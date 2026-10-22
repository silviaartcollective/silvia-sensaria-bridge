import sharp from 'sharp';
import {
  getPrintifyVariants,
  getPrintifyProducts,
  createPrintifyPricingDraft,
  getPrintifyPricingDraft,
  uploadPrintifyPricingImage,
  printifyConfigStatus
} from './printify.mjs';
import {
  scanPrintifyComparisonRows,
  invalidatePrintifyCatalogCache
} from './printify-comparison.mjs';
import {
  savePrintifyCostLibrary,
  resetPrintifyCostLibraryCache
} from './printify-cost-store.mjs';

const DRAFT_PREFIX = '[PRIVATE PRICE CHECK — NOT FOR SALE]';
// One capture at a time; a lookup that arrives meanwhile waits for it and
// then finds the prices it saved instead of creating the same products.
let current = null;

function safeNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function safeSize(width, height) {
  const a = Number(width), b = Number(height);
  if (!(a > 0 && a <= 120 && b > 0 && b <= 120)) {
    throw new Error('Width and height must be between 1 and 120 inches');
  }
  return `${Math.min(a,b)}x${Math.max(a,b)}`;
}

function labelsForVariant(variant) {
  const placeholders = Array.isArray(variant?.placeholders) ? variant.placeholders : [];
  const items = placeholders.length ? placeholders : [{ position: 'front' }];
  const normalized = new Map();
  for (const item of items) {
    const position = String(item?.position || 'front');
    const method = String(item?.decoration_method || '');
    const key = position + '|' + method;
    normalized.set(key, {
      position,
      ...(method ? { decoration_method: method } : {}),
      images: []
    });
  }
  return [...normalized.values()].sort((a,b)=>a.position.localeCompare(b.position));
}

function draftPayload(blueprintId, providerId, allVariants, providerName, productName) {
  const variantIds = new Set();
  const variants = [];
  const byPlaceholder = new Map();
  for (const variant of allVariants) {
    const id = Number(variant?.id);
    if (!Number.isSafeInteger(id) || variantIds.has(id)) continue;
    variantIds.add(id);
    variants.push({ id, price: 99900, is_enabled: true });
    const placeholders = labelsForVariant(variant);
    const key = JSON.stringify(placeholders);
    const group = byPlaceholder.get(key) || { variant_ids: [], placeholders };
    group.variant_ids.push(id);
    byPlaceholder.set(key, group);
  }
  if (!variants.length) throw new Error('Printify returned no valid variants for this blueprint/provider');
  return {
    title: `${DRAFT_PREFIX} ${String(productName || 'Wall Art').slice(0, 50)} — ${String(providerName || 'Provider').slice(0, 45)}`,
    description: 'Internal production-cost reference only. NEVER publish to Etsy, Shopify, or another storefront. No customer orders.',
    blueprint_id: Number(blueprintId),
    print_provider_id: Number(providerId),
    visible: false,
    variants,
    print_areas: [...byPlaceholder.values()]
  };
}

function imagePayload(payload, id) {
  return {
    ...payload,
    print_areas: payload.print_areas.map(area => ({
      variant_ids: [...area.variant_ids],
      placeholders: area.placeholders.map(placeholder => ({
        ...placeholder,
        images: [{ id, x: 0.5, y: 0.5, scale: 1, angle: 0 }]
      }))
    }))
  };
}

async function uploadNeutralImage() {
  // Used only when Printify rejects a draft with empty print areas.
  // A simple neutral image avoids using any customer artwork for price scans.
  const png = await sharp({
    create: { width: 8000, height: 8000, channels: 3,
      background: { r: 230, g: 227, b: 221 } }
  }).png({ compressionLevel: 9 }).toBuffer();
  if (png.length > 5 * 1024 * 1024) {
    throw new Error('Neutral image exceeds Printify upload size guidance');
  }
  const uploaded = await uploadPrintifyPricingImage(png.toString('base64'));
  if (!uploaded?.id) throw new Error('Printify did not return a pricing-image ID');
  return uploaded.id;
}

async function createUnpublished(payload, getImageId) {
  try {
    return await createPrintifyPricingDraft(payload);
  } catch (error) {
    const message = String(error?.message || error);
    // Only retry image/placeholder validation; do not swallow token, shop,
    // catalog, provider, or rate-limit failures.
    if (!/\b(?:400|422)\b/.test(message) ||
        !/image|artwork|placeholder|print.area|file|graphic/i.test(message)) throw error;
    const id = await getImageId();
    return createPrintifyPricingDraft(imagePayload(payload, id));
  }
}

// The costs of every variant of a product in the Printify shop.
function variantCosts(product, target) {
  return (product?.variants || [])
    .filter(v => Number.isSafeInteger(safeNumber(v?.cost)) && Number(v.cost) >= 0)
    .map(v => ({
      blueprintId: target.blueprintId,
      providerId: target.providerId,
      variantId: v.id,
      costCents: Number(v.cost)
    }));
}

export async function buildPrintifyCostsForRequest(input = {}) {
  while (current) await current.catch(() => {});
  const run = captureCosts(input);
  current = run;
  try {
    return await run;
  } finally {
    if (current === run) current = null;
  }
}

