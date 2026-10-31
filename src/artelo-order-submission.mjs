// Explicit, one-order-at-a-time Artelo submission for a regular Etsy order
// whose approved recommendation is Artelo. Nothing here runs automatically:
// the Etsy sync only prepares recommendations, and each submission needs
//   - FULFILLMENT_LIVE_SUBMISSION_ENABLED=true and ARTELO_FULFILLMENT_ENABLED=true,
//   - the receipt listed in SUPPLIER_SUBMISSION_ALLOWED_RECEIPTS (testing phase),
//   - the typed confirmation "SUBMIT <receipt> TO ARTELO" and the operator's
//     statement that the Artelo dashboard has no order for it.
// The submission record (supplier-order-ledger.mjs) is written as
// "submitting" before the request; a timeout or outage leaves it "unknown",
// which is never retried until it is verified with Artelo.
import { readOrder, saveReview, validReceiptId } from './custom-order-store.mjs';
import { getJsonObject, putJsonObject, isMissingR2Object } from './r2.mjs';
import { eligibleRegularReceipt, parseFulfillmentSku } from './regular-order-routing.mjs';
import { resolveProviderArtworkAsset } from './fulfillment-assets.mjs';
import { artworkObjectExists } from './r2.mjs';
import { createArteloOrder, getArteloOrder, validateArteloOrderPriceCheck, apiSizeFromLabel } from './artelo.mjs';
import { ledgerStore, transition, blockedBy } from './supplier-order-ledger.mjs';

const flag = (env, name) => String(env[name] || '').trim().toLowerCase() === 'true';
const words = value => String(value ?? '').trim();
const money = value => value?.amount == null ? null : Number(value.amount) / Number(value.divisor || 100);
const locks = new Set();

export function submissionSettings(env = process.env) {
  return {
    masterEnabled: flag(env, 'FULFILLMENT_LIVE_SUBMISSION_ENABLED'),
    arteloEnabled: flag(env, 'ARTELO_FULFILLMENT_ENABLED'),
    allowedReceipts: new Set(words(env.SUPPLIER_SUBMISSION_ALLOWED_RECEIPTS).split(/[\s,]+/).filter(Boolean)),
    // "all": every approved order may be submitted from the app, no list.
    allReceipts: words(env.SUPPLIER_SUBMISSION_ALLOWED_RECEIPTS).toLowerCase() === 'all',
    // Automatic submission of new Artelo orders (autoSubmitArteloOrder).
    autoEnabled: flag(env, 'ARTELO_AUTO_SUBMIT_ENABLED'),
    dailyLimit: Math.min(50, Math.max(1, Math.floor(Number(env.ARTELO_AUTO_SUBMIT_DAILY_LIMIT) || 5))),
    // Not read by this app: setting it changes nothing.
    ignoredVariables: ['LIVE_ORDER_SUBMISSION'].filter(name => env[name] != null)
  };
}

const receiptAllowed = (settings, id) => settings.allReceipts || settings.allowedReceipts.has(id);

export const confirmationFor = receiptId => `SUBMIT ${receiptId} TO ARTELO`;
export const notReceivedConfirmation = receiptId => `ARTELO DOES NOT HAVE ${receiptId}`;

// The regular-order checks (paid, not shipped or canceled, this shop, one
// item, address, converted SKU) for an order whose recommendation was
// approved for ordering: the approval itself is not "already placed".
function checkEligible(order, receipt, shopId) {
  const review = order?.review || {};
  const approvedOnly = review.status === 'approved_for_manual_order' && !review.approval?.supplierOrderSubmitted && !review.supplierOrderId;
  return eligibleRegularReceipt({ ...order, staged: { ...order?.staged, receipt },
    review: approvedOnly ? { ...review, status: 'awaiting_supplier_approval' } : review }, shopId);
}

const orientationFor = orientation => ({ portrait: 'Vertical', landscape: 'Horizontal' })[words(orientation).toLowerCase()] || '';

