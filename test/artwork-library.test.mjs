import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { renderThumb, thumbKey } from '../src/artwork-originals.mjs';
import { renderArtworkLibraryPage } from '../src/artwork-library-page.mjs';
const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');

test('the library picture is the original made small', async () => {
  assert.equal(thumbKey('SAC0012'), 'artworks/SAC0012/original/SAC0012-thumb.jpg');
  const original = await sharp({ create: { width: 1344, height: 896, channels: 3, background: '#7b98a6' } }).jpeg().toBuffer();
  const meta = await sharp(await renderThumb(original)).metadata();
  assert.deepEqual([meta.width, meta.height, meta.format], [360, 240, 'jpeg']);
});

test('the Artwork Library is a gallery by SKU; a click downloads the original, then the master', () => {
  const html = renderArtworkLibraryPage();
  assert.match(html, /<div class="gallery" id="al-gallery"><\/div>/);
  assert.match(html, /<script src="\/artwork-library-client\.js" defer>/);
  assert.match(read('src/admin-sidebar.mjs'), /\{ href:'\/artwork-library', label:'Artwork Library' \}/);
  const client = read('src/artwork-library-client.js');
  assert.match(client, /card\.append\(box,make\('div','sku',art\.artworkId\)\);/);
  assert.match(client, /save\(files\.original\.url\);\n  \/\/ The master after the original, so they arrive in that order\.\n  await new Promise\(resolve=>setTimeout\(resolve,1200\)\);\n  save\(files\.master\.url\);/);
  const server = read('src/server.mjs');
  // Lowest SKU first (SAC0002 before SAC0010).
  assert.match(server, /rows\.sort\(\(a,b\)=>a\.artworkId\.localeCompare\(b\.artworkId,undefined,\{numeric:true\}\)\);/);
  // The files come straight from storage, saved under their names; a missing original is made first.
  assert.match(server, /url:await signedArtworkUrl\(manifest\.original\.key,15\*60,\{filename:zipName\(id\+'\.jpg'\)\}\)/);
  assert.match(server, /url:await signedArtworkUrl\(manifest\.master\.key,60\*60,\{filename:zipName\(masterName\)\}\)/);
  assert.match(server, /if\(!fresh\)\{await originalInTurn\(id\);/);
});

test('a download link saves the file under its name', async () => {
  Object.assign(process.env, { R2_ACCOUNT_ID: 't', R2_ACCESS_KEY_ID: 't', R2_SECRET_ACCESS_KEY: 't', R2_BUCKET_NAME: 'b',
    R2_ENDPOINT: 'http://127.0.0.1:9', R2_REGION: 'auto' });
  const { signedArtworkUrl } = await import('../src/r2.mjs');
  const url = new URL(await signedArtworkUrl('artworks/SAC0001/source/SAC0001-master.jpg', 600, { filename: 'SAC0001 - Sage "Sweep".jpg' }));
  assert.equal(url.searchParams.get('response-content-disposition'), 'attachment; filename="SAC0001 - Sage _Sweep_.jpg"');
  assert.equal(new URL(await signedArtworkUrl('k')).searchParams.get('response-content-disposition'), null);
});
