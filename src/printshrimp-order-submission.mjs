// Explicit, one-order-at-a-time PrintShrimp submission for a regular Etsy
// order whose approved recommendation is PrintShrimp (an unframed Matte
// poster). It follows the Artelo submission (artelo-order-submission.mjs):
//   - FULFILLMENT_LIVE_SUBMISSION_ENABLED=true and PRINTSHRIMP_FULFILLMENT_ENABLED=true,
//   - the receipt in SUPPLIER_SUBMISSION_ALLOWED_RECEIPTS (or "all"),
//   - the recommendation approved on Fulfillment Review,
//   - PrintShrimp's live price for the exact order close to the approved quote,
//   - the typed confirmation "SUBMIT <receipt> TO PRINTSHRIMP" and the
//     operator's statement that the PrintShrimp dashboard has no order for it.
// The submission record (supplier-order-ledger.mjs) is "submitting" before the
// request; a timeout or outage leaves it "unknown", never sent again on its own.
import { readOrder, saveReview, validReceiptId } from './custom-order-store.mjs';
import { eligibleRegularReceipt } from './regular-order-routing.mjs';
import { resolveProviderArtworkAsset } from './fulfillment-assets.mjs';
import { artworkObjectExists } from './r2.mjs';
import { createPrintShrimpOrder, validatePrintShrimpOrderPreview, PRINTSHRIMP_PRINT_SIZES, PRINTSHRIMP_PRINT_PAPER_TYPE } from './printshrimp.mjs';
import { ledgerStore, transition, blockedBy } from './supplier-order-ledger.mjs';

const flag = (env, name) => String(env[name] || '').trim().toLowerCase() === 'true';
const words = value => String(value ?? '').trim();
const locks = new Set();

export function printShrimpSubmissionSettings(env = process.env) {
  const list = words(env.SUPPLIER_SUBMISSION_ALLOWED_RECEIPTS);
  return {
    masterEnabled: flag(env, 'FULFILLMENT_LIVE_SUBMISSION_ENABLED'),
    printShrimpEnabled: flag(env, 'PRINTSHRIMP_FULFILLMENT_ENABLED'),
    allReceipts: list.toLowerCase() === 'all',
    allowedReceipts: new Set(list.split(/[\s,]+/).filter(Boolean))
  };
}
export const printShrimpConfirmation = receiptId => `SUBMIT ${receiptId} TO PRINTSHRIMP`;

// The regular-order checks for an order whose recommendation was approved for
// ordering: the approval itself is not "already placed".
function checkEligible(order, receipt, shopId) {
  const review = order?.review || {};
  const approvedOnly = review.status === 'approved_for_manual_order' && !review.approval?.supplierOrderSubmitted && !review.supplierOrderId;
  return eligibleRegularReceipt({ ...order, staged: { ...order?.staged, receipt },
    review: approvedOnly ? { ...review, status: 'awaiting_supplier_approval' } : review }, shopId);
}

// The PrintShrimp order for a receipt: { payload, issues }. Etsy shares no
// buyer email or phone, so those are left out. PrintShrimp prints the
// production crop as it is (its orientation is shown in the preview).
export function buildPrintShrimpPayload({ receipt, plan, asset }) {
  const issues = [];
  if (plan?.supplier !== 'printshrimp') issues.push(`The approved supplier is ${plan?.provider || plan?.supplier || 'none'}, not PrintShrimp.`);
  if (plan?.productCode !== 'P') issues.push('PrintShrimp is only used for unframed posters (product P).');
  const size = words(plan?.size);
  if (!PRINTSHRIMP_PRINT_SIZES.includes(size)) issues.push(`PrintShrimp has no ${size || 'unknown'} poster size.`);
  if (!asset?.url) issues.push('The production artwork has no download URL.');
  if (words(asset?.orientation).toLowerCase() === 'square') issues.push('Square artwork needs manual review for PrintShrimp.');
  const customerInfo = {
    name: words(receipt?.name), address1: words(receipt?.first_line), address2: words(receipt?.second_line),
    city: words(receipt?.city), state: words(receipt?.state), zip: words(receipt?.zip), country: words(receipt?.country_iso).toUpperCase()
  };
  for (const [field, label] of [['name', 'name'], ['address1', 'street'], ['city', 'city'], ['zip', 'postal code'], ['country', 'country']])
    if (!customerInfo[field]) issues.push(`The Etsy shipping address has no ${label}.`);
  if (['US', 'CA', 'AU'].includes(customerInfo.country) && !customerInfo.state)
    issues.push('PrintShrimp needs a state or province for this country, and the Etsy address has none.');
  const payload = {
    customerInfo: Object.fromEntries(Object.entries(customerInfo).filter(([, value]) => value)),
    products: [{ type: 'Print', paper_type: PRINTSHRIMP_PRINT_PAPER_TYPE, size, quantity: 1,
      image: { artwork_url: asset?.url || '' } }]
  };
  return { payload, issues };
}