// The Artelo order for a receipt, from its Etsy receipt, approved plan and
// production artwork: { payload, issues }. Unframed Matte Poster is the only
// Artelo product the comparison quotes (IndividualArtPrint, MattePoster).
export function buildArteloPayload({ receipt, plan, asset, prefix = 'SAC' }) {
  const issues = [];
  const transaction = (receipt?.transactions || [])[0] || {};
  if (plan?.supplier !== 'artelo') issues.push(`The approved supplier is ${plan?.supplier || 'none'}, not Artelo.`);
  if (plan?.productCode !== 'P') issues.push('Artelo is only quoted for unframed posters (product P).');
  const size = apiSizeFromLabel(plan?.size);
  if (!size) issues.push(`No Artelo size for ${plan?.size}.`);
  const orientation = orientationFor(asset?.orientation);
  if (!orientation) issues.push(`Artwork orientation "${asset?.orientation || 'unknown'}" has no Artelo equivalent (square artwork needs manual review).`);
  if (!asset?.url) issues.push('The production artwork has no download URL.');
  // The ISO 3166 code goes in both country and countryCode: Artelo's order
  // validation requires country (a code); its address object reads countryCode.
  const countryCode = words(receipt?.country_iso).toUpperCase();
  const address = { name: words(receipt?.name), street1: words(receipt?.first_line), street2: words(receipt?.second_line),
    city: words(receipt?.city), state: words(receipt?.state), zipcode: words(receipt?.zip), country: countryCode, countryCode };
  for (const [field, label] of [['name', 'name'], ['street1', 'street'], ['city', 'city'], ['zipcode', 'postal code'], ['countryCode', 'country']])
    if (!address[field]) issues.push(`The Etsy shipping address has no ${label}.`);
  // Artelo's order API requires a state/region; Etsy omits it for some countries.
  if (!address.state) issues.push('Artelo requires a state/region and the Etsy address has none; enter it with Artelo support or in its dashboard.');
  const unitPrice = money(transaction.price);
  const total = money(receipt?.grandtotal) ?? money(receipt?.total_price);
  const created = receipt?.create_timestamp || receipt?.created_timestamp;
  const payload = {
    orderId: `${prefix}-${validReceiptId(receipt?.receipt_id)}`,
    channelName: 'Etsy',
    createdAt: created ? new Date(Number(created) * 1000).toISOString() : new Date().toISOString(),
    currency: words(receipt?.grandtotal?.currency_code || receipt?.total_price?.currency_code || 'USD').toUpperCase(),
    // Etsy shares no buyer phone or email; empty fields are left out.
    customerAddress: Object.fromEntries(Object.entries(address).filter(([, value]) => value)),
    items: [{
      orderItemId: words(transaction.transaction_id) || '1',
      // In an order the frame is chosen by frameColor, which Artelo requires
      // (null is refused): Unframed for a print with no frame. NaturalOak was
      // priced as a framed print ($11.87 + $6.37 for 8x10, against $4.06 +
      // $4.91 unframed); the price check against the approved unframed quote
      // blocks any frame charge.
      productInfo: {
        catalogProductId: 'IndividualArtPrint', frameStyle: 'Unframed', frameColor: 'Unframed',
        includeFramingService: false, includeHangingPins: false, includeMats: false,
        paperType: 'MattePoster', orientation: orientation || null, size: size || '',
        canvasDesignedFor: null, canvasBorderStyle: null,
        designs: asset?.url ? [{ fitOptions: { canvas: 'Paper', style: 'Outside' }, sourceImage: { url: asset.url } }] : []
      },
      quantity: 1,
      unitPrice: unitPrice ?? 0
    }],
    total: total ?? unitPrice ?? 0,
    isTestOrder: false
  };
  return { payload, issues };
}

function defaultDeps() {
  return { readOrder, saveReview, resolveAsset: resolveProviderArtworkAsset, artworkExists: artworkObjectExists,
    createOrder: createArteloOrder, getOrder: getArteloOrder, priceCheck: validateArteloOrderPriceCheck,
    ledger: ledgerStore(), trackingRecord: async () => null, env: process.env, now: () => new Date() };
}

