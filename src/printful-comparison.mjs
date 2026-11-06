// Printful in the supplier comparison: its catalog's posters, canvas and
// framed canvas matched to each row's exact size (either orientation) and
// frame colour, priced with the catalog prices endpoint and shipped with the
// shipping-rates endpoint to the country's reference address.
import {
  printfulConfigStatus, listPrintfulCategories, listPrintfulProducts, listPrintfulVariants,
  getPrintfulProductPrices, getPrintfulVariantPrices, getPrintfulShippingRates
} from './printful.mjs';
import { mapLimit, statusForError, ProviderApiError } from './provider-http.mjs';
import { parseDimensions, sameSize, sizeLabel, shapeOf, finishFamily, wallArtFamily, rowKey, amount, quoteRecord, toUsd, PRODUCT_LABELS, FRAMED } from './supplier-catalog-match.mjs';
import { referenceAddress, describeReferenceAddress } from './quote-destinations.mjs';

const PROVIDER = 'Printful';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
let catalog = null, catalogPromise = null;
const priceCache = new Map(), shippingCache = new Map();

async function cached(map, key, load) {
  const hit = map.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  const value = await load();
  map.set(key, { at: Date.now(), value });
  return value;
}

// Every poster, canvas and framed canvas variant: { family, product, variant, size, finish }.
export async function loadPrintfulCatalog({ fresh = false, deps = {} } = {}) {
  if (!fresh && catalog && Date.now() - catalog.at < CACHE_TTL_MS) return catalog.value;
  if (!fresh && catalogPromise) return catalogPromise;
  const api = { listPrintfulCategories, listPrintfulProducts, listPrintfulVariants, ...deps };
  catalogPromise = (async () => {
    const categories = await api.listPrintfulCategories();
    const wallArt = categories.filter(c => /poster|canvas|wall art|print/i.test(String(c?.title || c?.name || '')));
    const products = (await api.listPrintfulProducts({ categoryIds: wallArt.map(c => c.id) }))
      .filter(p => !p?.is_discontinued)
      .map(p => ({ product: p, family: wallArtFamily(`${p?.name || ''} ${p?.type || ''}`) }))
      .filter(p => p.family);
    const entries = [];
    const failures = [];
    await mapLimit(products, 3, async ({ product, family }) => {
      try {
        for (const variant of await api.listPrintfulVariants(product.id)) {
          const size = parseDimensions(variant?.size) || parseDimensions(variant?.name);
          if (!size) continue;
          entries.push({ family, product, variant, size, finish: FRAMED.has(family) ? finishFamily(variant?.color || variant?.name) : 'none' });
        }
      } catch (error) { failures.push({ productId: product.id, message: error?.message || String(error) }); }
    });
    const value = { entries, failures, productCount: products.length, categoryCount: wallArt.length };
    catalog = { at: Date.now(), value };
    return value;
  })().finally(() => { catalogPromise = null; });
  return catalogPromise;
}

export function variantPrice(prices, variantId) {
  // A product price list ({ variants: [...] }) or one variant's ({ variant: {...} }).
  const row = [...(prices?.variants || []), ...(prices?.variant ? [prices.variant] : [])].find(v => Number(v?.id) === Number(variantId));
  const offers = (row?.techniques || []).map(t => ({ technique: t?.technique_key || t?.technique_display_name || '',
    price: amount(t?.discounted_price) ?? amount(t?.price) })).filter(t => t.price != null && t.price > 0);
  offers.sort((a, b) => a.price - b.price);
  return offers[0] ? { ...offers[0], currency: String(prices?.currency || '').toUpperCase() } : null;
}

