import sharp from 'sharp';
import {
  getPrintifyVariants,
  getPrintifyProducts,
  createPrintifyPricingDraft,
  deletePrintifyPricingDraft,
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
let running = false;

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

export async function buildPrintifyCostsForRequest({
  countryCode, productCode, width, height, frame = '', maxDrafts = 3,
  confirm = ''
} = {}) {
  if (confirm !== 'CREATE_UNPUBLISHED_PRINTIFY_PRICING_DRAFTS') {
    throw new Error('Explicit confirmation required for unpublished Printify draft creation');
  }
  if (running) throw new Error('A Printify cost-library scan is already in progress');
  if (!printifyConfigStatus().ready) throw new Error('Printify API token is not configured');
  if (!['P','C','FC'].includes(String(productCode).toUpperCase())) {
    throw new Error('Only Poster, Canvas and Framed Canvas are allowed');
  }
  const country = String(countryCode || '').toUpperCase().trim();
  if (!/^[A-Z]{2}$/.test(country)) throw new Error('A valid destination country is required');
  const size = safeSize(width, height);
  const product = String(productCode).toUpperCase();
  const limit = Math.max(1, Math.min(4, Math.floor(Number(maxDrafts) || 3)));
  running = true;
  try {
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
    let imageId = null;
    const getImageId = async () => {
      if (!imageId) imageId = await uploadNeutralImage();
      return imageId;
    };
    for (const target of targets) {
      let draft = null;
      try {
        const variantsPayload = await getPrintifyVariants(target.blueprintId, target.providerId);
        const variants = Array.isArray(variantsPayload)
          ? variantsPayload : variantsPayload?.variants || [];
        const payload = draftPayload(
          target.blueprintId, target.providerId,
          variants, target.printProvider, target.product
        );
        // Use the official POST product creation endpoint, never /publish or /orders.
        draft = await createUnpublished(payload, getImageId);
        if (!draft?.id || !Array.isArray(draft?.variants)) {
          throw new Error('Printify created no readable draft ID or variant price information');
        }
        const prices = draft.variants
          .filter(v => Number.isSafeInteger(safeNumber(v?.cost)) && Number(v.cost) >= 0)
          .map(v => ({
            blueprintId: target.blueprintId,
            providerId: target.providerId,
            variantId: v.id,
            costCents: Number(v.cost)
          }));
        if (!prices.length) {
          throw new Error('Printify returned no supplier production costs for the draft');
        }
        let persisted = false;
        let persistenceWarning = '';
        try {
          await savePrintifyCostLibrary(prices);
          persisted = true;
        } catch (error) {
          // Keep the unpublished draft if the R2 save failed; its costs
          // remain recoverable via the Printify shop-products endpoint.
          persistenceWarning = error?.message || String(error);
        }
        let removed = false;
        let removeWarning = '';
        if (persisted) {
          try {
            await deletePrintifyPricingDraft(draft.id);
            removed = true;
          } catch (error) {
            removeWarning = error?.message || String(error);
          }
        }
        created.push({
          blueprintId: target.blueprintId,
          providerId: target.providerId,
          product: target.product,
          printProvider: target.printProvider,
          pricesCaptured: prices.length,
          savedInR2: persisted,
          temporaryDraftDeleted: removed,
          retainedDraftId: removed ? null : String(draft.id),
          warning: persistenceWarning || removeWarning || ''
        });
      } catch (error) {
        errors.push({
          blueprintId: target.blueprintId,
          providerId: target.providerId,
          product: target.product,
          printProvider: target.printProvider,
          error: error?.message || String(error),
          // A draft may remain, unpublished, if capture failed after creation.
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
      note: 'Only unpublished, private Printify test products were created. No product was published or ordered. Successfully saved pricing probes are deleted from Printify; any unsaved drafts remain unpublished for safety.'
    };
  } finally {
    running = false;
  }
}

export const __test = { draftPayload, labelsForVariant, imagePayload, safeSize };
