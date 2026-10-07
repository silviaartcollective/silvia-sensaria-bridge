import { readFileSync } from 'node:fs';
import { SILVIA_CURRENT_MARKETS } from './markets.mjs';

const PRODIGI_API_BASE_DEFAULT = 'https://api.prodigi.com/v4.0';

const sensariaShipping = JSON.parse(
  readFileSync(new URL('../config/sensaria-shipping.json', import.meta.url), 'utf8')
);

function apiBase() {
  return String(
    process.env.PRODIGI_API_URL ||
    process.env.PRODIGI_LIVE_API_URL ||
    PRODIGI_API_BASE_DEFAULT
  ).trim().replace(/\/$/, '');
}

export const PRODIGI_FRAMED_POSTER_SIZES = Object.freeze([
  { label: '8x10', sku: 'GLOBAL-CFP-8X10' },
  { label: '11x14', sku: 'GLOBAL-CFP-11X14' },
  { label: '12x16', sku: 'GLOBAL-CFP-12X16' },
  { label: '12x18', sku: 'GLOBAL-CFP-12X18' },
  { label: '16x20', sku: 'GLOBAL-CFP-16X20' },
  { label: '16x24', sku: 'GLOBAL-CFP-16X24' },
  { label: '18x24', sku: 'GLOBAL-CFP-18X24' },
  { label: '24x36', sku: 'GLOBAL-CFP-24X36' }
]);

const POSTER_SIZES = Object.freeze(['8x10','11x14','12x16','12x18','16x20','16x24','18x24','24x36','30x40']);
const CANVAS_SIZES = Object.freeze(['12x16','12x18','16x20','16x24','18x24','24x36','30x40','40x60']);
const FRAME_FINISHES = Object.freeze([
  { code: 'BLK', label: 'Black', prodigi: 'Black' },
  { code: 'WHT', label: 'White', prodigi: 'White' },
  { code: 'NAT', label: 'Natural', prodigi: 'Natural' },
  { code: 'DWD', label: 'Dark Wood', prodigi: 'Brown' }
]);

function sku(prefix, size) {
  return prefix + '-' + String(size).toUpperCase();
}

export const PRODIGI_SILVIA_CATALOG = Object.freeze({
  P: Object.freeze({
    code: 'P',
    label: 'Poster',
    prodigiProduct: 'Enhanced matte art paper',
    skuPrefix: 'GLOBAL-FAP',
    entries: Object.freeze(POSTER_SIZES.map(size => Object.freeze({
      productCode: 'P',
      product: 'Poster',
      size,
      finishCode: 'NONE',
      finish: '—',
      sku: sku('GLOBAL-FAP', size),
      desiredAttributes: Object.freeze({})
    })))
  }),
  FP: Object.freeze({
    code: 'FP',
    label: 'Framed Poster',
    prodigiProduct: 'Classic framed print',
    skuPrefix: 'GLOBAL-CFP',
    entries: Object.freeze(PRODIGI_FRAMED_POSTER_SIZES.flatMap(size =>
      FRAME_FINISHES.map(finish => Object.freeze({
        productCode: 'FP',
        product: 'Framed Poster',
        size: size.label,
        finishCode: finish.code,
        finish: finish.label,
        sku: size.sku,
        desiredAttributes: Object.freeze({ frameColour: finish.prodigi })
      }))
    ))
  }),
  C: Object.freeze({
    code: 'C',
    label: 'Canvas',
    prodigiProduct: '38mm stretched canvas',
    skuPrefix: 'GLOBAL-CAN',
    entries: Object.freeze(CANVAS_SIZES.map(size => Object.freeze({
      productCode: 'C',
      product: 'Canvas',
      size,
      finishCode: 'NONE',
      finish: '—',
      sku: sku('GLOBAL-CAN', size),
      desiredAttributes: Object.freeze({ wrap: 'MirrorWrap' })
    })))
  }),
  FC: Object.freeze({
    code: 'FC',
    label: 'Framed Canvas',
    prodigiProduct: '38mm float framed canvas',
    skuPrefix: 'GLOBAL-FRA-CAN',
    entries: Object.freeze(CANVAS_SIZES.flatMap(size =>
      FRAME_FINISHES.map(finish => Object.freeze({
        productCode: 'FC',
        product: 'Framed Canvas',
        size,
        finishCode: finish.code,
        finish: finish.label,
        sku: sku('GLOBAL-FRA-CAN', size),
        desiredAttributes: Object.freeze({ frameColour: finish.prodigi })
      }))
    ))
  })
});

export const PRODIGI_SILVIA_ENTRIES = Object.freeze(
  Object.values(PRODIGI_SILVIA_CATALOG).flatMap(group => group.entries)
);

const SENSARIA_ZONE_BY_COUNTRY = Object.freeze({ ...(sensariaShipping.countryZones || {}) });

