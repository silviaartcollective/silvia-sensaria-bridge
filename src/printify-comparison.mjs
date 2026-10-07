import {
  getPrintifyBlueprints,
  getPrintifyPrintProviders,
  getPrintifyVariants,
  getPrintifyShipping,
  printifyConfigStatus
} from './printify.mjs';

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
let catalogCache = null;
let catalogPromise = null;

function numeric(value) {
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
  if (/canvas/.test(text) && !/framed/.test(text)) return 'C';
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
  return normalizeSize(fromOptions || variant?.title || optionText(variant));
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

function providerVariantCostUsd(variant) {
  const cents = numeric(variant?.cost ?? variant?.price);
  return cents == null ? null : moneyFromCents(cents);
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

async function loadCatalog() {
  const now = Date.now();
  if (catalogCache && now - catalogCache.fetchedAt < CACHE_TTL_MS) return catalogCache.rows;
  if (catalogPromise) return catalogPromise;

  catalogPromise = (async () => {
    const blueprints = (await getPrintifyBlueprints())
      .map(item => ({ ...item, productCode: classifyBlueprint(item?.title) }))
      .filter(item => item.productCode);

    const providerTasks = [];
    for (const blueprint of blueprints) {
      const providers = await getPrintifyPrintProviders(blueprint.id);
      for (const provider of providers) providerTasks.push({ blueprint, provider });
    }

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

    catalogCache = { fetchedAt: Date.now(), rows };
    return rows;
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

export async function scanPrintifyComparisonRows({ rows = [], countryCode } = {}) {
  if (!printifyConfigStatus().ready) {
    return new Map((rows || []).map(row => [rowKey(row), {
      provider: 'Printify', eligible: false, status: 'not-configured',
      reason: 'PRINTIFY_API_TOKEN is not configured.'
    }]));
  }

  const catalog = await loadCatalog();
  const country = String(countryCode || '').trim().toUpperCase();
  const result = new Map();

  for (const row of rows || []) {
    const wantedSize = normalizeSize(row?.size);
    const candidates = [];

    for (const offering of catalog) {
      if (offering.productCode !== row?.productCode) continue;
      for (const variant of offering.variants || []) {
        if (variantSize(variant) !== wantedSize) continue;
        if (!finishCompatible(row, variant, offering.blueprintTitle)) continue;

        const profile = shippingProfileForVariant(offering.shipping, variant?.id, country);
        if (!profile) continue;
        const productCost = providerVariantCostUsd(variant);
        const shippingCost = shippingCostUsd(profile);
        if (shippingCost == null) continue;
        const totalUsd = productCost != null ? productCost + shippingCost : null;
        candidates.push({ offering, variant, profile, productCost, shippingCost, totalUsd });
      }
    }

    candidates.sort((a, b) => {
      if (a.totalUsd == null && b.totalUsd != null) return 1;
      if (a.totalUsd != null && b.totalUsd == null) return -1;
      return (a.totalUsd ?? Infinity) - (b.totalUsd ?? Infinity);
    });
    const best = candidates[0];

    if (!best) {
      result.set(rowKey(row), {
        provider: 'Printify', eligible: false, status: 'unavailable',
        reason: 'No compatible Printify provider/variant with shipping to this country was found.'
      });
      continue;
    }

    if (best.productCost == null) {
      result.set(rowKey(row), {
        provider: 'Printify', eligible: false, status: 'price-unavailable',
        totalUsd: null,
        currency: 'USD',
        productCost: null,
        shippingCost: best.shippingCost,
        reason: 'Printify catalog returned this exact variant and shipping route, but no numeric fulfillment cost was exposed.',
        basis: 'Printify catalog availability + shipping; production cost unavailable.',
        meta: {
          blueprintId: best.offering.blueprintId,
          blueprintTitle: best.offering.blueprintTitle,
          printProviderId: best.offering.providerId,
          printProvider: best.offering.providerTitle,
          providerCountry: best.offering.providerLocation?.country || '',
          variantId: best.variant?.id,
          variantTitle: best.variant?.title || ''
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
      basis: 'Printify catalog fulfillment cost + first-item standard shipping.',
      meta: {
        blueprintId: best.offering.blueprintId,
        blueprintTitle: best.offering.blueprintTitle,
        printProviderId: best.offering.providerId,
        printProvider: best.offering.providerTitle,
        providerCountry: best.offering.providerLocation?.country || '',
        variantId: best.variant?.id,
        variantTitle: best.variant?.title || '',
        handlingTime: best.offering.shipping?.handling_time || null,
        candidates: candidates.length
      }
    });
  }

  return result;
}

export const __test = { normalizeSize, classifyBlueprint, finishFamily, variantSize, rowKey };
