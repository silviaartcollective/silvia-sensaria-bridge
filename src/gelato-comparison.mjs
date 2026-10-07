import {
  listGelatoCatalogs,
  searchGelatoProducts,
  getGelatoProductPrices,
  getGelatoShipmentPrices,
  gelatoConfigStatus
} from './gelato.mjs';

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
let productCatalogCache = null;
let productCatalogPromise = null;
const quoteCache = new Map();

function numeric(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function compact(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[×]/g, 'x')
    .replace(/\s+/g, ' ')
    .trim();
}

function classifyCatalog(catalog) {
  const text = compact(`${catalog?.catalogUid || ''} ${catalog?.title || ''}`);
  if (/framed/.test(text) && /canvas/.test(text)) return 'FC';
  if (/canvas/.test(text) && !/framed/.test(text)) return 'C';
  if (/poster/.test(text) && !/framed/.test(text) && !/canvas/.test(text)) return 'P';
  return '';
}

function finishFamily(value) {
  const text = compact(value);
  if (!text || text === '—' || text === '-') return 'none';
  if (/black/.test(text)) return 'black';
  if (/white/.test(text)) return 'white';
  if (/natural|oak|beech|birch/.test(text)) return 'natural';
  if (/brown|dark wood|walnut|espresso|mahogany/.test(text)) return 'brown';
  return text;
}

function measureToInches(measure) {
  if (!measure || typeof measure !== 'object') return null;
  const value = numeric(measure.value);
  if (value == null) return null;
  const unit = compact(measure.measureUnit);
  if (unit === 'mm' || /millimeter/.test(unit)) return value / 25.4;
  if (unit === 'cm' || /centimeter/.test(unit)) return value / 2.54;
  if (unit === 'in' || unit === 'inch' || /inches/.test(unit)) return value;
  return null;
}

function productSizeInches(product) {
  const dimensions = product?.dimensions || {};
  const widthEntry = Object.entries(dimensions).find(([key]) => /^width$/i.test(key));
  const heightEntry = Object.entries(dimensions).find(([key]) => /^height$/i.test(key));
  const width = measureToInches(widthEntry?.[1]);
  const height = measureToInches(heightEntry?.[1]);
  if (width == null || height == null) return null;
  return { width: Math.min(width, height), height: Math.max(width, height) };
}

