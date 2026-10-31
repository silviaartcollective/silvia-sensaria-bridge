// Hourly Artelo → Etsy tracking, with mocked storage, Artelo and Etsy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { syncArteloTracking, autoTrackingSettings } from '../src/artelo-auto-tracking.mjs';
import { etsyCarrierCode, supplierShipments } from '../src/order-tracking.mjs';

const ON = { ARTELO_AUTO_TRACKING_ENABLED: 'true' };
const NOW = Date.parse('2026-11-02T12:00:00Z');
const submitted = (extra = {}) => ({ receiptId: '4217901308', provider: 'artelo', state: 'submitted', supplierOrderId: 'ART-1',
  externalOrderId: 'SAC-4217901308', updatedAt: '2026-10-31T01:38:00Z', ...extra });

// ledger: receiptId → submission record; artelo: what Artelo's order lookup reports.
function world({ ledger = { '4217901308': submitted() }, tracking = {}, artelo = { status: 'processing', shipments: [] }, etsyShipped = false, env = ON } = {}) {
  const calls = { link: [], check: [], send: [] };
  const deps = {
    env, now: () => NOW,
    listReceipts: async () => Object.keys(ledger),
    ledger: { read: async id => ledger[id] || null },
    readTracking: async id => tracking[id] || null,
    link: async (session, input) => { calls.link.push(input); return (tracking[input.receiptId] = { ...input, shipments: [], etsyStatus: { isShipped: etsyShipped } }); },
    check: async (session, id) => {
      calls.check.push(id);
      const doc = tracking[id];
      for (const s of artelo.shipments) if (!doc.shipments.some(v => v.trackingNumber === s.trackingNumber)) doc.shipments.push({ ...s, etsySentAt: null });
      doc.etsyStatus = { isShipped: etsyShipped };
      return { status: artelo.status, record: doc };
    },
    send: async (session, input) => {
      calls.send.push(input);
      tracking[input.receiptId].shipments.forEach(s => { s.etsySentAt = '2026-11-02T12:00:00Z'; });
      return { etsySubmitted: true };
    }
  };
  return { deps, calls, tracking };
}
const run = w => syncArteloTracking({ shop: { shop_id: 77 } }, { deps: w.deps });

test('off unless ARTELO_AUTO_TRACKING_ENABLED=true; ETSY_SHIPMENT_SUBMISSION_ENABLED=false also stops it', async () => {
  for (const env of [{}, { ARTELO_AUTO_TRACKING_ENABLED: 'false' }, { ...ON, ETSY_SHIPMENT_SUBMISSION_ENABLED: 'false' }]) {
    const w = world({ env });
    assert.deepEqual(await run(w), { enabled: false, results: [] });
    assert.equal(w.calls.check.length + w.calls.send.length, 0);
  }
  assert.equal(autoTrackingSettings({ ...ON, ETSY_SHIPMENT_SUBMISSION_ENABLED: 'true' }).enabled, true);
});

test('a submitted order is linked, waits while Artelo prints, and is marked shipped once with its tracking', async () => {
  const w = world();
  assert.deepEqual((await run(w)).results, [{ receiptId: '4217901308', outcome: 'waiting', artelo: 'processing' }]);
  assert.deepEqual(w.calls.link, [{ receiptId: '4217901308', supplier: 'artelo', supplierOrderId: 'ART-1' }]);
  assert.equal(w.calls.send.length, 0, 'nothing is sent to Etsy before Artelo reports it shipped');

  const shippedWorld = world({ tracking: w.tracking, artelo: { status: 'shipped', shipments: [{ trackingNumber: '9400111899223344556677', carrier: 'USPS', status: 'shipped' }] } });
  const second = await run(shippedWorld);
  assert.deepEqual(second.results, [{ receiptId: '4217901308', outcome: 'marked_shipped', trackingNumber: '9400111899223344556677', carrier: 'USPS' }]);
  assert.deepEqual(shippedWorld.calls.send, [{ receiptId: '4217901308', trackingNumber: '9400111899223344556677', confirm: 'MARK SHIPPED ON ETSY' }]);
  assert.equal(shippedWorld.calls.link.length, 0, 'already linked');

  // The next hour does nothing for it: no Artelo lookup, no second Etsy notification.
  const third = await run(shippedWorld);
  assert.deepEqual(third.results, []);
  assert.equal(shippedWorld.calls.send.length, 1);
  assert.equal(shippedWorld.calls.check.length, 1);
});