export function pickPrintfulRate(rates) {
  const usable = (rates || []).map(r => ({ id: String(r?.shipping || r?.id || ''), name: String(r?.shipping_method_name || r?.name || r?.shipping || ''),
    rate: amount(r?.rate), currency: String(r?.currency || '').toUpperCase(),
    minDays: amount(r?.min_delivery_days ?? r?.minDeliveryDays), maxDays: amount(r?.max_delivery_days ?? r?.maxDeliveryDays) }))
    .filter(r => r.rate != null && r.rate >= 0 && r.currency);
  return usable.find(r => r.id.toUpperCase() === 'STANDARD') || usable.sort((a, b) => a.rate - b.rate)[0] || null;
}

const unsupportedDestination = error => error instanceof ProviderApiError && error.kind === 'bad-request' &&
  /ship|country|destination|region|not available/i.test(error.message);

async function quoteEntry(entry, countryCode, api) {
  const address = referenceAddress(countryCode);
  const recipient = { country_code: address.countryCode, state_code: address.state || undefined, zip: address.postalCode || undefined,
    city: address.city || undefined, address1: address.address1 || undefined };
  const prices = await cached(priceCache, String(entry.product.id), () => api.getPrintfulProductPrices(entry.product.id, { currency: 'USD' }));
  let price = variantPrice(prices, entry.variant.id);
  // The product's price list may not include every variant: ask for this one.
  if (!price) {
    try {
      price = variantPrice(await cached(priceCache, 'variant:' + entry.variant.id,
        () => api.getPrintfulVariantPrices(entry.variant.id, { currency: 'USD' })), entry.variant.id);
    } catch (error) {
      return { entry, status: error instanceof ProviderApiError ? statusForError(error, 'price-unavailable') : 'price-unavailable',
        reason: `Printful price for variant ${entry.variant.id} failed: ` + (error?.message || error) };
    }
  }
  if (!price) return { entry, status: 'price-unavailable',
    reason: `Printful returned no price for variant ${entry.variant.id} (its product price list had ${(prices?.variants || []).length} variants, and the variant's own price had none).` };
  let rates;
  try {
    rates = await cached(shippingCache, `${entry.variant.id}|${address.countryCode}`, () => api.getPrintfulShippingRates({ recipient,
      items: [{ source: 'catalog', catalog_variant_id: Number(entry.variant.id), quantity: 1 }], currency: 'USD' }));
  } catch (error) {
    if (unsupportedDestination(error)) return { entry, price, status: 'destination-unsupported', reason: error.message };
    return { entry, price, status: error instanceof ProviderApiError ? statusForError(error, 'shipping-error') : 'shipping-error', reason: 'Shipping quote failed: ' + (error?.message || error) };
  }
  const rate = pickPrintfulRate(rates);
  if (!rate) return { entry, price, status: 'destination-unsupported', reason: `Printful offered no shipping method to ${address.countryCode} for this product.` };
  const usd = await toUsd({ product: price.price, productCurrency: price.currency, shipping: rate.rate, shippingCurrency: rate.currency }, { rate: api.usdRate });
  return { entry, price, rate, address, usd, status: usd.totalUsd != null ? 'available' : 'fx-unavailable' };
}

