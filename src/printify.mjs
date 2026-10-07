const DEFAULT_PRINTIFY_V1_BASE = 'https://api.printify.com/v1';
const DEFAULT_PRINTIFY_V2_BASE = 'https://api.printify.com/v2';

function cleanBase(value, fallback) {
  return String(value || fallback).trim().replace(/\/+$/, '');
}

function v1Base() {
  return cleanBase(process.env.PRINTIFY_API_URL, DEFAULT_PRINTIFY_V1_BASE);
}

function v2Base() {
  const configured = String(process.env.PRINTIFY_API_URL || '').trim();
  if (!configured) return DEFAULT_PRINTIFY_V2_BASE;
  const normalized = configured.replace(/\/+$/, '');
  if (/\/v1$/i.test(normalized)) return normalized.replace(/\/v1$/i, '/v2');
  return DEFAULT_PRINTIFY_V2_BASE;
}

function token() {
  return String(process.env.PRINTIFY_API_TOKEN || '').trim();
}

function configuredShopId() {
  return String(process.env.PRINTIFY_SHOP_ID || '').trim();
}

export function printifyConfigStatus() {
  return {
    ready: Boolean(token()),
    tokenConfigured: Boolean(token()),
    shopIdConfigured: Boolean(configuredShopId()),
    apiBaseUrl: v1Base(),
    apiV2BaseUrl: v2Base(),
    authentication: 'Bearer personal access token',
    catalogReadEnabled: Boolean(token()),
    liveSubmissionEnabled: false
  };
}

function cleanErrorBody(text) {
  const value = String(text || '').trim();
  if (!value) return '';
  try {
    const parsed = JSON.parse(value);
    return parsed?.message || parsed?.error || value.slice(0, 1000);
  } catch {
    return value.slice(0, 1000);
  }
}