const SENSARIA_BASIC_SHIPPING = Object.freeze(
  Object.fromEntries(
    Object.entries(sensariaShipping.basicRates || {}).map(([group, rates]) => [
      group,
      Object.freeze({ ...rates })
    ])
  )
);

export { SILVIA_CURRENT_MARKETS };

export const PRODIGI_DESTINATIONS = Object.freeze([
  ...SILVIA_CURRENT_MARKETS,
  { code: 'GB', label: 'United Kingdom' },
  { code: 'JP', label: 'Japan' },
  { code: 'KR', label: 'South Korea' },
  { code: 'AU', label: 'Australia' },
  { code: 'NZ', label: 'New Zealand' },
  { code: 'SG', label: 'Singapore' },
  { code: 'NO', label: 'Norway' },
  { code: 'CH', label: 'Switzerland' }
]);

const productCache = new Map();
const productRequestCache = new Map();

const PRODIGI_RATE_LIMIT_MAX_REQUESTS = 29;
const PRODIGI_RATE_LIMIT_WINDOW_MS = 30_000;
const PRODIGI_RATE_LIMIT_SAFETY_MS = 750;
const PRODIGI_MAX_429_RETRIES = 4;

const prodigiRequestStarts = [];
let prodigiRateLimitGate = Promise.resolve();

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function retryAfterMilliseconds(response) {
  const raw = String(response?.headers?.get?.('retry-after') || '').trim();
  if (!raw) return PRODIGI_RATE_LIMIT_WINDOW_MS + PRODIGI_RATE_LIMIT_SAFETY_MS;

  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.max(
      PRODIGI_RATE_LIMIT_WINDOW_MS + PRODIGI_RATE_LIMIT_SAFETY_MS,
      Math.ceil(seconds * 1000) + PRODIGI_RATE_LIMIT_SAFETY_MS
    );
  }

  const date = Date.parse(raw);
  if (Number.isFinite(date)) {
    return Math.max(
      PRODIGI_RATE_LIMIT_WINDOW_MS + PRODIGI_RATE_LIMIT_SAFETY_MS,
      date - Date.now() + PRODIGI_RATE_LIMIT_SAFETY_MS
    );
  }

  return PRODIGI_RATE_LIMIT_WINDOW_MS + PRODIGI_RATE_LIMIT_SAFETY_MS;
}

async function waitForProdigiRequestSlot() {
  let release;
  const previous = prodigiRateLimitGate;
  prodigiRateLimitGate = new Promise(resolve => {
    release = resolve;
  });

  await previous;
  try {
    while (true) {
      const now = Date.now();
      const cutoff = now - PRODIGI_RATE_LIMIT_WINDOW_MS;
      while (prodigiRequestStarts.length && prodigiRequestStarts[0] <= cutoff) {
        prodigiRequestStarts.shift();
      }

      if (prodigiRequestStarts.length < PRODIGI_RATE_LIMIT_MAX_REQUESTS) {
        prodigiRequestStarts.push(now);
        return;
      }

      const waitMs = Math.max(
        1,
        prodigiRequestStarts[0] + PRODIGI_RATE_LIMIT_WINDOW_MS - now + PRODIGI_RATE_LIMIT_SAFETY_MS
      );
      await sleep(waitMs);
    }
  } finally {
    release();
  }
}

function apiKey() {
  return String(
    process.env.PRODIGI_API_KEY ||
    process.env.PRODIGI_LIVE_API_KEY ||
    ''
  ).trim();
}

export function prodigiConfigStatus() {
  return {
    ready: Boolean(apiKey()),
    apiKeyConfigured: Boolean(apiKey()),
    apiBaseUrl: apiBase(),
    product: {
      family: 'Classic framed print',
      skuPrefix: 'GLOBAL-CFP',
      frameColour: 'Brown',
      currency: 'USD'
    },
    destinations: PRODIGI_DESTINATIONS,
    currentMarkets: SILVIA_CURRENT_MARKETS,
    sizes: PRODIGI_FRAMED_POSTER_SIZES.map(item => item.label),
    silviaCatalog: Object.fromEntries(Object.entries(PRODIGI_SILVIA_CATALOG).map(([code, group]) => [code, {
      label: group.label,
      prodigiProduct: group.prodigiProduct,
      skuPrefix: group.skuPrefix,
      variants: group.entries.length
    }])),
    taxPolicy: {
      mode: 'order-time-tax',
      quoteBasis: 'Quote API product + shipping before tax',
      salesTaxVat: 'Prodigi calculates applicable sales tax/VAT when the order is placed',
      customs: 'Cross-border customs/import charges may still apply depending on the fulfilment path',
      profitBasis: 'Treat Quote API totals as pre-tax planning costs until the final charged supplier total is known'
    }
  };
}