test('orders not sent by this app, not confirmed, too old or linked elsewhere are left alone', async () => {
  const ledger = {
    '1000000001': submitted({ receiptId: '1000000001', provider: 'sensaria', state: 'prepared', supplierOrderId: '' }),
    '1000000002': submitted({ receiptId: '1000000002', state: 'unknown' }),
    '1000000003': submitted({ receiptId: '1000000003', supplierOrderId: '' }),
    '1000000004': submitted({ receiptId: '1000000004', updatedAt: '2026-08-01T00:00:00Z' }),
    '1000000005': submitted({ receiptId: '1000000005', supplierOrderId: 'ART-5' })
  };
  const w = world({ ledger, tracking: { '1000000005': { supplier: 'prodigi', supplierOrderId: 'PRO-9', shipments: [] } } });
  const { results } = await run(w);
  assert.deepEqual(results, [{ receiptId: '1000000005', outcome: 'skipped', reason: 'Order Tracking links it to prodigi order PRO-9.' }]);
  assert.equal(w.calls.check.length + w.calls.send.length + w.calls.link.length, 0);
});

test('an order already marked shipped on Etsy (by hand) is never sent again', async () => {
  const w = world({ etsyShipped: true, artelo: { status: 'shipped', shipments: [{ trackingNumber: '9400111899223344556677', carrier: 'USPS', status: 'shipped' }] } });
  assert.deepEqual((await run(w)).results, [{ receiptId: '4217901308', outcome: 'already_shipped_on_etsy' }]);
  assert.equal(w.calls.send.length, 0);
  assert.deepEqual((await run(w)).results, [], 'and is skipped from then on');
});

test('one failing order is reported and the others still run', async () => {
  const ledger = { '4217901308': submitted(), '4217901309': submitted({ receiptId: '4217901309', supplierOrderId: 'ART-2' }) };
  const w = world({ ledger });
  const check = w.deps.check;
  w.deps.check = async (s, id) => { if (id === '4217901308') throw new Error('The Etsy order has been canceled.'); return check(s, id); };
  const { results } = await run(w);
  assert.deepEqual(results.map(r => [r.receiptId, r.outcome]), [['4217901308', 'error'], ['4217901309', 'waiting']]);
  assert.match(results[0].reason, /canceled/);
});

test('Artelo shipments and carrier service names map to Etsy', () => {
  assert.equal(etsyCarrierCode('USPS Ground Advantage'), 'usps');
  assert.equal(etsyCarrierCode('ups'), 'ups');
  assert.throws(() => etsyCarrierCode('Pigeon Express'), /Unknown Etsy carrier/);
  assert.deepEqual(supplierShipments('artelo', { order: { status: 'Processing', shipments: [] } }), { status: 'processing', shipments: [] });
  assert.deepEqual(supplierShipments('artelo', { status: 'Shipped', shipments: [{ id: 's1', trackingNumber: '9400111899223344556677', carrier: 'USPS' }] }).shipments,
    [{ trackingNumber: '9400111899223344556677', trackingUrl: '', carrier: 'USPS', shipmentId: 's1', status: 'shipped', source: 'artelo_api' }]);
});

test('the server runs it only when switched on', () => {
  const server = readFileSync(new URL('../src/server.mjs', import.meta.url), 'utf8');
  assert.match(server, /if\(autoTrackingSettings\(\)\.enabled\)\{/);
  assert.equal((server.match(/syncArteloTracking\(/g) || []).length, 1);
});
