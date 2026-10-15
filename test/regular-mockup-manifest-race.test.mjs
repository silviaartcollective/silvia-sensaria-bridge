import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const copy = value => JSON.parse(JSON.stringify(value));

test('normal mockup manifest mutations survive concurrent Etsy draft updates', async () => {
  const storage = source('src/artwork-storage.mjs');
  const start = storage.indexOf('const artworkManifestMutationTails = new Map();');
  const end = storage.indexOf('function extensionFromFilename(', start);
  assert.ok(start >= 0 && end > start);
  const implementation = storage.slice(start, end).replace('export async function', 'async function');
  let record = { artworkId: 'TEST1', mockups: [], etsyDraftSetup: { status: 'running' } };
  const loadArtworkManifest = async () => { await Promise.resolve(); return copy(record); };
  const saveArtworkManifest = async value => { await Promise.resolve(); record = copy(value); };
  const update = new Function('loadArtworkManifest', 'saveArtworkManifest',
    implementation + '\nreturn updateArtworkManifest;')(loadArtworkManifest, saveArtworkManifest);

  await Promise.all([
    ...Array.from({ length: 24 }, (_, i) =>
      update('TEST1', async current => {
        await Promise.resolve();
        current.mockups.push({ index: i, key: 'artworks/TEST1/mockups/' + i });
      })),
    update('TEST1', current => { current.etsyDraftSetup = { status: 'completed' }; })
  ]);
  assert.equal(record.mockups.length, 24);
  assert.equal(record.etsyDraftSetup.status, 'completed');

  await assert.rejects(update('TEST1', () => { throw Error('failure'); }), /failure/);
  await update('TEST1', current => { current.mockups.push({ index: 24 }); });
  assert.equal(record.mockups.length, 25);
});

test('regular JPG uploader uses the same manifest mutation queue as the draft', () => {
  const uploader = source('src/regular-mockup-uploads.mjs');
  assert.match(uploader, /updateArtworkManifest\(artworkId,async\(manifest\)=>/);
  assert.equal((uploader.match(/return updateArtworkManifest\(artworkId/g) || []).length, 2);
  assert.doesNotMatch(uploader, /let mutationTail=Promise.resolve\(\)/);
  const server = source('src/server.mjs');
  assert.match(server, /async function persistDraftManifestFields\(manifest, fields\)/);
  assert.match(server, /persistDraftManifestFields\(manifest,\['etsyDraftListingId','etsyDraftCreatedAt'\]\)/);
  assert.match(server, /persistDraftManifestFields\(manifest,\['etsyConfiguredAt','etsyConfiguration'\]\)/);
  assert.match(server, /persistDraftManifestFields\(manifest,\['etsyDraftSetup'\]\)/);
  assert.match(server, /const latest=await updateArtworkManifest\(manifest.artworkId,current=>/);
  assert.match(server, /const latestManifest=await updateArtworkManifest\(manifest.artworkId,current=>/);
  assert.match(server, /void queueRegularMockupEtsySync\(setupId\)\.catch/);
  assert.match(server, /verifyEtsyImageReceipts\(\{receipts:newlyUploaded,readImages\}\)/);
});
