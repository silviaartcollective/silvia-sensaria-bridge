// Gooten API (https://api.print.io/api/v/5/source/api). Every request carries
// the account's RecipeID in its URL; price estimates and orders also need the
// private PartnerBillingKey in the body. Endpoints as in Gooten's
// documentation and its official client (printdotio/gooten-js): products,
// productvariants (per destination country, with the partner price),
// shippingprices (shipping options for SKUs to an address), priceestimate and
// orders. Live orders stay off until GOOTEN_FULFILLMENT_ENABLED and
// FULFILLMENT_LIVE_SUBMISSION_ENABLED are both true; a test order
// (IsInTestMode) is used unless GOOTEN_LIVE_ORDERS is true as well.
import { providerRequest, ProviderApiError, redact } from './provider-http.mjs';

const PROVIDER = 'Gooten';
const DEFAULT_BASE = 'https://api.print.io/api/v/5/source/api';
const flag = name => String(process.env[name] || '').toLowerCase() === 'true';
const recipeId = () => String(process.env.GOOTEN_RECIPE_ID || '').trim();
const billingKey = () => String(process.env.GOOTEN_PARTNER_BILLING_KEY || '').trim();
const base = () => String(process.env.GOOTEN_API_URL || DEFAULT_BASE).trim().replace(/\/+$/, '');

export function gootenLiveSubmissionEnabled() {
  return flag('FULFILLMENT_LIVE_SUBMISSION_ENABLED') && flag('GOOTEN_FULFILLMENT_ENABLED');
}

export function gootenConfigStatus() {
  return {
    ready: Boolean(recipeId()),
    recipeIdConfigured: Boolean(recipeId()),
    partnerBillingKeyConfigured: Boolean(billingKey()),
    apiBaseUrl: base(),
    authentication: 'recipeId query parameter (GOOTEN_RECIPE_ID) + PartnerBillingKey (GOOTEN_PARTNER_BILLING_KEY) for price estimates and orders',
    catalogReadEnabled: Boolean(recipeId()),
    liveSubmissionEnabled: false
  };
}

export async function gootenRequest(endpoint, { method = 'GET', query = {}, body, retry, timeoutMs = 15000, fetchImpl } = {}) {
  if (!recipeId()) throw new ProviderApiError(PROVIDER, 'not-configured', 'GOOTEN_RECIPE_ID is not configured in Render.');
  const search = new URLSearchParams({ recipeId: recipeId(),
    ...Object.fromEntries(Object.entries(query).filter(([, v]) => v != null && v !== '').map(([k, v]) => [k, String(v)])) });
  const payload = await providerRequest(`${base()}/${endpoint}/?${search}`, {
    provider: PROVIDER, method, body, retry, timeoutMs, fetchImpl, secrets: [recipeId(), billingKey()]
  });
  // Gooten can answer 200 with HadError and an error list.
  if (payload?.HadError === true || (Array.isArray(payload?.Errors) && payload.Errors.length && !payload?.Id)) {
    const message = (payload.Errors || []).map(e => e?.ErrorMessage || e?.Message || e).join('; ') || 'Gooten reported an error.';
    const kind = /recipe|billing|key|unauthori|forbidden/i.test(message) ? 'invalid-credentials' : 'bad-request';
    throw new ProviderApiError(PROVIDER, kind, `Gooten: ${redact(String(message).slice(0, 300), [recipeId(), billingKey()])}`);
  }
  return payload;
}

export async function listGootenProducts({ countryCode = 'US', currencyCode = 'USD', fetchImpl } = {}) {
  const payload = await gootenRequest('products', { fetchImpl, query: { countryCode, currencyCode, languageCode: 'en', all: true } });
  if (!Array.isArray(payload?.Products)) throw new ProviderApiError(PROVIDER, 'malformed-response', 'Gooten products response had no Products list.');
  return payload.Products;
}

export async function listGootenVariants(productId, { countryCode = 'US', currencyCode = 'USD', fetchImpl } = {}) {
  const payload = await gootenRequest('productvariants', { fetchImpl, query: { productId, countryCode, currencyCode, languageCode: 'en', all: true } });
  if (!Array.isArray(payload?.ProductVariants)) throw new ProviderApiError(PROVIDER, 'malformed-response', 'Gooten productvariants response had no ProductVariants list.');
  return payload.ProductVariants;
}

// Shipping options for SKUs to an address (a read-only quote).
export async function getGootenShippingOptions({ items, postalCode, countryCode, state, currencyCode = 'USD', fetchImpl } = {}) {
  const payload = await gootenRequest('shippingprices', { method: 'POST', retry: true, fetchImpl,
    body: { ShipToPostalCode: postalCode, ShipToCountry: countryCode, ShipToState: state || undefined,
      CurrencyCode: currencyCode, LanguageCode: 'en', Items: items } });
  if (!Array.isArray(payload?.Result)) throw new ProviderApiError(PROVIDER, 'malformed-response', 'Gooten shippingprices response had no Result list.');
  return payload.Result;
}