// Everything known about one order, answering: imported? paid? which
// supplier? queued? submitted? blocked by what? supplier order ID?
export async function diagnoseOrder(receiptId, { shopId, deps = {} } = {}) {
  const d = { ...defaultDeps(), ...deps };
  const id = validReceiptId(receiptId);
  const settings = submissionSettings(d.env);
  let order;
  try { order = await d.readOrder(id); }
  catch (error) { return { receiptId: id, imported: false, error: 'No imported Etsy receipt is stored for ' + id + ': ' + (error?.message || error) }; }
  const receipt = order?.staged?.receipt || {}, review = order?.review || {}, plan = review.regularPlan || null;
  const transaction = (receipt.transactions || [])[0] || {};
  const [ledger, tracking] = await Promise.all([d.ledger.read(id), d.trackingRecord(id).catch(() => null)]);
  const problems = [];
  let item = null, asset = null;
  try { checkEligible(order, receipt, shopId ?? receipt.shop_id); } catch (error) { problems.push(error.message); }
  try { item = parseFulfillmentSku(transaction.sku); } catch (error) { problems.push(error.message); }
  if (item) {
    try {
      asset = await d.resolveAsset({ artworkId: item.artworkId, size: item.size });
      if (!(await d.artworkExists(asset.key))) problems.push('The production artwork is missing from R2.');
    } catch (error) { problems.push(error.message); }
  }
  if (tracking?.supplier) problems.push(`Order Tracking links this receipt to ${tracking.supplier} order ${tracking.supplierOrderId}.`);
  return {
    receiptId: id,
    imported: true,
    importedAt: order?.staged?.receivedAt || null,
    importSource: order?.staged?.source || '',
    paid: receipt.was_paid === true || receipt.is_paid === true,
    shipped: receipt.is_shipped === true || receipt.was_shipped === true || (receipt.shipments || []).length > 0,
    canceled: Boolean(receipt.is_canceled || receipt.was_canceled || receipt.is_cancelled),
    listingId: transaction.listing_id || null,
    sku: transaction.sku || '',
    title: transaction.title || '',
    variations: (transaction.variations || []).map(v => `${v.formatted_name || v.name}: ${v.formatted_value || v.value}`),
    destination: [receipt.city, receipt.state, receipt.country_iso].filter(Boolean).join(', '),
    product: item ? { artworkId: item.artworkId, productCode: item.productCode, size: item.size, frame: item.frame } : null,
    artwork: asset ? { key: asset.key, ratio: asset.ratio, width: asset.width, height: asset.height, orientation: asset.orientation } : null,
    reviewStatus: review.status || 'not reviewed',
    automaticRouting: review.automaticRouting || null,
    selectedSupplier: plan?.supplier || '',
    plan: plan ? { supplier: plan.supplier, provider: plan.provider, quotedTotalUsd: plan.quotedTotalUsd, modeledLandedUsd: plan.modeledLandedUsd,
      generatedAt: plan.generatedAt, expiresAt: plan.expiresAt, alternatives: plan.alternatives } : null,
    approval: review.approval || null,
    // Silvia has no supplier submission queue: approval is for a manual order.
    queuedForSupplier: Boolean(ledger && ['queued', 'submitting'].includes(ledger.state)),
    submissionAttempted: Boolean(ledger?.history?.some(h => h.to === 'submitting')),
    submission: ledger,
    supplierOrderId: ledger?.supplierOrderId || review.supplierOrderId || tracking?.supplierOrderId || '',
    liveSubmission: { masterEnabled: settings.masterEnabled, arteloEnabled: settings.arteloEnabled,
      receiptAuthorized: receiptAllowed(settings, id), automaticEnabled: settings.autoEnabled, ignoredVariables: settings.ignoredVariables,
      automaticSubmission: false,
      note: 'Silvia never submits supplier orders automatically. LIVE_ORDER_SUBMISSION is not read by this app; FULFILLMENT_LIVE_SUBMISSION_ENABLED and ARTELO_FULFILLMENT_ENABLED only allow the explicit single-order submission below.' },
    problems
  };
}