function defaultDeps() {
  return { readOrder, saveReview, resolveAsset: resolveProviderArtworkAsset, artworkExists: artworkObjectExists,
    createOrder: createPrintShrimpOrder, priceCheck: validatePrintShrimpOrderPreview,
    ledger: ledgerStore(), trackingRecord: async () => null, env: process.env, now: () => new Date() };
}

// The checks for one PrintShrimp submission, with PrintShrimp's live price for
// the exact order. Never creates an order.
export async function previewPrintShrimpOrder(receiptId, { shopId, latestReceipt = null, deps = {} } = {}) {
  const d = { ...defaultDeps(), ...deps };
  const id = validReceiptId(receiptId);
  const settings = printShrimpSubmissionSettings(d.env);
  const order = await d.readOrder(id);
  const receipt = latestReceipt || order?.staged?.receipt || {};
  const review = order?.review || {}, plan = review.regularPlan || null;
  const blockers = [];
  try { checkEligible(order, receipt, shopId ?? receipt.shop_id); }
  catch (error) { blockers.push(error.message); }
  if (!plan) blockers.push('No supplier recommendation has been prepared.');
  else if (plan.supplier !== 'printshrimp') blockers.push(`The recommended supplier is ${plan.provider || plan.supplier}, not PrintShrimp.`);
  if (review.status !== 'approved_for_manual_order' || !review.approval?.planSignature || review.approval.planSignature !== plan?.signature)
    blockers.push('Approve the PrintShrimp recommendation on Fulfillment Review first (address, artwork, variant and price checked).');
  const ledger = await d.ledger.read(id);
  const blocked = blockedBy(ledger, 'printshrimp');
  if (blocked) blockers.push(blocked);
  const tracking = await d.trackingRecord(id).catch(() => null);
  if (tracking?.supplier) blockers.push(`Order Tracking links this receipt to ${tracking.supplier} order ${tracking.supplierOrderId}; it was fulfilled elsewhere.`);
  let asset = null;
  if (plan) {
    try {
      asset = await d.resolveAsset({ artworkId: plan.artworkId, size: plan.size });
      if (asset.key !== plan.assetKey) blockers.push('The production artwork changed after approval. Prepare and approve again.');
      if (!(await d.artworkExists(asset.key))) blockers.push('The production artwork is missing from R2.');
    } catch (error) { blockers.push(error.message); }
  }
  const { payload, issues } = plan ? buildPrintShrimpPayload({ receipt, plan, asset }) : { payload: null, issues: [] };
  blockers.push(...issues);
  // PrintShrimp's live price for this exact order, against the approved quote.
  let price = null;
  if (payload && !issues.length) {
    try {
      const check = await d.priceCheck(payload);
      const row = check?.checks?.[0] || {};
      const currency = words(row.currency || check?.currency).toUpperCase();
      const total = Number(row.livePrice) + Number(row.liveShipping);
      const rate = currency === 'USD' ? 1 : Number(plan?.quoteDetails?.gbpToUsd);
      const totalUsd = Number.isFinite(total) && rate > 0 && (currency === 'USD' || currency === 'GBP') ? total * rate : null;
      price = { product: Number(row.livePrice), shipping: Number(row.liveShipping), total, currency, totalUsd };
      if (totalUsd == null) blockers.push(`PrintShrimp priced this order in ${currency || 'an unknown currency'}; it cannot be compared with the approved quote.`);
      else if (Math.abs(totalUsd - plan.quotedTotalUsd) > Math.max(2, plan.quotedTotalUsd * 0.15))
        blockers.push(`PrintShrimp now prices this order at $${totalUsd.toFixed(2)}, not the approved $${plan.quotedTotalUsd.toFixed(2)}: refresh the quote and approve again.`);
    } catch (error) { blockers.push('PrintShrimp price check failed: ' + (error?.message || error)); }
  }
  const switches = [];
  if (!settings.masterEnabled) switches.push('FULFILLMENT_LIVE_SUBMISSION_ENABLED is not true');
  if (!settings.printShrimpEnabled) switches.push('PRINTSHRIMP_FULFILLMENT_ENABLED is not true');
  if (!settings.allReceipts && !settings.allowedReceipts.has(id)) switches.push(`receipt ${id} is not in SUPPLIER_SUBMISSION_ALLOWED_RECEIPTS (or set it to all)`);
  const visible = payload ? { ...payload, products: payload.products.map(p => ({ ...p, image: { artwork_url: '(signed R2 link to ' + (asset?.key || '') + ')' } })) } : null;
  return { receiptId: id, supplier: 'printshrimp', ready: !blockers.length && !switches.length, blockers, switches, payload: visible,
    artwork: asset ? { key: asset.key, width: asset.width, height: asset.height, orientation: asset.orientation, ratio: asset.ratio } : null,
    expectedCost: { approvedQuoteUsd: plan?.quotedTotalUsd ?? null, approvedModeledUsd: plan?.modeledLandedUsd ?? null, printShrimpPriceCheck: price },
    submission: ledger, confirmation: printShrimpConfirmation(id), _payload: payload, _planSignature: plan?.signature || null };
}