export async function scanPrintfulComparisonRows({ rows = [], countryCode, keyOf = rowKey, fresh = false, deps = {} } = {}) {
  const api = { getPrintfulProductPrices, getPrintfulVariantPrices, getPrintfulShippingRates, ...deps };
  const result = new Map();
  if (!printfulConfigStatus().ready) {
    for (const row of rows) result.set(keyOf(row), quoteRecord({ provider: PROVIDER, status: 'not-configured', reason: 'PRINTFUL_API_TOKEN is not configured.' }));
    return result;
  }
  let loaded;
  try { loaded = await loadPrintfulCatalog({ fresh, deps }); }
  catch (error) {
    for (const row of rows) result.set(keyOf(row), quoteRecord({ provider: PROVIDER, status: statusForError(error, 'catalog-scan-error'),
      reason: 'Printful catalog could not be read: ' + (error?.message || error) }));
    return result;
  }
  const country = String(countryCode || '').toUpperCase();
  await mapLimit(rows, 3, async row => {
    const key = keyOf(row);
    const target = parseDimensions(row?.size);
    const finish = finishFamily(row?.finish);
    const family = loaded.entries.filter(e => e.family === row?.productCode);
    const sized = family.filter(e => sameSize(e.size, target));
    const matches = FRAMED.has(row?.productCode) ? sized.filter(e => e.finish === finish) : sized;
    if (!matches.length) {
      const nearest = [...new Set(family.map(e => sizeLabel(e.size)))].slice(0, 40);
      const finishes = [...new Set(sized.map(e => e.finish))];
      result.set(key, quoteRecord({ provider: PROVIDER,
        status: !family.length ? (loaded.failures.length ? 'catalog-scan-error' : 'not-offered') : sized.length ? 'finish-no-match' : 'unsupported-size',
        reason: !family.length
          ? (loaded.failures.length ? `Printful variants could not be read for ${loaded.failures.length} product(s): ${loaded.failures[0].message}`
            : `Printful's catalog has no ${PRODUCT_LABELS[row?.productCode] || row?.productCode} product.`)
          : sized.length ? `Printful has ${row?.size} ${String(PRODUCT_LABELS[row?.productCode] || '').toLowerCase()} only in ${finishes.join(', ')}, not ${finish}.`
          : `Printful does not offer ${row?.size} in this product (it offers ${nearest.slice(0, 12).join(', ') || 'no parsed sizes'}).`,
        meta: { availableSizes: nearest, availableFinishes: finishes } }));
      return;
    }
    // One variant per product: the products differ in paper or build, and the cheapest wins.
    const perProduct = [...new Map(matches.map(e => [e.product.id, e])).values()].slice(0, 3);
    const quotes = await mapLimit(perProduct, 2, entry => quoteEntry(entry, country, api).catch(error =>
      ({ entry, status: statusForError(error, 'quote-error'), reason: error?.message || String(error) })));
    const good = quotes.filter(q => q.status === 'available').sort((a, b) => a.usd.totalUsd - b.usd.totalUsd);
    const best = good[0];
    if (!best) {
      const first = quotes.find(q => q.status !== 'available') || {};
      result.set(key, quoteRecord({ provider: PROVIDER, status: first.status || 'price-unavailable', reason: first.reason || 'No complete Printful price.' }));
      return;
    }
    result.set(key, quoteRecord({ provider: PROVIDER, eligible: true, status: 'available',
      totalUsd: best.usd.totalUsd, originalTotal: best.price.price + best.rate.rate,
      currency: best.price.currency === best.rate.currency ? best.price.currency : 'mixed',
      productCost: best.usd.productUsd, shippingCost: best.usd.shippingUsd,
      basis: `Live Printful catalog price (${best.price.technique || 'print'}) + ${best.rate.name || best.rate.id} shipping rate to ${describeReferenceAddress(best.address)}.`,
      meta: { productId: best.entry.product.id, productName: best.entry.product.name || '', variantId: best.entry.variant.id,
        variantName: best.entry.variant.name || '', size: sizeLabel(best.entry.size), shape: shapeOf(best.entry.size),
        frameColor: FRAMED.has(row?.productCode) ? best.entry.variant.color || best.entry.finish : '',
        material: best.entry.product.name || '', shippingMethod: best.rate.id, shippingMethodName: best.rate.name,
        deliveryDays: best.rate.minDays != null ? { min: best.rate.minDays, max: best.rate.maxDays } : null,
        quotedTo: describeReferenceAddress(best.address), fx: best.usd.fx,
        alternatives: good.slice(1).map(q => ({ productName: q.entry.product.name, totalUsd: Math.round(q.usd.totalUsd * 100) / 100 })) } }));
  });
  return result;
}

export function clearPrintfulCaches() { catalog = null; priceCache.clear(); shippingCache.clear(); }
export const __test = { variantPrice, pickPrintfulRate };