function cleanErrorBody(text) {
  const value = String(text || '').trim();
  if (!value) return '';
  try {
    const parsed = JSON.parse(value);
    const issues = Array.isArray(parsed?.issues)
      ? parsed.issues.map(issue => issue?.description || issue?.errorCode).filter(Boolean).join(' · ')
      : '';
    return parsed?.error_description || parsed?.error || parsed?.message || issues || value.slice(0, 1000);
  } catch {
    return value.slice(0, 1000);
  }
}

async function prodigiRequest(pathname, { method = 'GET', body } = {}) {
  const key = apiKey();
  if (!key) throw new Error('PRODIGI_API_KEY is not configured');

  const url = pathname.startsWith('http')
    ? pathname
    : `${apiBase()}${pathname.startsWith('/') ? '' : '/'}${pathname}`;

  for (let attempt = 0; ; attempt += 1) {
    await waitForProdigiRequestSlot();

    const response = await fetch(url, {
      method,
      headers: {
        'X-API-Key': key,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });

    const text = await response.text();
    if (response.ok) {
      if (!text) return null;
      return JSON.parse(text);
    }

    const detail = cleanErrorBody(text);
    const error = new Error(`Prodigi API ${response.status}${detail ? `: ${detail}` : ''}`);
    error.status = response.status;
    error.retryAfterMs = response.status === 429 ? retryAfterMilliseconds(response) : 0;

    if (response.status !== 429 || attempt >= PRODIGI_MAX_429_RETRIES) {
      throw error;
    }

    // Prodigi admits at most 30 calls per 30 seconds. The global request gate
    // keeps normal scans just under that ceiling; this backoff handles any
    // remaining 429s caused by overlapping requests or provider-side timing.
    await sleep(error.retryAfterMs + (attempt * 1000));
  }
}

function destinationByCode(code) {
  const normalized = String(code || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized)) return null;
  return PRODIGI_DESTINATIONS.find(item => item.code === normalized) || {
    code: normalized,
    label: normalized
  };
}

function sizeByLabel(label) {
  return PRODIGI_FRAMED_POSTER_SIZES.find(item => item.label === String(label || '')) || null;
}

async function getProductDetails(sku) {
  if (productCache.has(sku)) return productCache.get(sku);
  if (productRequestCache.has(sku)) return productRequestCache.get(sku);

  const pending = (async () => {
    const raw = await prodigiRequest(`/products/${encodeURIComponent(sku)}`);
    const product = raw?.product || raw;
    if (!product?.sku) throw new Error(`Prodigi returned no product details for ${sku}`);
    productCache.set(sku, product);
    return product;
  })();

  productRequestCache.set(sku, pending);
  try {
    return await pending;
  } finally {
    productRequestCache.delete(sku);
  }
}

function isBrown(value) {
  return String(value || '').trim().toLowerCase() === 'brown';
}

function isFrameColourKey(key) {
  const value = String(key || '').trim();
  // Prodigi also exposes a generic "frame" attribute whose values describe
  // the frame construction (for example "Classic" or
  // "Float frame, 38mm standard stretcher bar"). That is NOT the colour.
  return /frame.*colou?r/i.test(value) ||
    /colou?r.*frame/i.test(value) ||
    /^colou?r$/i.test(value) ||
    /^color$/i.test(value);
}

function frameColourKeyScore(key) {
  const normalized = normalizeAttributeName(key);
  if (normalized === 'framecolour' || normalized === 'framecolor') return 100;
  if ((normalized.includes('frame') && normalized.includes('colour')) ||
      (normalized.includes('frame') && normalized.includes('color'))) return 90;
  if (normalized === 'colour' || normalized === 'color') return 80;
  return isFrameColourKey(key) ? 50 : -1;
}

function brownAttributesForDestination(product, countryCode) {
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  const country = String(countryCode || '').toUpperCase();

  const brownVariants = variants.filter(variant => {
    const attrs = variant?.attributes && typeof variant.attributes === 'object' ? variant.attributes : {};
    return Object.entries(attrs).some(([key, value]) =>
      isFrameColourKey(key) && isBrown(value)
    );
  });

  const destinationVariant = brownVariants.find(variant =>
    !Array.isArray(variant?.shipsTo) ||
    variant.shipsTo.length === 0 ||
    variant.shipsTo.map(code => String(code).toUpperCase()).includes(country)
  );

  if (destinationVariant?.attributes) return destinationVariant.attributes;

  if (brownVariants.length) {
    throw new Error(`Brown frame exists for ${product.sku}, but Prodigi does not list ${country} as a supported destination for that variant`);
  }

  const attributeEntries = Object.entries(product?.attributes || {});
  const frameEntry = attributeEntries.find(([key, values]) =>
    isFrameColourKey(key) &&
    Array.isArray(values) &&
    values.some(value => isBrown(value))
  );
  if (frameEntry) {
    const [key, values] = frameEntry;
    const brown = Array.isArray(values)
      ? values.find(value => isBrown(value))
      : null;
    if (brown != null) return { [key]: brown };
  }

  throw new Error(`Brown frame attribute was not found for ${product?.sku || 'this SKU'}`);
}


