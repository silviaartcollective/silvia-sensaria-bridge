import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';

// A minimal S3-compatible stand-in for R2: serves artwork manifests by key and
// records every request, so the test can prove nothing is downloaded,
// rendered or uploaded while the Sensaria CSV is prepared.
const objects = new Map();
const requests = [];
const server = http.createServer(async (req, res) => {
  requests.push(req.method + ' ' + req.url);
  const key = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/[^/]+\//, '');
  if (req.method === 'PUT') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    let body = Buffer.concat(chunks);
    // The AWS SDK streams file uploads as aws-chunked; R2 decodes that.
    if (String(req.headers['content-encoding'] || '').includes('aws-chunked')) {
      const parts = [];
      let offset = 0;
      while (offset < body.length) {
        const lineEnd = body.indexOf('\r\n', offset);
        const length = parseInt(body.subarray(offset, lineEnd).toString().split(';')[0], 16);
        if (!length) break;
        parts.push(body.subarray(lineEnd + 2, lineEnd + 2 + length));
        offset = lineEnd + 2 + length + 2;
      }
      body = Buffer.concat(parts);
    }
    objects.set(key, body);
    res.writeHead(200, { etag: '"x"' });
    return res.end();
  }
  if ((req.method === 'GET' || req.method === 'HEAD') && objects.has(key)) {
    const body = Buffer.from(objects.get(key));
    res.writeHead(200, { 'content-type': key.endsWith('.json') ? 'application/json' : 'image/jpeg', 'content-length': body.length });
    return res.end(req.method === 'HEAD' ? undefined : body);
  }
  res.writeHead(404, { 'content-type': 'application/xml' });
  res.end(req.method === 'HEAD' ? undefined : '<Error><Code>NoSuchKey</Code></Error>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
Object.assign(process.env, {
  R2_ACCOUNT_ID: 'test',
  R2_ACCESS_KEY_ID: 'test',
  R2_SECRET_ACCESS_KEY: 'test',
  R2_BUCKET_NAME: 'silvia-test',
  R2_ENDPOINT: 'http://127.0.0.1:' + server.address().port,
  R2_REGION: 'auto'
});
test.after(() => server.close());

const { etsyReceiptToSensariaCsvFromR2 } = await import('../src/fulfillment.mjs');

const MASTER_KEY = 'artworks/SAC0042/SAC0042.jpg';
function storeManifest(overrides = {}) {
  const manifest = {
    artworkId: 'SAC0042',
    status: 'ready',
    orientation: 'portrait',
    master: { key: MASTER_KEY, width: 8000, height: 12000, orientation: 'portrait' },
    fulfillmentRatios: {
      '2x3': {
        ratio: '2x3', key: 'artworks/SAC0042/fulfillment/2x3.jpg', width: 8000, height: 12000,
        orientation: 'portrait', productionReady: true, sourceMasterKey: MASTER_KEY
      },
      '3x4': {
        ratio: '3x4', key: 'artworks/SAC0042/fulfillment/3x4.jpg', width: 8000, height: 10667,
        orientation: 'portrait', productionReady: true, sourceMasterKey: MASTER_KEY
      }
    },
    ...overrides
  };
  for (const key of [...objects.keys()]) objects.delete(key);
  objects.set('artworks/SAC0042/manifest.json', JSON.stringify(manifest));
}

function receipt(sku) {
  return {
    receipt_id: 3876543210,
    name: 'Ada Lovelace',
    first_line: '1 Test Street',
    city: 'Columbia',
    state: 'MO',
    zip: '65202',
    country_iso: 'US',
    buyer_email: 'buyer@example.com',
    transactions: [{ sku, quantity: 1 }]
  };
}

test('Sensaria CSV links the stored R2 crop for the ordered size and renders nothing', async () => {
  storeManifest();
  requests.length = 0;
  for (const [sku, cropKey] of [
    ['SAC0042-C-2436', 'artworks/SAC0042/fulfillment/2x3.jpg'],
    ['SAC0042-FC-1824-BLK', 'artworks/SAC0042/fulfillment/3x4.jpg'],
    ['SAC0042-P-1218', 'artworks/SAC0042/fulfillment/2x3.jpg']
  ]) {
    const exported = await etsyReceiptToSensariaCsvFromR2(receipt(sku), { useProductionCrop: true });
    const [row] = exported.rows;
    const [source] = exported.sources;
    assert.equal(source.productionCrop, true, sku);
    assert.equal(source.key, cropKey, sku);
    assert.match(row.URL, new RegExp(cropKey.replaceAll('/', '\\/').replace('.', '\\.')), sku);
    assert.match(row.URL, /X-Amz-Signature=/, sku);
    assert.ok(row['Product Code'], sku);
  }
  // Only manifest reads: no master download, no production render upload.
  assert.ok(requests.every(line => line.startsWith('GET ') && /manifest\.json/.test(line)), requests.join('\n'));
  assert.ok(!requests.some(line => /\/production\/|SAC0042\.jpg/.test(line)), requests.join('\n'));
});

test('canvas rows keep Sensaria Mirror wrap so Sensaria builds the edges', async () => {
  storeManifest();
  const exported = await etsyReceiptToSensariaCsvFromR2(receipt('SAC0042-C-2436'), { useProductionCrop: true });
  assert.equal(exported.rows[0]['Wrap Type'], 'Mirror');
});

test('a missing or wrong-orientation crop stops the CSV instead of falling back to the master', async () => {
  storeManifest({ fulfillmentRatios: {} });
  await assert.rejects(
    etsyReceiptToSensariaCsvFromR2(receipt('SAC0042-C-2436'), { useProductionCrop: true }),
    /does not have a production-ready 2x3 crop/
  );

  storeManifest();
  const landscapeCrop = JSON.parse(objects.get('artworks/SAC0042/manifest.json'));
  landscapeCrop.fulfillmentRatios['2x3'] = { ...landscapeCrop.fulfillmentRatios['2x3'], width: 12000, height: 8000, orientation: 'landscape' };
  objects.set('artworks/SAC0042/manifest.json', JSON.stringify(landscapeCrop));
  await assert.rejects(
    etsyReceiptToSensariaCsvFromR2(receipt('SAC0042-C-2436'), { useProductionCrop: true }),
    /unsafe/
  );
});

test('the CSV job requires the exact crop the supplier recommendation verified', () => {
  const server = readFileSync(new URL('../src/server.mjs', import.meta.url), 'utf8');
  const fulfillment = readFileSync(new URL('../src/fulfillment.mjs', import.meta.url), 'utf8');
  assert.match(server, /useProductionCrop:true/);
  assert.match(server, /exported\.sources\[0\]\?\.cropKey!==plan\.assetKey/);
  assert.match(server, />17500/);
  assert.doesNotMatch(fulfillment, /ensureProductionAsset/);
});

test('crops over Sensaria\'s pixel limit get a capped copy that is cached and reused', async () => {
  storeManifest();
  // A real (small) 2x3 crop stands in for the 12000×18000 file; the limit is
  // scaled down the same way (17,500 → 400) so the test stays fast.
  const crop = await sharp({ create: { width: 300, height: 450, channels: 3, background: '#7a8c5e' } }).jpeg().toBuffer();
  const manifest = JSON.parse(objects.get('artworks/SAC0042/manifest.json'));
  manifest.fulfillmentRatios['2x3'] = { ...manifest.fulfillmentRatios['2x3'], width: 300, height: 450, updatedAt: '2026-10-15T00:00:00Z' };
  objects.set('artworks/SAC0042/manifest.json', JSON.stringify(manifest));
  objects.set('artworks/SAC0042/fulfillment/2x3.jpg', crop);

  requests.length = 0;
  const first = await etsyReceiptToSensariaCsvFromR2(receipt('SAC0042-FC-4060-BLK'), { useProductionCrop: true, sensariaMaxUploadPx: 400 });
  const source = first.sources[0];
  assert.equal(source.capped, true);
  assert.equal(source.cropKey, 'artworks/SAC0042/fulfillment/2x3.jpg');
  assert.equal(source.key, 'artworks/SAC0042/fulfillment/sensaria/40x60.jpg');
  assert.match(first.rows[0].URL, /fulfillment\/sensaria\/40x60\.jpg/);
  const stored = await sharp(objects.get(source.key)).metadata();
  assert.deepEqual([stored.width, stored.height], [267, 400]);
  assert.equal(stored.format, 'jpeg');
  assert.equal(stored.isProgressive, false);
  assert.ok(requests.some(line => line.startsWith('PUT ') && line.includes('sensaria/40x60.jpg')));
  assert.ok(!requests.some(line => line.includes('SAC0042.jpg')), 'master must not be downloaded');

  requests.length = 0;
  const second = await etsyReceiptToSensariaCsvFromR2(receipt('SAC0042-FC-4060-BLK'), { useProductionCrop: true, sensariaMaxUploadPx: 400 });
  assert.equal(second.sources[0].key, source.key);
  assert.ok(!requests.some(line => line.startsWith('PUT ') && line.includes('sensaria/')), 'cached copy must be reused');
  assert.ok(!requests.some(line => line.startsWith('GET ') && line.includes('fulfillment/2x3.jpg')), 'crop must not be downloaded again');
});

test('the real Sensaria cap turns a 12000×18000 crop into 11667×17500 at most', async () => {
  const { sensariaUploadTarget, SENSARIA_MAX_UPLOAD_PX } = await import('../src/sensaria-upload-asset.mjs');
  assert.equal(SENSARIA_MAX_UPLOAD_PX, 17500);
  assert.deepEqual(sensariaUploadTarget({ width: 12000, height: 18000, size: '40x60' }), { width: 11667, height: 17500, density: 291 });
  assert.deepEqual(sensariaUploadTarget({ width: 18000, height: 12000, size: '40x60' }), { width: 17500, height: 11667, density: 291 });
  assert.deepEqual(sensariaUploadTarget({ width: 12000, height: 18000, size: '24x36' }), { width: 7200, height: 10800, density: 300 });
  assert.equal(sensariaUploadTarget({ width: 9000, height: 12000, size: '30x40' }), null);
  assert.equal(sensariaUploadTarget({ width: 12000, height: 17500, size: '40x60' }), null);
});