const definiteRejection = error => /PrintShrimp API (4\d\d)/.test(String(error?.message || '')) && !/PrintShrimp API (408|409|429)/.test(String(error?.message || ''));
export function printShrimpOrderId(raw = {}) {
  const nested = raw?.order || raw?.data || {};
  return words(raw?.order_id || raw?.orderId || raw?.id || nested?.order_id || nested?.orderId || nested?.id);
}

// Submits one approved PrintShrimp order, once. Returns the submission record.
export async function submitPrintShrimpOrder(receiptId, input = {}, { shopId, latestReceipt, deps = {} } = {}) {
  const d = { ...defaultDeps(), ...deps };
  const id = validReceiptId(receiptId);
  if (locks.has(id)) throw new Error('This order is already being submitted.');
  locks.add(id);
  try {
    if (input?.confirm !== printShrimpConfirmation(id)) throw new Error(`Type "${printShrimpConfirmation(id)}" to submit this order.`);
    if (input?.dashboardChecked !== true) throw new Error('Confirm that the PrintShrimp dashboard has no order for this receipt.');
    const preview = await previewPrintShrimpOrder(id, { shopId, latestReceipt, deps: d });
    if (preview.switches.length) throw new Error('PrintShrimp submission is not authorized: ' + preview.switches.join('; ') + '.');
    if (preview.blockers.length) throw new Error('Not submitted: ' + preview.blockers.join(' '));
    const at = () => d.now().toISOString();
    let record = await d.ledger.read(id);
    record = transition(record, 'prepared', { provider: 'printshrimp', at: at(), fields: { receiptId: id, planSignature: preview._planSignature } });
    record = transition(record, 'queued', { provider: 'printshrimp', at: at(), note: 'Explicitly authorized: ' + printShrimpConfirmation(id) });
    // Saved before the request: if the app stops now, the order shows as
    // "submitting" and is treated as unknown, never sent again on its own.
    record = transition(record, 'submitting', { provider: 'printshrimp', at: at() });
    await d.ledger.write(id, record);
    let raw;
    try { raw = await d.createOrder(preview._payload); }
    catch (error) {
      const rejected = definiteRejection(error);
      record = transition(record, rejected ? 'rejected' : 'unknown', { provider: 'printshrimp', at: at(),
        note: String(error?.message || error).slice(0, 400), fields: { lastError: String(error?.message || error).slice(0, 400) } });
      await d.ledger.write(id, record);
      throw Object.assign(new Error(rejected
        ? 'PrintShrimp rejected the order: ' + (error?.message || error)
        : 'PrintShrimp did not confirm the order (' + (error?.message || error) + '). It may or may not have been created: check the PrintShrimp dashboard. It will not be sent again automatically.'), { record });
    }
    const supplierOrderId = printShrimpOrderId(raw);
    record = transition(record, supplierOrderId ? 'submitted' : 'unknown', { provider: 'printshrimp', at: at(),
      fields: { supplierOrderId, supplierStatus: words(raw?.status || raw?.order?.status) },
      note: supplierOrderId ? '' : 'PrintShrimp answered without an order ID; verify in the dashboard.' });
    await d.ledger.write(id, record);
    const order = await d.readOrder(id);
    await d.saveReview(id, { ...order.review, status: 'supplier_submitted', supplierOrderId, updatedAt: at(),
      approval: { ...(order.review?.approval || {}), supplierOrderSubmitted: true, supplier: 'printshrimp', submittedAt: at() } });
    return record;
  } finally { locks.delete(id); }
}
