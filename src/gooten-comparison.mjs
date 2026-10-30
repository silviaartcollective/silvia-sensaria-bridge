// Gooten in the supplier comparison. Gooten's SKUs differ by region (inch
// sizes in the US, centimetre sizes in Europe), so the catalog is read for the
// destination country: its canvas, framed canvas and poster SKUs are matched
// to each row's exact size and frame colour, priced from the variant's partner
// price and shipped with the shippingprices endpoint to the reference address.
import { gootenConfigStatus, listGootenProducts, listGootenVariants, getGootenShippingOptions } from './gooten.mjs';
import { mapLimit, statusForError } from './provider-http.mjs';
import { parseDimensions, sameSize, sizeLabel, shapeOf, finishFamily, wallArtFamily, rowKey, amount, quoteRecord, toUsd, PRODUCT_LABELS, FRAMED } from './supplier-catalog-match.mjs';
import { referenceAddress, describeReferenceAddress } from './quote-destinations.mjs';

const PROVIDER = 'Gooten';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const catalogs = new Map(), shippingCache = new Map(), pending = new Map();

const optionValue = (variant, pattern) => (variant?.Options || []).find(o => pattern.test(String(o?.Name || '')));

// A variant's size, frame colour and wrap from its options (or its SKU).
export function gootenVariantFacts(variant) {
  const sizeOption = optionValue(variant, /size|dimension/i);
  const size = parseDimensions(sizeOption?.Value) || parseDimensions(String(variant?.Sku || '').replace(/[-_]/g, ' '));
  const frame = optionValue(variant, /frame/i);
  const wrap = optionValue(variant, /wrap|edge|border/i);
  return { size, finish: frame ? finishFamily(frame.Value) : 'none', frame: frame?.Value || '', wrap: wrap?.Value || '',
    options: (variant?.Options || []).map(o => `${o?.Name}: ${o?.Value}`) };
}

