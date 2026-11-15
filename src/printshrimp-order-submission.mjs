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
//
// From PrintShrimp's API documentation: an order is created as Pending and is
// printed once paid (checkout, or Auto-pay from wallet in PrintShrimp's
// settings); an unpaid order can be deleted. external_order_number carries the
// Etsy receipt (SAC-<receipt>), and Get Order finds the order by it. Artwork
// files may be up to 50 MB; city may not contain numbers; name and address
// lines are at most 60 characters; US zips are numeric, UK ones have letters.
import { readOrder, saveReview, validReceiptId } from './custom-order-store.mjs';
import { eligibleRegularReceipt } from './regular-order-routing.mjs';
import { resolveProviderArtworkAsset } from './fulfillment-assets.mjs';
import { artworkObjectExists } from './r2.mjs';
import { createPrintShrimpOrder, validatePrintShrimpOrderPreview, getPrintShrimpOrder, PRINTSHRIMP_PRINT_SIZES, PRINTSHRIMP_PRINT_PAPER_TYPE } from './printshrimp.mjs';
import { artworkObjectInfo, getJsonObject, putJsonObject, isMissingR2Object } from './r2.mjs';
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
    allowedReceipts: new Set(list.split(/[\s,]+/).filter(Boolean)),
    // Automatic submission of new PrintShrimp orders (autoSubmitPrintShrimpOrder).
    autoEnabled: flag(env, 'PRINTSHRIMP_AUTO_SUBMIT_ENABLED'),
    dailyLimit: Math.min(50, Math.max(1, Math.floor(Number(env.PRINTSHRIMP_AUTO_SUBMIT_DAILY_LIMIT) || 5)))
  };
}
export const printShrimpConfirmation = receiptId => `SUBMIT ${receiptId} TO PRINTSHRIMP`;
export const PRINTSHRIMP_MAX_ARTWORK_BYTES = 50 * 1024 * 1024;
// The order reference PrintShrimp stores: the artwork's shop prefix and the receipt (SAC-4233477454).
export const printShrimpReference = (plan, receiptId) => (/^[A-Z]+/.exec(words(plan?.artworkId).toUpperCase())?.[0] || 'ETSY') + '-' + receiptId;

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
  for (const [field, label] of [['name', 'name'], ['address1', 'street line'], ['address2', 'second address line'], ['city', 'city'], ['state', 'state']])
    if (customerInfo[field].length > 60) issues.push(`The ${label} is over PrintShrimp's 60-character limit; order this one in the PrintShrimp dashboard.`);
  if (/\d/.test(customerInfo.city)) issues.push(`PrintShrimp does not accept numbers in the city ("${customerInfo.city}"); order this one in the PrintShrimp dashboard.`);
  if (customerInfo.country === 'US' && customerInfo.zip && !/^\d{5}(-?\d{4})?$/.test(customerInfo.zip)) issues.push('PrintShrimp needs a numeric US ZIP code.');
  if (customerInfo.country === 'GB' && customerInfo.zip && !/[A-Za-z]/.test(customerInfo.zip)) issues.push('PrintShrimp needs a UK postcode with letters.');
  const payload = {
    external_order_number: printShrimpReference(plan, validReceiptId(receipt?.receipt_id)),
    customerInfo: Object.fromEntries(Object.entries(customerInfo).filter(([, value]) => value)),
    products: [{ type: 'Print', paper_type: PRINTSHRIMP_PRINT_PAPER_TYPE, size, quantity: 1,
      image: { artwork_url: asset?.url || '' } }]
  };
  return { payload, issues };
}

function defaultDeps() {
  return { readOrder, saveReview, resolveAsset: resolveProviderArtworkAsset, artworkExists: artworkObjectExists,
    createOrder: createPrintShrimpOrder, priceCheck: validatePrintShrimpOrderPreview, getOrder: getPrintShrimpOrder,
    objectInfo: artworkObjectInfo, smallerArtwork: async () => null, publicArtworkUrl: null,
    ledger: ledgerStore(), trackingRecord: async () => null, env: process.env, now: () => new Date() };
}

