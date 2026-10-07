import {
  getPrintifyBlueprints,
  getPrintifyPrintProviders,
  getPrintifyVariants,
  getPrintifyShipping,
  getPrintifyProducts,
  printifyConfigStatus
} from './printify.mjs';
import { loadPrintifyCostLibrary } from './printify-cost-store.mjs';

const CACHE_TTL_MS = 30 * 60 * 1000;
let catalogCache = null;
let catalogPromise = null;

function numeric(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function moneyFromCents(value) {
  const n = numeric(value);
  return n == null ? null : Math.round(n) / 100;
}

function compact(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[“”″]/g, '"')
    .replace(/[×]/g, 'x')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeSize(value) {
  const text = compact(value)
    .replace(/inches?|inch|\bin\b|["']/g, '')
    .replace(/\s+/g, '');
  const match = text.match(/(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)/i);
  if (!match) return '';
  const a = Number(match[1]);
  const b = Number(match[2]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return '';
  const left = Math.min(a, b);
  const right = Math.max(a, b);
  return `${left}x${right}`;
}

function classifyBlueprint(title) {
  const text = compact(title);
  if (!text) return '';
  if (/framed/.test(text) && /canvas/.test(text)) return 'FC';
  if (/(?:canvas|stretched[- ]?print|gallery[- ]?wrap)/.test(text) && !/framed/.test(text)) return 'C';
  if (/(poster|fine art print|art print)/.test(text) && !/framed/.test(text) && !/canvas/.test(text)) return 'P';
  return '';
}

function optionText(variant) {
  const options = variant?.options;
  if (options && !Array.isArray(options) && typeof options === 'object') {
    return Object.entries(options)
      .map(([key, value]) => `${key}:${value}`)
      .join(' ');
  }
  return '';
}

function variantSize(variant) {
  const fromOptions = variant?.options && !Array.isArray(variant.options)
    ? Object.entries(variant.options).find(([key]) => /size|dimension|format/i.test(key))?.[1]
    : '';
  for (const candidate of [fromOptions, variant?.title, optionText(variant)]) {
    const found = normalizeSize(candidate);
    if (found) return found;
  }
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

function variantFinish(variant, blueprintTitle = '') {
  const options = variant?.options;
  let value = '';
  if (options && !Array.isArray(options) && typeof options === 'object') {
    const found = Object.entries(options).find(([key]) => /color|colour|frame|finish|wood/i.test(key));
    value = found?.[1] || '';
  }
  return finishFamily(`${value} ${variant?.title || ''} ${blueprintTitle}`);
}

function finishCompatible(row, variant, blueprintTitle) {
  if (row?.productCode !== 'FC') return true;
  const wanted = finishFamily(row?.finish);
  const actual = variantFinish(variant, blueprintTitle);
  return wanted !== 'none' && actual === wanted;
}

function costMapKey(blueprintId, providerId, variantId) {
  return `${Number(blueprintId)}|${Number(providerId)}|${Number(variantId)}`;
}

async function buildShopCostMap() {
  const map = new Map();
  let productCount = 0;
  let warning = '';
  try {
    const products = await getPrintifyProducts();
    productCount = products.length;
    for (const product of products) {
      const blueprintId = Number(product?.blueprint_id);
      const providerId = Number(product?.print_provider_id);
      if (!Number.isFinite(blueprintId) || !Number.isFinite(providerId)) continue;
      for (const variant of product?.variants || []) {
        const cost = moneyFromCents(variant?.cost);
        if (cost == null || variant?.id == null) continue;
        map.set(costMapKey(blueprintId, providerId, variant.id), cost);
      }
    }
  } catch (error) {
    // Never misreport a missing shop ID / missing permissions as an actual
    // supplier price of $0. Catalog/shipping lookup remains independent.
    warning = error?.message || String(error);
  }
  return { map, warning, productCount };
}

function shippingProfileForVariant(shipping, variantId, countryCode) {
  const profiles = Array.isArray(shipping?.profiles) ? shipping.profiles : [];
  const id = Number(variantId);
  const country = String(countryCode || '').toUpperCase();
  const applicable = profiles.filter(profile =>
    Array.isArray(profile?.variant_ids) && profile.variant_ids.map(Number).includes(id)
  );
  return applicable.find(profile => Array.isArray(profile?.countries) && profile.countries.includes(country)) ||
    applicable.find(profile => Array.isArray(profile?.countries) && profile.countries.includes('REST_OF_THE_WORLD')) || null;
}

function shippingCostUsd(profile) {
  if (!profile) return null;
  const currency = String(profile?.first_item?.currency || '').toUpperCase();
  const cost = moneyFromCents(profile?.first_item?.cost);
  return currency === 'USD' ? cost : null;
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

async function loadCatalog({ fresh = false } = {}) {
  const now = Date.now();
  if (!fresh && catalogCache && now - catalogCache.fetchedAt < CACHE_TTL_MS) return catalogCache;
  if (catalogPromise) return catalogPromise;

  catalogPromise = (async () => {
    const [blueprints, shopCosts, savedCosts] = await Promise.all([
      getPrintifyBlueprints(),
      buildShopCostMap(),
      loadPrintifyCostLibrary({ fresh }).then(
        document => ({ document, error: '' }),
        error => ({ document: { variants: {} }, error: error?.message || String(error) })
      )
    ]);
    const wallArtBlueprints = blueprints
      .map(item => ({ ...item, productCode: classifyBlueprint(item?.title) }))
      .filter(item => item.productCode);

    // Enumerate every matching wall-art blueprint, including the product
    // "Matte Canvas, Stretched, 1.25\"", and every print provider listed
    // under it. Do not select a preferred brand/provider before scanning.
    const providerFailures = [];
    const availableProviders = await mapLimit(wallArtBlueprints, 4, async blueprint => {
      try {
        return { blueprint, providers: await getPrintifyPrintProviders(blueprint.id) };
      } catch (error) {
        providerFailures.push({ blueprintId: blueprint.id, title: blueprint.title,
          error: error?.message || String(error) });
        return { blueprint, providers: [] };
      }
    });
    const providerTasks = availableProviders.flatMap(({ blueprint, providers }) =>
      providers.map(provider => ({ blueprint, provider }))
    );

    const rows = (await mapLimit(providerTasks, 5, async ({ blueprint, provider }) => {
      try {
        const [variantsPayload, shipping] = await Promise.all([
          getPrintifyVariants(blueprint.id, provider.id),
          getPrintifyShipping(blueprint.id, provider.id)
        ]);
        const variants = Array.isArray(variantsPayload)
          ? variantsPayload
          : Array.isArray(variantsPayload?.variants)
            ? variantsPayload.variants
            : [];
        return {
          blueprintId: blueprint.id,
          blueprintTitle: blueprint.title || '',
          brand: blueprint.brand || '',
          productCode: blueprint.productCode,
          providerId: provider.id,
          providerTitle: provider.title || '',
          providerLocation: provider.location || null,
          variants,
          shipping
        };
      } catch (error) {
        return {
          blueprintId: blueprint.id,
          blueprintTitle: blueprint.title || '',
          brand: blueprint.brand || '',
          productCode: blueprint.productCode,
          providerId: provider.id,
          providerTitle: provider.title || '',
          providerLocation: provider.location || null,
          variants: [],
          shipping: null,
          error: error?.message || String(error)
        };
      }
    })).filter(Boolean);

    catalogCache = {
      fetchedAt: Date.now(), rows,
      shopCosts: shopCosts.map,
      savedCosts: savedCosts.document.variants || {},
      priceLibraryError: savedCosts.error,
      priceLibraryUpdatedAt: savedCosts.document.updatedAt || null,
      shopCostWarning: shopCosts.warning,
      shopProductCount: shopCosts.productCount,
      pricedVariantCount: shopCosts.map.size,
      blueprintCount: blueprints.length,
      wallArtBlueprintCount: wallArtBlueprints.length,
      printProviderOffersScanned: providerTasks.length,
      providerFailures,
      providerDetailErrors: rows.filter(item => item.error).map(item => ({
        blueprintId: item.blueprintId, provider: item.providerTitle, error: item.error
      }))
    };
    return catalogCache;
  })();

  try {
    return await catalogPromise;
  } finally {
    catalogPromise = null;
  }
}

function rowKey(row) {
  return `${row?.productCode || ''}|${normalizeSize(row?.size)}|${finishFamily(row?.finish)}`;
}

export async function scanPrintifyComparisonRows({ rows = [], countryCode, fresh = false } = {}) {
  if (!printifyConfigStatus().ready) {
    return new Map((rows || []).map(row => [rowKey(row), {
      provider: 'Printify', eligible: false, status: 'not-configured',
      reason: 'PRINTIFY_API_TOKEN is not configured.'
    }]));
  }

  const loaded = await loadCatalog({ fresh });
  const catalog = loaded.rows || [];
  const shopCosts = loaded.shopCosts || new Map();
  const savedCosts = loaded.savedCosts || {};
  const country = String(countryCode || '').trim().toUpperCase();
  const result = new Map();

  for (const row of rows || []) {
    const wantedSize = normalizeSize(row?.size);
    const candidates = [];
    const missingDestination = [];
    let exactSizeCount = 0;

    for (const offering of catalog) {
      if (offering.productCode !== row?.productCode) continue;
      for (const variant of offering.variants || []) {
        if (variantSize(variant) !== wantedSize) continue;
        if (!finishCompatible(row, variant, offering.blueprintTitle)) continue;

        exactSizeCount++;
        const profile = shippingProfileForVariant(offering.shipping, variant?.id, country);
        if (!profile) {
          missingDestination.push({
            product: offering.blueprintTitle,
            printProvider: offering.providerTitle,
            variantTitle: variant?.title || ''
          });
          continue;
        }

        const costKey = costMapKey(offering.blueprintId, offering.providerId, variant?.id);
        const saved = savedCosts[costKey];
        const productCost = shopCosts.get(costKey) ??
          moneyFromCents(variant?.cost) ?? moneyFromCents(saved?.costCents);
        const costSource = shopCosts.has(costKey)
          ? 'printify-shop-product' : numeric(variant?.cost) != null
          ? 'printify-catalog' : saved?.costCents != null
          ? 'r2-pricing-library' : 'unavailable';
        const shippingCost = shippingCostUsd(profile);
        if (shippingCost == null) continue;
        const totalUsd = productCost != null ? productCost + shippingCost : null;
        candidates.push({ offering, variant, profile, productCost, shippingCost, totalUsd, costSource });
      }
    }

    candidates.sort((a, b) => {
      // Prefer a complete production + shipping quote; of those, choose
      // the lowest real landed total, NOT merely the lowest shipping fee.
      if (a.totalUsd == null && b.totalUsd != null) return 1;
      if (a.totalUsd != null && b.totalUsd == null) return -1;
      if (a.totalUsd != null && b.totalUsd != null && a.totalUsd !== b.totalUsd) {
        return a.totalUsd - b.totalUsd;
      }
      if (a.shippingCost !== b.shippingCost) return a.shippingCost - b.shippingCost;
      return String(a.offering.providerTitle).localeCompare(String(b.offering.providerTitle));
    });
    const best = candidates[0];
    const offers = candidates.map(item => ({
      product: item.offering.blueprintTitle,
      brand: item.offering.brand || '',
      printProvider: item.offering.providerTitle,
      printProviderCountry: item.offering.providerLocation?.country || '',
      blueprintId: item.offering.blueprintId,
      providerId: item.offering.providerId,
      variantId: item.variant?.id ?? null,
      variantTitle: item.variant?.title || '',
      productionUsd: item.productCost,
      shippingUsd: item.shippingCost,
      quotedTotalUsd: item.totalUsd,
      costSource: item.costSource,
      priceStatus: item.totalUsd != null ? 'priced' : 'production-cost-missing'
    }));
    const scan = {
      totalCatalogBlueprints: loaded.blueprintCount,
      wallArtBlueprints: loaded.wallArtBlueprintCount,
      blueprintProvidersScanned: loaded.printProviderOffersScanned,
      exactSizeMatches: exactSizeCount,
      shippableOffers: offers.length,
      omittedForCountry: missingDestination.length,
      savedLibraryUpdatedAt: loaded.priceLibraryUpdatedAt,
      priceLibraryWarning: loaded.priceLibraryError,
      catalogErrors: [...(loaded.providerFailures || []), ...(loaded.providerDetailErrors || [])],
      omittedExamples: missingDestination.slice(0, 12)
    };

    if (!best) {
      result.set(rowKey(row), {
        provider: 'Printify', eligible: false,
        status: exactSizeCount ? 'not-available-for-route' : 'catalog-no-match',
        reason: exactSizeCount
          ? `Printify found ${exactSizeCount} exact-size variations among all wall-art products/providers but none with confirmed shipping to ${country}.`
          : `Printify found no ${wantedSize} variant across ${loaded.printProviderOffersScanned} wall-art blueprint/provider combinations. ${scan.catalogErrors.length} catalog requests failed.`,
        meta: { scan, offers }
      });
      continue;
    }

    if (best.productCost == null) {
      result.set(rowKey(row), {
        provider: 'Printify', eligible: false, status: 'available-no-live-cost',
        totalUsd: null,
        currency: 'USD',
        productCost: null,
        shippingCost: best.shippingCost,
        reason: loaded.shopCostWarning
          ? `Printify offers this size and shipping route, but production cost could not be loaded from the connected shop: ${loaded.shopCostWarning}. It cannot be safely ranked until cost is verified.`
          : `Printify offers this size and shipping route, but there is no production cost for this exact blueprint/provider/variant in the connected shop's ${loaded.shopProductCount} products. The catalog API only exposes shipping, not production cost. It cannot be safely ranked yet.`,
        basis: 'Live Printify catalog availability + destination shipping. Production cost is not exposed by the catalog endpoint.',
        meta: {
          blueprintId: best.offering.blueprintId,
          blueprintTitle: best.offering.blueprintTitle,
          printProviderId: best.offering.providerId,
          printProvider: best.offering.providerTitle,
          providerCountry: best.offering.providerLocation?.country || '',
          variantId: best.variant?.id,
          variantTitle: best.variant?.title || '',
          candidates: candidates.length,
          shopProductCount: loaded.shopProductCount,
          pricedVariantCount: loaded.pricedVariantCount,
          scan, offers
        }
      });
      continue;
    }

    result.set(rowKey(row), {
      provider: 'Printify',
      eligible: true,
      status: 'available',
      totalUsd: Math.round(best.totalUsd * 100) / 100,
      originalTotal: Math.round(best.totalUsd * 100) / 100,
      currency: 'USD',
      productCost: best.productCost,
      shippingCost: best.shippingCost,
      reason: '',
      basis: best.costSource === 'r2-pricing-library'
          ? 'Production price captured from an unpublished Printify test product and saved to R2; live destination shipping. Recheck when rates change.'
          : 'Printify shop-product or catalog fulfillment cost + live catalog shipping for the same blueprint/provider/variant.',
      meta: {
        blueprintId: best.offering.blueprintId,
        blueprintTitle: best.offering.blueprintTitle,
        printProviderId: best.offering.providerId,
        printProvider: best.offering.providerTitle,
        providerCountry: best.offering.providerLocation?.country || '',
        variantId: best.variant?.id,
        variantTitle: best.variant?.title || '',
        handlingTime: best.offering.shipping?.handling_time || null,
        costSource: best.costSource,
        libraryCapturedAt: best.costSource === 'r2-pricing-library'
          ? loaded.priceLibraryUpdatedAt : null,
        candidates: candidates.length,
        scan, offers
      }
    });
  }

  return result;
}

export function invalidatePrintifyCatalogCache() {
  catalogCache = null;
}
export const __test = { normalizeSize, classifyBlueprint, finishFamily, variantSize, rowKey };