// The checks for one Artelo submission, with Artelo's own read-only price
// check of the exact order. Never creates an order. automatic: the checks for
// autoSubmitArteloOrder, which replace the operator's approval: no
// submission record at all, and ARTELO_AUTO_SUBMIT_ENABLED instead of the
// receipt list.
export async function previewArteloOrder(receiptId, { shopId, prefix = 'SAC', latestReceipt = null, automatic = false, deps = {} } = {}) {
  const d = { ...defaultDeps(), ...deps };
  const id = validReceiptId(receiptId);
  const settings = submissionSettings(d.env);
  const order = await d.readOrder(id);
  const receipt = latestReceipt || order?.staged?.receipt || {};
  const review = order?.review || {}, plan = review.regularPlan || null;
  const blockers = [];
  try { checkEligible(order, receipt, shopId ?? receipt.shop_id); }
  catch (error) { blockers.push(error.message); }
  if (!plan) blockers.push('No supplier recommendation has been prepared.');
  else if (plan.supplier !== 'artelo') blockers.push(`The recommended supplier is ${plan.provider || plan.supplier}, not Artelo.`);
  if (automatic) {
    if (review.status !== 'awaiting_supplier_approval') blockers.push(`The order is ${review.status || 'not reviewed'}, not a new recommendation.`);
  } else if (review.status !== 'approved_for_manual_order' || !review.approval?.planSignature || review.approval.planSignature !== plan?.signature)
    blockers.push('Approve the Artelo recommendation on Fulfillment Review first (address, artwork, variant and price checked).');
  const ledger = await d.ledger.read(id);
  // Automatic submission never touches an order that has any record (sent,
  // rejected, unknown, Sensaria CSV, fulfilled elsewhere): only a person does.
  if (automatic && ledger) blockers.push(`A submission record exists (${ledger.provider} · ${ledger.state}).`);
  const blocked = blockedBy(ledger, 'artelo');
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
  const { payload, issues } = plan ? buildArteloPayload({ receipt, plan, asset, prefix }) : { payload: null, issues: [] };
  blockers.push(...issues);
  // Artelo prices the exact product; a price far from the approved quote means
  // the order would be for something else (a framed print, another size).
  let price = null;
  if (payload && !issues.length) {
    try {
      price = await d.priceCheck(payload);
      const quotedProduct = Number(plan?.quoteDetails?.productionCost ?? (plan.quotedTotalUsd - (plan.shippingUsd ?? 0)));
      if (price?.total == null) blockers.push('Artelo returned no total for this order.');
      else if (Number.isFinite(quotedProduct) && price.productionCost != null && Math.abs(price.productionCost - quotedProduct) > Math.max(2, quotedProduct * 0.15))
        blockers.push(`Artelo prices this product at $${price.productionCost.toFixed(2)}, not the approved $${quotedProduct.toFixed(2)}: check the product before submitting.`);
    } catch (error) {
      const phoneNote = payload.customerAddress.countryCode !== 'US' && !payload.customerAddress.phone
        ? ' Artelo asks for a phone number on orders shipped outside the US, and Etsy does not share the buyer\'s phone: order this one in the Artelo dashboard.' : '';
      blockers.push('Artelo price check failed: ' + (error?.message || error) + phoneNote);
    }
  }
  const switches = [];
  if (!settings.masterEnabled) switches.push('FULFILLMENT_LIVE_SUBMISSION_ENABLED is not true');
  if (!settings.arteloEnabled) switches.push('ARTELO_FULFILLMENT_ENABLED is not true');
  if (automatic) { if (!settings.autoEnabled) switches.push('ARTELO_AUTO_SUBMIT_ENABLED is not true'); }
  else if (!receiptAllowed(settings, id)) switches.push(`receipt ${id} is not in SUPPLIER_SUBMISSION_ALLOWED_RECEIPTS (or set it to all)`);
  const visible = payload ? { ...payload, items: payload.items.map(item => ({ ...item, productInfo: { ...item.productInfo,
    designs: item.productInfo.designs.map(() => ({ sourceImage: { url: '(signed R2 link to ' + (asset?.key || '') + ')' } })) } })) } : null;
  return { receiptId: id, ready: !blockers.length && !switches.length, blockers, switches, payload: visible,
    artwork: asset ? { key: asset.key, width: asset.width, height: asset.height, orientation: asset.orientation, ratio: asset.ratio } : null,
    expectedCost: { approvedQuoteUsd: plan?.quotedTotalUsd ?? null, approvedModeledUsd: plan?.modeledLandedUsd ?? null,
      arteloPriceCheck: price ? { productionCost: price.productionCost, shippingCost: price.shippingCost,
        taxes: (price.gst || 0) + (price.hst || 0) + (price.pst || 0) + (price.qst || 0) + (price.usSalesTax || 0), total: price.total, currency: price.currency } : null },
    submission: ledger, confirmation: confirmationFor(id), _payload: payload, _planSignature: plan?.signature || null };
}

