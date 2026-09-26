import { SILVIA_CURRENT_MARKETS } from './markets.mjs';

export const PRINTSHRIMP_API_BASE = 'https://api.printshrimp.com/functions/v1';

export const PRINTSHRIMP_FRAMED_SIZES = Object.freeze([
  '8x10','11x14','12x18','16x20','16x24','18x24','24x36'
]);

// 12x16 is an Silvia storefront size, but it is not present in PrintShrimp's
// documented API size enum. Live /api-get-pricing responses can be used to
// detect future support without hard-coding it.
export const PRINTSHRIMP_UNCONFIRMED_SILVIA_SIZES = Object.freeze(['12x16']);

export const PRINTSHRIMP_FRAME_FINISHES = Object.freeze(['Black', 'White', 'Oak']);

function apiKey() {
  return String(process.env.PRINTSHRIMP_API_KEY || '').trim();
}

export function printShrimpConfigStatus() {
  return {
    ready: Boolean(apiKey()),
    apiKeyConfigured: Boolean(apiKey()),
    apiBaseUrl: PRINTSHRIMP_API_BASE,
    authentication: 'x-api-key',
    frameFinishes: PRINTSHRIMP_FRAME_FINISHES,
    documentedFramedSizes: PRINTSHRIMP_FRAMED_SIZES,
    unconfirmedSilviaSizes: PRINTSHRIMP_UNCONFIRMED_SILVIA_SIZES,
    currentMarkets: SILVIA_CURRENT_MARKETS,
    taxPolicy: {
      mode: 'supplier-handled',
      quoteBasis: 'Live API product price + shipping once per order',
      vat: 'VAT is already included in API price fields when returned',
      duties: 'No extra import-duty buffer; PrintShrimp confirmed on 2026-09-22 that rare tax/tariff charges are covered by them',
      profitBasis: 'Treat live API price + shipping as the working landed supplier cost'
    }
  };
}

function cleanErrorBody(text) {
  const value = String(text || '').trim();
  if (!value) return '';
  try {
    const parsed = JSON.parse(value);
    return parsed?.error || parsed?.message || value.slice(0, 1000);
  } catch {
    return value.slice(0, 1000);
  }
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function printShrimpRequest(pathname, {
  method = 'GET',
  query,
  body,
  retry429 = true
} = {}) {
  const key = apiKey();
  if (!key) throw new Error('PRINTSHRIMP_API_KEY is not configured');

  const url = new URL(
    pathname.startsWith('http') ? pathname : PRINTSHRIMP_API_BASE + (pathname.startsWith('/') ? pathname : '/' + pathname)
  );
  for (const [name, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null && String(value) !== '') {
      url.searchParams.set(name, String(value));
    }
  }

  const response = await fetch(url, {
    method,
    headers: {
      'x-api-key': key,
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });

  const text = await response.text();
  if (!response.ok) {
    const detail = cleanErrorBody(text);
    if (response.status === 429 && retry429) {
      const retryAfter = Number(response.headers.get('retry-after') || 0);
      await wait(Math.max(1000, retryAfter * 1000 || 2500));
      return printShrimpRequest(pathname, { method, query, body, retry429: false });
    }
    throw new Error(`PrintShrimp API ${response.status}${detail ? `: ${detail}` : ''}`);
  }

  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('PrintShrimp returned a non-JSON response');
  }
}

function normalizeCountry(country) {
  const value = String(country || '').trim();
  if (!value) throw new Error('PrintShrimp country is required');
  return value.length === 2 ? value.toUpperCase() : value;
}

export async function getPrintShrimpPricing(country) {
  const resolved = normalizeCountry(country);
  const raw = await printShrimpRequest('/api-get-pricing', {
    query: { country: resolved }
  });

  const rows = Array.isArray(raw?.sizes)
    ? raw.sizes.map(entry => ({
        size: entry?.size || '',
        print: entry?.print ?? null,
        frame: entry?.frame ?? null
      }))
    : [];

  return {
    ok: Boolean(raw?.success ?? true),
    country: raw?.country || resolved,
    currency: raw?.currency || 'GBP',
    sizes: rows,
    framedSizes: rows.filter(row => row.frame).map(row => row.size),
    raw
  };
}

export async function testPrintShrimpConnection(country = 'CA') {
  const result = await getPrintShrimpPricing(country);
  return {
    ok: true,
    country: result.country,
    currency: result.currency,
    sizeCount: result.sizes.length,
    framedSizeCount: result.framedSizes.length,
    framedSizes: result.framedSizes
  };
}

function requireText(value, field) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`PrintShrimp ${field} is required`);
  return text;
}

