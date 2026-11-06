// Lumaprints API v1 (open beta; https://us.api.lumaprints.com/api/v1, sandbox
// https://us.api-sandbox.lumaprints.com/api/v1). HTTP Basic authentication
// with the API key and secret from Developer > API Keys. Endpoints as in its
// documentation: categories, subcategories and options, product cost
// (pricing/product), shipping cost (pricing/shipping), stores, orders and
// shipments. Lumaprints prints any size within a subcategory's limits.
// Live orders stay off until LUMAPRINTS_FULFILLMENT_ENABLED and
// FULFILLMENT_LIVE_SUBMISSION_ENABLED are both true.
import { providerRequest, ProviderApiError } from './provider-http.mjs';

const PROVIDER = 'Lumaprints';
const LIVE_BASE = 'https://us.api.lumaprints.com/api/v1';
const SANDBOX_BASE = 'https://us.api-sandbox.lumaprints.com/api/v1';
const flag = name => String(process.env[name] || '').toLowerCase() === 'true';
const key = () => String(process.env.LUMAPRINTS_API_KEY || '').trim();
const secret = () => String(process.env.LUMAPRINTS_API_SECRET || '').trim();
const storeId = () => String(process.env.LUMAPRINTS_STORE_ID || '').trim();
const base = () => String(process.env.LUMAPRINTS_API_URL || (flag('LUMAPRINTS_SANDBOX') ? SANDBOX_BASE : LIVE_BASE)).trim().replace(/\/+$/, '');
// The API's prices carry no currency field; Lumaprints bills its US accounts in USD.
export const lumaprintsCurrency = () => String(process.env.LUMAPRINTS_PRICE_CURRENCY || 'USD').trim().toUpperCase();

export function lumaprintsLiveSubmissionEnabled() {
  return flag('FULFILLMENT_LIVE_SUBMISSION_ENABLED') && flag('LUMAPRINTS_FULFILLMENT_ENABLED');
}

export function lumaprintsConfigStatus() {
  const ready = Boolean(key() && secret());
  return {
    ready,
    apiKeyConfigured: Boolean(key()),
    apiSecretConfigured: Boolean(secret()),
    storeIdConfigured: Boolean(storeId()),
    sandbox: base() === SANDBOX_BASE,
    apiBaseUrl: base(),
    authentication: 'HTTP Basic (LUMAPRINTS_API_KEY : LUMAPRINTS_API_SECRET)',
    catalogReadEnabled: ready,
    priceCurrency: lumaprintsCurrency(),
    liveSubmissionEnabled: false
  };
}

export async function lumaprintsRequest(path, { method = 'GET', body, query, retry, timeoutMs = 15000, fetchImpl } = {}) {
  if (!key() || !secret()) throw new ProviderApiError(PROVIDER, 'not-configured', 'LUMAPRINTS_API_KEY and LUMAPRINTS_API_SECRET are not configured in Render.');
  const auth = Buffer.from(`${key()}:${secret()}`).toString('base64');
  const search = query ? '?' + new URLSearchParams(Object.entries(query).filter(([, v]) => v != null && v !== '')).toString() : '';
  return providerRequest(base() + path + (search === '?' ? '' : search), {
    provider: PROVIDER, method, body, retry, timeoutMs, fetchImpl,
    headers: { Authorization: `Basic ${auth}` }, secrets: [key(), secret(), auth]
  });
}

// A list from a response that may wrap it ({ data: [...] }, { results: [...] }…).
export function listOf(payload, ...names) {
  if (Array.isArray(payload)) return payload;
  for (const name of [...names, 'data', 'results', 'items', 'result']) if (Array.isArray(payload?.[name])) return payload[name];
  return null;
}
const requireList = (payload, what, ...names) => {
  const list = listOf(payload, ...names);
  if (!list) throw new ProviderApiError(PROVIDER, 'malformed-response', `Lumaprints ${what} response was not a list.`);
  return list;
};

// Authenticated: the stores list needs the API key and secret.
export async function testLumaprintsConnection({ fetchImpl } = {}) {
  const stores = requireList(await lumaprintsRequest('/stores', { fetchImpl, timeoutMs: 12000 }), 'stores', 'stores');
  return { ok: true, authenticated: true, storeCount: stores.length, sandbox: base() === SANDBOX_BASE,
    storeIdConfigured: Boolean(storeId()) };
}

export const listLumaprintsCategories = async ({ fetchImpl } = {}) =>
  requireList(await lumaprintsRequest('/products/categories', { fetchImpl }), 'categories', 'categories');
export const listLumaprintsSubcategories = async (categoryId, { fetchImpl } = {}) =>
  requireList(await lumaprintsRequest(`/products/categories/${encodeURIComponent(categoryId)}/subcategories`, { fetchImpl }), 'subcategories', 'subcategories');
export const listLumaprintsOptions = async (subcategoryId, { fetchImpl } = {}) =>
  requireList(await lumaprintsRequest(`/products/subcategories/${encodeURIComponent(subcategoryId)}/options`, { fetchImpl }), 'options', 'options', 'optionGroups');

