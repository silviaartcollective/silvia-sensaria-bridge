// One approved PrintShrimp order: preview (live price check, no order), then a
// single recorded submission. Mocked PrintShrimp, storage and Etsy.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { buildPrintShrimpPayload, previewPrintShrimpOrder, submitPrintShrimpOrder, printShrimpConfirmation, printShrimpOrderId } from '../src/printshrimp-order-submission.mjs';

const ID = '4000000001';
const ON = { FULFILLMENT_LIVE_SUBMISSION_ENABLED: 'true', PRINTSHRIMP_FULFILLMENT_ENABLED: 'true', SUPPLIER_SUBMISSION_ALLOWED_RECEIPTS: 'all' };
const receipt = (extra = {}) => ({ receipt_id: Number(ID), shop_id: 77, was_paid: true, is_paid: true, name: 'Test Buyer', first_line: '1 Example St',
  second_line: '', city: 'Sampletown', state: 'VIC', zip: '3000', country_iso: 'AU',
  transactions: [{ transaction_id: 5000000001, quantity: 1, sku: 'SAC0021-P-1216', listing_id: 1 }], ...extra });
const plan = (extra = {}) => ({ receiptId: ID, supplier: 'printshrimp', provider: 'PrintShrimp', productCode: 'P', size: '12x16', artworkId: 'SAC0021',
  assetKey: 'artworks/SAC0021/fulfillment/3x4.jpg', quotedTotalUsd: 13.91, modeledLandedUsd: 14.19,
  quoteDetails: { size: '30x40cm', gbpToUsd: 1.27 }, signature: 'sig-1', ...extra });

function world({ review, env = ON, price = { livePrice: 7.5, liveShipping: 3.45, currency: 'GBP' }, create, ledger = null } = {}) {
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
    trackingRecord: async () => null
  };
  return { deps, calls, record: () => record, order };
}

test('the PrintShrimp order: Etsy address, one Matte poster at the plan size, the production crop', () => {
  const { payload, issues } = buildPrintShrimpPayload({ receipt: receipt(), plan: plan(), asset: { url: 'https://r2/x.jpg', orientation: 'portrait' } });
  assert.deepEqual(issues, []);
  assert.deepEqual(payload, {
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
  assert.match(p.payload.products[0].image.artwork_url, /signed R2 link to artworks\/SAC0021/);
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
  assert.match(server, /\|printshrimp-preview\|printshrimp-submit\)\$\/\);/);
  assert.match(server, /'submission-resolve','printshrimp-submit'\]\.includes\(action\)/);
  const client = readFileSync(new URL('../src/supplier-order-client.js', import.meta.url), 'utf8');
  assert.doesNotThrow(() => new vm.Script(client));
  assert.match(client, /data-so="ps-preview"/);
  assert.match(client, /\{confirm:el\('confirm'\)\.value\.trim\(\),dashboardChecked:true\}/);
});
