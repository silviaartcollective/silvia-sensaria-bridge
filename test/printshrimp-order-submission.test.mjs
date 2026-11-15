// One approved PrintShrimp order: preview (live price check, no order), then a
// single recorded submission. Mocked PrintShrimp, storage and Etsy.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { buildPrintShrimpPayload, previewPrintShrimpOrder, submitPrintShrimpOrder, printShrimpConfirmation, printShrimpOrderId, verifyPrintShrimpSubmission, autoSubmitPrintShrimpOrder, syncPrintShrimpAutoActivation } from '../src/printshrimp-order-submission.mjs';
import { supplierShipments } from '../src/order-tracking.mjs';

const ID = '4000000001';
const ON = { FULFILLMENT_LIVE_SUBMISSION_ENABLED: 'true', PRINTSHRIMP_FULFILLMENT_ENABLED: 'true', SUPPLIER_SUBMISSION_ALLOWED_RECEIPTS: 'all' };
const receipt = (extra = {}) => ({ receipt_id: Number(ID), shop_id: 77, was_paid: true, is_paid: true, name: 'Test Buyer', first_line: '1 Example St',
  second_line: '', city: 'Sampletown', state: 'VIC', zip: '3000', country_iso: 'AU',
  transactions: [{ transaction_id: 5000000001, quantity: 1, sku: 'SAC0021-P-1216', listing_id: 1 }], ...extra });
const plan = (extra = {}) => ({ receiptId: ID, supplier: 'printshrimp', provider: 'PrintShrimp', productCode: 'P', size: '12x16', artworkId: 'SAC0021',
  assetKey: 'artworks/SAC0021/fulfillment/3x4.jpg', quotedTotalUsd: 13.91, modeledLandedUsd: 14.19,
  quoteDetails: { size: '30x40cm', gbpToUsd: 1.27 }, signature: 'sig-1', ...extra });

function world({ review, env = ON, price = { livePrice: 7.5, liveShipping: 3.45, currency: 'GBP' }, create, ledger = null, bytes = 20e6, smaller = null, found = null } = {}) {
  const calls = { create: [], ledgerWrites: [], reviews: [] };
  let record = ledger;
  const order = { staged: { receipt: receipt(), source: 'etsy_sync' },
    review: review || { classification: 'regular', status: 'approved_for_manual_order', regularPlan: plan(), approval: { planSignature: 'sig-1' } } };
  const deps = {
    env, now: () => new Date('2026-11-15T10:00:00Z'),
    readOrder: async () => order,
    saveReview: async (id, r) => { calls.reviews.push(r); order.review = r; },
    resolveAsset: async () => ({ key: 'artworks/SAC0021/fulfillment/3x4.jpg', url: 'https://r2.example/signed/3x4.jpg', width: 3600, height: 4800, orientation: 'portrait', ratio: '3x4' }),
    artworkExists: async () => true,
    priceCheck: async () => ({ currency: 'GBP', checks: [price] }),
    createOrder: async payload => { calls.create.push(payload); return create ? create(payload) : { order_id: 'PS-901', status: 'received' }; },
    ledger: { read: async () => record, write: async (id, r) => { calls.ledgerWrites.push(r.state); record = r; } },
    trackingRecord: async () => null,
    objectInfo: async () => ({ size: bytes }),
    smallerArtwork: async () => smaller,
    getOrder: async ({ externalOrderNumber }) => { calls.lookups = [...(calls.lookups || []), externalOrderNumber]; if (!found) throw new Error('PrintShrimp API 404: Order not found'); return { order: found }; }
  };
  return { deps, calls, record: () => record, order };
}

