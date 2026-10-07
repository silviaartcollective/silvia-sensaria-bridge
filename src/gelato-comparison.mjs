import {
  listGelatoCatalogs,
  getGelatoCatalog,
  searchGelatoProducts,
  getGelatoProductPrices,
  getGelatoShipmentPrices,
  gelatoConfigStatus
} from './gelato.mjs';

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
let productCatalogCache = null;
let productCatalogPromise = null;
let catalogDiagnostics = null;
const quoteCache = new Map();

function numeric(value) {
  if (value === null || value === undefined || value === '') return null;
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
  if (/framed[-_ ]*canvas|canvas[-_ ]*framed|float[-_ ]*frame.*canvas/.test(text)) return 'FC';
  if (/canvas|stretched[-_ ]*print|gallery[-_ ]*wrap/.test(text)) return 'C';
  if (/poster|fine art print|art print/.test(text) && !/framed/.test(text)) return 'P';
  return '';
}

function relevantCatalog(catalog) {
  return /poster|canvas|fine art|art print|wall[-_ ]?art|frame|stretched|gallery[-_ ]?wrap|wall[-_ ]?decor|photo[-_ ]?print/i.test(
    `${catalog?.catalogUid || ''} ${catalog?.title || ''}`
  );
}

function finishFamily(value) {
  const text = compact(value);
  if (!text || text === '—' || text === '-') return 'none';
  if (/black/.test(text)) return 'black';
  if (/white/.test(text)) return 'white';
  if (/natural|oak|beech|birch/.test(text)) return 'natural';
  if (/brown|dark wood|dark-brown|dark_brown|walnut|espresso|mahogany/.test(text)) return 'brown';
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

function normalizePair(a, b) {
  const x = Number(a);
  const y = Number(b);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x <= 0 || y <= 0) return null;
  return { width: Math.min(x, y), height: Math.max(x, y) };
}