const definiteRejection = error => Number(error?.status) >= 400 && Number(error?.status) < 500 && ![408, 409, 429].includes(Number(error.status));

// Submits one approved Artelo order, once. Returns the submission record.
export async function submitArteloOrder(receiptId, input = {}, { shopId, prefix = 'SAC', latestReceipt, deps = {} } = {}) {
  const d = { ...defaultDeps(), ...deps };
  const id = validReceiptId(receiptId);
  if (locks.has(id)) throw new Error('This order is already being submitted.');
  locks.add(id);
  try {
    if (input?.confirm !== confirmationFor(id)) throw new Error(`Type "${confirmationFor(id)}" to submit this order.`);
    if (input?.arteloDashboardChecked !== true) throw new Error('Confirm that the Artelo dashboard has no order for this receipt.');
    const preview = await previewArteloOrder(id, { shopId, prefix, latestReceipt, deps: d });
    if (preview.switches.length) throw new Error('Artelo submission is not authorized: ' + preview.switches.join('; ') + '.');
    if (preview.blockers.length) throw new Error('Not submitted: ' + preview.blockers.join(' '));
    return await sendOnce(id, preview, d, { note: 'Explicitly authorized: ' + confirmationFor(id) });
  } finally { locks.delete(id); }
}

// The one order request, recorded at every step. Callers hold the lock.
async function sendOnce(id, preview, d, { note, approval = {} }) {
    const at = () => d.now().toISOString();
    let record = await d.ledger.read(id);
    record = transition(record, 'prepared',
      { provider: 'artelo', at: at(), fields: { receiptId: id, externalOrderId: preview._payload.orderId, planSignature: preview._planSignature } });
    record = transition(record, 'queued', { provider: 'artelo', at: at(), note });
    // Persisted before the request: if the process stops, the order shows as
    // "submitting" and is treated as unknown, never sent again on its own.
    record = transition(record, 'submitting', { provider: 'artelo', at: at() });
    await d.ledger.write(id, record);
    let raw;
    try {
      raw = await d.createOrder(preview._payload, { timeoutMs: 45000 });
    } catch (error) {
      const rejected = definiteRejection(error);
      record = transition(record, rejected ? 'rejected' : 'unknown', { provider: 'artelo', at: at(),
        note: String(error?.message || error).slice(0, 400), fields: { lastError: String(error?.message || error).slice(0, 400) } });
      await d.ledger.write(id, record);
      throw Object.assign(new Error(rejected
        ? 'Artelo rejected the order: ' + (error?.message || error)
        : 'Artelo did not confirm the order (' + (error?.message || error) + '). It may or may not have been created: check the Artelo dashboard, then record what you find. It will not be sent again automatically.'), { record });
    }
    const supplierOrderId = words(raw?.id || raw?.order?.id || raw?.data?.id || raw?.orderId);
    record = transition(record, supplierOrderId ? 'submitted' : 'unknown', { provider: 'artelo', at: at(),
      fields: { supplierOrderId, supplierStatus: words(raw?.productionStatus || raw?.status) },
      note: supplierOrderId ? '' : 'Artelo answered without an order ID; verify in the dashboard.' });
    await d.ledger.write(id, record);
    const order = await d.readOrder(id);
    await d.saveReview(id, { ...order.review, status: 'supplier_submitted', supplierOrderId, updatedAt: at(),
      approval: { ...(order.review?.approval || {}), ...approval, supplierOrderSubmitted: true, supplier: 'artelo', submittedAt: at() } });
    return record;
}

