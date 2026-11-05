import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { renderPreviews, previewKeys, makePreviews, previewState } from '../src/artwork-originals.mjs';
import { renderArtworkLibraryPage } from '../src/artwork-library-page.mjs';
const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');

test('the library pictures are the whole artwork, uncropped, made from the master', async () => {
  assert.deepEqual(previewKeys('SAC0012'), { view: 'artworks/SAC0012/preview/SAC0012-view.jpg',
    gallery: 'artworks/SAC0012/preview/SAC0012-gallery.jpg' });
  const dir = await mkdtemp(path.join(os.tmpdir(), 'previews-'));
  try {
    for (const [w, h, view, gallery] of [[3000, 4000, [1050, 1400], [480, 640]], [6000, 2900, [1400, 677], [640, 309]], [800, 600, [800, 600], [640, 480]]]) {
      const file = path.join(dir, w + 'x' + h);
      await writeFile(file, await sharp({ create: { width: w, height: h, channels: 3, background: '#7b98a6' } }).png().toBuffer());
      const made = await renderPreviews(file);
      const [big, small] = await Promise.all([sharp(made.view).metadata(), sharp(made.gallery).metadata()]);
      assert.deepEqual([big.width, big.height, big.format, made.width, made.height], [...view, 'jpeg', ...view]);
      assert.deepEqual([small.width, small.height, small.format], [...gallery, 'jpeg']);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('library pictures are made for an artwork without them, and again when its master is replaced', async () => {
  const masterKey = 'artworks/SAC0003/source/SAC0003-master.jpg';
  const store = new Map([[masterKey, { size: 900, etag: '"a"' }]]);
  const manifests = { SAC0003: { artworkId: 'SAC0003', status: 'ready', master: { key: masterKey, width: 3000, height: 4000 } } };
  let made = 0;
  const deps = {
    loadManifest: async id => structuredClone(manifests[id]),
    objectInfo: async key => store.get(key),
    exists: async key => store.has(key),
    withMaster: async (key, use) => use('/tmp/master'),
    renderPreviews: async () => { made++; return { view: Buffer.from('v'), gallery: Buffer.from('g'), width: 1050, height: 1400 }; },
    put: async ({ key, body }) => store.set(key, { size: body.length, etag: '"p"' }),
    updateManifest: async (id, change) => change(manifests[id])
  };
  assert.equal(previewState(manifests.SAC0003, store), 'missing');
  assert.equal((await makePreviews('SAC0003', deps)).made.galleryKey, 'artworks/SAC0003/preview/SAC0003-gallery.jpg');
  assert.equal(previewState(manifests.SAC0003, store), 'made');
  assert.equal((await makePreviews('SAC0003', deps)).skipped, 'up to date');
  store.set(masterKey, { size: 950, etag: '"b"' });
  assert.equal(previewState(manifests.SAC0003, store), 'outdated');
  assert.ok((await makePreviews('SAC0003', deps)).made);
  assert.equal(made, 2);
});

test('the Artwork Library: whole pictures in their own shape, by SKU, opening a window with the downloads', () => {
  const html = renderArtworkLibraryPage();
  assert.match(html, /<div class="gallery" id="al-gallery"><\/div>/);
  assert.match(html, /<script src="\/artwork-library-client\.js" defer>/);
  // Each picture keeps the artwork's shape and is shown whole, in rows of one height.
  assert.match(html, /\.art\{flex:0 0 auto;width:calc\(var\(--a\) \* var\(--row\)\);max-width:100%;/);
  assert.match(html, /\.art \.pic\{width:100%;aspect-ratio:var\(--a\)/);
  assert.match(html, /\.art img\{width:100%;height:100%;object-fit:contain;display:block\}/);
  assert.match(html, /\.gallery\{--row:250px;/);
  assert.match(html, /<button type="button" class="primary" data-files="original">Download original<\/button><button type="button" data-files="master">Download master<\/button><button type="button" data-files="original,master">Download both<\/button>/);
  assert.match(read('src/admin-sidebar.mjs'), /\{ href:'\/artwork-library', label:'Artwork Library' \}/);
  const client = read('src/artwork-library-client.js');
  assert.match(client, /if\(alone\/target<=target\/joined\)\{place\(row,alone\);row=\[item\];sum=a;\}/);
  assert.match(client, /node\.addEventListener\('click',\(\)=>show\(art\.artworkId\)\);/);
  assert.match(client, /if\(ready\.original\)\{save\(ready\.original\.url\);[^\n]*\n  \/\/ The master after the original, so they arrive in that order\.\n  if\(ready\.original&&ready\.master\)await new Promise\(resolve=>setTimeout\(resolve,1200\)\);\n  if\(ready\.master\)\{save\(ready\.master\.url\);/);
  assert.match(client, /dialog\.addEventListener\('click',event=>\{if\(event\.target===dialog\)dialog\.close\(\);\}\);/);
  const server = read('src/server.mjs');
  // Lowest SKU first (SAC0002 before SAC0010).
  assert.match(server, /rows\.sort\(\(a,b\)=>a\.artworkId\.localeCompare\(b\.artworkId,undefined,\{numeric:true\}\)\);/);
  // Missing pictures are made in the background, one master at a time.
  assert.match(server, /queuePreviews\(rows\.filter\(row=>row\.preview!=='made'\)\.map\(row=>row\.artworkId\)\);/);
  assert.match(server, /const result=await inTurn\(\(\)=>makePreviews\(id,originalDeps\)\);/);
  // The files come straight from storage, saved under their names; a missing original is made first.
  assert.match(server, /const files=\['original','master'\]\.filter\(file=>!Array\.isArray\(input\?\.files\)\|\|input\.files\.includes\(file\)\);/);
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
