import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';

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

test('an oversized older crop is refused with a regenerate message, never resized on the server', async () => {
  storeManifest();
  const manifest = JSON.parse(objects.get('artworks/SAC0042/manifest.json'));
  manifest.fulfillmentRatios['2x3'] = { ...manifest.fulfillmentRatios['2x3'], width: 12000, height: 18000 };
  objects.set('artworks/SAC0042/manifest.json', JSON.stringify(manifest));
  requests.length = 0;
  await assert.rejects(
    etsyReceiptToSensariaCsvFromR2(receipt('SAC0042-FC-4060-BLK'), { useProductionCrop: true }),
    /2x3 crop is 12000×18000 px; Sensaria accepts at most 17500 px\. Regenerate/
  );
  // Only the manifest was read: no crop download, no resize, no upload.
  assert.ok(requests.every(line => line.startsWith('GET ') && /manifest\.json/.test(line)), requests.join('\n'));
});

test('crops within the limit link straight to R2 with nothing downloaded', async () => {
  storeManifest();
  const manifest = JSON.parse(objects.get('artworks/SAC0042/manifest.json'));
  manifest.fulfillmentRatios['2x3'] = { ...manifest.fulfillmentRatios['2x3'], width: 11666, height: 17499 };
  objects.set('artworks/SAC0042/manifest.json', JSON.stringify(manifest));
  requests.length = 0;
  const exported = await etsyReceiptToSensariaCsvFromR2(receipt('SAC0042-FC-4060-BLK'), { useProductionCrop: true });
  assert.equal(exported.sources[0].key, 'artworks/SAC0042/fulfillment/2x3.jpg');
  assert.equal(exported.sources[0].height, 17499);
  assert.ok(requests.every(line => line.startsWith('GET ') && /manifest\.json/.test(line)), requests.join('\n'));
});

test('crop targets stay within Sensaria\'s 17,500 px limit', async () => {
  const { FULFILLMENT_RATIO_MIN_PIXELS } = await import('../src/artwork-ratios.mjs');
  const { sizeCropTarget } = await import('../src/size-crops.mjs');
  assert.deepEqual(FULFILLMENT_RATIO_MIN_PIXELS['2x3'], [11666, 17499]);
  assert.equal(11666 / 17499, 2 / 3);
  for (const [ratio, [w, h]] of Object.entries(FULFILLMENT_RATIO_MIN_PIXELS)) {
    assert.ok(Math.max(w, h) <= 17500, ratio);
  }
  assert.deepEqual(sizeCropTarget('40x60'), { width: 11666, height: 17500 });
  assert.deepEqual(sizeCropTarget('40x60', 'landscape'), { width: 17500, height: 11666 });
  assert.deepEqual(sizeCropTarget('24x36'), { width: 7200, height: 10800 });
  assert.ok(Math.max(...Object.values(sizeCropTarget('120x120', 'square'))) <= 17500);
});
