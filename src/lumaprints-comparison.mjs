// Lumaprints in the supplier comparison. Lumaprints prints any size within a
// subcategory's limits (0.75", 1.25" or 1.5" stretched canvas, framed canvas,
// fine art papers…), so a row's size is available when it fits those limits
// in either orientation; the product cost and shipping cost endpoints price it.
import {
  lumaprintsConfigStatus, listLumaprintsCategories, listLumaprintsSubcategories, listLumaprintsOptions,
  getLumaprintsProductPrice, getLumaprintsShippingPrice, lumaprintsCurrency, listOf
} from './lumaprints.mjs';
import { mapLimit, statusForError } from './provider-http.mjs';
import { parseDimensions, shapeOf, sizeLabel, finishFamily, wallArtFamily, rowKey, amount, quoteRecord, toUsd, PRODUCT_LABELS } from './supplier-catalog-match.mjs';
import { referenceAddress, describeReferenceAddress } from './quote-destinations.mjs';

const PROVIDER = 'Lumaprints';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
let catalog = null, catalogPromise = null;
const optionCache = new Map(), quoteCache = new Map();

async function cached(map, key, load) {
  const hit = map.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  const value = await load();
  map.set(key, { at: Date.now(), value });
  return value;
}
const field = (object, pattern) => {
  const entry = Object.entries(object || {}).find(([k]) => pattern.test(k));
  return entry ? amount(entry[1]) : null;
};