test('the PrintShrimp order: Etsy address, one Matte poster at the plan size, the production crop', () => {
  const { payload, issues } = buildPrintShrimpPayload({ receipt: receipt(), plan: plan(), asset: { url: 'https://r2/x.jpg', orientation: 'portrait' } });
  assert.deepEqual(issues, []);
  assert.deepEqual(payload, {
    external_order_number: 'SAC-4000000001',
    customerInfo: { name: 'Test Buyer', address1: '1 Example St', city: 'Sampletown', state: 'VIC', zip: '3000', country: 'AU' },
    products: [{ type: 'Print', paper_type: 'Matte', size: '12x16', quantity: 1, image: { artwork_url: 'https://r2/x.jpg' } }]
  });
  const bad = buildPrintShrimpPayload({ receipt: receipt({ state: '' }), plan: plan({ productCode: 'C', size: '20x26' }), asset: { orientation: 'square' } }).issues.join(' ');
  for (const text of ['unframed posters', 'no 20x26', 'no download URL', 'Square artwork', 'state or province']) assert.match(bad, new RegExp(text));
});

test('preview: ready when approved, authorized and the live price matches; never creates an order', async () => {
  const w = world();
  const p = await previewPrintShrimpOrder(ID, { shopId: 77, deps: w.deps });
  assert.deepEqual(p.blockers, []); assert.deepEqual(p.switches, []); assert.equal(p.ready, true);
  assert.equal(p.confirmation, 'SUBMIT 4000000001 TO PRINTSHRIMP');
  assert.equal(p.expectedCost.printShrimpPriceCheck.totalUsd.toFixed(2), ((7.5 + 3.45) * 1.27).toFixed(2));
  assert.match(p.payload.products[0].image.artwork_url, /private link to artworks\/SAC0021/);
  assert.equal(w.calls.create.length, 0);
});

test('preview blocks: not approved, price moved, switches off, another supplier already holds it', async () => {
  const notApproved = world({ review: { classification: 'regular', status: 'awaiting_supplier_approval', regularPlan: plan(), approval: null } });
  assert.match((await previewPrintShrimpOrder(ID, { shopId: 77, deps: notApproved.deps })).blockers.join(' '), /Approve the PrintShrimp recommendation/);
  const moved = world({ price: { livePrice: 15, liveShipping: 5, currency: 'GBP' } });
  assert.match((await previewPrintShrimpOrder(ID, { shopId: 77, deps: moved.deps })).blockers.join(' '), /now prices this order at \$25\.40/);
  const off = world({ env: { SUPPLIER_SUBMISSION_ALLOWED_RECEIPTS: '123' } });
  assert.equal((await previewPrintShrimpOrder(ID, { shopId: 77, deps: off.deps })).switches.length, 3);
  const held = world({ ledger: { receiptId: ID, provider: 'artelo', state: 'submitted', supplierOrderId: 'A-1' } });
  assert.match((await previewPrintShrimpOrder(ID, { shopId: 77, deps: held.deps })).blockers.join(' '), /already submitted \(artelo order A-1\)/);
});

test('submit: needs the typed confirmation and dashboard check, sends once, records the PrintShrimp order ID', async () => {
  const w = world();
  await assert.rejects(submitPrintShrimpOrder(ID, { confirm: 'yes', dashboardChecked: true }, { shopId: 77, deps: w.deps }), /Type "SUBMIT 4000000001 TO PRINTSHRIMP"/);
  await assert.rejects(submitPrintShrimpOrder(ID, { confirm: printShrimpConfirmation(ID) }, { shopId: 77, deps: w.deps }), /dashboard has no order/);
  assert.equal(w.calls.create.length, 0);
  const record = await submitPrintShrimpOrder(ID, { confirm: printShrimpConfirmation(ID), dashboardChecked: true }, { shopId: 77, deps: w.deps });
  assert.deepEqual(w.calls.ledgerWrites, ['submitting', 'submitted'], 'saved as submitting before the request');
  assert.equal(record.provider, 'printshrimp'); assert.equal(record.supplierOrderId, 'PS-901');
  assert.equal(w.calls.create[0].products[0].image.artwork_url, 'https://r2.example/signed/3x4.jpg');
  assert.equal(w.order.review.status, 'supplier_submitted'); assert.equal(w.order.review.approval.supplier, 'printshrimp');
  // Never twice.
  await assert.rejects(submitPrintShrimpOrder(ID, { confirm: printShrimpConfirmation(ID), dashboardChecked: true }, { shopId: 77, deps: w.deps }), /Not submitted/);
  assert.equal(w.calls.create.length, 1);
});