function pairFromText(value, defaultUnit = '') {
  const text = compact(value).replace(/["']/g, '');
  const match = text.match(/(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)(?:[-_ ]?(mm|cm|inch|in))?/i);
  if (!match) return null;
  let a = Number(match[1]);
  let b = Number(match[2]);
  const unit = String(match[3] || defaultUnit || '').toLowerCase();
  if (unit === 'mm') { a /= 25.4; b /= 25.4; }
  else if (unit === 'cm') { a /= 2.54; b /= 2.54; }
  else if (unit === 'inch' || unit === 'in' || !unit) {
    // already inches
  } else return null;
  return normalizePair(a, b);
}

function productSizeCandidates(product) {
  const pairs = [];
  const add = pair => {
    if (!pair) return;
    if (pairs.some(item =>
      Math.abs(item.width - pair.width) < 0.02 &&
      Math.abs(item.height - pair.height) < 0.02
    )) return;
    pairs.push(pair);
  };

  // Prefer nominal format/size metadata and UID dimensions. Canvas products can
  // expose physical dimensions that include wrap/production allowance, while
  // the customer-facing format remains the requested nominal size.
  const attrs = product?.attributes && typeof product.attributes === 'object'
    ? product.attributes : {};
  for (const [key, value] of Object.entries(attrs)) {
    if (!/format|size|dimension/i.test(key)) continue;
    add(pairFromText(value));
  }

  const uid = String(product?.productUid || '');
  // Gelato product UIDs often contain an underscore after "-inch"; a
  // word boundary fails because underscores count as word characters.
  for (const match of uid.matchAll(/(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)[-_ ]?(mm|cm|inches|inch|in)(?=$|[^a-z0-9])/gi)) {
    add(pairFromText(`${match[1]}x${match[2]}-${match[3]}`));
  }

  const dimensions = product?.dimensions;
  if (Array.isArray(dimensions)) {
    const byName = name => dimensions.find(item =>
      new RegExp('^' + name + '$', 'i').test(String(item?.name || item?.type || item?.dimension || ''))
    );
    const width = byName('width');
    const height = byName('height');
    if (width && height) add(normalizePair(measureToInches(width), measureToInches(height)));
  }
  if (dimensions && typeof dimensions === 'object' && !Array.isArray(dimensions)) {
    const widthEntry = Object.entries(dimensions).find(([key]) => /^width$/i.test(key));
    const heightEntry = Object.entries(dimensions).find(([key]) => /^height$/i.test(key));
    add(normalizePair(
      measureToInches(widthEntry?.[1]),
      measureToInches(heightEntry?.[1])
    ));
  }

  return pairs;
}

function productSizeInches(product) {
  return productSizeCandidates(product)[0] || null;
}

function parseTargetSize(value) {
  return pairFromText(value, 'in');
}

function productText(product, catalog) {
  const attrs = product?.attributes && typeof product.attributes === 'object'
    ? Object.entries(product.attributes).map(([k, v]) => `${k}:${v}`).join(' ')
    : '';
  return compact(`${catalog?.title || ''} ${catalog?.catalogUid || ''} ${product?.productUid || ''} ${attrs}`);
}

function productCodeForItem(product, catalog) {
  // Gelato separates the main wall-art families into catalogs. Prefer that
  // explicit catalog identity before inspecting variant attributes. A normal
  // stretched canvas can legitimately contain "canvas frame" / stretcher-bar
  // metadata, which must not turn it into a decorative Framed Canvas.
  const catalogCode = classifyCatalog(catalog);
  if (catalogCode) return catalogCode;

  const text = productText(product, catalog);
  const attrs = product?.attributes && typeof product.attributes === 'object' ? product.attributes : {};
  const frameKey = Object.entries(attrs).some(([key, value]) => {
    if (!/^(framecolor|framecolour|framestyle|framematerial|framevariant)$/i.test(String(key))) return false;
    const normalized = compact(value);
    return Boolean(normalized) && !/^(none|no|unframed|without-frame|no-frame)$/.test(normalized);
  });
  const framedCanvas = /framed[-_ ]*canvas|canvas[-_ ].*frame|frame[-_ ].*canvas|frame_and_canvas/i.test(text) || frameKey;

  if (/canvas|gallery[-_ ]*wrap|stretched[-_ ]*print/.test(text)) return framedCanvas ? 'FC' : 'C';
  if (/poster|fine art print|art print/.test(text)) {
    if (/framed[-_ ]*poster|frame_and_poster|poster[-_ ].*frame/i.test(text) || frameKey) return '';
    return 'P';
  }
  return '';
}

function sizeCompatible(product, target, tolerance = 0.52) {
  if (!target) return false;
  return productSizeCandidates(product).some(actual =>
    Math.abs(actual.width - target.width) <= tolerance &&
    Math.abs(actual.height - target.height) <= tolerance
  );
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
    if (/matte|matt|uncoated|170-gsm-coated-silk/.test(text)) score += 4;
    if (/gloss|lustre|luster|satin/.test(text)) score -= 5;
  }
  if (row?.productCode === 'C') {
    if (/canvas/.test(text)) score += 4;
    if (/stretched|slim|thick/.test(text)) score += 1;
  }
  if (row?.productCode === 'FC') {
    if (/canvas/.test(text)) score += 4;
    if (/frame/.test(text)) score += 4;
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

async function searchAllCatalogProducts(catalogUid, { attributeFilters = {}, maxPages = 100 } = {}) {
  const products = [];
  let offset = 0;
  const limit = 100;
  for (let page = 0; page < maxPages; page++) {
    const result = await searchGelatoProducts(catalogUid, {
      attributeFilters, limit, offset
    });
    const batch = Array.isArray(result?.products) ? result.products : [];
    products.push(...batch);
    if (batch.length < limit) break;
    offset += batch.length;
  }
  return products;
}

async function loadProductCatalog({ fresh = false } = {}) {
  const now = Date.now();
  if (!fresh && productCatalogCache && now - productCatalogCache.fetchedAt < CACHE_TTL_MS) return productCatalogCache.rows;
  if (productCatalogPromise) return productCatalogPromise;

  productCatalogPromise = (async () => {
    const availableCatalogs = await listGelatoCatalogs();
    const catalogs = availableCatalogs.filter(relevantCatalog);
    const stats = {
      totalCatalogs: availableCatalogs.length,
      relevantCatalogs: catalogs.map(item => ({ uid: item.catalogUid, title: item.title })),
      errors: [], scanned: []
    };

    const rows = (await mapLimit(catalogs, 3, async catalog => {
      try {
        const products = await searchAllCatalogProducts(catalog.catalogUid);
        stats.scanned.push({
          uid: catalog.catalogUid, title: catalog.title,
          productCount: products.length,
          sampleUid: products[0]?.productUid || ''
        });
        return products
          .map(product => ({
            catalog,
            product,
            productCode: productCodeForItem(product, catalog)
          }))
          .filter(item => item.productCode);
      } catch (error) {
        stats.errors.push({ catalogUid: catalog.catalogUid,
          message: error?.message || String(error) });
        return [];
      }
    })).flat().filter(item => item?.product && item?.productCode);

    stats.mappedProductCount = rows.length;
    stats.scanned.sort((a, b) => a.uid.localeCompare(b.uid));
    catalogDiagnostics = stats;
    productCatalogCache = { fetchedAt: Date.now(), rows };
    return rows;
  })();

  try {
    return await productCatalogPromise;
  } finally {
    productCatalogPromise = null;
  }
}


function matchingGelatoFormatAttributes(catalog, target) {
  const result = [];
  for (const attribute of catalog?.productAttributes || []) {
    const key = String(attribute?.productAttributeUid || '');
    if (!/format|size|dimension/i.test(key)) continue;
    const matchingValues = (attribute.values || [])
      .filter(value =>
        [value?.productAttributeValueUid, value?.title]
          .some(text => {
            const pair = pairFromText(text);
            return Boolean(pair) &&
              Math.abs(pair.width - target.width) <= 0.52 &&
              Math.abs(pair.height - target.height) <= 0.52;
          })
      )
      .map(value => value.productAttributeValueUid)
      .filter(Boolean);
    if (matchingValues.length) result.push({ key, values: matchingValues });
  }
  return result;
}

// Direct exact-format lookup avoids silently losing a 20x30 product when
// unfiltered catalogs have thousands of frame/material/orientation variants.
// Only performs read-only catalog and product searches.
async function findGelatoExactFormat(row, target) {
  const diagnostics = { catalogDetailsChecked: 0, filteredSearches: 0,
    productsReturned: 0, failures: [] };
  if (!target) return { matches: [], diagnostics };
  const allCatalogs = await listGelatoCatalogs();
  const candidates = allCatalogs.filter(relevantCatalog);
  const catalogs = candidates.length ? candidates : allCatalogs;
  const groups = await mapLimit(catalogs, 3, async catalog => {
    try {
      const detail = await getGelatoCatalog(catalog.catalogUid);
      diagnostics.catalogDetailsChecked++;
      const dimensions = matchingGelatoFormatAttributes(detail, target);
      if (!dimensions.length) return [];
      const perCatalog = [];
      // Use a single matching format filter at a time. AND-ing all the format
      // attributes together would exclude legitimate variants.
      for (const dimension of dimensions) {
        diagnostics.filteredSearches++;
        const products = await searchAllCatalogProducts(catalog.catalogUid, {
          attributeFilters: { [dimension.key]: dimension.values },
          maxPages: 30
        });
        diagnostics.productsReturned += products.length;
        for (const product of products) {
          const item = {
            catalog, product,
            productCode: productCodeForItem(product, catalog)
          };
          if (item.productCode === row.productCode &&
              sizeCompatible(product, target) &&
              finishCompatible(row, product, catalog)) {
            perCatalog.push(item);
          }
        }
      }
      return perCatalog;
    } catch (error) {
      diagnostics.failures.push({
        catalogUid: catalog.catalogUid,
        reason: error?.message || String(error)
      });
      return [];
    }
  });
  const unique = new Map();
  for (const item of groups.flat()) {
    unique.set(item.product.productUid, item);
  }
  return { matches: [...unique.values()], diagnostics };
}

function normalizeSizeKey(value) {
  const target = parseTargetSize(value);
  if (!target) return '';
  return `${Number(target.width.toFixed(2))}x${Number(target.height.toFixed(2))}`;
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

export async function scanGelatoComparisonRows({ rows = [], countryCode, fresh = false } = {}) {
  if (!gelatoConfigStatus().ready) {
    return new Map((rows || []).map(row => [rowKey(row), {
      provider: 'Gelato', eligible: false, status: 'not-configured',
      reason: 'GELATO_API_KEY is not configured.'
    }]));
  }

  const country = String(countryCode || '').trim().toUpperCase();
  const result = new Map();
  // Custom Size Lookup requests one exact size. Search directly by Gelato's
  // CanvasFormat/PaperFormat catalog attribute instead of exhausting a huge
  // unfiltered product catalog. Bulk comparisons still use the shared cache.
  const exactSizeLookup = (rows || []).length <= 2;
  let catalogRows = exactSizeLookup ? null : await loadProductCatalog({ fresh });

  for (const row of rows || []) {
    const target = parseTargetSize(row?.size);
    let sizeMatches = [];
    let exactFormatDiagnostics = null;
    if (exactSizeLookup && target) {
      try {
        const exact = await findGelatoExactFormat(row, target);
        sizeMatches = exact.matches;
        exactFormatDiagnostics = exact.diagnostics;
      } catch (error) {
        exactFormatDiagnostics = { failures: [{
          reason: error?.message || String(error)
        }] };
      }
    }
    if (!sizeMatches.length) {
      if (!catalogRows) catalogRows = await loadProductCatalog({ fresh });
      sizeMatches = catalogRows.filter(item =>
        item.productCode === row?.productCode &&
        sizeCompatible(item.product, target) &&
        finishCompatible(row, item.product, item.catalog)
      );
    }

    const countrySupported = sizeMatches.filter(item =>
      Array.isArray(item.product?.supportedCountries) &&
      item.product.supportedCountries.includes(country)
    );
    const countryUnknown = sizeMatches.filter(item =>
      !Array.isArray(item.product?.supportedCountries) ||
      item.product.supportedCountries.length === 0
    );

    let candidates = (
      countrySupported.length ? countrySupported :
      countryUnknown.length ? countryUnknown :
      sizeMatches
    )
      .map(item => ({
        ...item,
        score: compatibilityScore(row, item.product, item.catalog) +
          (Array.isArray(item.product?.supportedCountries) && item.product.supportedCountries.includes(country) ? 100 : 0)
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 4);

    if (!candidates.length) {
      const familyRows = (catalogRows || []).filter(item => item.productCode === row?.productCode);
      const parsedSizes = familyRows.flatMap(item =>
        productSizeCandidates(item.product).map(size => ({
          width: size.width,
          height: size.height,
          distance: target
            ? Math.abs(size.width - target.width) + Math.abs(size.height - target.height)
            : Infinity
        }))
      ).sort((a, b) => a.distance - b.distance);
      const nearest = [];
      for (const size of parsedSizes) {
        const label = `${Number(size.width.toFixed(2))}x${Number(size.height.toFixed(2))}`;
        if (!nearest.includes(label)) nearest.push(label);
        if (nearest.length >= 6) break;
      }
      const diagnostic = catalogDiagnostics || {};
      const failures = [
        ...(diagnostic.errors || []),
        ...(exactFormatDiagnostics?.failures || [])
      ];
      const names = (diagnostic.relevantCatalogs || []).map(item => item.uid).slice(0, 15);
      const status = !familyRows.length && failures.length
        ? 'catalog-scan-error' : 'catalog-no-match';
      result.set(rowKey(row), {
        provider: 'Gelato', eligible: false, status,
        reason: familyRows.length
          ? `Gelato mapped ${familyRows.length} products in this family but did not match ${row?.size}. Nearest parsed sizes: ${nearest.join(', ') || 'none'}.`
          : failures.length
            ? `Gelato catalog scan failed for ${failures.length} catalog(s): ${failures.slice(0, 3).map(item => item.catalogUid + ': ' + item.message).join(' | ')}.`
            : `Gelato returned no products mapped to ${row?.productCode} (catalogs searched: ${names.join(', ') || 'none'}; total catalogs: ${diagnostic.totalCatalogs ?? '?'}, mapped variants: ${diagnostic.mappedProductCount ?? 0}).`,
        meta: {
          familyProductCount: familyRows.length,
          nearestParsedSizes: nearest,
          catalogDiagnostics: diagnostic,
          exactFormatDiagnostics
        }
      });
      continue;
    }

    const quoted = await mapLimit(candidates, 2, async candidate => {
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
        provider: 'Gelato', eligible: false, status: firstError ? 'quote-error' : 'price-unavailable',
        reason: firstError || 'Gelato matched this exact catalog product, but a complete product + shipping price was not returned for the destination.'
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
      basis: 'Gelato live country-specific product price + normal residential shipment price.',
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

export const __test = {
  classifyCatalog,
  finishFamily,
  parseTargetSize,
  productSizeCandidates,
  productSizeInches,
  productCodeForItem,
  matchingGelatoFormatAttributes,
  sizeCompatible,
  rowKey
};