// The whole price of a cart (items, shipping, tax) without placing an order.
export async function getGootenPriceEstimate({ address, items, fetchImpl } = {}) {
  if (!billingKey()) throw new ProviderApiError(PROVIDER, 'not-configured', 'GOOTEN_PARTNER_BILLING_KEY is not configured in Render.');
  return gootenRequest('priceestimate', { method: 'POST', retry: true, fetchImpl,
    body: { ShipToAddress: address, Items: items, Payment: { PartnerBillingKey: billingKey() } } });
}

// RecipeID is checked with the catalog; the private PartnerBillingKey with a
// price estimate for one catalog SKU (no order is created).
export async function testGootenConnection({ fetchImpl } = {}) {
  const products = await listGootenProducts({ countryCode: 'US', fetchImpl });
  const result = { ok: true, authenticated: true, productCount: products.length, partnerBillingKeyVerified: false,
    partnerBillingKeyConfigured: Boolean(billingKey()) };
  if (!billingKey()) return { ...result, note: 'RecipeID verified. Add GOOTEN_PARTNER_BILLING_KEY to price whole orders and submit them.' };
  const canvas = products.find(p => /canvas/i.test(p?.Name || '') && !p?.IsComingSoon) || products.find(p => !p?.IsComingSoon);
  const variant = canvas ? (await listGootenVariants(canvas.Id, { countryCode: 'US', fetchImpl }))[0] : null;
  if (!variant?.Sku) return { ...result, note: 'RecipeID verified; no catalog SKU was available to verify the billing key.' };
  const estimate = await getGootenPriceEstimate({ fetchImpl, address: { countryCode: 'US', postalCode: '64105', state: 'MO' },
    items: [{ SKU: variant.Sku, ShipCarrierMethodId: 1, Quantity: 1 }] });
  return { ...result, partnerBillingKeyVerified: estimate?.Items?.Price != null || estimate?.Total != null };
}

// ---- Orders: never called by a comparison or a connection test. ----

function assertSubmissionAllowed() {
  if (!gootenLiveSubmissionEnabled())
    throw new ProviderApiError(PROVIDER, 'not-configured', 'Gooten order submission is disabled (GOOTEN_FULFILLMENT_ENABLED and FULFILLMENT_LIVE_SUBMISSION_ENABLED must both be true).');
  if (!billingKey()) throw new ProviderApiError(PROVIDER, 'not-configured', 'GOOTEN_PARTNER_BILLING_KEY is required to submit orders.');
}

// Submits an order once: the hook refuses a repeat of the same source ID and
// the request itself is never retried. A test order unless GOOTEN_LIVE_ORDERS.
export async function submitGootenOrder({ sourceId, shipTo, billingAddress, items, alreadySubmitted, fetchImpl } = {}) {
  assertSubmissionAllowed();
  const id = String(sourceId || '').trim();
  if (!id) throw new Error('A Gooten order needs a source ID.');
  if (typeof alreadySubmitted !== 'function') throw new Error('A duplicate-order check is required to submit a Gooten order.');
  if (await alreadySubmitted(id)) return { duplicate: true, order: null };
  const order = await gootenRequest('orders', { method: 'POST', retry: false, fetchImpl,
    body: { ShipToAddress: shipTo, BillingAddress: billingAddress || shipTo, Items: items, SourceId: id,
      IsInTestMode: !flag('GOOTEN_LIVE_ORDERS'), Payment: { PartnerBillingKey: billingKey() } } });
  return { duplicate: false, order, testMode: !flag('GOOTEN_LIVE_ORDERS') };
}

export function gootenOrderItem({ sku, quantity = 1, shipCarrierMethodId = 1, fileUrl, sourceId }) {
  return { SKU: String(sku), Quantity: Number(quantity) || 1, ShipCarrierMethodId: Number(shipCarrierMethodId) || 1,
    Images: [{ Index: 0, Url: String(fileUrl) }], ...(sourceId ? { SourceId: String(sourceId) } : {}) };
}

export async function getGootenOrder(orderId, { fetchImpl } = {}) {
  return gootenRequest('orders', { fetchImpl, query: { id: String(orderId || '').trim() } });
}

// Shipped items with tracking. Item statuses and shipment fields as in the
// documentation's order example, read defensively.
export function gootenShipments(order) {
  const items = Array.isArray(order?.Items) ? order.Items : [];
  const statuses = [...new Set(items.map(i => String(i?.Status || '').toLowerCase()).filter(Boolean))];
  const seen = new Set(), shipments = [];
  for (const item of items) for (const s of Array.isArray(item?.Shipments) ? item.Shipments : []) {
    const number = String(s?.TrackingNumber || s?.TrackingCode || '');
    if (!number || seen.has(number)) continue;
    seen.add(number);
    shipments.push({ trackingNumber: number, trackingUrl: String(s?.TrackingUrl || s?.TrackingURL || ''),
      carrier: String(s?.CarrierName || s?.Carrier || s?.ShipCarrier || ''), shipmentId: String(s?.Id ?? ''),
      status: 'shipped', source: 'gooten_api' });
  }
  return { status: statuses.join(', ') || 'unknown', shipments };
}