test('a timeout leaves the order unknown and blocked; a 4xx is a rejection', async () => {
  const timeout = world({ create: () => { throw new Error('fetch failed'); } });
  await assert.rejects(submitPrintShrimpOrder(ID, { confirm: printShrimpConfirmation(ID), dashboardChecked: true }, { shopId: 77, deps: timeout.deps }), /may or may not have been created/);
  assert.equal(timeout.record().state, 'unknown');
  assert.match((await previewPrintShrimpOrder(ID, { shopId: 77, deps: timeout.deps })).blockers.join(' '), /unknown outcome/);
  const refused = world({ create: () => { throw new Error('PrintShrimp API 422: invalid size'); } });
  await assert.rejects(submitPrintShrimpOrder(ID, { confirm: printShrimpConfirmation(ID), dashboardChecked: true }, { shopId: 77, deps: refused.deps }), /rejected the order/);
  assert.equal(refused.record().state, 'rejected');
  assert.equal(printShrimpOrderId({ data: { order_id: 77 } }), '77');
});

test('the server routes and the order panel', () => {
  const server = readFileSync(new URL('../src/server.mjs', import.meta.url), 'utf8');
  assert.match(server, /\|printshrimp-preview\|printshrimp-submit\|printshrimp-verify\)\$\/\);/);
  assert.match(server, /'submission-resolve','printshrimp-submit','printshrimp-verify'\]\.includes\(action\)/);
  assert.match(server, /const printShrimpDeps=\{\.\.\.deps,smallerArtwork:printShrimpSizeCrop,publicArtworkUrl:/);
  const client = readFileSync(new URL('../src/supplier-order-client.js', import.meta.url), 'utf8');
  assert.doesNotThrow(() => new vm.Script(client));
  assert.match(client, /data-so="ps-preview"/);
  assert.match(client, /data-so="ps-verify"/);
  assert.match(client, /waits in the PrintShrimp dashboard as Pending until it is paid/);
  assert.match(client, /\{confirm:el\('confirm'\)\.value\.trim\(\),dashboardChecked:true\}/);
});