// Product cost for one size with options (a read-only calculation).
export async function getLumaprintsProductPrice({ subcategoryId, width, height, optionIds = [], fetchImpl } = {}) {
  return lumaprintsRequest('/pricing/product', { method: 'POST', retry: true, fetchImpl,
    body: { subcategoryId: Number(subcategoryId), width: Number(width), height: Number(height), orderItemOptions: optionIds.map(Number) } });
}

// Shipping cost for one item to an address: the payload of an order without its file.
export async function getLumaprintsShippingPrice({ recipient, subcategoryId, width, height, optionIds = [], quantity = 1, fetchImpl } = {}) {
  try {
    return await lumaprintsRequest('/pricing/shipping', { method: 'POST', retry: true, fetchImpl,
      body: { recipient, orderItems: [{ subcategoryId: Number(subcategoryId), quantity, width: Number(width), height: Number(height),
        orderItemOptions: optionIds.map(id => ({ optionId: Number(id) })) }] } });
  } catch (error) {
    // 406 is Lumaprints' "No shipping method available" for the address.
    if (error?.status === 406) throw new ProviderApiError(PROVIDER, 'destination-unsupported', 'Lumaprints: no shipping method available to this destination for this product.', { status: 406 });
    throw error;
  }
}

// ---- Orders: never called by a comparison or a connection test. ----

function assertSubmissionAllowed() {
  if (!lumaprintsLiveSubmissionEnabled())
    throw new ProviderApiError(PROVIDER, 'not-configured', 'Lumaprints order submission is disabled (LUMAPRINTS_FULFILLMENT_ENABLED and FULFILLMENT_LIVE_SUBMISSION_ENABLED must both be true).');
  if (!storeId()) throw new ProviderApiError(PROVIDER, 'not-configured', 'LUMAPRINTS_STORE_ID (a Standard Store) is required to submit orders.');
}

// The order with this external ID among recent orders of the store, or null.
export async function findLumaprintsOrderByExternalId(externalId, { fetchImpl } = {}) {
  const orders = listOf(await lumaprintsRequest('/orders', { fetchImpl, query: { storeId: storeId() || undefined, page: 1 } }), 'orders') || [];
  return orders.find(o => String(o?.externalId || o?.externalOrderId || '') === String(externalId)) || null;
}

// Submits an order once: an existing order with this external ID is returned
// instead, the hook can refuse a repeat, and the request itself is not retried.
export async function submitLumaprintsOrder({ externalId, recipient, items, shippingMethod = 'default', alreadySubmitted, fetchImpl } = {}) {
  assertSubmissionAllowed();
  const id = String(externalId || '').trim();
  if (!id) throw new Error('A Lumaprints order needs an external ID.');
  if (typeof alreadySubmitted === 'function' && await alreadySubmitted(id)) return { duplicate: true, order: null };
  const existing = await findLumaprintsOrderByExternalId(id, { fetchImpl });
  if (existing) return { duplicate: true, order: existing };
  const order = await lumaprintsRequest('/orders', { method: 'POST', retry: false, fetchImpl,
    body: { externalId: id, storeId: Number(storeId()), shippingMethod, recipient, orderItems: items } });
  return { duplicate: false, order };
}

export function lumaprintsOrderItem({ externalItemId, subcategoryId, width, height, optionIds = [], fileUrl, quantity = 1 }) {
  return { externalItemId: String(externalItemId || ''), subcategoryId: Number(subcategoryId), quantity: Number(quantity) || 1,
    width: Number(width), height: Number(height), file: { imageUrl: String(fileUrl) },
    orderItemOptions: optionIds.map(optionId => ({ optionId: Number(optionId) })) };
}

export async function getLumaprintsOrderTracking(orderNumber, { fetchImpl } = {}) {
  const id = encodeURIComponent(String(orderNumber || '').trim());
  const [order, shipments] = await Promise.all([
    lumaprintsRequest(`/orders/${id}`, { fetchImpl }),
    lumaprintsRequest(`/orders/${id}/shipments`, { fetchImpl }).catch(error => { if (error?.kind === 'not-found') return []; throw error; })
  ]);
  return { order, shipments: listOf(shipments, 'shipments') || [] };
}

// Shipped packages with tracking. The response field names come from the
// documentation's examples and are read defensively.
export function lumaprintsShipments(payload) {
  const order = payload?.order?.data || payload?.order || {};
  const status = String(order?.orderStatus || order?.status || 'unknown').toLowerCase();
  const rows = [...(payload?.shipments || []), ...(Array.isArray(order?.shipments) ? order.shipments : [])];
  const seen = new Set();
  const shipments = rows.map(s => ({ trackingNumber: String(s?.trackingNumber || s?.tracking_number || s?.trackingCode || ''),
    trackingUrl: String(s?.trackingUrl || s?.tracking_url || ''), carrier: String(s?.carrier || s?.carrierName || s?.shippingCarrier || ''),
    shipmentId: String(s?.id ?? s?.shipmentId ?? ''), status: 'shipped', source: 'lumaprints_api' }))
    .filter(s => s.trackingNumber && !seen.has(s.trackingNumber) && seen.add(s.trackingNumber));
  return { status, shipments };
}