function normalizeAttributeName(value) {
  return String(value || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function attributeKeysFor(product) {
  const keys = new Set(Object.keys(product?.attributes || {}));
  for (const variant of Array.isArray(product?.variants) ? product.variants : []) {
    const attrs = variant?.attributes && typeof variant.attributes === 'object' ? variant.attributes : {};
    Object.keys(attrs).forEach(key => keys.add(key));
  }
  return [...keys];
}

function attributeKeyFor(product, requestedName) {
  const normalized = normalizeAttributeName(requestedName);
  const keys = attributeKeysFor(product);
  if (normalized === 'framecolour') {
    return keys
      .map(key => ({ key, score: frameColourKeyScore(key) }))
      .filter(item => item.score >= 0)
      .sort((a, b) => b.score - a.score)[0]?.key || null;
  }
  return keys.find(key => normalizeAttributeName(key) === normalized) || null;
}

function attributeScalar(value) {
  if (value == null) return '';
  if (typeof value === 'object') {
    return value.value ?? value.name ?? value.label ?? value.id ?? '';
  }
  return value;
}

function attributeValueMatches(requestedName, candidate, wanted) {
  const actual = String(attributeScalar(candidate)).trim().toLowerCase();
  const target = String(attributeScalar(wanted)).trim().toLowerCase();
  if (!actual || !target) return false;
  if (actual === target) return true;

  if (normalizeAttributeName(requestedName) === 'framecolour') {
    const a = normalizeAttributeName(actual);
    const t = normalizeAttributeName(target);
    if (t === 'black') return a.includes('black');
    if (t === 'white') return a.includes('white');
    if (t === 'natural') return a.includes('natural');
    if (t === 'brown') return a.includes('brown');
  }

  return false;
}

function availableAttributeValues(product, key) {
  const values = [];
  const root = product?.attributes?.[key];
  if (Array.isArray(root)) values.push(...root);
  for (const variant of Array.isArray(product?.variants) ? product.variants : []) {
    const attrs = variant?.attributes && typeof variant.attributes === 'object' ? variant.attributes : {};
    if (attrs[key] != null) values.push(attrs[key]);
  }
  return [...new Set(values.map(value => String(attributeScalar(value)).trim()).filter(Boolean))];
}

export function resolveProdigiAttributesForDestination(product, countryCode, desired = {}) {
  const country = String(countryCode || '').toUpperCase();
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  const requirements = [];

  for (const [requestedName, wanted] of Object.entries(desired || {})) {
    const key = attributeKeyFor(product, requestedName);
    if (!key) throw new Error(`Prodigi attribute ${requestedName} was not found for ${product?.sku || 'this SKU'}`);

    const values = availableAttributeValues(product, key);
    const matchedValue = values.find(value => attributeValueMatches(requestedName, value, wanted));
    if (matchedValue == null) {
      const available = values.length ? ` Available: ${values.join(', ')}.` : '';
      throw new Error(`Prodigi ${requestedName} ${wanted} was not found for ${product?.sku || 'this SKU'}.${available}`);
    }
    requirements.push({ requestedName, key, wanted, matchedValue });
  }

  if (!requirements.length) return {};

  const variantMatches = variant => {
    const attrs = variant?.attributes && typeof variant.attributes === 'object' ? variant.attributes : {};
    return requirements.every(req => attributeValueMatches(req.requestedName, attrs[req.key], req.wanted));
  };

  const matching = variants.find(variant => {
    if (!variantMatches(variant)) return false;
    return !Array.isArray(variant?.shipsTo) ||
      variant.shipsTo.length === 0 ||
      variant.shipsTo.map(code => String(code).toUpperCase()).includes(country);
  });

  if (matching?.attributes) return matching.attributes;

  if (variants.some(variantMatches)) {
    throw new Error(`Requested Prodigi variant exists for ${product?.sku || 'this SKU'}, but is not listed for ${country}`);
  }

  return Object.fromEntries(requirements.map(req => [req.key, req.matchedValue]));
}

function canvasShippingGroup(size) {
  const [width, height] = String(size || '').toLowerCase().split('x').map(Number);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return 'Default';
  const totalOuterDimensions = 2 * (width + height);
  if (totalOuterDimensions > 220) return 'Canvas Oversized';
  if (totalOuterDimensions >= 170) return 'Canvas Large';
  if (totalOuterDimensions >= 132) return 'Canvas Medium';
  return 'Default';
}

function sensariaShippingGroup(entry) {
  if (entry.productCode === 'P') return 'Rolled Substrates';
  if (entry.productCode === 'FP') return 'Framed Prints';
  if (entry.productCode === 'C' || entry.productCode === 'FC') return canvasShippingGroup(entry.size);
  return 'Default';
}

function sensariaFinishCode(entry) {
  if (entry.productCode === 'FP' && entry.finishCode === 'DWD') return 'WAL';
  if (entry.productCode === 'FC' && entry.finishCode === 'DWD') return 'BRN';
  if (entry.finishCode === 'NONE') return 'NONE';
  return entry.finishCode;
}

export function getSensariaComparison({
  countryCode,
  entry,
  sensariaProducts = {}
}) {
  const country = String(countryCode || '').toUpperCase();
  const zone = SENSARIA_ZONE_BY_COUNTRY[country] || null;
  const group = sensariaShippingGroup(entry);
  const finish = sensariaFinishCode(entry);
  const productKey = `${entry.productCode}|${entry.size}|${finish}`;
  const config = sensariaProducts?.[productKey] || null;
  // Missing supplier costs or unavailable shipping are NOT free shipping.
  // Number(null) would silently convert a missing quote into an eligible $0 route.
  const listedProduction = config?.costUsd;
  const listedShipping = zone && zone !== 'UNDELIVERABLE'
    ? SENSARIA_BASIC_SHIPPING?.[group]?.[zone]
    : null;
  const productionCost = listedProduction == null || listedProduction === '' ? Number.NaN : Number(listedProduction);
  const shippingCost = listedShipping == null || listedShipping === '' ? Number.NaN : Number(listedShipping);
  const production = Number.isFinite(productionCost) ? productionCost : null;
  const shipping = Number.isFinite(shippingCost) ? shippingCost : null;

  return {
    productKey,
    friendlySku: config?.friendlySku || '',
    productionCost: production,
    shippingCost: shipping,
    totalBeforeTax: production != null && shipping != null ? production + shipping : null,
    shippingZone: zone,
    shippingGroup: group,
    shippingBasis: entry.productCode === 'FC'
      ? 'Captured Sensaria Basic shipping using the matching canvas outer-dimension band; Sensaria export has no separate framed-canvas shipping group.'
      : 'Captured Sensaria Basic per-item shipping.',
    taxNote: country === 'US'
      ? 'US route comparison; no import-duty buffer modeled.'
      : 'Sensaria states duties and taxes are the recipient responsibility when applicable; not included in this comparison.'
  };
}

async function getProdigiArteQuote({
  countryCode,
  entry,
  copies = 1,
  shippingMethod
}) {
  const destination = destinationByCode(countryCode);
  if (!destination) throw new Error(`Unsupported Prodigi scan destination: ${countryCode}`);

  const product = await getProductDetails(entry.sku);
  const attributes = resolveProdigiAttributesForDestination(product, destination.code, entry.desiredAttributes);

  const payload = {
    destinationCountryCode: destination.code,
    currencyCode: 'USD',
    items: [{
      sku: entry.sku,
      copies,
      attributes,
      assets: [{ printArea: 'default' }]
    }]
  };
  if (shippingMethod) payload.shippingMethod = shippingMethod;

  const raw = await prodigiRequest('/quotes', { method: 'POST', body: payload });

  const quotes = Array.isArray(raw?.quotes) ? raw.quotes : [];
  if (!quotes.length) {
    const issues = Array.isArray(raw?.issues)
      ? raw.issues.map(issue => issue?.description || issue?.errorCode).filter(Boolean).join(' · ')
      : '';
    throw new Error(issues || 'Prodigi returned no quote');
  }

  const selected = shippingMethod ? quotes[0] : chooseCheapestQuote(quotes);
  const itemCost = numberFromCost(selected?.costSummary?.items);
  const shippingCost = numberFromCost(selected?.costSummary?.shipping);
  const shipments = Array.isArray(selected?.shipments) ? selected.shipments : [];

  return {
    countryCode: destination.code,
    country: destination.label,
    productCode: entry.productCode,
    product: entry.product,
    size: entry.size,
    finishCode: entry.finishCode,
    finish: entry.finish,
    sku: entry.sku,
    copies,
    attributes,
    currency: selected?.costSummary?.items?.currency || selected?.costSummary?.shipping?.currency || 'USD',
    shippingMethod: selected?.shipmentMethod || shippingMethod || '',
    productionCost: itemCost,
    shippingCost,
    totalBeforeTax: itemCost != null && shippingCost != null ? itemCost + shippingCost : null,
    fulfillmentLocations: [...new Set(shipments.map(shipment => shipment?.fulfillmentLocation?.countryCode).filter(Boolean))],
    labCodes: [...new Set(shipments.map(shipment => shipment?.fulfillmentLocation?.labCode).filter(Boolean))],
    carriers: [...new Set(shipments.map(shipment => [shipment?.carrier?.name, shipment?.carrier?.service].filter(Boolean).join(' / ')).filter(Boolean))],
    issues: Array.isArray(raw?.issues) ? raw.issues : []
  };
}

function numberFromCost(cost) {
  const value = Number(cost?.amount);
  return Number.isFinite(value) ? value : null;
}

function quoteTotal(quote) {
  const items = numberFromCost(quote?.costSummary?.items);
  const shipping = numberFromCost(quote?.costSummary?.shipping);
  if (items == null || shipping == null) return Number.POSITIVE_INFINITY;
  return items + shipping;
}

function chooseCheapestQuote(quotes) {
  return [...quotes].sort((a, b) => quoteTotal(a) - quoteTotal(b))[0] || null;
}

export async function getProdigiClassicFrameQuote({
  countryCode,
  size,
  copies = 1,
  shippingMethod
}) {
  const destination = destinationByCode(countryCode);
  if (!destination) throw new Error(`Unsupported Prodigi scan destination: ${countryCode}`);

  const sizeConfig = sizeByLabel(size);
  if (!sizeConfig) throw new Error(`Unsupported Prodigi framed-poster size: ${size}`);

  const product = await getProductDetails(sizeConfig.sku);
  const attributes = brownAttributesForDestination(product, destination.code);

  const payload = {
    destinationCountryCode: destination.code,
    currencyCode: 'USD',
    items: [{
      sku: sizeConfig.sku,
      copies,
      attributes,
      assets: [{ printArea: 'default' }]
    }]
  };
  if (shippingMethod) payload.shippingMethod = shippingMethod;

  const raw = await prodigiRequest('/quotes', { method: 'POST', body: payload });
  const quotes = Array.isArray(raw?.quotes) ? raw.quotes : [];
  if (!quotes.length) {
    const issues = Array.isArray(raw?.issues)
      ? raw.issues.map(issue => issue?.description || issue?.errorCode).filter(Boolean).join(' · ')
      : '';
    throw new Error(issues || 'Prodigi returned no quote');
  }

  const selected = shippingMethod
    ? quotes[0]
    : chooseCheapestQuote(quotes);

  const itemCost = numberFromCost(selected?.costSummary?.items);
  const shippingCost = numberFromCost(selected?.costSummary?.shipping);
  const shipments = Array.isArray(selected?.shipments) ? selected.shipments : [];
  const fulfillmentLocations = [...new Set(shipments
    .map(shipment => shipment?.fulfillmentLocation?.countryCode)
    .filter(Boolean))];
  const labCodes = [...new Set(shipments
    .map(shipment => shipment?.fulfillmentLocation?.labCode)
    .filter(Boolean))];
  const carriers = [...new Set(shipments
    .map(shipment => [shipment?.carrier?.name, shipment?.carrier?.service].filter(Boolean).join(' / '))
    .filter(Boolean))];

  return {
    countryCode: destination.code,
    country: destination.label,
    size: sizeConfig.label,
    sku: sizeConfig.sku,
    copies,
    frameColour: 'Brown',
    attributes,
    currency: selected?.costSummary?.items?.currency || selected?.costSummary?.shipping?.currency || 'USD',
    shippingMethod: selected?.shipmentMethod || shippingMethod || '',
    productionCost: itemCost,
    shippingCost,
    totalBeforeTax: itemCost != null && shippingCost != null ? itemCost + shippingCost : null,
    fulfillmentLocations,
    labCodes,
    carriers,
    availableMethods: quotes.map(quote => ({
      shippingMethod: quote?.shipmentMethod || '',
      productionCost: numberFromCost(quote?.costSummary?.items),
      shippingCost: numberFromCost(quote?.costSummary?.shipping),
      totalBeforeTax: quoteTotal(quote)
    })),
    issues: Array.isArray(raw?.issues) ? raw.issues : []
  };
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;

  async function worker() {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  }

  const count = Math.max(1, Math.min(Number(limit) || 1, items.length || 1));
  await Promise.all(Array.from({ length: count }, () => worker()));
  return results;
}

export async function createProdigiOrder(payload = {}) {
  const shippingMethod = String(payload?.shippingMethod || '').trim();
  const recipient = payload?.recipient || {};
  const items = Array.isArray(payload?.items) ? payload.items : [];

  if (!shippingMethod) throw new Error('Prodigi order requires a validated shippingMethod');
  if (!recipient?.name || !recipient?.address?.line1 || !recipient?.address?.postalOrZipCode ||
      !recipient?.address?.countryCode || !recipient?.address?.townOrCity) {
    throw new Error('Prodigi order requires a complete recipient name and shipping address');
  }
  if (!items.length) throw new Error('Prodigi order requires at least one item');

  for (const item of items) {
    if (!item?.sku || !Number(item?.copies) || !Array.isArray(item?.assets) || !item.assets.length) {
      throw new Error('Prodigi order item is incomplete');
    }
    for (const asset of item.assets) {
      if (!asset?.printArea || !asset?.url) throw new Error('Prodigi order asset requires printArea and url');
    }
  }

  return prodigiRequest('/orders', {
    method: 'POST',
    body: payload
  });
}

export async function cancelProdigiOrder(orderId) {
  const id = String(orderId || '').trim();
  if (!id) throw new Error('Prodigi cancel requires an order ID');
  return prodigiRequest(`/orders/${encodeURIComponent(id)}/actions/cancel`, {
    method: 'POST'
  });
}

export async function validateProdigiOrderQuote({
  countryCode,
  items = [],
  currencyCode = 'USD'
} = {}) {
  const destination = destinationByCode(String(countryCode || '').toUpperCase());
  if (!destination) throw new Error(`Unsupported Prodigi validation destination: ${countryCode}`);
  if (!Array.isArray(items) || !items.length) throw new Error('Prodigi validation requires at least one item');

  const resolvedItems = [];
  for (const item of items) {
    const sku = String(item?.sku || '').trim();
    if (!sku) throw new Error('Prodigi validation item is missing sku');
    const copies = Math.max(1, Number(item?.copies || 1));
    const product = await getProductDetails(sku);
    const attributes = resolveProdigiAttributesForDestination(
      product,
      destination.code,
      item?.attributes || {}
    );
    resolvedItems.push({
      sku,
      copies,
      attributes,
      assets: [{ printArea: 'default' }]
    });
  }

  const raw = await prodigiRequest('/quotes', {
    method: 'POST',
    body: {
      destinationCountryCode: destination.code,
      currencyCode,
      items: resolvedItems
    }
  });

  const quotes = Array.isArray(raw?.quotes) ? raw.quotes : [];
  if (!quotes.length) {
    const issues = Array.isArray(raw?.issues)
      ? raw.issues.map(issue => issue?.description || issue?.errorCode).filter(Boolean).join(' · ')
      : '';
    throw new Error(issues || 'Prodigi returned no validation quote');
  }

  const selected = chooseCheapestQuote(quotes);
  const itemCost = numberFromCost(selected?.costSummary?.items);
  const shippingCost = numberFromCost(selected?.costSummary?.shipping);

  return {
    ok: true,
    countryCode: destination.code,
    currency: selected?.costSummary?.items?.currency || selected?.costSummary?.shipping?.currency || currencyCode,
    shippingMethod: selected?.shipmentMethod || '',
    productionCost: itemCost,
    shippingCost,
    totalBeforeTax: itemCost != null && shippingCost != null ? itemCost + shippingCost : null,
    resolvedItems,
    availableMethods: quotes.map(quote => ({
      shippingMethod: quote?.shipmentMethod || '',
      productionCost: numberFromCost(quote?.costSummary?.items),
      shippingCost: numberFromCost(quote?.costSummary?.shipping),
      totalBeforeTax: quoteTotal(quote)
    })),
    issues: Array.isArray(raw?.issues) ? raw.issues : []
  };
}

export async function scanProdigiClassicFrames({
  countryCodes = SILVIA_CURRENT_MARKETS.map(item => item.code),
  copies = 1,
  shippingMethod
} = {}) {
  const wanted = [...new Set(countryCodes.map(code => String(code || '').toUpperCase()).filter(Boolean))];
  const destinations = wanted.map(code => {
    const match = destinationByCode(code);
    if (!match) throw new Error(`Unsupported Prodigi scan destination: ${code}`);
    return match;
  });

  const tasks = destinations.flatMap(destination =>
    PRODIGI_FRAMED_POSTER_SIZES.map(size => ({
      countryCode: destination.code,
      country: destination.label,
      size: size.label
    }))
  );

  const rows = await mapLimit(tasks, 8, async task => {
    try {
      return await getProdigiClassicFrameQuote({
        countryCode: task.countryCode,
        size: task.size,
        copies,
        shippingMethod
      });
    } catch (error) {
      return {
        countryCode: task.countryCode,
        country: task.country,
        size: task.size,
        copies,
        frameColour: 'Brown',
        currency: 'USD',
        shippingMethod: shippingMethod || '',
        productionCost: null,
        shippingCost: null,
        totalBeforeTax: null,
        fulfillmentLocations: [],
        labCodes: [],
        carriers: [],
        availableMethods: [],
        issues: [],
        error: error.message
      };
    }
  });

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    configuration: {
      product: 'Classic framed print',
      skuPrefix: 'GLOBAL-CFP',
      frameColour: 'Brown',
      currencyCode: 'USD',
      shippingMethod: shippingMethod || 'cheapest available'
    },
    note: 'Prodigi Quote API values are product + shipping before tax. When no shipping method is requested, the scanner selects the cheapest method returned and records its fulfillment location.',
    rows
  };
}


export async function scanProdigiSilviaCatalog({
  countryCodes = ['CA'],
  productCodes = ['P','FP','C','FC'],
  copies = 1,
  shippingMethod,
  sensariaProducts = {}
} = {}) {
  const wantedCountries = [...new Set((countryCodes || []).map(code => String(code || '').toUpperCase()).filter(Boolean))];
  const wantedProducts = [...new Set((productCodes || []).map(code => String(code || '').toUpperCase()).filter(Boolean))];

  const destinations = wantedCountries.map(code => {
    const match = destinationByCode(code);
    if (!match) throw new Error(`Unsupported Prodigi comparison destination: ${code}`);
    return match;
  });

  const catalogEntries = wantedProducts.flatMap(code => {
    const group = PRODIGI_SILVIA_CATALOG[code];
    if (!group) throw new Error(`Unsupported Silvia product code for Prodigi comparison: ${code}`);
    return group.entries;
  });

  const tasks = destinations.flatMap(destination =>
    catalogEntries.map(entry => ({ destination, entry }))
  );

  const rows = await mapLimit(tasks, 6, async task => {
    const sensaria = getSensariaComparison({
      countryCode: task.destination.code,
      entry: task.entry,
      sensariaProducts
    });

    try {
      const prodigi = await getProdigiArteQuote({
        countryCode: task.destination.code,
        entry: task.entry,
        copies,
        shippingMethod
      });
      const prodigiTotal = prodigi.totalBeforeTax;
      const sensariaTotal = sensaria.totalBeforeTax;
      const savingsVsSensaria = prodigiTotal != null && sensariaTotal != null
        ? sensariaTotal - prodigiTotal
        : null;

      return {
        ...prodigi,
        sensaria,
        savingsVsSensaria,
        cheaperSupplier:
          savingsVsSensaria == null ? '' :
          savingsVsSensaria > 0 ? 'Prodigi' :
          savingsVsSensaria < 0 ? 'Sensaria' : 'Same',
        comparisonBasis: 'Prodigi product + shipping before tax vs Sensaria production + captured Basic shipping before tax/duties.'
      };
    } catch (error) {
      return {
        countryCode: task.destination.code,
        country: task.destination.label,
        productCode: task.entry.productCode,
        product: task.entry.product,
        size: task.entry.size,
        finishCode: task.entry.finishCode,
        finish: task.entry.finish,
        sku: task.entry.sku,
        copies,
        currency: 'USD',
        shippingMethod: shippingMethod || '',
        productionCost: null,
        shippingCost: null,
        totalBeforeTax: null,
        fulfillmentLocations: [],
        labCodes: [],
        carriers: [],
        sensaria,
        savingsVsSensaria: null,
        cheaperSupplier: '',
        comparisonBasis: 'Prodigi quote failed; Sensaria comparison retained.',
        error: error.message
      };
    }
  });

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    configuration: {
      products: wantedProducts,
      countries: wantedCountries,
      copies,
      currencyCode: 'USD',
      shippingMethod: shippingMethod || 'cheapest available',
      prodigiFamilies: Object.fromEntries(wantedProducts.map(code => [code, {
        label: PRODIGI_SILVIA_CATALOG[code].label,
        skuPrefix: PRODIGI_SILVIA_CATALOG[code].skuPrefix,
        variantsPerCountry: PRODIGI_SILVIA_CATALOG[code].entries.length
      }]))
    },
    note: 'Comparison is before tax. Prodigi calculates applicable sales tax/VAT at order time; cross-border customs may still apply. Sensaria uses current config/products.json production costs plus captured Basic shipping rates. Framed-canvas Sensaria shipping uses the matching canvas size band because the captured Sensaria shipping export has no separate framed-canvas group.',
    rows
  };
}

export async function testProdigiConnection() {
  const checks = [
    { code: 'P', sku: 'GLOBAL-FAP-12X16', desiredAttributes: {} },
    { code: 'FP', sku: 'GLOBAL-CFP-12X16', desiredAttributes: { frameColour: 'Brown' } },
    { code: 'C', sku: 'GLOBAL-CAN-12X16', desiredAttributes: { wrap: 'MirrorWrap' } },
    { code: 'FC', sku: 'GLOBAL-FRA-CAN-12X16', desiredAttributes: { frameColour: 'Brown' } }
  ];

  const products = [];
  for (const check of checks) {
    const product = await getProductDetails(check.sku);
    const attributes = resolveProdigiAttributesForDestination(product, 'CA', check.desiredAttributes);
    products.push({
      productCode: check.code,
      sku: product.sku,
      description: product.description || '',
      attributes
    });
  }

  return {
    ok: true,
    products,
    catalogVariantCount: PRODIGI_SILVIA_ENTRIES.length
  };
}