// The checks for one PrintShrimp submission, with PrintShrimp's live price for
// the exact order. Never creates an order.
// automatic: the checks for autoSubmitPrintShrimpOrder, which replace the
// operator's approval: a new recommendation with no submission record at all,
// and PRINTSHRIMP_AUTO_SUBMIT_ENABLED instead of the receipt list.
export async function previewPrintShrimpOrder(receiptId, { shopId, latestReceipt = null, automatic = false, deps = {} } = {}) {
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
  if (automatic) {
    if (review.status !== 'awaiting_supplier_approval') blockers.push(`The order is ${review.status || 'not reviewed'}, not a new recommendation.`);
  } else if (review.status !== 'approved_for_manual_order' || !review.approval?.planSignature || review.approval.planSignature !== plan?.signature)
    blockers.push('Approve the PrintShrimp recommendation on Fulfillment Review first (address, artwork, variant and price checked).');
  const ledger = await d.ledger.read(id);
  // Automatic submission never touches an order with any record: only a person does.
  if (automatic && ledger) blockers.push(`A submission record exists (${ledger.provider} · ${ledger.state}).`);
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
  // PrintShrimp takes artwork files up to 50 MB. A larger ratio crop is replaced
  // by the exact-size crop (300 dpi for this size), queued on the PC if it is not made yet.
  if (asset && plan) {
    try {
      const bytes = Number((await d.objectInfo(asset.key))?.size || 0);
      asset = { ...asset, sizeBytes: bytes || null };
      if (bytes > PRINTSHRIMP_MAX_ARTWORK_BYTES) {
        const smaller = await d.smallerArtwork(plan.artworkId, plan.size);
        if (smaller?.url && Number(smaller.sizeBytes || 0) <= PRINTSHRIMP_MAX_ARTWORK_BYTES) asset = { ...smaller, replacedLargeCrop: asset.key };
        else blockers.push(`The ${asset.ratio} crop is ${(bytes / 1048576).toFixed(0)} MB and PrintShrimp accepts up to 50 MB. ` +
          (smaller?.message || 'Make a ' + plan.size + ' crop (Listings → Add a size, or Custom Size Lookup) and preview again.'));
      }
    } catch (error) { blockers.push('The production artwork size could not be checked: ' + (error?.message || error)); }
  }
  // PrintShrimp checks the artwork link with HEAD first; a GET-signed R2 link
  // answers that with 403, so the app's own expiring link is sent instead.
  if (asset?.key && d.publicArtworkUrl) {
    try { asset = { ...asset, url: d.publicArtworkUrl(asset.key) }; }
    catch (error) { blockers.push('The artwork link for PrintShrimp could not be made: ' + (error?.message || error)); }
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
  if (automatic) { if (!settings.autoEnabled) switches.push('PRINTSHRIMP_AUTO_SUBMIT_ENABLED is not true'); }
  else if (!settings.allReceipts && !settings.allowedReceipts.has(id)) switches.push(`receipt ${id} is not in SUPPLIER_SUBMISSION_ALLOWED_RECEIPTS (or set it to all)`);
  const visible = payload ? { ...payload, products: payload.products.map(p => ({ ...p, image: { artwork_url: '(private link to ' + (asset?.key || '') + ')' } })) } : null;
  return { receiptId: id, supplier: 'printshrimp', ready: !blockers.length && !switches.length, blockers, switches, payload: visible,
    artwork: asset ? { key: asset.key, width: asset.width, height: asset.height, orientation: asset.orientation, ratio: asset.ratio,
      sizeBytes: asset.sizeBytes ?? null, replacedLargeCrop: asset.replacedLargeCrop || null } : null,
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
    return await sendOnce(id, preview, d, { note: 'Explicitly authorized: ' + printShrimpConfirmation(id) });
  } finally { locks.delete(id); }
}

// What PrintShrimp has for this receipt, found by its order reference; an
// "unknown" submission that PrintShrimp has becomes "submitted" with its ID.
export async function verifyPrintShrimpSubmission(receiptId, { deps = {} } = {}) {
  const d = { ...defaultDeps(), ...deps };
  const id = validReceiptId(receiptId);
  let record = await d.ledger.read(id);
  const order = await d.readOrder(id).catch(() => null);
  const reference = printShrimpReference(order?.review?.regularPlan, id);
  let found = null;
  try { found = (await d.getOrder({ externalOrderNumber: reference }))?.order || null; }
  catch (error) { if (!/PrintShrimp API 404/.test(String(error?.message || ''))) throw error; }
  if (!found) return { found: false, reference, record, note: 'PrintShrimp has no order ' + reference + '.' };
  const orderId = words(found.order_id);
  if (record?.provider === 'printshrimp' && record.state === 'unknown' && orderId) {
    record = transition(record, 'submitted', { provider: 'printshrimp', at: d.now().toISOString(),
      fields: { supplierOrderId: orderId, supplierStatus: words(found.status) }, note: 'Found at PrintShrimp by its order reference.' });
    await d.ledger.write(id, record);
  }
  return { found: true, reference, record, orderId, status: words(found.status), paid: found.paid === true,
    orderNumber: found.order_num ?? null, tracking: found.tracking || null };
}

// The one order request, recorded at every step. Callers hold the lock.
async function sendOnce(id, preview, d, { note, approval = {} }) {
  const at = () => d.now().toISOString();
  let record = await d.ledger.read(id);
  record = transition(record, 'prepared', { provider: 'printshrimp', at: at(), fields: { receiptId: id, planSignature: preview._planSignature } });
  record = transition(record, 'queued', { provider: 'printshrimp', at: at(), note });
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
    approval: { ...(order.review?.approval || {}), ...approval, supplierOrderSubmitted: true, supplier: 'printshrimp', submittedAt: at() } });
  return record;
}

