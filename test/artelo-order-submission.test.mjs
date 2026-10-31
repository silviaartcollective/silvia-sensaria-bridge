// Artelo submission of one approved regular order, with mocked Artelo and
// storage: no real order is created.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { diagnoseOrder, previewArteloOrder, submitArteloOrder, verifyArteloSubmission, resolveSubmission,
  otherSupplierHolds, buildArteloPayload, submissionSettings, confirmationFor, notReceivedConfirmation } from '../src/artelo-order-submission.mjs';
import { transition, blockedBy } from '../src/supplier-order-ledger.mjs';
import { automaticPreparationDecision, automaticallyPrepareReceipt, selectAutomaticCandidates } from '../src/auto-fulfillment.mjs';

const RECEIPT = '3456789012';
const SHOP = 77;
const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const LIVE = { FULFILLMENT_LIVE_SUBMISSION_ENABLED: 'true', ARTELO_FULFILLMENT_ENABLED: 'true', SUPPLIER_SUBMISSION_ALLOWED_RECEIPTS: RECEIPT };

function receipt(extra = {}) {
  return { receipt_id: Number(RECEIPT), shop_id: SHOP, was_paid: true, is_paid: true, is_shipped: false, was_shipped: false, shipments: [],
    name: 'Ada Buyer', first_line: '12 Rue Example', second_line: '', city: 'Toronto', state: 'ON', zip: 'M5H 2N2', country_iso: 'CA',
    create_timestamp: 1761700000, grandtotal: { amount: 9900, divisor: 100, currency_code: 'USD' },
    transactions: [{ transaction_id: 555, listing_id: 4400000001, quantity: 1, sku: 'SAC0042-P-3040', title: 'Sage Abstract Poster',
      price: { amount: 9900, divisor: 100, currency_code: 'USD' }, variations: [{ formatted_name: 'Size', formatted_value: '30x40' }] }],
    ...extra };
}
const plan = (extra = {}) => ({ version: 1, receiptId: RECEIPT, shopId: String(SHOP), sku: 'SAC0042-P-3040', artworkId: 'SAC0042', productCode: 'P',
  size: '30x40', frame: '', countryCode: 'CA', assetKey: 'artworks/SAC0042/fulfillment/3x4.jpg', supplier: 'artelo', provider: 'Artelo',
  quotedTotalUsd: 52, modeledLandedUsd: 61.36, shippingUsd: 14, quoteDetails: { apiSize: 'x30x40' }, signature: 'sig-1',
  alternatives: [{ provider: 'Artelo', quotedTotalUsd: 52 }, { provider: 'Sensaria', quotedTotalUsd: 70 }], ...extra });
const approvedReview = (extra = {}) => ({ classification: 'regular', status: 'approved_for_manual_order', regularPlan: plan(),
  approval: { approvedAt: '2026-10-30T10:00:00Z', method: 'review_only', supplierOrderSubmitted: false, planSignature: 'sig-1' }, ...extra });
const asset = { key: 'artworks/SAC0042/fulfillment/3x4.jpg', ratio: '3x4', width: 9000, height: 12000, orientation: 'portrait', url: 'https://r2.example/signed/3x4.jpg' };

// A world with an in-memory order, ledger and Artelo.
function world({ review = approvedReview(), staged = receipt(), env = LIVE, tracking = null, artelo = {} } = {}) {
  const state = { review, staged, ledger: null, saved: [], ledgerWrites: [], created: [], priceChecks: 0 };
  const deps = {
    env,
    readOrder: async id => { assert.equal(id, RECEIPT); return { staged: { receipt: state.staged, receivedAt: '2026-10-29T18:00:00Z', source: 'manual-etsy-import' }, review: state.review }; },
    saveReview: async (id, value) => { state.review = value; state.saved.push(value); },
    resolveAsset: async () => asset,
    artworkExists: async () => true,
    priceCheck: async payload => { state.priceChecks++; assert.deepEqual(payload.items[0].productInfo.designs, payload.items[0].productInfo.designs);
      return artelo.priceCheck ? artelo.priceCheck(payload) : { total: 55.1, productionCost: 38, shippingCost: 14, gst: 0, hst: 3.1, currency: 'USD' }; },
    createOrder: async (payload, options) => { state.created.push({ payload, options }); return artelo.create ? artelo.create(payload) : { id: 'ART-9001', productionStatus: 'Pending' }; },
    getOrder: async orderId => artelo.get ? artelo.get(orderId) : { id: orderId, productionStatus: 'InProduction' },
    ledger: { read: async () => state.ledger, write: async (id, record) => { state.ledger = record; state.ledgerWrites.push(record.state); } },
    trackingRecord: async () => tracking,
    now: () => new Date('2026-10-31T12:00:00Z')
  };
  return { state, deps };
}
const submit = (w, input = {}) => submitArteloOrder(RECEIPT, { confirm: confirmationFor(RECEIPT), arteloDashboardChecked: true, ...input },
  { shopId: SHOP, deps: w.deps });

