// Originals: a small copy of each master artwork, in one fixed size per shape,
// as light a JPG as still looks right (mozjpeg at quality 70: about 80–150 KB).
// The master is centre-cropped to fill the size. Each is kept beside its
// master in R2, and the artwork's manifest says what it was made from, so a
// replaced master shows it as out of date.
import sharp from 'sharp';
import { listingLayoutForManifest } from './panoramic-layout.mjs';

export const ORIGINAL_SIZES = Object.freeze({
  portrait: [928, 1232], landscape: [1344, 896], panoramic: [1536, 768], square: [1024, 1024]
});
export const ORIGINAL_QUALITY = 70;
export const originalKey = artworkId => 'artworks/' + artworkId + '/original/' + artworkId + '-original.jpg';
export const originalSize = layout => ORIGINAL_SIZES[layout] || ORIGINAL_SIZES.portrait;
// The Artwork Library's pictures of an artwork: the whole artwork, uncropped,
// made from its master. A view for the artwork's window (1400 px on its long
// side) and a smaller one for the gallery (640 px, about 40 KB).
export const previewKeys = artworkId => ({
  view: 'artworks/' + artworkId + '/preview/' + artworkId + '-view.jpg',
  gallery: 'artworks/' + artworkId + '/preview/' + artworkId + '-gallery.jpg'
});
export async function renderPreviews(file) {
  const view = await sharp(file, { failOn: 'none', limitInputPixels: false, sequentialRead: true })
    .rotate()
    .resize(1400, 1400, { fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .toColourspace('srgb')
    .jpeg({ quality: 80, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  const gallery = await sharp(view.data).resize(640, 640, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 72, mozjpeg: true }).toBuffer();
  return { view: view.data, gallery, width: view.info.width, height: view.info.height };
}

// The original from a master file on disk (a file, so even a very large
// master is read as it goes rather than held in memory).
export function renderOriginal(file, [width, height]) {
  return sharp(file, { failOn: 'none', limitInputPixels: false, sequentialRead: true })
    .rotate()
    .resize(width, height, { fit: 'cover', position: 'centre' })
    .flatten({ background: '#ffffff' })
    .toColourspace('srgb')
    .jpeg({ quality: ORIGINAL_QUALITY, mozjpeg: true })
    .toBuffer();
}

// Whether an artwork's original is 'made', 'missing' or 'outdated' (its
// master or shape changed). `objects` maps R2 keys to { size, etag }.
export function originalState(manifest, objects) {
  const made = manifest?.original, master = objects.get(manifest?.master?.key);
  if (!made?.key || !objects.has(made.key)) return 'missing';
  if (made.masterKey !== manifest.master.key || made.layout !== listingLayoutForManifest(manifest) ||
    (made.masterEtag && master?.etag && made.masterEtag !== master.etag)) return 'outdated';
  return 'made';
}
// The same for the library pictures.
export function previewState(manifest, objects) {
  const made = manifest?.preview, master = objects.get(manifest?.master?.key);
  if (!made?.galleryKey || !objects.has(made.galleryKey) || !objects.has(made.viewKey)) return 'missing';
  if (made.masterKey !== manifest.master.key || (made.masterEtag && master?.etag && made.masterEtag !== master.etag)) return 'outdated';
  return 'made';
}

// The library pictures from a master file, kept with what they were made from.
async function savePreviews(artworkId, manifest, master, file, deps) {
  const pictures = await (deps.renderPreviews || renderPreviews)(file), keys = previewKeys(artworkId);
  await deps.put({ key: keys.view, body: pictures.view, contentType: 'image/jpeg' });
  await deps.put({ key: keys.gallery, body: pictures.gallery, contentType: 'image/jpeg' });
  return { viewKey: keys.view, galleryKey: keys.gallery, width: pictures.width, height: pictures.height,
    masterKey: manifest.master.key, masterEtag: master?.etag || null, madeAt: new Date().toISOString() };
}
// Whether the artwork's stored file (original or pictures) is up to date.
async function upToDate(record, keys, state, manifest, master, deps) {
  for (const key of keys) if (!key || !await deps.exists(key)) return false;
  return state(manifest, new Map([[manifest.master.key, master], ...keys.map(key => [key, {}])])) === 'made';
}

// Makes the library pictures of one artwork unless they are up to date.
// deps: loadManifest, objectInfo (size, etag), exists, withMaster(masterKey,
// file => …) (the master on disk), put, updateManifest; renderPreviews optional.
export async function makePreviews(artworkId, deps) {
  const manifest = await deps.loadManifest(artworkId);
  if (manifest?.status !== 'ready' || !manifest.master?.key) return { artworkId, skipped: 'the artwork is not ready' };
  const master = await deps.objectInfo(manifest.master.key), made = manifest.preview;
  if (made && await upToDate(made, [made.galleryKey, made.viewKey], previewState, manifest, master, deps))
    return { artworkId, skipped: 'up to date' };
  let record;
  await deps.withMaster(manifest.master.key, async file => { record = await savePreviews(artworkId, manifest, master, file, deps); });
  await deps.updateManifest(artworkId, current => { current.preview = record; });
  return { artworkId, made: record };
}

// Makes the original of one artwork unless it is up to date, and its library
// pictures with it from the same master. deps: as makePreviews; renderOriginal
// optional.
export async function makeOriginal(artworkId, deps) {
  const manifest = await deps.loadManifest(artworkId);
  if (manifest?.status !== 'ready' || !manifest.master?.key) return { artworkId, skipped: 'the artwork is not ready' };
  const master = await deps.objectInfo(manifest.master.key);
  const layout = listingLayoutForManifest(manifest);
  const made = manifest.original;
  if (made?.key && await upToDate(made, [made.key], originalState, manifest, master, deps))
    return { artworkId, skipped: 'up to date' };
  const size = originalSize(layout), key = originalKey(artworkId);
  let body, preview;
  await deps.withMaster(manifest.master.key, async file => {
    body = await (deps.renderOriginal || renderOriginal)(file, size);
    preview = await savePreviews(artworkId, manifest, master, file, deps);
  });
  await deps.put({ key, body, contentType: 'image/jpeg' });
  const record = { key, width: size[0], height: size[1], bytes: body.length, layout, masterKey: manifest.master.key,
    masterEtag: master?.etag || null, masterBytes: master?.size || null, madeAt: new Date().toISOString() };
  await deps.updateManifest(artworkId, current => { current.original = record; current.preview = preview; });
  return { artworkId, made: record, preview };
}