export async function createPrintShrimpProduct({ name, sku, variants = [] }) {
  const payload = {
    name: requireText(name, 'product name'),
    sku: requireText(sku, 'product SKU')
  };
  if (variants.length) payload.variants = variants;
  return printShrimpRequest('/api-create-product', { method: 'POST', body: payload });
}

export async function updatePrintShrimpProduct(payload = {}) {
  if (!payload?.sku) throw new Error('PrintShrimp existing product SKU is required');
  return printShrimpRequest('/api-update-product', { method: 'PUT', body: payload });
}

export async function deletePrintShrimpProduct({
  sku,
  productId,
  size,
  variantSku,
  variantId
} = {}) {
  const query = {};
  if (sku) query.sku = sku;
  if (productId) query.product_id = productId;
  if (size) query.size = size;
  if (variantSku) query.variant_sku = variantSku;
  if (variantId) query.variant_id = variantId;
  if (!Object.keys(query).length) throw new Error('PrintShrimp product or variant selector is required');
  return printShrimpRequest('/api-delete-product', { method: 'DELETE', query });
}

export async function getPrintShrimpProduct({ sku, page } = {}) {
  return printShrimpRequest('/api-get-product', { query: { sku, page } });
}

function validateCustomerInfo(customerInfo = {}) {
  const required = ['name', 'address1', 'city', 'zip', 'country'];
  for (const field of required) requireText(customerInfo[field], `customerInfo.${field}`);
  const country = String(customerInfo.country).trim().toUpperCase();
  if (['US', 'CA', 'AU'].includes(country)) requireText(customerInfo.state, 'customerInfo.state');
}

function validateOrderProduct(product = {}) {
  requireText(product.size, 'order product size');
  const hasSku = Boolean(String(product.sku || '').trim());
  const hasArtwork = Boolean(String(product?.image?.artwork_url || '').trim());
  if (hasSku === hasArtwork) {
    throw new Error('Each PrintShrimp order item must use exactly one mode: sku OR image.artwork_url');
  }
  const type = String(product.type || 'Print').toLowerCase();
  if (type === 'frame') {
    const variant = requireText(product.variant, 'frame variant');
    if (!PRINTSHRIMP_FRAME_FINISHES.some(value => value.toLowerCase() === variant.toLowerCase())) {
      throw new Error('PrintShrimp frame variant must be Black, White, or Oak');
    }
  } else {
    requireText(product.paper_type, 'print paper_type');
  }
}

export async function createPrintShrimpOrder(payload = {}) {
  validateCustomerInfo(payload.customerInfo || {});
  if (!Array.isArray(payload.products) || !payload.products.length) {
    throw new Error('PrintShrimp order requires at least one product');
  }
  payload.products.forEach(validateOrderProduct);

  return printShrimpRequest('/api-create-order', {
    method: 'POST',
    body: payload
  });
}

export async function validatePrintShrimpOrderPreview(payload = {}) {
  validateCustomerInfo(payload.customerInfo || {});
  if (!Array.isArray(payload.products) || !payload.products.length) {
    throw new Error('PrintShrimp validation requires at least one product');
  }
  payload.products.forEach(validateOrderProduct);

  const country = normalizeCountry(payload.customerInfo.country);
  const pricing = await getPrintShrimpPricing(country);
  const checks = payload.products.map(product => {
    const row = pricing.sizes.find(item => String(item?.size || '') === String(product.size || ''));
    const frame = row?.frame || null;
    return {
      size: product.size,
      variant: product.variant,
      quantity: Number(product.quantity || 1),
      supported: Boolean(frame),
      liveFramePrice: frame?.price ?? null,
      liveShipping: frame?.shipping ?? null,
      vatRate: frame?.vat_rate ?? null,
      vatAmount: frame?.vat_amount ?? null
    };
  });

  const unsupported = checks.filter(item => !item.supported);
  if (unsupported.length) {
    throw new Error(`PrintShrimp live pricing does not support: ${unsupported.map(item => item.size).join(', ')}`);
  }

  return {
    ok: true,
    country: pricing.country,
    currency: pricing.currency,
    checks,
    multiItem: {
      lineCount: payload.products.length,
      totalQuantity: payload.products.reduce((sum, product) => sum + Math.max(1, Number(product.quantity || 1)), 0),
      combinedShippingConfirmed: false,
      createOrderCalled: false,
      note: 'Live validation confirms supported sizes and current per-size pricing only. Combined multi-item shipping is not treated as verified until PrintShrimp documents a non-production order preview/hold flow.'
    }
  };
}

export async function getPrintShrimpOrder({
  orderId,
  externalOrderNumber,
  page
} = {}) {
  return printShrimpRequest('/api-get-order', {
    query: {
      order_id: orderId,
      external_order_number: externalOrderNumber,
      page
    }
  });
}