// Automatic submission: since when it is on, and how many orders it sent each
// day (fulfillment/auto-submit/state.json in R2).
const AUTO_STATE_KEY = 'fulfillment/auto-submit/state.json';
export function autoSubmitState({ get = getJsonObject, put = putJsonObject } = {}) {
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
export async function syncAutoSubmitActivation({ env = process.env, state = autoSubmitState(), now = () => new Date() } = {}) {
  const current = await state.read();
  if (!submissionSettings(env).autoEnabled) {
    if (current.enabledSince) await state.write({ ...current, enabledSince: null });
    return null;
  }
  if (current.enabledSince) return current.enabledSince;
  await state.write({ ...current, enabledSince: now().toISOString() });
  return now().toISOString();
}

// Sends a NEW paid order whose recommended supplier is Artelo, with no
// person approving it, when every check passes: the switches
// (FULFILLMENT_LIVE_SUBMISSION_ENABLED, ARTELO_FULFILLMENT_ENABLED,
// ARTELO_AUTO_SUBMIT_ENABLED), placed after automatic submission was switched
// on, under the daily limit, no submission record, and Preview's checks
// (address, artwork, Artelo's exact price within the quote). An order that
// fails a check is held for a person, once per recommendation.
export async function autoSubmitArteloOrder(receiptId, { shopId, prefix = 'SAC', latestReceipt, deps = {} } = {}) {
  const d = { ...defaultDeps(), autoState: autoSubmitState(), ...deps };
  const id = validReceiptId(receiptId);
  const settings = submissionSettings(d.env);
  if (!settings.autoEnabled || !settings.masterEnabled || !settings.arteloEnabled) return { receiptId: id, status: 'off' };
  const order = await d.readOrder(id);
  const review = order?.review || {}, plan = review.regularPlan || null;
  if (plan?.supplier !== 'artelo' || review.status !== 'awaiting_supplier_approval') return { receiptId: id, status: 'not_artelo' };
  if (review.automaticSubmission?.planSignature && review.automaticSubmission.planSignature === plan.signature)
    return { receiptId: id, status: 'already_held' };
  const state = await d.autoState.read();
  const receipt = latestReceipt || order?.staged?.receipt || {};
  const placed = Number(receipt.create_timestamp || receipt.created_timestamp) * 1000;
  if (!state.enabledSince || !(placed >= Date.parse(state.enabledSince))) return { receiptId: id, status: 'before_switch_on' };
  const day = d.now().toISOString().slice(0, 10);
  const hold = async reasons => {
    await d.saveReview(id, { ...review, automaticSubmission: { status: 'held', planSignature: plan.signature, reasons, at: d.now().toISOString() } });
    return { receiptId: id, status: 'held', reasons };
  };
  if ((state.days?.[day] || 0) >= settings.dailyLimit)
    return { receiptId: id, status: 'daily_limit', reasons: [`${settings.dailyLimit} orders were already sent automatically today.`] };
  if (locks.has(id)) return { receiptId: id, status: 'already_processing' };
  locks.add(id);
  try {
    const preview = await previewArteloOrder(id, { shopId, prefix, latestReceipt, automatic: true, deps: d });
    if (preview.switches.length || preview.blockers.length) return await hold([...preview.switches, ...preview.blockers]);
    // Counted before the request, so a crash cannot exceed the limit.
    await d.autoState.write({ ...state, days: { ...Object.fromEntries(Object.entries(state.days || {}).slice(-30)), [day]: (state.days?.[day] || 0) + 1 } });
    const record = await sendOnce(id, preview, d, { note: 'Sent automatically: every check passed (price ' + preview.expectedCost.arteloPriceCheck?.total + ' USD).',
      approval: { method: 'automatic', approvedAt: d.now().toISOString(), planSignature: plan.signature } });
    return { receiptId: id, status: 'submitted', record };
  } finally { locks.delete(id); }
}

// Asks Artelo about a submitted or unknown order. Accepted when Artelo has it.
export async function verifyArteloSubmission(receiptId, { deps = {} } = {}) {
  const d = { ...defaultDeps(), ...deps };
  const id = validReceiptId(receiptId);
  let record = await d.ledger.read(id);
  if (!record || record.provider !== 'artelo') throw new Error('No Artelo submission is recorded for this receipt.');
  if (!record.supplierOrderId) return { record, found: null, note: 'No Artelo order ID is recorded: check the Artelo dashboard for ' + record.externalOrderId + ', then record the result.' };
  const order = await d.getOrder(record.supplierOrderId);
  const found = Boolean(order && (order.id || order.order || order.orderId));
  if (found && ['submitted', 'unknown', 'accepted'].includes(record.state)) {
    record = transition(record, 'accepted', { provider: 'artelo', fields: { supplierStatus: words(order?.productionStatus || order?.status || order?.order?.status) } });
    await d.ledger.write(id, record);
  }
  return { record, found };
}

// The operator's finding for an unknown outcome, or an order fulfilled elsewhere.
export async function resolveSubmission(receiptId, input = {}, { deps = {} } = {}) {
  const d = { ...defaultDeps(), ...deps };
  const id = validReceiptId(receiptId);
  const record = await d.ledger.read(id);
  if (input.outcome === 'received') {
    const supplierOrderId = words(input.supplierOrderId);
    if (!supplierOrderId) throw new Error('Enter the Artelo order ID shown in its dashboard.');
    const next = transition(record, 'submitted', { provider: 'artelo', fields: { supplierOrderId }, note: 'Found in the Artelo dashboard by the operator.' });
    await d.ledger.write(id, next);
    return next;
  }
  if (input.outcome === 'not_received') {
    if (record?.state !== 'unknown') throw new Error('Only an unknown outcome can be marked as not received.');
    if (input.confirm !== notReceivedConfirmation(id)) throw new Error(`Type "${notReceivedConfirmation(id)}" after checking the Artelo dashboard.`);
    const next = transition(record, 'prepared', { provider: 'artelo', note: 'Operator verified Artelo has no order; it may be submitted again explicitly.' });
    await d.ledger.write(id, next);
    return next;
  }
  if (input.outcome === 'reassign') {
    const provider = words(input.provider).toLowerCase();
    if (!record || !['prepared', 'rejected'].includes(record.state)) throw new Error('Only a prepared or rejected order can be given to another supplier.');
    if (input.confirm !== `REASSIGN ${id} TO ${provider.toUpperCase()}`) throw new Error(`Type "REASSIGN ${id} TO ${provider.toUpperCase()}" to change the order's supplier.`);
    const next = transition(record, 'prepared', { provider, note: `Reassigned from ${record.provider} to ${provider} by the operator.` });
    await d.ledger.write(id, next);
    return next;
  }
  if (input.outcome === 'fulfilled_elsewhere') {
    const provider = words(input.provider).toLowerCase();
    if (!provider) throw new Error('Name the supplier that fulfilled this order.');
    const next = transition(record, 'fulfilled_elsewhere',
      { provider, fields: { receiptId: id, fulfilledBy: provider, supplierOrderId: words(input.supplierOrderId) || '' },
        note: words(input.note) || 'Fulfilled by ' + provider });
    await d.ledger.write(id, next);
    return next;
  }
  throw new Error('Unknown outcome. Use received, not_received, reassign or fulfilled_elsewhere.');
}

// A supplier other than this one already received the order (for the
// Sensaria CSV): '' when it may still be prepared.
export async function otherSupplierHolds(receiptId, provider, { deps = {} } = {}) {
  const d = { ...defaultDeps(), ...deps };
  const record = await d.ledger.read(validReceiptId(receiptId));
  if (!record || record.provider === String(provider).toLowerCase()) return '';
  return ['queued', 'submitting', 'submitted', 'accepted', 'unknown'].includes(record.state)
    ? `This order is ${record.state} with ${record.provider}${record.supplierOrderId ? ' (order ' + record.supplierOrderId + ')' : ''}; do not order it again elsewhere.` : '';
}