test('diagnosis: imported, paid, Artelo selected and approved for a manual order, never queued or sent; LIVE_ORDER_SUBMISSION is not read', async () => {
  const w = world({ env: { LIVE_ORDER_SUBMISSION: 'false' } });
  const d = await diagnoseOrder(RECEIPT, { shopId: SHOP, deps: w.deps });
  assert.equal(d.imported, true);
  assert.equal(d.paid, true);
  assert.equal(d.selectedSupplier, 'artelo');
  assert.equal(d.reviewStatus, 'approved_for_manual_order');
  assert.equal(d.approval.method, 'review_only');
  assert.equal(d.queuedForSupplier, false);
  assert.equal(d.submissionAttempted, false);
  assert.equal(d.supplierOrderId, '');
  assert.equal(d.listingId, 4400000001);
  assert.equal(d.sku, 'SAC0042-P-3040');
  assert.deepEqual(d.product, { artworkId: 'SAC0042', productCode: 'P', size: '30x40', frame: '' });
  assert.deepEqual(d.liveSubmission.ignoredVariables, ['LIVE_ORDER_SUBMISSION']);
  assert.equal(d.liveSubmission.automaticSubmission, false);
  assert.deepEqual(d.problems, [], 'an approved order is not "already placed"');
  const missing = await diagnoseOrder(RECEIPT, { deps: { ...w.deps, readOrder: async () => { throw new Error('NoSuchKey'); } } });
  assert.equal(missing.imported, false);
});

test('live submission disabled: nothing is sent, whatever is typed', async () => {
  for (const env of [{}, { FULFILLMENT_LIVE_SUBMISSION_ENABLED: 'true' }, { ARTELO_FULFILLMENT_ENABLED: 'true' },
    { FULFILLMENT_LIVE_SUBMISSION_ENABLED: 'true', ARTELO_FULFILLMENT_ENABLED: 'true' }, { LIVE_ORDER_SUBMISSION: 'true' }]) {
    const w = world({ env });
    await assert.rejects(submit(w), /not authorized/);
    assert.equal(w.state.created.length, 0);
    assert.equal(w.state.ledger, null);
  }
  assert.equal(submissionSettings({ SUPPLIER_SUBMISSION_ALLOWED_RECEIPTS: '1, 2 3' }).allowedReceipts.size, 3);
});

