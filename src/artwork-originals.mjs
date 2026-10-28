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

// Makes the original of one artwork unless it is up to date.
// deps: loadManifest, objectInfo (size, etag), exists, render(masterKey, size), put, updateManifest.
export async function makeOriginal(artworkId, deps) {
  const manifest = await deps.loadManifest(artworkId);
  if (manifest?.status !== 'ready' || !manifest.master?.key) return { artworkId, skipped: 'the artwork is not ready' };
  const master = await deps.objectInfo(manifest.master.key);
  const layout = listingLayoutForManifest(manifest);
  const made = manifest.original;
  if (made?.key && await deps.exists(made.key) &&
    originalState(manifest, new Map([[manifest.master.key, master], [made.key, {}]])) === 'made')
    return { artworkId, skipped: 'up to date' };
  const size = originalSize(layout);
  const body = await deps.render(manifest.master.key, size);
  const key = originalKey(artworkId);
  await deps.put({ key, body, contentType: 'image/jpeg' });
  const record = { key, width: size[0], height: size[1], bytes: body.length, layout, masterKey: manifest.master.key,
    masterEtag: master?.etag || null, masterBytes: master?.size || null, madeAt: new Date().toISOString() };
  await deps.updateManifest(artworkId, current => { current.original = record; });
  return { artworkId, made: record };
}
