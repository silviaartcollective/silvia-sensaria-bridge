import { readOrder, saveReview, paidReceipt } from './custom-order-store.mjs';
import { lookupCustomSize } from './custom-size-lookup.mjs';
import { profitScenarioPolicy } from './retail-margin.mjs';
import { loadArtworkManifest } from './artwork-storage.mjs';
import { artworkObjectExists } from './r2.mjs';

const suppliers = new Set(['sensaria', 'prodigi', 'artelo', 'printshrimp', 'printify', 'gelato']);
const round = number => Math.round((Number(number) + Number.EPSILON) * 100) / 100;
const words = value => String(value ?? '').trim();
function costNumber(value, name, positive = false) {
  if (value == null || value === '') throw new Error(name + ' is required.');
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || (positive && n <= 0) || n > 1000000) {
    throw new Error('Invalid ' + name);
  }
  return round(n);
}
function confirmItem(order) {
  const receipt = order.staged.receipt || {};
  if (!paidReceipt(receipt, order.staged.source)) throw new Error('Etsy receipt is not confirmed paid or was canceled.');
  const items = Array.isArray(receipt.transactions) ? receipt.transactions : [];
  if (items.length !== 1 || Number(items[0].quantity || 1) !== 1) {
    throw new Error('This workflow currently supports one purchased item (quantity one). Review other orders directly in Etsy.');
  }
  const country = words(receipt.country_iso).toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) throw new Error('Shipping country is not available in this receipt. Check Etsy.');
  return country;
}
export async function classify(id, classification) {
  if (!['custom', 'regular', 'unclassified'].includes(classification)) throw new Error('Choose custom, regular, or unclassified.');
  const order = await readOrder(id);
  if (order.review?.status === 'manually_ordered') throw new Error('Cannot reclassify an order already marked as placed.');
  const review = {
    ...order.review, classification, status: 'needs_review',
    plan: classification === 'custom' ? order.review?.plan || null : null,
    approval: null, updatedAt: new Date().toISOString()
  };
  return saveReview(id, review);
}
export async function quote(id, input) {
  const order = await readOrder(id);
  const countryCode = confirmItem(order);
  const result = await lookupCustomSize({
    countryCode, productCode: input.productCode, width: input.width,
    height: input.height, frame: input.frame,
    shippingMode: input.shippingMode || 'auto'
  });
  return { summary: order.summary, result };
}
export function validCustomArtworkId(value) {
  const id = words(value).toUpperCase();
  if (!/^SAC[0-9]{4,}$/.test(id)) throw new Error('Select a valid Silvia artwork ID (for example SAC0003).');
  return id;
}
async function verifiedArtwork(id) {
  const artworkId = validCustomArtworkId(id);
  let manifest;
  try { manifest = await loadArtworkManifest(artworkId); }
  catch { throw new Error('Artwork ' + artworkId + ' is not present in the Silvia R2 artwork library.'); }
  if (manifest?.artworkId !== artworkId || manifest.status !== 'ready' || !manifest.master?.key) {
    throw new Error('Artwork ' + artworkId + ' has no ready production master. Upload or finish it first.');
  }
  if (!(await artworkObjectExists(manifest.master.key))) {
    throw new Error('Artwork ' + artworkId + ' master image is missing from R2.');
  }
  return { artworkId, title: words(manifest.title), orientation: words(manifest.orientation), masterKey: manifest.master.key };
}
export async function savePlan(id, input) {
  const order = await readOrder(id);
  if (order.review?.classification !== 'custom') throw new Error('Mark this Etsy order as Custom first.');
  if (order.review?.status === 'manually_ordered') throw new Error('This supplier order is already recorded.');
  const country = confirmItem(order);
  const artwork = await verifiedArtwork(input.artworkId);
  const supplier = words(input.supplier).toLowerCase();
  if (!suppliers.has(supplier)) throw new Error('Select a supported supplier.');
  const merchandise = costNumber(input.salePriceUsd, 'actual artwork sale price in USD', true);
  const shipping = costNumber(input.customerShippingUsd, 'customer shipping paid in USD');
  const result = await lookupCustomSize({
    countryCode: country, productCode: input.productCode, width: input.width,
    height: input.height, frame: input.frame, shippingMode: shipping ? 'separate' : 'included'
  });
  const offer = result.suppliers[supplier];
  const cost = Number(offer?.modeledLandedUsd ?? offer?.totalUsd);
  if (!offer?.eligible || !Number.isFinite(cost) || cost <= 0) {
    throw new Error('That supplier is not confirmed for this exact size, product and country.');
  }
  const rate = Number(profitScenarioPolicy().etsyFeeReservePercent);
  const fees = round((merchandise + shipping) * rate / 100);
  const review = {
    ...order.review, classification: 'custom', status: 'needs_review', approval: null,
    plan: {
      artworkId: artwork.artworkId, artworkTitle: artwork.title,
      artworkOrientation: artwork.orientation, artworkMasterKey: artwork.masterKey,
      productCode: result.request.productCode, countryCode: country,
      size: result.request.size, width: Number(input.width), height: Number(input.height),
      frame: result.request.frame || '', supplier, supplierLabel: offer.provider || supplier,
      quotedSupplierUsd: round(Number(offer.totalUsd)), modeledSupplierUsd: round(cost),
      supplierShippingUsd: offer.shippingCost == null ? null : round(Number(offer.shippingCost)),
      quoteDetails: offer.meta || null, quoteGeneratedAt: result.generatedAt,
      customerArtworkUsd: merchandise, customerShippingUsd: shipping,
      estimatedEtsyFeesUsd: fees, assumedEtsyFeePercent: rate,
      estimatedContributionUsd: round(merchandise + shipping - fees - cost),
      notes: words(input.notes).slice(0, 1200)
    },
    updatedAt: new Date().toISOString()
  };
  await saveReview(id, review);
  return review;
}
export function validateApproval(order, input) {
  const review = order.review;
  if (review?.classification !== 'custom' || !review?.plan) throw new Error('Save a custom supplier plan before approval.');
  if (review.status === 'manually_ordered') throw new Error('Supplier placement has already been recorded.');
  if (!review.plan.artworkId || !/^SAC[0-9]{4,}$/.test(review.plan.artworkId) || !review.plan.artworkMasterKey) {
    throw new Error('Link a verified SAC artwork ID before approving this private custom order.');
  }
  if (confirmItem(order) !== review.plan.countryCode) throw new Error('Shipping country changed. Get a fresh quote.');
  const elapsed = Date.now() - Date.parse(review.plan.quoteGeneratedAt);
  if (!Number.isFinite(elapsed) || elapsed < -60000 || elapsed > 86400000) {
    throw new Error('Quote is older than 24 hours. Save a fresh supplier plan.');
  }
  if (input?.confirm !== 'APPROVE' ||
      input?.addressVerified !== true || input?.artworkVerified !== true ||
      input?.supplierVerified !== true || input?.amountVerified !== true) {
    throw new Error('Confirm the shipping address, artwork/crop, supplier variant and Etsy amounts before approval.');
  }
}
export async function approve(id, input) {
  const order = await readOrder(id);
  validateApproval(order, input);
  const artwork = await verifiedArtwork(order.review.plan.artworkId);
  if (artwork.masterKey !== order.review.plan.artworkMasterKey) {
    throw new Error('The linked artwork master changed since the plan was saved. Recreate the plan.');
  }
  const now = new Date().toISOString();
  const review = {
    ...order.review, status: 'approved_for_manual_order', updatedAt: now,
    approval: { approvedAt: now, method: 'manual_review_only', supplierOrderSubmitted: false }
  };
  return saveReview(id, review);
}
export async function markOrdered(id, input) {
  const order = await readOrder(id);
  if (order.review?.status !== 'approved_for_manual_order') {
    throw new Error('Approve first. This action records only a manually placed supplier order.');
  }
  const ref = words(input?.supplierOrderId);
  if (!ref || ref.length > 180) throw new Error('Enter the actual supplier order reference.');
  const now = new Date().toISOString();
  return saveReview(id, {
    ...order.review, status: 'manually_ordered', supplierOrderId: ref,
    manuallyOrderedAt: now, updatedAt: now
  });
}