test('live submission enabled and this receipt authorized: the one order is sent once, recorded at every step', async () => {
  const w = world();
  await assert.rejects(submit(w, { confirm: 'SUBMIT' }), /Type "SUBMIT 3456789012 TO ARTELO"/);
  await assert.rejects(submit(w, { arteloDashboardChecked: false }), /Artelo dashboard/);
  assert.equal(w.state.created.length, 0);
  const record = await submit(w);
  assert.equal(w.state.created.length, 1);
  assert.deepEqual(w.state.ledgerWrites, ['submitting', 'submitted'], '"submitting" is stored before the request');
  assert.deepEqual(record.history.map(h => h.to), ['prepared', 'queued', 'submitting', 'submitted']);
  assert.equal(record.provider, 'artelo');
  assert.equal(record.supplierOrderId, 'ART-9001');
  assert.equal(record.externalOrderId, 'SAC-3456789012');
  assert.equal(w.state.created[0].options.timeoutMs, 45000);
  const payload = w.state.created[0].payload;
  assert.equal(payload.orderId, 'SAC-3456789012');
  assert.equal(payload.isTestOrder, false);
  // Artelo's address fields: the country code as country and countryCode, and no empty phone, email or street2.
  assert.deepEqual(payload.customerAddress, { name: 'Ada Buyer', street1: '12 Rue Example', city: 'Toronto', state: 'ON', zipcode: 'M5H 2N2', country: 'CA', countryCode: 'CA' });
  const info = payload.items[0].productInfo;
  assert.deepEqual([info.catalogProductId, info.paperType, info.frameStyle, info.frameColor, info.size, info.orientation],
    ['IndividualArtPrint', 'MattePoster', 'Unframed', 'NaturalOak', 'x30x40', 'Vertical']);
  assert.equal(info.designs[0].sourceImage.url, asset.url);
  assert.equal(payload.items[0].unitPrice, 99);
  assert.equal(w.state.review.status, 'supplier_submitted');
  assert.equal(w.state.review.supplierOrderId, 'ART-9001');
  assert.equal(w.state.review.approval.supplierOrderSubmitted, true);
});

test('duplicates: a second submission, a concurrent one or another supplier is refused', async () => {
  const w = world();
  const [first, second] = await Promise.allSettled([submit(w), submit(w)]);
  assert.equal(first.status, 'fulfilled');
  assert.match(String(second.reason?.message), /already being submitted/);
  await assert.rejects(submit(w), /already been placed|already submitted|Supplier order already recorded/);
  assert.equal(w.state.created.length, 1);
  // The other way round: Sensaria may not be prepared for an order Artelo has.
  assert.match(await otherSupplierHolds(RECEIPT, 'sensaria', { deps: w.deps }), /submitted with artelo \(order ART-9001\)/);
  // An order assigned to Sensaria (its CSV was downloaded) is not sent to Artelo.
  const s = world();
  s.state.ledger = transition(null, 'prepared', { provider: 'sensaria', fields: { receiptId: RECEIPT } });
  await assert.rejects(submit(s), /assigned to sensaria/);
  assert.equal(s.state.created.length, 0);
  await assert.rejects(resolveSubmission(RECEIPT, { outcome: 'reassign', provider: 'artelo', confirm: 'yes' }, { deps: s.deps }), /REASSIGN 3456789012 TO ARTELO/);
  await resolveSubmission(RECEIPT, { outcome: 'reassign', provider: 'artelo', confirm: 'REASSIGN 3456789012 TO ARTELO' }, { deps: s.deps });
  assert.equal((await submit(s)).state, 'submitted');
});

test('duplicate Etsy events never re-plan or submit an order already prepared or sent', async () => {
  const awaiting = { classification: 'regular', status: 'awaiting_supplier_approval', regularPlan: plan() };
  assert.equal(automaticPreparationDecision({ staged: { receipt: receipt() }, review: awaiting }).action, 'skip');
  assert.equal(automaticPreparationDecision({ staged: { receipt: receipt() }, review: approvedReview() }).action, 'skip');
  assert.equal(automaticPreparationDecision({ staged: { receipt: receipt() }, review: { ...approvedReview(), status: 'supplier_submitted', supplierOrderId: 'ART-1' } }).action, 'skip');
  assert.deepEqual(selectAutomaticCandidates([receipt(), receipt()], { [RECEIPT]: approvedReview() }), []);
  let prepared = 0;
  const result = await automaticallyPrepareReceipt(RECEIPT, SHOP, { read: async () => ({ staged: { receipt: receipt() }, review: approvedReview() }),
    prepare: async () => { prepared++; }, save: async () => {} });
  assert.deepEqual([result.status, prepared], ['skipped', 0]);
});