// Automatic submission: since when it is on, and how many orders it sent each
// day (fulfillment/auto-submit/printshrimp-state.json in R2).
const AUTO_STATE_KEY = 'fulfillment/auto-submit/printshrimp-state.json';
export function printShrimpAutoState({ get = getJsonObject, put = putJsonObject } = {}) {
  return {
    async read() {
      try { return await get(AUTO_STATE_KEY); }
      catch (error) { if (isMissingR2Object(error) || error?.code === 'missing') return {}; throw error; }
    },
    write: value => put(AUTO_STATE_KEY, value)
  };
}
// At startup: switched on, it counts from now (orders placed before are never
// sent automatically); switched off, the next switch-on starts afresh.
export async function syncPrintShrimpAutoActivation({ env = process.env, state = printShrimpAutoState(), now = () => new Date() } = {}) {
  const current = await state.read();
  if (!printShrimpSubmissionSettings(env).autoEnabled) {
    if (current.enabledSince) await state.write({ ...current, enabledSince: null });
    return null;
  }
  if (current.enabledSince) return current.enabledSince;
  await state.write({ ...current, enabledSince: now().toISOString() });
  return now().toISOString();
}

// Sends a NEW paid order whose recommended supplier is PrintShrimp, with no
// person approving it, when every check passes: the switches
// (FULFILLMENT_LIVE_SUBMISSION_ENABLED, PRINTSHRIMP_FULFILLMENT_ENABLED,
// PRINTSHRIMP_AUTO_SUBMIT_ENABLED), placed after automatic submission was
// switched on, under the daily limit, no submission record, and Preview's
// checks (address, artwork, PrintShrimp's live price within the quote). An
// order that fails a check is held for a person, once per recommendation.
// PrintShrimp creates it Pending: it is printed once paid (Auto-pay from wallet).
export async function autoSubmitPrintShrimpOrder(receiptId, { shopId, latestReceipt, deps = {} } = {}) {
  const d = { ...defaultDeps(), autoState: printShrimpAutoState(), ...deps };
  const id = validReceiptId(receiptId);
  const settings = printShrimpSubmissionSettings(d.env);
  if (!settings.autoEnabled || !settings.masterEnabled || !settings.printShrimpEnabled) return { receiptId: id, status: 'off' };
  const order = await d.readOrder(id);
  const review = order?.review || {}, plan = review.regularPlan || null;
  if (plan?.supplier !== 'printshrimp' || review.status !== 'awaiting_supplier_approval') return { receiptId: id, status: 'not_printshrimp' };
  if (review.automaticSubmission?.planSignature && review.automaticSubmission.planSignature === plan.signature)
    return { receiptId: id, status: 'already_held' };
  const state = await d.autoState.read();
  const receipt = latestReceipt || order?.staged?.receipt || {};
  const placed = Number(receipt.create_timestamp || receipt.created_timestamp) * 1000;
  if (!state.enabledSince || !(placed >= Date.parse(state.enabledSince))) return { receiptId: id, status: 'before_switch_on' };
  const day = d.now().toISOString().slice(0, 10);
  const hold = async reasons => {
    await d.saveReview(id, { ...review, automaticSubmission: { status: 'held', supplier: 'printshrimp', planSignature: plan.signature, reasons, at: d.now().toISOString() } });
    return { receiptId: id, status: 'held', reasons };
  };
  if ((state.days?.[day] || 0) >= settings.dailyLimit)
    return { receiptId: id, status: 'daily_limit', reasons: [`${settings.dailyLimit} PrintShrimp orders were already sent automatically today.`] };
  if (locks.has(id)) return { receiptId: id, status: 'already_processing' };
  locks.add(id);
  try {
    const preview = await previewPrintShrimpOrder(id, { shopId, latestReceipt, automatic: true, deps: d });
    if (preview.switches.length || preview.blockers.length) return await hold([...preview.switches, ...preview.blockers]);
    // Counted before the request, so a crash cannot exceed the limit.
    await d.autoState.write({ ...state, days: { ...Object.fromEntries(Object.entries(state.days || {}).slice(-30)), [day]: (state.days?.[day] || 0) + 1 } });
    const price = preview.expectedCost.printShrimpPriceCheck;
    const record = await sendOnce(id, preview, d, { note: 'Sent automatically: every check passed (price ' + (price?.total ?? '?') + ' ' + (price?.currency || '') + ').',
      approval: { method: 'automatic', approvedAt: d.now().toISOString(), planSignature: plan.signature } });
    return { receiptId: id, status: 'submitted', record };
  } catch (error) {
    // A failed request is recorded (rejected or unknown) and never sent again on its own.
    return { receiptId: id, status: 'failed', reasons: [String(error?.message || error)] };
  } finally { locks.delete(id); }
}
