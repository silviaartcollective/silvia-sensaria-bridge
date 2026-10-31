// Your own production crops on Re-upload artwork: the checks each one passes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { checkOwnCrop } from '../src/converter-artwork-revision.mjs';

const ok = (ratio, width, height, size = 5_000_000, format = 'jpeg') => checkOwnCrop(ratio, { format, width, height }, { size }, size);

test('a crop of the exact shape passes, either way round, and notes if it is below the recommended resolution', () => {
  assert.deepEqual(ok('2x3', 11666, 17499), { width: 11666, height: 17499, recommendedPixelsMet: true });
  assert.equal(ok('2x3', 17499, 11666).width, 17499, 'a landscape crop of a landscape listing');
  assert.equal(ok('4x5', 4800, 6000).recommendedPixelsMet, true);
  assert.equal(ok('3x4', 3000, 4000).recommendedPixelsMet, false);
  assert.equal(ok('11x14', 3300, 4205).width, 3300, 'within half a percent');
});

test('a crop of the wrong shape, not a JPEG, too large, too small or not fully uploaded is refused', () => {
  assert.throws(() => ok('2x3', 3000, 4000), /not a 2:3 shape/);
  assert.throws(() => ok('5x7', 3000, 4000), /not a 5:7 shape/);
  assert.throws(() => ok('4x5', 4800, 6000, 5_000_000, 'png'), /not a JPEG/);
  assert.throws(() => ok('2x3', 12000, 18000), /at most 17500 px/);
  assert.throws(() => ok('4x5', 400, 500), /too small to print/);
  assert.throws(() => checkOwnCrop('4x5', { format: 'jpeg', width: 4800, height: 6000 }, { size: 100 }, 5_000_000), /did not finish/);
});

test('the routes, the activation and the page use the own-crop path', () => {
  const server = readFileSync(new URL('../src/server.mjs', import.meta.url), 'utf8');
  assert.match(server, /url\.pathname==='\/api\/listing-converter\/reconvert\/own-crops'\|\|/);
  assert.match(server, /await verifyOwnCrops\(\{shopId,listingId,artworkId,revision:String\(body\.revision\)\}\)/);
  const revision = readFileSync(new URL('../src/converter-artwork-revision.mjs', import.meta.url), 'utf8');
  // The activation checks verified own crops instead of a PC crop job.
  assert.match(revision, /const assets=ownCropsReady\(record\)\?await checkedOwnCropAssets\(record\)/);
  // Cropping on the PC drops crops uploaded by hand for that revision.
  assert.match(revision, /delete record\.ownCrops;/);
  const client = readFileSync(new URL('../src/listings-client.js', import.meta.url), 'utf8');
  assert.doesNotThrow(() => new vm.Script(client));
  assert.match(client, /'\/api\/listing-converter\/reconvert\/own-crops\/verify'/);
  assert.match(client, /Use my own crops…/);
});