test('historical pending orders are never submitted by enabling live submission', () => {
  // The only automatic order work prepares recommendations; it cannot submit.
  for (const file of ['src/auto-fulfillment.mjs', 'src/regular-order-routing.mjs'])
    assert.doesNotMatch(read(file), /createArteloOrder|submitArteloOrder|createPrintShrimpOrder|createProdigiOrder|createGelatoOrder|createPrintifyOrder/, file);
  const server = read('src/server.mjs');
  assert.equal((server.match(/submitArteloOrder\(/g) || []).length, 1, 'one call: the explicit artelo-submit route');
  assert.match(server, /const submission=await submitArteloOrder\(id,await readJsonBody\(req\),\{shopId,latestReceipt:latest,deps\}\);/);
  assert.doesNotMatch(server, /createArteloOrder\(/);
  // Each receipt must be authorized by itself, so an old pending order cannot ride along.
  assert.equal(submissionSettings({ ...LIVE, SUPPLIER_SUBMISSION_ALLOWED_RECEIPTS: '' }).allowedReceipts.size, 0);
});

test('a rejected order is recorded and can only be sent again explicitly', async () => {
  const w = world({ artelo: { create: async () => { throw Object.assign(new Error('Artelo API 422: Invalid size'), { status: 422 }); } } });
  await assert.rejects(submit(w), /Artelo rejected the order: Artelo API 422/);
  assert.equal(w.state.ledger.state, 'rejected');
  assert.match(w.state.ledger.lastError, /Invalid size/);
  assert.equal(w.state.review.status, 'approved_for_manual_order', 'not marked as submitted');
  w.deps.createOrder = async () => ({ id: 'ART-9002' });
  assert.equal((await submit(w)).supplierOrderId, 'ART-9002');
});

test('a timeout or outage leaves the outcome unknown: never retried until checked with Artelo', async () => {
  for (const failure of [Object.assign(new Error('Artelo API did not answer within 45 seconds.'), { timeout: true }),
    Object.assign(new Error('Artelo API 503: down'), { status: 503 }), Object.assign(new Error('Artelo API 429'), { status: 429 })]) {
    const w = world({ artelo: { create: async () => { throw failure; } } });
    await assert.rejects(submit(w), /may or may not have been created/);
    assert.equal(w.state.ledger.state, 'unknown');
    assert.equal(w.state.created.length, 1);
    await assert.rejects(submit(w), /unknown outcome/);
    assert.equal(w.state.created.length, 1, 'not sent again');
  }
  // Found in the dashboard: recorded as submitted, then accepted once Artelo confirms it.
  const found = world({ artelo: { create: async () => { throw Object.assign(new Error('timeout'), { timeout: true }); } } });
  await assert.rejects(submit(found));
  await assert.rejects(resolveSubmission(RECEIPT, { outcome: 'received' }, { deps: found.deps }), /Artelo order ID/);
  assert.equal((await resolveSubmission(RECEIPT, { outcome: 'received', supplierOrderId: 'ART-7' }, { deps: found.deps })).state, 'submitted');
  const verified = await verifyArteloSubmission(RECEIPT, { deps: found.deps });
  assert.deepEqual([verified.found, verified.record.state], [true, 'accepted']);
  // Not in the dashboard: only after the typed statement may it be sent again.
  const lost = world({ artelo: { create: async () => { throw Object.assign(new Error('timeout'), { timeout: true }); } } });
  await assert.rejects(submit(lost));
  await assert.rejects(resolveSubmission(RECEIPT, { outcome: 'not_received', confirm: 'no' }, { deps: lost.deps }), /ARTELO DOES NOT HAVE 3456789012/);
  await resolveSubmission(RECEIPT, { outcome: 'not_received', confirm: notReceivedConfirmation(RECEIPT) }, { deps: lost.deps });
  lost.deps.createOrder = async () => ({ id: 'ART-3' });
  assert.equal((await submit(lost)).supplierOrderId, 'ART-3');
});

test('orders already fulfilled elsewhere are excluded', async () => {
  const cases = [
    ['shipped on Etsy', world({ staged: receipt({ was_shipped: true }) }), /already considers the receipt shipped/],
    ['canceled', world({ staged: receipt({ is_canceled: true }) }), /Canceled or unpaid/],
    ['unpaid', world({ staged: receipt({ was_paid: false, is_paid: false }) }), /explicitly confirm this receipt was paid/],
    ['manually ordered', world({ review: { ...approvedReview(), status: 'manually_ordered' } }), /already been placed/],
    ['linked in Order Tracking', world({ tracking: { supplier: 'sensaria', supplierOrderId: 'SEN-1' } }), /fulfilled elsewhere/],
    ['not approved yet', world({ review: { classification: 'regular', status: 'awaiting_supplier_approval', regularPlan: plan() } }), /Approve the Artelo recommendation/],
    ['another supplier recommended', world({ review: approvedReview({ regularPlan: plan({ supplier: 'sensaria', provider: 'Sensaria' }) }) }), /not Artelo/]
  ];
  for (const [name, w, error] of cases) {
    await assert.rejects(submit(w), error, name);
    assert.equal(w.state.created.length, 0, name);
  }
  const elsewhere = world();
  await resolveSubmission(RECEIPT, { outcome: 'fulfilled_elsewhere', provider: 'Sensaria', supplierOrderId: 'SEN-2' }, { deps: elsewhere.deps });
  await assert.rejects(submit(elsewhere), /fulfilled elsewhere/);
  assert.equal(elsewhere.state.created.length, 0);
});

test('preview: read-only Artelo price check of the exact order, with a different product caught before submission', async () => {
  const w = world({ env: {} });
  const p = await previewArteloOrder(RECEIPT, { shopId: SHOP, deps: w.deps });
  assert.equal(w.state.created.length, 0);
  assert.equal(w.state.priceChecks, 1);
  assert.deepEqual(p.blockers, []);
  assert.equal(p.ready, false);
  assert.equal(p.switches.length, 3);
  assert.deepEqual(p.expectedCost.arteloPriceCheck, { productionCost: 38, shippingCost: 14, taxes: 3.1, total: 55.1, currency: 'USD' });
  assert.match(p.payload.items[0].productInfo.designs[0].sourceImage.url, /^\(signed R2 link/, 'the signed link is not shown');
  const framed = world({ artelo: { priceCheck: async () => ({ total: 140, productionCost: 112, shippingCost: 22, currency: 'USD' }) } });
  await assert.rejects(submit(framed), /prices this product at \$112\.00, not the approved \$38\.00/);
  assert.equal(framed.state.created.length, 0);
  const gb = buildArteloPayload({ receipt: receipt({ state: '', country_iso: 'GB' }), plan: plan(), asset });
  assert.match(gb.issues.join(' '), /requires a state\/region/);
  const square = buildArteloPayload({ receipt: receipt(), plan: plan(), asset: { ...asset, orientation: 'square' } });
  assert.match(square.issues.join(' '), /square artwork needs manual review/);
});

test('preview sends Artelo its own address fields and shows why Artelo refused the price check', async () => {
  const us = receipt({ name: 'Jamie Moyle', first_line: '256 Lows Hollow Rd', city: 'Stewartsville', state: 'NJ', zip: '08886', country_iso: 'US' });
  const seen = [];
  const ok = world({ staged: us, artelo: { priceCheck: async payload => { seen.push(payload); return { total: 55.1, productionCost: 38, shippingCost: 14, currency: 'USD' }; } } });
  await previewArteloOrder(RECEIPT, { shopId: SHOP, deps: ok.deps });
  assert.deepEqual(seen[0].customerAddress, { name: 'Jamie Moyle', street1: '256 Lows Hollow Rd', city: 'Stewartsville', state: 'NJ', zipcode: '08886', country: 'US', countryCode: 'US' });
  // Outside the US with no phone (Etsy shares none), a refusal says so.
  const refused = { priceCheck: async () => { throw new Error('Artelo API 400: Invalid Input'); } };
  const ca = await previewArteloOrder(RECEIPT, { shopId: SHOP, deps: world({ artelo: refused }).deps });
  assert.match(ca.blockers.join(' '), /Invalid Input Artelo asks for a phone number on orders shipped outside the US/);
  const home = await previewArteloOrder(RECEIPT, { shopId: SHOP, deps: world({ staged: us, artelo: refused }).deps });
  assert.match(home.blockers.join(' '), /Artelo price check failed: Artelo API 400: Invalid Input$/m);
  assert.doesNotMatch(home.blockers.join(' '), /phone/);
});

test('an Artelo error names each rejected field, with long value lists cut short', async () => {
  const saved = { fetch: globalThis.fetch, key: process.env.ARTELO_API_KEY };
  process.env.ARTELO_API_KEY = 'test-key';
  const countries = ['US', 'AD', 'AE', 'AF', ...Array.from({ length: 245 }, (_, i) => 'Q' + i)];
  const bodies = [
    // Artelo's validation answer (receipt 4217901308): one issue per field.
    { message: 'Invalid Input', data: { issues: [{ code: 'invalid_value', values: countries, path: ['customerAddress', 'country'],
      message: 'Invalid option: expected one of ' + countries.map(c => '"' + c + '"').join('|') }] } },
    { message: 'Invalid Input', data: { issues: [{ code: 'invalid_value', values: ['NaturalOak', 'BlackOak', 'WhiteOak'], path: ['items', 0, 'productInfo', 'frameColor'],
      message: 'Invalid option: expected one of "NaturalOak"|"BlackOak"|"WhiteOak"' }] } },
    { message: 'Invalid Input', errors: [{ field: 'items.0.productInfo.size', message: 'Required' }] },
    { message: 'Invalid Input', detail: { list: countries } }
  ];
  let sent;
  globalThis.fetch = async (url, options) => { sent = { url, body: JSON.parse(options.body) };
    return new Response(JSON.stringify(bodies.shift()), { status: 400 }); };
  try {
    const { validateArteloOrderPriceCheck } = await import('../src/artelo.mjs');
    const { payload } = buildArteloPayload({ receipt: receipt(), plan: plan(), asset });
    await assert.rejects(validateArteloOrderPriceCheck(payload), error => error.status === 400 &&
      error.message === 'Artelo API 400: Invalid Input: customerAddress.country: Invalid option (one of US, AD, AE, AF … 249 values)');
    await assert.rejects(validateArteloOrderPriceCheck(payload), { message: 'Artelo API 400: Invalid Input: items.0.productInfo.frameColor: Invalid option (one of NaturalOak, BlackOak, WhiteOak)' });
    await assert.rejects(validateArteloOrderPriceCheck(payload), { message: 'Artelo API 400: Invalid Input: items.0.productInfo.size: Required' });
    await assert.rejects(validateArteloOrderPriceCheck(payload), { message: 'Artelo API 400: Invalid Input {"detail":{"list":["US","AD","AE","AF","… 249 values"]}}' });
    assert.match(sent.url, /\/orders\/price-check$/);
    assert.deepEqual(sent.body.items[0].productInfo.designs, [], 'no artwork link is sent for a price check');
    assert.ok(!JSON.stringify(sent.body).includes('test-key'));
  } finally {
    globalThis.fetch = saved.fetch;
    if (saved.key === undefined) delete process.env.ARTELO_API_KEY; else process.env.ARTELO_API_KEY = saved.key;
  }
});

test('submission record rules: one supplier, no resubmission, unknown leaves only by verification', () => {
  let r = transition(null, 'prepared', { provider: 'artelo', fields: { receiptId: RECEIPT } });
  r = transition(r, 'queued', {}); r = transition(r, 'submitting', {}); r = transition(r, 'submitted', { fields: { supplierOrderId: 'A1' } });
  assert.throws(() => transition(r, 'submitting', {}), /cannot go from submitted to submitting/);
  assert.throws(() => transition(r, 'prepared', { provider: 'sensaria' }), /cannot go from submitted to prepared/);
  assert.match(blockedBy(r, 'artelo'), /was already submitted \(artelo order A1\)/);
  let u = transition(transition(transition(transition(null, 'prepared', { provider: 'artelo' }), 'queued', {}), 'submitting', {}), 'unknown', {});
  assert.throws(() => transition(u, 'queued', {}), /cannot go from unknown to queued/);
  assert.throws(() => transition(u, 'fulfilled_elsewhere', { provider: 'sensaria' }), /cannot go from unknown/);
  assert.throws(() => transition(transition(null, 'prepared', { provider: 'artelo' }), 'queued', { provider: 'sensaria' }), /assigned to artelo/);
});
