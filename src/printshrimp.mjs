import { SILVIA_CURRENT_MARKETS } from './markets.mjs';
import { printShrimpQuotedBasketTotal } from './printshrimp-basket-cost.mjs';

export const PRINTSHRIMP_API_BASE = 'https://api.printshrimp.com/functions/v1';

// PrintShrimp API order size enum; a live destination-specific price is still
// required to establish actual print/frame availability.
export const PRINTSHRIMP_PRINT_SIZES = Object.freeze([
  '8x10','11x14','12x16','12x18','16x20','16x24','18x24','24x36','30x40'
]);

export const PRINTSHRIMP_FRAMED_SIZES = Object.freeze([
  '8x10','11x14','12x16','12x18','16x20','16x24','18x24','24x36'
]);

// API explicitly accepts 12x16 as an order alias of 30x40cm. Whether a
// destination supports the framed form is determined by the live frame quote.
export const PRINTSHRIMP_UNCONFIRMED_SILVIA_SIZES = Object.freeze([]);

export const PRINTSHRIMP_PRINT_PAPER_TYPE = 'Matte';
export const PRINTSHRIMP_PAPER_TYPES = Object.freeze(['Matte', 'Satin', 'Gloss']);

export function printShrimpPriceRow(pricing, size) {
  const aliases = String(size) === '12x16' ? ['12x16', '30x40cm']
    : String(size) === '20x28' ? ['20x28', '50x70cm'] : [String(size)];
  return (pricing?.sizes || []).find(row => aliases.includes(String(row?.size || ''))) || null;
}

export const PRINTSHRIMP_FRAME_FINISHES = Object.freeze(['Black', 'White', 'Oak']);

// Published policy: 20% off print production prices when 3+ prints go
// to the same address. Frames do not qualify. This is a planning
// estimate until the supplier confirms the discounted order total.
export function estimatePrintShrimpBulkPrintDiscount(products = []) {
  const printItems = (products || []).filter(item =>
    String(item?.type || '').toLowerCase() === 'print'
  );
  const printQuantity = printItems.reduce(
    (sum, item) => sum + Math.max(1, Number(item.quantity || 1)), 0
  );
  const eligible = printQuantity >= 3;
  const subtotal = printItems.reduce((sum, item) => {
    const unitPrice = Number(item.unitPrice);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) return Number.NaN;
    return sum + unitPrice * Math.max(1, Number(item.quantity || 1));
  }, 0);
  const discount = eligible && Number.isFinite(subtotal)
    ? Math.round(subtotal * 0.2 * 100) / 100 : 0;
  return {
    eligible,
    printQuantity,
    discountRate: eligible ? 0.2 : 0,
    printSubtotal: Number.isFinite(subtotal) ? Math.round(subtotal * 100) / 100 : null,
    estimatedDiscount: Number.isFinite(subtotal) ? discount : null,
    note: 'Published print-only quantity discount estimate; shipping, VAT and exact combined checkout total must be confirmed.'
  };
}


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
    publishedPrintSizes: PRINTSHRIMP_PRINT_SIZES,
    printPaperType: PRINTSHRIMP_PRINT_PAPER_TYPE,
    unconfirmedSilviaSizes: PRINTSHRIMP_UNCONFIRMED_SILVIA_SIZES,
    currentMarkets: SILVIA_CURRENT_MARKETS,
    taxPolicy: {
      mode: 'import-tariff-covered-sales-tax-unverified',
      quoteBasis: 'API supplies both print and frame prices in GBP; use its returned currency for conversion',
      vat: 'VAT is already included in API price fields when returned',
      duties: 'Supplier email on 2026-09-21 says rare import tariffs are covered by PrintShrimp; separately assessed local sales tax remains unverified',
      profitBasis: 'Treat API price + one-order shipping as the quoted supplier cost; separately assessed local sales tax remains unverified'
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
    printCurrency: raw?.currency || 'GBP',
    frameCurrency: raw?.currency || 'GBP',
    sizes: rows,
    framedSizes: rows.filter(row => row.frame).map(row => row.size),
    printSizes: rows.filter(row => row.print).map(row => row.size),
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
    printSizeCount: result.printSizes.length,
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
    const paper = requireText(product.paper_type, 'print paper_type');
    if (!PRINTSHRIMP_PAPER_TYPES.includes(paper)) {
      throw new Error('PrintShrimp paper_type must be Matte, Satin, or Gloss');
    }
  }
}

export async function createPrintShrimpOrder(payload = {}) {
  if(String(process.env.FULFILLMENT_LIVE_SUBMISSION_ENABLED||'').toLowerCase()!=='true' ||
     String(process.env.PRINTSHRIMP_FULFILLMENT_ENABLED||'').toLowerCase()!=='true')
    throw new Error('PrintShrimp production order submission is disabled.');
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
    const row = printShrimpPriceRow(pricing, product.size);
    const isFrame = String(product.type || 'Print').toLowerCase() === 'frame';
    const item = isFrame ? row?.frame : row?.print;
    return {
      size: product.size,
      type: isFrame ? 'Frame' : 'Print',
      variant: product.variant || '',
      quantity: Number(product.quantity || 1),
      supported: Boolean(item) && item.price != null && item.shipping != null,
      livePrice: item?.price ?? null,
      liveFramePrice: isFrame ? item?.price ?? null : null,
      liveShipping: item?.shipping ?? null,
      currency: item?.currency || (isFrame ? pricing.frameCurrency : pricing.printCurrency) || pricing.currency,
      vatRate: item?.vat_rate ?? null,
      vatAmount: item?.vat_amount ?? null
    };
  });

  const bulkPrintDiscount = estimatePrintShrimpBulkPrintDiscount(
    payload.products.map((product, index) => ({
      type: String(product.type || 'Print'),
      quantity: product.quantity,
      unitPrice: checks[index]?.livePrice
    }))
  );

  const unsupported = checks.filter(item => !item.supported);
  if (unsupported.length) {
    throw new Error(`PrintShrimp live pricing does not support: ${unsupported.map(item => item.size).join(', ')}`);
  }

  const basketQuote = printShrimpQuotedBasketTotal(checks);

  return {
    ok: true,
    country: pricing.country,
    currency: pricing.currency,
    checks,
    bulkPrintDiscount,
    multiItem: {
      ...basketQuote,
      combinedShippingConfirmed: true,
      createOrderCalled: false,
      note: 'Authenticated API docs state shipping is charged once per order and only the first item pays it. The published 3+ print discount remains planning-only and is not automatically deducted from this quoted basket total.'
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
