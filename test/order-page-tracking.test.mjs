import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

// Minimal R2 stand-in for tracking records (JSON GET/PUT by key).
const objects = new Map();
const server = http.createServer(async (req, res) => {
  const key = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/[^/]+\//, '');
  if (req.method === 'PUT') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    let body = Buffer.concat(chunks);
    if (String(req.headers['content-encoding'] || '').includes('aws-chunked')) {
      const parts = []; let offset = 0;
      while (offset < body.length) {
        const end = body.indexOf('\r\n', offset);
        const length = parseInt(body.subarray(offset, end).toString().split(';')[0], 16);
        if (!length) break;
        parts.push(body.subarray(end + 2, end + 2 + length)); offset = end + 2 + length + 2;
      }
      body = Buffer.concat(parts);
    }
    objects.set(key, body.toString('utf8'));
    res.writeHead(200, { etag: '"x"' }); return res.end();
  }
  if (req.method === 'GET' && objects.has(key)) {
    res.writeHead(200, { 'content-type': 'application/json' }); return res.end(objects.get(key));
  }
  res.writeHead(404, { 'content-type': 'application/xml' });
  res.end('<Error><Code>NoSuchKey</Code></Error>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
Object.assign(process.env, {
  R2_ACCOUNT_ID: 'test', R2_ACCESS_KEY_ID: 'test', R2_SECRET_ACCESS_KEY: 'test',
  R2_BUCKET_NAME: 'silvia-test', R2_ENDPOINT: 'http://127.0.0.1:' + server.address().port, R2_REGION: 'auto'
});
test.after(() => server.close());

const { autoLinkSensariaReceipt, readShopTrackingRecord, sensariaCandidates } = await import('../src/order-tracking.mjs');
const session = { shop: { shop_id: 55501 } };
const receipt = { receipt_id: 4201324221, shop_id: 55501, is_paid: true, shipments: [] };
const report = [
  'PartnerOrderReferenceNumber,OrderNumber,OrderStatus,Shipment Id,Shipping Date,ShipmentTrackingNumber,ShipmentTrackingURL',
  '4201324221,SEN-778812,Shipped,SH-1,2026-10-18,1Z999AA10123456784,https://www.ups.com/track?tracknum=1Z999AA10123456784'
].join('\n');

test('downloading a Sensaria CSV links the receipt so the shipped report matches without manual entry', async () => {
  objects.clear();
  const result = await autoLinkSensariaReceipt(session, receipt);
  assert.equal(result.linked, true);
  assert.equal(result.record.supplier, 'sensaria');
  assert.equal(result.record.supplierOrderId, '4201324221');
  assert.equal(result.record.supplierReference, 'sensaria_po_number');
  assert.equal(result.record.linkSource, 'sensaria_csv_download');

  const stored = await readShopTrackingRecord(session, '4201324221');
  const preview = sensariaCandidates(report, [stored]);
  assert.equal(preview.skipped.length, 0, JSON.stringify(preview.skipped));
  assert.equal(preview.rows.length, 1);
  assert.equal(preview.rows[0].receiptId, '4201324221');
  assert.equal(preview.rows[0].trackingNumber, '1Z999AA10123456784');
  assert.equal(preview.rows[0].carrier, 'UPS');
});

test('auto-link never replaces an existing link or touches another shop', async () => {
  objects.clear();
  await autoLinkSensariaReceipt(session, receipt);
  const again = await autoLinkSensariaReceipt(session, receipt);
  assert.equal(again.linked, false);
  assert.equal(again.reason, 'already_linked');

  objects.clear();
  objects.set('tracking/etsy/4201324221/record.json', JSON.stringify({
    receiptId: '4201324221', shopId: '55501', supplier: 'prodigi', supplierOrderId: 'PRD-1', shipments: []
  }));
  const other = await autoLinkSensariaReceipt(session, receipt);
  assert.equal(other.linked, false);
  assert.equal(other.reason, 'other_supplier');
  assert.equal(JSON.parse(objects.get('tracking/etsy/4201324221/record.json')).supplier, 'prodigi');

  await assert.rejects(autoLinkSensariaReceipt(session, { ...receipt, receipt_id: 999, shop_id: 1 }), /different shop/);
  assert.equal(await readShopTrackingRecord({ shop: { shop_id: 1 } }, '4201324221'), null);
});

test('order page has the tracking step and the server wires it without touching Etsy', () => {
  const client = readFileSync(new URL('../src/orders-client.js', import.meta.url), 'utf8');
  assert.doesNotThrow(() => new vm.Script(client));
  assert.ok(client.includes("'/api/tracking/record?receiptId='+encodeURIComponent(id)"));
  assert.ok(client.includes("api('/api/tracking/stage',{receiptId:id,"));
  assert.ok(client.includes("confirm:'SAVE TRACKING'"));
  assert.ok(client.includes("api('/api/tracking/link',{receiptId:id,supplier,supplierOrderId})"));
  const page = readFileSync(new URL('../src/orders-page.mjs', import.meta.url), 'utf8');
  for (const id of ['tracking-summary', 'tracking-number', 'tracking-carrier', 'tracking-save', 'tracking-link'])
    assert.ok(page.includes('id="' + id + '"'), id);
  const srv = readFileSync(new URL('../src/server.mjs', import.meta.url), 'utf8');
  assert.ok(srv.includes("url.pathname === '/api/tracking/record'"));
  assert.ok(srv.includes("if(body.confirm!=='SAVE TRACKING')"));
  assert.ok(srv.includes('etsySubmitted:false'));
  assert.ok(srv.includes('await autoLinkSensariaReceipt(session,latest)'));
});