test('the docs\' address rules: 60 characters, no numbers in the city, US and UK postcodes', () => {
  const issues = r => buildPrintShrimpPayload({ receipt: receipt(r), plan: plan(), asset: { url: 'https://r2/x.jpg', orientation: 'portrait' } }).issues.join(' ');
  assert.match(issues({ first_line: 'x'.repeat(61) }), /street line is over PrintShrimp's 60-character limit/);
  assert.match(issues({ city: 'Area 51' }), /numbers in the city/);
  assert.match(issues({ country_iso: 'US', state: 'NY', zip: 'ABCDE' }), /numeric US ZIP/);
  assert.match(issues({ country_iso: 'GB', state: '', zip: '12345' }), /UK postcode with letters/);
  assert.equal(issues({ country_iso: 'GB', state: '', zip: 'SW1A 1AA' }), '');
});

test('a crop over 50 MB is replaced by the exact-size crop, or the preview says it is being made', async () => {
  const big = world({ bytes: 60 * 1048576, smaller: { key: 'artworks/SAC0021/fulfillment/by-size/12x16.jpg', url: 'https://r2.example/signed/12x16.jpg',
    width: 3600, height: 4800, orientation: 'portrait', ratio: 'size-12x16', sizeBytes: 6e6 } });
  const p = await previewPrintShrimpOrder(ID, { shopId: 77, deps: big.deps });
  assert.deepEqual(p.blockers, []);
  assert.equal(p.artwork.key, 'artworks/SAC0021/fulfillment/by-size/12x16.jpg');
  assert.equal(p.artwork.replacedLargeCrop, 'artworks/SAC0021/fulfillment/3x4.jpg');
  const queued = world({ bytes: 60 * 1048576, smaller: { queued: true, message: 'A 12x16 crop is queued on the PC crop worker.' } });
  assert.match((await previewPrintShrimpOrder(ID, { shopId: 77, deps: queued.deps })).blockers.join(' '), /3x4 crop is 60 MB and PrintShrimp accepts up to 50 MB\. A 12x16 crop is queued/);
});

test('Check PrintShrimp status finds the order by its reference and settles an unknown submission', async () => {
  const none = world();
  assert.equal((await verifyPrintShrimpSubmission(ID, { deps: none.deps })).found, false);
  assert.deepEqual(none.calls.lookups, ['SAC-4000000001']);
  const w = world({ ledger: { receiptId: ID, provider: 'printshrimp', state: 'unknown', history: [] },
    found: { order_id: 'f0f17d46', status: 'Pending', paid: false, order_num: null, tracking: null } });
  const out = await verifyPrintShrimpSubmission(ID, { deps: w.deps });
  assert.equal(out.found, true); assert.equal(out.paid, false); assert.equal(out.status, 'Pending');
  assert.equal(w.record().state, 'submitted'); assert.equal(w.record().supplierOrderId, 'f0f17d46');
});

test('Order Tracking reads PrintShrimp\'s tracking and tracking_courier once it has shipped', () => {
  assert.deepEqual(supplierShipments('printshrimp', { success: true, order: { status: 'Processing', paid: true, tracking: null } }), { status: 'processing', shipments: [] });
  assert.deepEqual(supplierShipments('printshrimp', { success: true, order: { order_id: 'f0f17d46', status: 'Shipped', tracking: 'RM1234567GB', tracking_courier: 'Royal Mail' } }).shipments,
    [{ trackingNumber: 'RM1234567GB', trackingUrl: '', carrier: 'Royal Mail', shipmentId: 'f0f17d46', status: 'shipped', source: 'printshrimp_api' }]);
  assert.equal(supplierShipments('printshrimp', { order: { status: 'Completed', tracking: 'RM1234567GB', tracking_courier: 'Royal Mail' } }).shipments.length, 1);
});

test('PrintShrimp gets the app\'s own artwork link, which answers HEAD', async () => {
  const w = world();
  w.deps.publicArtworkUrl = key => 'https://silvia.example.com/supplier-artwork/x/1/y/' + key.split('/').pop();
  await submitPrintShrimpOrder(ID, { confirm: printShrimpConfirmation(ID), dashboardChecked: true }, { shopId: 77, deps: w.deps });
  assert.equal(w.calls.create[0].products[0].image.artwork_url, 'https://silvia.example.com/supplier-artwork/x/1/y/3x4.jpg');
});

test('after a rejection the order can be sent again', async () => {
  const w = world({ ledger: { receiptId: ID, provider: 'printshrimp', state: 'rejected', history: [] } });
  const record = await submitPrintShrimpOrder(ID, { confirm: printShrimpConfirmation(ID), dashboardChecked: true }, { shopId: 77, deps: w.deps });
  assert.equal(record.state, 'submitted'); assert.equal(w.calls.create.length, 1);
});

// ---- Automatic submission ----
const AUTO = { ...ON, PRINTSHRIMP_AUTO_SUBMIT_ENABLED: 'true', SUPPLIER_SUBMISSION_ALLOWED_RECEIPTS: '' };
const placedAt = iso => ({ create_timestamp: Date.parse(iso) / 1000 });
function autoWorld({ env = AUTO, state = { enabledSince: '2026-11-15T08:00:00Z' }, placed = '2026-11-15T09:00:00Z', ...rest } = {}) {
  const w = world({ env, review: { classification: 'regular', status: 'awaiting_supplier_approval', regularPlan: plan(), approval: null }, ...rest });
  w.order.staged.receipt = { ...receipt(), ...placedAt(placed) };
  let current = state;
  w.deps.autoState = { read: async () => current, write: async value => { current = value; } };
  w.state = () => current;
  return w;
}
const autoRun = w => autoSubmitPrintShrimpOrder(ID, { shopId: 77, latestReceipt: w.order.staged.receipt, deps: w.deps });

test('automatic: a new passing PrintShrimp order is sent once, approved as automatic, and counted', async () => {
  const w = autoWorld();
  const out = await autoRun(w);
  assert.equal(out.status, 'submitted'); assert.equal(out.record.supplierOrderId, 'PS-901');
  assert.equal(w.calls.create.length, 1);
  assert.equal(w.order.review.approval.method, 'automatic'); assert.equal(w.order.review.status, 'supplier_submitted');
  assert.equal(w.state().days['2026-11-15'], 1);
  assert.equal((await autoRun(w)).status, 'not_printshrimp', 'never twice');
  assert.equal(w.calls.create.length, 1);
});

test('automatic: off without its switch, never for orders placed before switch-on, and within the daily limit', async () => {
  assert.equal((await autoRun(autoWorld({ env: ON }))).status, 'off');
  assert.equal((await autoRun(autoWorld({ placed: '2026-11-14T16:45:00Z' }))).status, 'before_switch_on');
  const full = autoWorld({ env: { ...AUTO, PRINTSHRIMP_AUTO_SUBMIT_DAILY_LIMIT: '2' }, state: { enabledSince: '2026-11-15T08:00:00Z', days: { '2026-11-15': 2 } } });
  assert.equal((await autoRun(full)).status, 'daily_limit');
  assert.equal(full.calls.create.length, 0);
});

test('automatic: an order that fails a check is held for a person once, and any existing record blocks it', async () => {
  const moved = autoWorld({ price: { livePrice: 15, liveShipping: 5, currency: 'GBP' } });
  const held = await autoRun(moved);
  assert.equal(held.status, 'held'); assert.match(held.reasons.join(' '), /now prices this order/);
  assert.equal(moved.order.review.automaticSubmission.status, 'held');
  assert.equal((await autoRun(moved)).status, 'already_held', 'not re-checked every sweep');
  const recorded = autoWorld({ ledger: { receiptId: ID, provider: 'printshrimp', state: 'rejected', history: [] } });
  assert.match((await autoRun(recorded)).reasons.join(' '), /A submission record exists \(printshrimp · rejected\)/);
  assert.equal(recorded.calls.create.length + moved.calls.create.length, 0);
});

test('automatic: a failed request is recorded and reported, never retried on its own', async () => {
  const w = autoWorld({ create: () => { throw new Error('fetch failed'); } });
  const out = await autoRun(w);
  assert.equal(out.status, 'failed'); assert.equal(w.record().state, 'unknown');
  assert.equal(w.state().days['2026-11-15'], 1, 'counted before the request');
});

test('automatic: switch-on time is kept across restarts and cleared when switched off', async () => {
  let saved = {};
  const state = { read: async () => saved, write: async v => { saved = v; } };
  const first = await syncPrintShrimpAutoActivation({ env: AUTO, state, now: () => new Date('2026-11-15T08:00:00Z') });
  assert.equal(first, '2026-11-15T08:00:00.000Z');
  assert.equal(await syncPrintShrimpAutoActivation({ env: AUTO, state, now: () => new Date('2026-11-16T08:00:00Z') }), first);
  assert.equal(await syncPrintShrimpAutoActivation({ env: ON, state }), null);
  assert.equal(saved.enabledSince, null);
});

test('the server sweeps PrintShrimp orders with the app address Render provides', () => {
  const server = readFileSync(new URL('../src/server.mjs', import.meta.url), 'utf8');
  assert.match(server, /autoSuppliers=\[submissionSettings\(\)\.autoEnabled\?'artelo':'',printShrimpSubmissionSettings\(\)\.autoEnabled\?'printshrimp':''\]/);
  assert.match(server, /base:String\(process\.env\.RENDER_EXTERNAL_URL\|\|process\.env\.APP_BASE_URL\|\|''\)/);
  assert.match(server, /await autoSubmitPrintShrimpOrder\(o\.receiptId,\{shopId,latestReceipt:latest,deps:autoPrintShrimpDeps\(\)\}\)/);
});