async function printifyRequest(pathname, { method = 'GET', body, apiVersion = 'v1' } = {}) {
  const apiToken = token();
  if (!apiToken) throw new Error('PRINTIFY_API_TOKEN is not configured');

  const base = apiVersion === 'v2' ? v2Base() : v1Base();
  const url = pathname.startsWith('http')
    ? pathname
    : `${base}${pathname.startsWith('/') ? '' : '/'}${pathname}`;

  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${apiToken}`,
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json;charset=utf-8' } : {})
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });

  const text = await response.text();
  if (!response.ok) {
    const detail = cleanErrorBody(text);
    throw new Error(`Printify API ${response.status}${detail ? `: ${detail}` : ''}`);
  }
  if (!text) return null;
  return JSON.parse(text);
}

export async function getPrintifyShops() {
  const shops = await printifyRequest('/shops.json');
  return Array.isArray(shops) ? shops : [];
}

export async function resolvePrintifyShopId(shopId) {
  const supplied = String(shopId || configuredShopId()).trim();
  if (supplied) return supplied;

  const shops = await getPrintifyShops();
  if (shops.length === 1 && shops[0]?.id != null) return String(shops[0].id);
  if (!shops.length) throw new Error('No Printify shops are available for this API token');
  throw new Error('PRINTIFY_SHOP_ID is not configured and the token has access to multiple shops');
}

export async function getPrintifyBlueprints() {
  const rows = await printifyRequest('/catalog/blueprints.json');
  return Array.isArray(rows) ? rows : [];
}

export async function getPrintifyBlueprint(blueprintId) {
  return printifyRequest(`/catalog/blueprints/${encodeURIComponent(blueprintId)}.json`);
}

export async function getPrintifyPrintProviders(blueprintId) {
  const rows = await printifyRequest(
    `/catalog/blueprints/${encodeURIComponent(blueprintId)}/print_providers.json`
  );
  return Array.isArray(rows) ? rows : [];
}

export async function getPrintifyVariants(blueprintId, printProviderId) {
  return printifyRequest(
    `/catalog/blueprints/${encodeURIComponent(blueprintId)}/print_providers/${encodeURIComponent(printProviderId)}/variants.json`
  );
}

export async function getPrintifyShipping(blueprintId, printProviderId) {
  return printifyRequest(
    `/catalog/blueprints/${encodeURIComponent(blueprintId)}/print_providers/${encodeURIComponent(printProviderId)}/shipping.json`
  );
}

export async function getPrintifyShippingMethod(
  blueprintId,
  printProviderId,
  method = 'standard'
) {
  const shippingMethod = String(method || 'standard').trim().toLowerCase();
  const allowed = new Set(['standard', 'priority', 'express', 'economy']);
  if (!allowed.has(shippingMethod)) {
    throw new Error('Printify shipping method must be standard, priority, express, or economy');
  }
  return printifyRequest(
    `/catalog/blueprints/${encodeURIComponent(blueprintId)}/print_providers/${encodeURIComponent(printProviderId)}/shipping/${shippingMethod}.json`,
    { apiVersion: 'v2' }
  );
}

// Price-library probes create UNPUBLISHED products only.
export async function createPrintifyPricingDraft(payload, shopId) {
  const id = await resolvePrintifyShopId(shopId);
  return printifyRequest(`/shops/${encodeURIComponent(id)}/products.json`, {
    method: 'POST',
    body: {
      ...payload,
      visible: false
    }
  });
}

export async function deletePrintifyPricingDraft(productId, shopId) {
  if (!productId) throw new Error('Printify pricing draft ID required');
  const id = await resolvePrintifyShopId(shopId);
  return printifyRequest(
    `/shops/${encodeURIComponent(id)}/products/${encodeURIComponent(productId)}.json`,
    { method: 'DELETE' }
  );
}

export async function uploadPrintifyPricingImage(contents) {
  return printifyRequest('/uploads/images.json', {
    method: 'POST',
    body: {
      file_name: 'pricing-only-neutral-reference.png',
      contents
    }
  });
}

export async function getPrintifyProducts(shopId, { limit = 50 } = {}) {
  const id = await resolvePrintifyShopId(shopId);
  const products = [];
  const pageSize = Math.min(Math.max(Number(limit) || 50, 1), 50);

  for (let page = 1; page <= 100; page++) {
    const query = new URLSearchParams({
      page: String(page),
      limit: String(pageSize)
    });
    const payload = await printifyRequest(
      `/shops/${encodeURIComponent(id)}/products.json?${query}`
    );
    const batch = Array.isArray(payload?.data) ? payload.data : [];
    products.push(...batch);
    const lastPage = Number(payload?.last_page || 0);
    if (!batch.length || (lastPage && page >= lastPage) || batch.length < pageSize) break;
  }
  return products;
}

export async function findPrintifyWallArtBlueprints() {
  const blueprints = await getPrintifyBlueprints();
  const pattern = /(poster|canvas|framed|wall art|fine art|print)/i;
  return blueprints.filter((item) => pattern.test(String(item?.title || '')));
}

export async function testPrintifyConnection() {
  const [shops, blueprints] = await Promise.all([
    getPrintifyShops(),
    getPrintifyBlueprints()
  ]);

  return {
    ok: true,
    shopCount: shops.length,
    configuredShopId: configuredShopId() || null,
    catalogBlueprintCount: blueprints.length,
    wallArtBlueprintCount: blueprints.filter((item) =>
      /(poster|canvas|framed|wall art|fine art|print)/i.test(String(item?.title || ''))
    ).length,
    shops: shops.map(shop => ({
      id: shop?.id,
      title: shop?.title || '',
      salesChannel: shop?.sales_channel || ''
    }))
  };
}

export async function getPrintifyOrders(shopId, { page = 1, limit = 10 } = {}) {
  const id = await resolvePrintifyShopId(shopId);
  const query = new URLSearchParams({ page: String(page), limit: String(limit) });
  return printifyRequest(`/shops/${encodeURIComponent(id)}/orders.json?${query}`);
}

export async function createPrintifyOrder(shopId, payload = {}) {
  const masterEnabled = String(process.env.FULFILLMENT_LIVE_SUBMISSION_ENABLED || '').toLowerCase() === 'true';
  const providerEnabled = String(process.env.PRINTIFY_FULFILLMENT_ENABLED || '').toLowerCase() === 'true';
  if (!masterEnabled || !providerEnabled) {
    throw new Error('Printify live order submission is disabled');
  }

  const id = await resolvePrintifyShopId(shopId);
  return printifyRequest(`/shops/${encodeURIComponent(id)}/orders.json`, {
    method: 'POST',
    body: payload
  });
}