// { id, name, family, limits: { minWidth, maxWidth, minHeight, maxHeight }, thickness, dpi }
export function lumaprintsSubcategory(category, sub) {
  const name = String(sub?.name || sub?.subcategoryName || '');
  const family = wallArtFamily(`${category?.name || category?.categoryName || ''} ${name}`);
  const thickness = /(\d+(?:\.\d+)?)\s*(?:in\b|"|″|inch)/i.exec(name)?.[1];
  return { id: sub?.subcategoryId ?? sub?.id, name, family, categoryName: String(category?.name || category?.categoryName || ''),
    limits: { minWidth: field(sub, /^min.*width$/i), maxWidth: field(sub, /^max.*width$/i), minHeight: field(sub, /^min.*height$/i), maxHeight: field(sub, /^max.*height$/i) },
    thickness: thickness && family !== 'P' ? Number(thickness) : null, dpi: field(sub, /dpi/i) };
}

export function fitsLimits(limits, size) {
  const { minWidth, maxWidth, minHeight, maxHeight } = limits || {};
  if ([minWidth, maxWidth, minHeight, maxHeight].some(v => v == null)) return null; // limits not given
  const fits = (w, h) => w >= minWidth - 1e-6 && w <= maxWidth + 1e-6 && h >= minHeight - 1e-6 && h <= maxHeight + 1e-6;
  return fits(size.width, size.height) || fits(size.height, size.width);
}

// Options flattened to { id, name, group } whether grouped or not.
export function flattenOptions(payload) {
  const out = [];
  const visit = (item, group) => {
    if (!item || typeof item !== 'object') return;
    const nested = listOf(item, 'options', 'values', 'items');
    if (nested && nested !== item) { for (const child of nested) visit(child, String(item.name || item.groupName || item.optionGroup || group || '')); return; }
    const id = item.optionId ?? item.id;
    if (id != null) out.push({ id, name: String(item.name || item.optionName || ''), group: String(item.groupName || item.optionGroup || item.group || group || '') });
  };
  for (const item of Array.isArray(payload) ? payload : []) visit(item, '');
  return out;
}

export function chooseOptions(family, options, finish) {
  const chosen = [];
  const wrap = options.filter(o => /border|wrap|edge/i.test(o.group) || /wrap/i.test(o.name));
  const pick = wrap.find(o => /image wrap/i.test(o.name)) || wrap.find(o => /mirror/i.test(o.name));
  if (pick && family !== 'P') chosen.push(pick);
  if (family === 'FC') {
    const frames = options.filter(o => /frame/i.test(o.group) || /frame/i.test(o.name));
    const frame = frames.find(o => finishFamily(o.name) === finish);
    return { chosen: frame ? [...chosen, frame] : chosen, frame, frameColors: [...new Set(frames.map(o => finishFamily(o.name)))] };
  }
  return { chosen, frame: null, frameColors: [] };
}

export async function loadLumaprintsCatalog({ fresh = false, deps = {} } = {}) {
  if (!fresh && catalog && Date.now() - catalog.at < CACHE_TTL_MS) return catalog.value;
  if (!fresh && catalogPromise) return catalogPromise;
  const api = { listLumaprintsCategories, listLumaprintsSubcategories, ...deps };
  catalogPromise = (async () => {
    const categories = await api.listLumaprintsCategories();
    const subcategories = [], failures = [];
    await mapLimit(categories, 3, async category => {
      try {
        for (const sub of await api.listLumaprintsSubcategories(category?.id ?? category?.categoryId))
          subcategories.push(lumaprintsSubcategory(category, sub));
      } catch (error) { failures.push({ category: category?.name, message: error?.message || String(error) }); }
    });
    const value = { subcategories: subcategories.filter(s => s.family && s.id != null), failures, categoryCount: categories.length };
    catalog = { at: Date.now(), value };
    return value;
  })().finally(() => { catalogPromise = null; });
  return catalogPromise;
}

// Shipping methods from the shipping cost response, cheapest usable first.
export function lumaprintsShippingMethods(payload) {
  const list = listOf(payload, 'shippingMethods', 'methods', 'rates', 'shippingRates', 'shippingOptions') ||
    (payload && typeof payload === 'object' ? [payload] : []);
  return list.map(m => ({ name: String(m?.shippingMethod || m?.method || m?.name || m?.service || m?.carrier || 'default'),
    cost: amount(m?.cost ?? m?.price ?? m?.rate ?? m?.amount ?? m?.shippingCost ?? m?.shippingTotal ?? m?.total),
    status: String(m?.status || m?.message || ''), carrier: String(m?.carrier || ''),
    minDays: amount(m?.minDays ?? m?.minDeliveryDays), maxDays: amount(m?.maxDays ?? m?.maxDeliveryDays ?? m?.estimatedDays) }))
    .filter(m => m.cost != null && m.cost >= 0 && !/freight|incorrect|error|unavailable|not available/i.test(m.status))
    .sort((a, b) => a.cost - b.cost);
}

export async function scanLumaprintsComparisonRows({ rows = [], countryCode, keyOf = rowKey, fresh = false, deps = {} } = {}) {
  const api = { listLumaprintsOptions, getLumaprintsProductPrice, getLumaprintsShippingPrice, ...deps };
  const result = new Map();
  if (!lumaprintsConfigStatus().ready) {
    for (const row of rows) result.set(keyOf(row), quoteRecord({ provider: PROVIDER, status: 'not-configured', reason: 'LUMAPRINTS_API_KEY and LUMAPRINTS_API_SECRET are not configured.' }));
    return result;
  }
  let loaded;
  try { loaded = await loadLumaprintsCatalog({ fresh, deps }); }
  catch (error) {
    for (const row of rows) result.set(keyOf(row), quoteRecord({ provider: PROVIDER, status: statusForError(error, 'catalog-scan-error'), reason: 'Lumaprints catalog could not be read: ' + (error?.message || error) }));
    return result;
  }
  const address = referenceAddress(countryCode);
  const recipient = { firstName: 'Quote', lastName: 'Reference', addressLine1: address.address1, city: address.city,
    state: address.state, zipCode: address.postalCode, country: address.countryCode };
  const currency = lumaprintsCurrency();
  await mapLimit(rows, 3, async row => {
    const key = keyOf(row);
    const size = parseDimensions(row?.size);
    const finish = finishFamily(row?.finish);
    const family = loaded.subcategories.filter(s => s.family === row?.productCode);
    if (!family.length) {
      result.set(key, quoteRecord({ provider: PROVIDER, status: loaded.failures.length ? 'catalog-scan-error' : 'not-offered',
        reason: loaded.failures.length ? 'Lumaprints subcategories could not be read: ' + loaded.failures[0].message
          : `Lumaprints' catalog has no ${PRODUCT_LABELS[row?.productCode] || row?.productCode} product.` }));
      return;
    }
    const fitting = family.filter(s => fitsLimits(s.limits, size) !== false);
    if (!fitting.length) {
      result.set(key, quoteRecord({ provider: PROVIDER, status: 'unsupported-size',
        reason: `${row?.size} is outside Lumaprints' size limits for ${family.map(s => s.name).join(', ')}.`,
        meta: { limits: family.map(s => ({ name: s.name, ...s.limits })) } }));
      return;
    }
    // One quote per subcategory (canvas depth or paper), the cheapest wins.
    const quotes = await mapLimit(fitting.slice(0, 4), 2, async sub => {
      try {
        const options = flattenOptions(await cached(optionCache, String(sub.id), () => api.listLumaprintsOptions(sub.id)));
        const { chosen, frame, frameColors } = chooseOptions(sub.family, options, finish);
        if (sub.family === 'FC' && !frame) return { sub, status: 'finish-no-match',
          reason: `Lumaprints ${sub.name} has no ${finish} frame option (frame colours: ${frameColors.join(', ') || 'none listed'}).` };
        const optionIds = chosen.map(o => o.id);
        const quoteKey = `${sub.id}|${size.width}x${size.height}|${optionIds.join(',')}|${address.countryCode}`;
        return await cached(quoteCache, quoteKey, async () => {
          const pricing = await api.getLumaprintsProductPrice({ subcategoryId: sub.id, width: size.width, height: size.height, optionIds });
          const product = amount(pricing?.price ?? pricing?.data?.price ?? pricing?.totalPrice ?? pricing?.total);
          if (product == null || product <= 0) return { sub, status: 'price-unavailable', reason: 'Lumaprints returned no product price.' };
          let shippingPayload;
          try { shippingPayload = await api.getLumaprintsShippingPrice({ recipient, subcategoryId: sub.id, width: size.width, height: size.height, optionIds }); }
          catch (error) { return { sub, product, status: statusForError(error, 'shipping-error'), reason: 'Shipping quote failed: ' + (error?.message || error) }; }
          const method = lumaprintsShippingMethods(shippingPayload)[0];
          if (!method) return { sub, product, status: 'destination-unsupported', reason: `Lumaprints returned no usable shipping method to ${address.countryCode} (freight-only or not shipped).` };
          const shipCurrency = String(shippingPayload?.currency || currency).toUpperCase();
          const productCurrency = String(pricing?.currency || currency).toUpperCase();
          const usd = await toUsd({ product, productCurrency, shipping: method.cost, shippingCurrency: shipCurrency }, { rate: api.usdRate });
          return { sub, product, method, chosen, frame, usd, productCurrency, shipCurrency,
            currencySource: pricing?.currency ? 'API response' : 'LUMAPRINTS_PRICE_CURRENCY (the API response has no currency field)',
            optionPrices: listOf(pricing, 'options') || [], status: usd.totalUsd != null ? 'available' : 'fx-unavailable' };
        });
      } catch (error) {
        return { sub, status: statusForError(error, 'quote-error'), reason: error?.message || String(error) };
      }
    });
    const good = quotes.filter(q => q.status === 'available').sort((a, b) => a.usd.totalUsd - b.usd.totalUsd);
    const best = good[0];
    if (!best) {
      const first = quotes.find(q => q.status !== 'available') || {};
      result.set(key, quoteRecord({ provider: PROVIDER, status: first.status || 'price-unavailable', reason: first.reason || 'No complete Lumaprints price.' }));
      return;
    }
    result.set(key, quoteRecord({ provider: PROVIDER, eligible: true, status: 'available',
      totalUsd: best.usd.totalUsd, originalTotal: best.product + best.method.cost,
      currency: best.productCurrency === best.shipCurrency ? best.productCurrency : 'mixed',
      productCost: best.usd.productUsd, shippingCost: best.usd.shippingUsd,
      basis: `Live Lumaprints product cost for ${best.sub.name} at exactly ${row?.size}" + "${best.method.name}" shipping cost to ${describeReferenceAddress(address)}. Currency: ${best.currencySource}.`,
      meta: { subcategoryId: best.sub.id, productName: best.sub.name, category: best.sub.categoryName, material: best.sub.name,
        canvasThicknessInches: best.sub.thickness, size: sizeLabel(size), shape: shapeOf(size), customSize: true,
        options: best.chosen.map(o => `${o.group ? o.group + ': ' : ''}${o.name}`), frameColor: best.frame?.name || '',
        shippingMethod: best.method.name, deliveryDays: best.method.minDays != null ? { min: best.method.minDays, max: best.method.maxDays } : null,
        quotedTo: describeReferenceAddress(address), currencySource: best.currencySource, fx: best.usd.fx,
        alternatives: good.slice(1).map(q => ({ productName: q.sub.name, totalUsd: Math.round(q.usd.totalUsd * 100) / 100 })) } }));
  });
  return result;
}

export function clearLumaprintsCaches() { catalog = null; optionCache.clear(); quoteCache.clear(); }