export async function loadGootenCatalog(countryCode, { fresh = false, deps = {} } = {}) {
  const country = String(countryCode || '').toUpperCase();
  const hit = catalogs.get(country);
  if (!fresh && hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  if (!fresh && pending.has(country)) return pending.get(country);
  const api = { listGootenProducts, listGootenVariants, ...deps };
  const promise = (async () => {
    const products = (await api.listGootenProducts({ countryCode: country }))
      .filter(p => !p?.IsComingSoon && p?.HasAvailableProductVariants !== false)
      .map(p => ({ product: p, family: wallArtFamily(p?.Name || p?.UId || '') }))
      .filter(p => p.family);
    const entries = [], failures = [];
    await mapLimit(products, 3, async ({ product, family }) => {
      try {
        for (const variant of await api.listGootenVariants(product.Id, { countryCode: country })) {
          const facts = gootenVariantFacts(variant);
          if (facts.size && variant?.Sku) entries.push({ family, product, variant, ...facts });
        }
      } catch (error) { failures.push({ product: product.Name, message: error?.message || String(error) }); }
    });
    const value = { entries, failures, productCount: products.length };
    catalogs.set(country, { at: Date.now(), value });
    return value;
  })().finally(() => pending.delete(country));
  pending.set(country, promise);
  return promise;
}

export function pickGootenOption(results, sku) {
  const group = (results || []).find(r => (r?.SKUs || []).includes(sku)) || (results || [])[0];
  const options = (group?.ShipOptions || []).map(o => ({ id: o?.Id, name: String(o?.Name || o?.MethodType || o?.CarrierName || ''),
    type: String(o?.MethodType || ''), price: amount(o?.Price?.Price ?? o?.Price), currency: String(o?.Price?.CurrencyCode || '').toUpperCase(),
    days: amount(o?.EstBusinessDaysTilDelivery) })).filter(o => o.price != null && o.price >= 0 && o.currency);
  return options.find(o => /^standard$/i.test(o.type) || /^standard$/i.test(o.name)) || options.sort((a, b) => a.price - b.price)[0] || null;
}

export async function scanGootenComparisonRows({ rows = [], countryCode, keyOf = rowKey, fresh = false, deps = {} } = {}) {
  const api = { getGootenShippingOptions, ...deps };
  const result = new Map();
  if (!gootenConfigStatus().ready) {
    for (const row of rows) result.set(keyOf(row), quoteRecord({ provider: PROVIDER, status: 'not-configured', reason: 'GOOTEN_RECIPE_ID is not configured.' }));
    return result;
  }
  const country = String(countryCode || '').toUpperCase();
  let loaded;
  try { loaded = await loadGootenCatalog(country, { fresh, deps }); }
  catch (error) {
    for (const row of rows) result.set(keyOf(row), quoteRecord({ provider: PROVIDER, status: statusForError(error, 'catalog-scan-error'), reason: 'Gooten catalog could not be read: ' + (error?.message || error) }));
    return result;
  }
  const address = referenceAddress(country);
  await mapLimit(rows, 3, async row => {
    const key = keyOf(row);
    const target = parseDimensions(row?.size);
    const finish = finishFamily(row?.finish);
    const family = loaded.entries.filter(e => e.family === row?.productCode);
    const sized = family.filter(e => sameSize(e.size, target));
    let matches = FRAMED.has(row?.productCode) ? sized.filter(e => e.finish === finish) : sized;
    if (row?.productCode === 'C') {
      const imageWrap = matches.filter(e => /image|photo|mirror/i.test(e.wrap));
      if (imageWrap.length) matches = imageWrap;
    }
    if (!matches.length) {
      const sizes = [...new Set(family.map(e => sizeLabel(e.size)))];
      result.set(key, quoteRecord({ provider: PROVIDER,
        status: !family.length ? (loaded.failures.length ? 'catalog-scan-error' : 'not-offered') : sized.length ? 'finish-no-match' : 'unsupported-size',
        reason: !family.length
          ? (loaded.failures.length ? `Gooten variants could not be read: ${loaded.failures[0].message}` : `Gooten has no ${PRODUCT_LABELS[row?.productCode] || row?.productCode} product for ${country}.`)
          : sized.length ? `Gooten has ${row?.size} only with frames ${[...new Set(sized.map(e => e.frame || e.finish))].join(', ')}, not ${finish}.`
          : `Gooten does not offer ${row?.size} in ${country} (it offers ${sizes.slice(0, 12).join(', ') || 'no parsed sizes'}).`,
        meta: { availableSizes: sizes } }));
      return;
    }
    const candidates = [...new Map(matches.map(e => [e.product.Id, e])).values()].slice(0, 3);
    const quotes = await mapLimit(candidates, 2, async entry => {
      try {
        const product = amount(entry.variant?.PriceInfo?.Price);
        const productCurrency = String(entry.variant?.PriceInfo?.CurrencyCode || '').toUpperCase();
        if (product == null || product <= 0 || !productCurrency) return { entry, status: 'price-unavailable', reason: `Gooten returned no price for ${entry.variant.Sku}.` };
        const cacheKey = `${entry.variant.Sku}|${country}`;
        let results = shippingCache.get(cacheKey);
        if (!results || Date.now() - results.at > CACHE_TTL_MS) {
          results = { at: Date.now(), value: await api.getGootenShippingOptions({ items: [{ SKU: entry.variant.Sku, Quantity: 1 }],
            postalCode: address.postalCode, countryCode: country, state: address.state }) };
          shippingCache.set(cacheKey, results);
        }
        const option = pickGootenOption(results.value, entry.variant.Sku);
        if (!option) return { entry, status: 'destination-unsupported', reason: `Gooten offered no shipping option to ${country} for ${entry.variant.Sku}.` };
        const usd = await toUsd({ product, productCurrency, shipping: option.price, shippingCurrency: option.currency }, { rate: api.usdRate });
        return { entry, product, productCurrency, option, usd, status: usd.totalUsd != null ? 'available' : 'fx-unavailable' };
      } catch (error) {
        return { entry, status: statusForError(error, 'quote-error'), reason: error?.message || String(error) };
      }
    });
    const good = quotes.filter(q => q.status === 'available').sort((a, b) => a.usd.totalUsd - b.usd.totalUsd);
    const best = good[0];
    if (!best) {
      const first = quotes.find(q => q.status !== 'available') || {};
      result.set(key, quoteRecord({ provider: PROVIDER, status: first.status || 'price-unavailable', reason: first.reason || 'No complete Gooten price.' }));
      return;
    }
    result.set(key, quoteRecord({ provider: PROVIDER, eligible: true, status: 'available',
      totalUsd: best.usd.totalUsd, originalTotal: best.product + best.option.price,
      currency: best.productCurrency === best.option.currency ? best.productCurrency : 'mixed',
      productCost: best.usd.productUsd, shippingCost: best.usd.shippingUsd,
      basis: `Live Gooten partner price for ${best.entry.variant.Sku} in ${country} + "${best.option.name}" shipping to ${describeReferenceAddress(address)}.`,
      meta: { productId: best.entry.product.Id, productName: best.entry.product.Name || '', sku: best.entry.variant.Sku,
        size: sizeLabel(best.entry.size), shape: shapeOf(best.entry.size), frameColor: best.entry.frame, wrap: best.entry.wrap,
        material: best.entry.product.Name || '', options: best.entry.options, shippingMethod: best.option.name, shipCarrierMethodId: best.option.id,
        deliveryDays: best.option.days != null ? { min: best.option.days, max: best.option.days, businessDays: true } : null,
        quotedTo: describeReferenceAddress(address), fx: best.usd.fx,
        alternatives: good.slice(1).map(q => ({ productName: q.entry.product.Name, sku: q.entry.variant.Sku, totalUsd: Math.round(q.usd.totalUsd * 100) / 100 })) } }));
  });
  return result;
}

export function clearGootenCaches() { catalogs.clear(); shippingCache.clear(); }