async function captureCosts({
  countryCode, productCode, width, height, frame = '', maxDrafts = 3,
  confirm = ''
} = {}) {
  if (confirm !== 'CREATE_UNPUBLISHED_PRINTIFY_PRICING_DRAFTS') {
    throw new Error('Explicit confirmation required for unpublished Printify draft creation');
  }
  if (!printifyConfigStatus().ready) throw new Error('Printify API token is not configured');
  if (!['P','C','FC'].includes(String(productCode).toUpperCase())) {
    throw new Error('Only Poster, Canvas and Framed Canvas are allowed');
  }
  const country = String(countryCode || '').toUpperCase().trim();
  if (!/^[A-Z]{2}$/.test(country)) throw new Error('A valid destination country is required');
  const size = safeSize(width, height);
  const product = String(productCode).toUpperCase();
  const limit = Math.max(1, Math.min(4, Math.floor(Number(maxDrafts) || 3)));
  {
    const row = {
      productCode: product, size,
      finish: product === 'FC' ? frame : '—'
    };
    const current = await scanPrintifyComparisonRows({
      rows: [row], countryCode: country, fresh: true
    });
    const record = [...current.values()][0] || null;
    const offers = Array.isArray(record?.meta?.offers) ? record.meta.offers : [];
    const pairs = new Map();
    for (const offer of offers) {
      if (offer.productionUsd != null) continue;
      if (!Number.isFinite(Number(offer.blueprintId)) ||
          !Number.isFinite(Number(offer.providerId))) continue;
      const key = `${offer.blueprintId}|${offer.providerId}`;
      if (!pairs.has(key)) pairs.set(key, offer);
    }
    const targetCount = pairs.size;
    const targets = [...pairs.values()].slice(0, limit);
    const created = [];
    const errors = [];
    // A product/printer already in the Printify shop (an earlier price check,
    // or a real product) is reused, never created again. If the shop's
    // products cannot be read, nothing is created: it could be a duplicate.
    const shopProducts = targets.length ? await getPrintifyProducts() : [];
    const existingFor = target => shopProducts.find(product =>
      Number(product?.blueprint_id) === Number(target.blueprintId) &&
      Number(product?.print_provider_id) === Number(target.providerId));
    let imageId = null;
    const getImageId = async () => {
      if (!imageId) imageId = await uploadNeutralImage();
      return imageId;
    };
    for (const target of targets) {
      let draft = null;
      try {
        const existing = existingFor(target);
        if (existing) {
          let prices = variantCosts(existing, target);
          if (!prices.length && existing.id) prices = variantCosts(await getPrintifyPricingDraft(existing.id), target);
          if (!prices.length) throw new Error('The existing Printify product "' + String(existing.title || existing.id).slice(0, 80) +
            '" shows no production costs.');
          await savePrintifyCostLibrary(prices);
          created.push({
            blueprintId: target.blueprintId, providerId: target.providerId,
            product: target.product, printProvider: target.printProvider,
            pricesCaptured: prices.length, savedInR2: true, reusedProductId: String(existing.id || ''),
            createdProductId: null, warning: ''
          });
          continue;
        }
        const variantsPayload = await getPrintifyVariants(target.blueprintId, target.providerId);
        const variants = Array.isArray(variantsPayload)
          ? variantsPayload : variantsPayload?.variants || [];
        const payload = draftPayload(
          target.blueprintId, target.providerId,
          variants, target.printProvider, target.product
        );
        // Use the official POST product creation endpoint, never /publish or /orders.
        draft = await createUnpublished(payload, getImageId);
        if (!draft?.id) {
          throw new Error('Printify did not return a draft product ID');
        }
        // Some Printify shops populate product costs after the POST responds.
        // Re-fetch the private draft before deciding a variant is unavailable.
        let pricedDraft = draft;
        for (let attempt = 0; attempt < 3; attempt++) {
          const pricesReturned = Array.isArray(pricedDraft?.variants) &&
            pricedDraft.variants.some(v => Number.isSafeInteger(safeNumber(v?.cost)));
          if (pricesReturned) break;
          if (attempt) await new Promise(resolve => setTimeout(resolve, 800));
          pricedDraft = await getPrintifyPricingDraft(draft.id);
        }
        const prices = variantCosts(pricedDraft, target);
        if (!prices.length) {
          throw new Error('Printify returned no supplier production costs for the draft');
        }
        // The unpublished product stays in Printify: later lookups read its
        // current costs from the shop, and it is reused instead of recreated.
        // The saved copy keeps the costs if it is ever deleted in Printify.
        let persisted = false;
        let persistenceWarning = '';
        try {
          await savePrintifyCostLibrary(prices);
          persisted = true;
        } catch (error) {
          persistenceWarning = error?.message || String(error);
        }
        created.push({
          blueprintId: target.blueprintId,
          providerId: target.providerId,
          product: target.product,
          printProvider: target.printProvider,
          pricesCaptured: prices.length,
          savedInR2: persisted,
          reusedProductId: null,
          createdProductId: String(draft.id),
          warning: persistenceWarning
        });
      } catch (error) {
        errors.push({
          blueprintId: target.blueprintId,
          providerId: target.providerId,
          product: target.product,
          printProvider: target.printProvider,
          error: error?.message || String(error),
          // A product created before the failure stays, unpublished, and is
          // reused by the next capture.
          draftId: draft?.id ? String(draft.id) : null
        });
      }
    }
    invalidatePrintifyCatalogCache();
    resetPrintifyCostLibraryCache();
    return {
      ok: true, size, countryCode: country, productCode: product,
      matchingPrintifyOffers: offers.length,
      missingProviderPairsBefore: targetCount,
      attempted: targets.length,
      captured: created.reduce((n,item)=>n+item.pricesCaptured,0),
      created, errors,
      pendingProviderPairsEstimate: Math.max(0,targetCount-created.length),
      note: 'At most one unpublished, private price-check product per Printify product and printer is kept in the Printify shop and reused; nothing is published or ordered.'
    };
  }
}

export const __test = { draftPayload, labelsForVariant, imagePayload, safeSize, variantCosts };
