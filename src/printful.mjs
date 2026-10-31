// Printful API v2 (https://api.printful.com, Bearer private token; an
// account-level token also needs X-PF-Store-Id). Endpoints as in Printful's
// v2 OpenAPI document: catalog categories, products, variants and prices,
// shipping rates, orders (created as drafts, then confirmed) and shipments.
// Live orders stay off until PRINTFUL_FULFILLMENT_ENABLED and
// FULFILLMENT_LIVE_SUBMISSION_ENABLED are both true.
import { providerRequest, ProviderApiError } from './provider-http.mjs';

const PROVIDER = 'Printful';
const DEFAULT_BASE = 'https://api.printful.com';
const flag = name => String(process.env[name] || '').toLowerCase() === 'true';
const token = () => String(process.env.PRINTFUL_API_TOKEN || '').trim();
const storeId = () => String(process.env.PRINTFUL_STORE_ID || '').trim();
const base = () => String(process.env.PRINTFUL_API_URL || DEFAULT_BASE).trim().replace(/\/+$/, '');

export function printfulLiveSubmissionEnabled() {
  return flag('FULFILLMENT_LIVE_SUBMISSION_ENABLED') && flag('PRINTFUL_FULFILLMENT_ENABLED');
}

export function printfulConfigStatus() {
  return {
    ready: Boolean(token()),
    apiKeyConfigured: Boolean(token()),
    storeIdConfigured: Boolean(storeId()),
    apiBaseUrl: base(),
    authentication: 'Authorization: Bearer PRINTFUL_API_TOKEN (+ X-PF-Store-Id from PRINTFUL_STORE_ID for an account-level token)',
    catalogReadEnabled: Boolean(token()),
    liveSubmissionEnabled: false
  };
}

export async function printfulRequest(path, { method = 'GET', query, body, retry, timeoutMs = 15000, fetchImpl } = {}) {
  const key = token();
  if (!key) throw new ProviderApiError(PROVIDER, 'not-configured', 'PRINTFUL_API_TOKEN is not configured in Render.');
  const search = query ? '?' + new URLSearchParams(Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : String(v)])).toString() : '';
  return providerRequest(base() + path + (search === '?' ? '' : search), {
    provider: PROVIDER, method, body, retry, timeoutMs, fetchImpl,
    headers: { Authorization: `Bearer ${key}`, ...(storeId() ? { 'X-PF-Store-Id': storeId() } : {}) },
    secrets: [key]
  });
}

const dataOf = (payload, what) => {
  const data = payload?.data ?? payload?.result;
  if (data === undefined) throw new ProviderApiError(PROVIDER, 'malformed-response', `Printful returned no data for ${what}.`);
  return data;
};

// An authenticated request: the stores endpoint needs a valid token (the
// public catalog does not), so success proves the credentials.
export async function testPrintfulConnection({ fetchImpl } = {}) {
  const stores = dataOf(await printfulRequest('/v2/stores', { fetchImpl, timeoutMs: 12000 }), 'stores');
  if (!Array.isArray(stores)) throw new ProviderApiError(PROVIDER, 'malformed-response', 'Printful stores response was not a list.');
  return { ok: true, authenticated: true, storeCount: stores.length,
    storeIdConfigured: Boolean(storeId()), needsStoreId: stores.length > 1 && !storeId() };
}

export async function listPrintfulCategories({ fetchImpl } = {}) {
  const data = dataOf(await printfulRequest('/v2/catalog-categories', { fetchImpl }), 'catalog categories');
  if (!Array.isArray(data)) throw new ProviderApiError(PROVIDER, 'malformed-response', 'Printful catalog categories were not a list.');
  return data;
}

export async function listPrintfulProducts({ categoryIds = [], destinationCountry, fetchImpl, maxPages = 20 } = {}) {
  const products = [];
  for (let page = 0, offset = 0; page < maxPages; page++) {
    const payload = await printfulRequest('/v2/catalog-products', { fetchImpl,
      query: { category_ids: categoryIds, destination_country: destinationCountry, limit: 100, offset } });
    const data = dataOf(payload, 'catalog products');
    if (!Array.isArray(data)) throw new ProviderApiError(PROVIDER, 'malformed-response', 'Printful catalog products were not a list.');
    products.push(...data);
    const total = Number(payload?.paging?.total);
    offset += data.length;
    if (!data.length || data.length < 100 || (Number.isFinite(total) && offset >= total)) break;
  }
  return products;
}

export async function listPrintfulVariants(productId, { fetchImpl } = {}) {
  const data = dataOf(await printfulRequest(`/v2/catalog-products/${encodeURIComponent(productId)}/catalog-variants`, { fetchImpl }), 'catalog variants');
  if (!Array.isArray(data)) throw new ProviderApiError(PROVIDER, 'malformed-response', 'Printful catalog variants were not a list.');
  return data;
}