function parseTargetSize(value) {
  const text = compact(value).replace(/["']/g, '').replace(/\s+/g, '');
  const match = text.match(/(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const a = Number(match[1]);
  const b = Number(match[2]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return { width: Math.min(a, b), height: Math.max(a, b) };
}

function sizeCompatible(product, target, tolerance = 0.48) {
  const actual = productSizeInches(product);
  if (!actual || !target) return false;
  return Math.abs(actual.width - target.width) <= tolerance &&
    Math.abs(actual.height - target.height) <= tolerance;
}

function productText(product, catalog) {
  const attrs = product?.attributes && typeof product.attributes === 'object'
    ? Object.entries(product.attributes).map(([k, v]) => `${k}:${v}`).join(' ')
    : '';
  return compact(`${catalog?.title || ''} ${catalog?.catalogUid || ''} ${product?.productUid || ''} ${attrs}`);
}

function productFinish(product, catalog) {
  return finishFamily(productText(product, catalog));
}

function finishCompatible(row, product, catalog) {
  if (row?.productCode !== 'FC') return true;
  const wanted = finishFamily(row?.finish);
  const actual = productFinish(product, catalog);
  return wanted !== 'none' && actual === wanted;
}

function compatibilityScore(row, product, catalog) {
  const text = productText(product, catalog);
  let score = 0;
  if (row?.productCode === 'P') {
    if (/matte|matt|uncoated/.test(text)) score += 4;
    if (/gloss|lustre|luster|satin|silk/.test(text)) score -= 5;
  }
  if (row?.productCode === 'C') {
    if (/canvas/.test(text)) score += 2;
    if (/stretched/.test(text)) score += 2;
  }
  if (row?.productCode === 'FC') {
    if (/framed/.test(text) && /canvas/.test(text)) score += 4;
  }
  return score;
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function searchAllCatalogProducts(catalogUid) {
  const products = [];
  let offset = 0;
  const limit = 100;
  for (let page = 0; page < 50; page++) {
    const result = await searchGelatoProducts(catalogUid, { limit, offset });
    const batch = Array.isArray(result?.products) ? result.products : [];
    products.push(...batch);
    if (batch.length < limit) break;
    offset += batch.length;
  }
  return products;
}

async function loadProductCatalog() {
  const now = Date.now();
  if (productCatalogCache && now - productCatalogCache.fetchedAt < CACHE_TTL_MS) return productCatalogCache.rows;
  if (productCatalogPromise) return productCatalogPromise;

  productCatalogPromise = (async () => {
    const catalogs = (await listGelatoCatalogs())
      .map(catalog => ({ ...catalog, productCode: classifyCatalog(catalog) }))
      .filter(catalog => catalog.productCode);

    const rows = (await mapLimit(catalogs, 3, async catalog => {
      try {
        const products = await searchAllCatalogProducts(catalog.catalogUid);
        return products.map(product => ({ catalog, product }));
      } catch (error) {
        return [{ catalog, product: null, error: error?.message || String(error) }];
      }
    })).flat().filter(item => item?.product);

    productCatalogCache = { fetchedAt: Date.now(), rows };
    return rows;
  })();

  try {
    return await productCatalogPromise;
  } finally {
    productCatalogPromise = null;
  }
}

function normalizeSizeKey(value) {
  const target = parseTargetSize(value);
  if (!target) return '';
  return `${target.width}x${target.height}`;
}

function rowKey(row) {
  return `${row?.productCode || ''}|${normalizeSizeKey(row?.size)}|${finishFamily(row?.finish)}`;
}

function parseProductPrice(payload, countryCode) {
  const rows = Array.isArray(payload) ? payload : [];
  const country = String(countryCode || '').toUpperCase();
  const exact = rows.filter(item => String(item?.country || '').toUpperCase() === country);
  const source = exact.length ? exact : rows;
  const quantityOne = source.find(item => Number(item?.quantity) === 1);
  const chosen = quantityOne || [...source].sort((a, b) => Number(a?.quantity || Infinity) - Number(b?.quantity || Infinity))[0];
  if (!chosen) return null;
  return {
    price: numeric(chosen.price),
    currency: String(chosen.currency || 'USD').toUpperCase(),
    quantity: Number(chosen.quantity || 1)
  };
}

function parseShipmentPrice(payload, productUid) {
  const prices = Array.isArray(payload?.prices) ? payload.prices : [];
  const product = prices.find(item => String(item?.productUid || '') === String(productUid)) || prices[0];
  const quantities = Array.isArray(product?.quantities) ? product.quantities : [];
  const quantity = quantities.find(item => Number(item?.quantity) === 1) || quantities[0];
  const methods = Array.isArray(quantity?.methods) ? quantity.methods : [];
  const normal = methods.filter(item => String(item?.type || '').toLowerCase() === 'normal');
  const source = normal.length ? normal : methods;
  const selected = [...source].sort((a, b) => Number(a?.minPrice ?? Infinity) - Number(b?.minPrice ?? Infinity))[0];
  if (!selected) return null;
  return {
    price: numeric(selected.minPrice ?? selected.avgPrice),
    averagePrice: numeric(selected.avgPrice),
    methodUid: selected.shipmentMethodUid || '',
    type: selected.type || '',
    minDays: numeric(selected.minDays),
    maxDays: numeric(selected.maxDays),
    hasFlatRate: Boolean(selected.hasFlatRate)
  };
}

async function quoteProduct(productUid, countryCode) {
  const key = `${productUid}|${String(countryCode || '').toUpperCase()}`;
  const cached = quoteCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.value;

  const [pricePayload, shipmentPayload] = await Promise.all([
    getGelatoProductPrices(productUid, { country: countryCode, currency: 'USD' }),
    getGelatoShipmentPrices({
      country: countryCode,
      currency: 'USD',
      products: [{ productUid, quantities: [1] }],
      isBusiness: false,
      isPrivate: true
    })
  ]);
  const productPrice = parseProductPrice(pricePayload, countryCode);
  const shipping = parseShipmentPrice(shipmentPayload, productUid);
  const value = { productPrice, shipping };
  quoteCache.set(key, { fetchedAt: Date.now(), value });
  return value;
}

export async function scanGelatoComparisonRows({ rows = [], countryCode } = {}) {
  if (!gelatoConfigStatus().ready) {
    return new Map((rows || []).map(row => [rowKey(row), {
      provider: 'Gelato', eligible: false, status: 'not-configured',
      reason: 'GELATO_API_KEY is not configured.'
    }]));
  }

  const catalogRows = await loadProductCatalog();
  const country = String(countryCode || '').trim().toUpperCase();
  const result = new Map();

  for (const row of rows || []) {
    const target = parseTargetSize(row?.size);
    let candidates = catalogRows.filter(item =>
      item.catalog?.productCode === row?.productCode &&
      Array.isArray(item.product?.supportedCountries) &&
      item.product.supportedCountries.includes(country) &&
      sizeCompatible(item.product, target) &&
      finishCompatible(row, item.product, item.catalog)
    );

    candidates = candidates
      .map(item => ({ ...item, score: compatibilityScore(row, item.product, item.catalog) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 1);

    if (!candidates.length) {
      result.set(rowKey(row), {
        provider: 'Gelato', eligible: false, status: 'unavailable',
        reason: 'No compatible Gelato product with this size and destination country was found.'
      });
      continue;
    }

    const quoted = await mapLimit(candidates, 3, async candidate => {
      try {
        return { candidate, quote: await quoteProduct(candidate.product.productUid, country) };
      } catch (error) {
        return { candidate, error: error?.message || String(error) };
      }
    });

    const available = quoted.map(item => {
      const productPrice = item.quote?.productPrice;
      const shipping = item.quote?.shipping;
      const productCost = productPrice?.currency === 'USD' ? productPrice.price : null;
      const shippingCost = shipping?.price;
      const totalUsd = productCost != null && shippingCost != null ? productCost + shippingCost : null;
      return { ...item, productCost, shippingCost, totalUsd };
    }).filter(item => item.totalUsd != null)
      .sort((a, b) => a.totalUsd - b.totalUsd);

    const best = available[0];
    if (!best) {
      const firstError = quoted.find(item => item.error)?.error || '';
      result.set(rowKey(row), {
        provider: 'Gelato', eligible: false, status: firstError ? 'error' : 'price-unavailable',
        reason: firstError || 'Gelato product matched, but product or shipping price was unavailable.'
      });
      continue;
    }

    const actual = productSizeInches(best.candidate.product);
    result.set(rowKey(row), {
      provider: 'Gelato',
      eligible: true,
      status: 'available',
      totalUsd: Math.round(best.totalUsd * 100) / 100,
      originalTotal: Math.round(best.totalUsd * 100) / 100,
      currency: 'USD',
      productCost: Math.round(best.productCost * 100) / 100,
      shippingCost: Math.round(best.shippingCost * 100) / 100,
      reason: '',
      basis: 'Gelato country-specific product price + minimum normal residential shipment price.',
      meta: {
        catalogUid: best.candidate.catalog.catalogUid,
        catalogTitle: best.candidate.catalog.title || '',
        productUid: best.candidate.product.productUid,
        actualSizeInches: actual ? {
          width: Math.round(actual.width * 100) / 100,
          height: Math.round(actual.height * 100) / 100
        } : null,
        shipmentMethodUid: best.quote?.shipping?.methodUid || '',
        shipmentType: best.quote?.shipping?.type || '',
        deliveryDays: best.quote?.shipping ? {
          min: best.quote.shipping.minDays,
          max: best.quote.shipping.maxDays
        } : null,
        compatibilityScore: best.candidate.score,
        candidates: candidates.length
      }
    });
  }

  return result;
}

export const __test = { classifyCatalog, finishFamily, parseTargetSize, productSizeInches, sizeCompatible, rowKey };