// { currency, product, variants: [{ id, techniques: [{ technique_key, price, discounted_price }] }] }
export async function getPrintfulProductPrices(productId, { currency = 'USD', fetchImpl } = {}) {
  const data = dataOf(await printfulRequest(`/v2/catalog-products/${encodeURIComponent(productId)}/prices`, { fetchImpl, query: { currency } }), 'product prices');
  if (!data || !Array.isArray(data.variants)) throw new ProviderApiError(PROVIDER, 'malformed-response', 'Printful product prices had no variant list.');
  return data;
}

// A read-only quote, safe to repeat. recipient: { country_code, state_code, zip, city, address1 }
export async function getPrintfulShippingRates({ recipient, items, currency = 'USD', fetchImpl } = {}) {
  const data = dataOf(await printfulRequest('/v2/shipping-rates', { method: 'POST', retry: true, fetchImpl,
    body: { recipient, order_items: items, currency } }), 'shipping rates');
  if (!Array.isArray(data)) throw new ProviderApiError(PROVIDER, 'malformed-response', 'Printful shipping rates were not a list.');
  return data;
}

// ---- Orders: never called by a comparison or a connection test. ----

function assertSubmissionAllowed() {
  if (!printfulLiveSubmissionEnabled())
    throw new ProviderApiError(PROVIDER, 'not-configured', 'Printful order submission is disabled (PRINTFUL_FULFILLMENT_ENABLED and FULFILLMENT_LIVE_SUBMISSION_ENABLED must both be true).');
}

// The order with this external ID, or null. Printful accepts "@<external_id>" for an order ID.
export async function findPrintfulOrderByExternalId(externalId, { fetchImpl } = {}) {
  try { return dataOf(await printfulRequest(`/v2/orders/@${encodeURIComponent(externalId)}`, { fetchImpl }), 'order'); }
  catch (error) { if (error?.kind === 'not-found') return null; throw error; }
}

// A draft order (Printful does not charge or produce a draft). An order that
// already exists under this external ID is returned instead of a second one,
// and the create request itself is never retried.
export async function createPrintfulDraftOrder({ externalId, recipient, items, shipping = 'STANDARD', fetchImpl } = {}) {
  assertSubmissionAllowed();
  const id = String(externalId || '').trim();
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(id)) throw new Error('A Printful order needs an external ID (letters, digits, - or _, up to 32).');
  if (!recipient?.country_code || !recipient?.address1 || !recipient?.name) throw new Error('A complete recipient address is required.');
  if (!Array.isArray(items) || !items.length) throw new Error('At least one order item is required.');
  const existing = await findPrintfulOrderByExternalId(id, { fetchImpl });
  if (existing) return { duplicate: true, order: existing };
  const order = dataOf(await printfulRequest('/v2/orders', { method: 'POST', retry: false, fetchImpl,
    body: { external_id: id, shipping, recipient, order_items: items } }), 'created order');
  return { duplicate: false, order };
}

export async function confirmPrintfulOrder(orderId, { fetchImpl } = {}) {
  assertSubmissionAllowed();
  return dataOf(await printfulRequest(`/v2/orders/${encodeURIComponent(orderId)}/confirmation`, { method: 'POST', retry: false, fetchImpl }), 'order confirmation');
}

// A catalog order item with the artwork from its R2 URL.
export function printfulOrderItem({ catalogVariantId, quantity = 1, fileUrl, externalId }) {
  return { source: 'catalog', catalog_variant_id: Number(catalogVariantId), quantity: Number(quantity) || 1,
    ...(externalId ? { external_id: String(externalId) } : {}),
    placements: [{ placement: 'default', technique: 'digital', layers: [{ type: 'file', url: String(fileUrl) }] }] };
}

export async function getPrintfulOrderTracking(orderId, { fetchImpl } = {}) {
  const id = String(orderId || '').trim();
  const path = /^\d+$/.test(id) ? id : '@' + encodeURIComponent(id.replace(/^@/, ''));
  const [order, shipments] = await Promise.all([
    printfulRequest(`/v2/orders/${path}`, { fetchImpl }).then(p => dataOf(p, 'order')),
    printfulRequest(`/v2/orders/${path}/shipments`, { fetchImpl }).then(p => dataOf(p, 'shipments'))
  ]);
  return { order, shipments: Array.isArray(shipments) ? shipments : [] };
}

// Shipped packages with tracking, from getPrintfulOrderTracking.
export function printfulShipments(payload) {
  const status = String(payload?.order?.status || 'unknown').toLowerCase();
  const shipments = (payload?.shipments || []).filter(s => s?.tracking_number &&
    (['shipped', 'returned'].includes(String(s.shipment_status || '').toLowerCase()) || s?.shipped_at))
    .map(s => ({ trackingNumber: String(s.tracking_number), trackingUrl: String(s.tracking_url || ''), carrier: String(s.carrier || ''),
      shipmentId: String(s.id ?? ''), status: 'shipped', deliveryStatus: String(s.delivery_status || ''), source: 'printful_api' }));
  return { status, shipments };
}
