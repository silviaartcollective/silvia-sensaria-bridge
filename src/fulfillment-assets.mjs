import { loadArtworkManifest, updateArtworkManifest } from './artwork-storage.mjs';
import {
  fulfillmentRatioForSize,
  fulfillmentRatioObjectKey,
  fulfillmentRatiosForOrientation
} from './artwork-ratios.mjs';
import { signedArtworkUrl, getJsonObject, artworkObjectExists } from './r2.mjs';

function normalizedOrientation(value) {
  const text = String(value || '').trim().toLowerCase();
  if (text === 'landscape' || text === 'horizontal') return 'landscape';
  if (text === 'square') return 'square';
  return 'portrait';
}

function orientationIssue(asset, orientation) {
  const expected = normalizedOrientation(orientation);
  const recorded = String(asset?.orientation || '').trim();
  if (recorded && normalizedOrientation(recorded) !== expected) {
    return `stored ratio file was generated for ${normalizedOrientation(recorded)}, not ${expected}`;
  }
  const width = Number(asset?.width || 0);
  const height = Number(asset?.height || 0);
  if (width > 0 && height > 0) {
    const actual = width > height ? 'landscape' : height > width ? 'portrait' : 'square';
    if (actual !== expected) return `stored ratio file is ${actual}, not ${expected}`;
  }
  return '';
}

// The crop worker's results are written twice: to the artwork's manifest and to
// its fulfillment/status.json. When the manifest lost them (two app instances
// overwrote each other during a deploy) but status.json has them, the crops made
// from the current master whose files are in R2 are put back in the manifest.
// Crops from an earlier master are never restored.
export async function restoreRatiosFromStatus(id, manifest, deps = {}) {
  const read = deps.getJsonObject || getJsonObject, exists = deps.artworkObjectExists || artworkObjectExists;
  const update = deps.updateArtworkManifest || updateArtworkManifest;
  let status = null;
  try { status = await read('artworks/' + id + '/fulfillment/status.json'); } catch { return null; }
  if (status?.status !== 'completed' || !status.assets || typeof status.assets !== 'object') return null;
  const restored = {};
  for (const [ratio, asset] of Object.entries(status.assets)) {
    if (!asset?.productionReady || !asset.key || asset.ratio !== ratio) continue;
    if (String(asset.sourceMasterKey || '') !== String(manifest.master.key)) continue;
    if (String(asset.key) !== fulfillmentRatioObjectKey(id, ratio)) continue;
    if (orientationIssue(asset, manifest.orientation)) continue;
    if (!(await exists(asset.key))) continue;
    restored[ratio] = { ...asset, restoredFromStatusAt: new Date().toISOString() };
  }
  if (!Object.keys(restored).length) return null;
  return update(id, latest => {
    if (String(latest.master?.key || '') !== String(manifest.master.key))
      throw new Error('Artwork ' + id + ' master changed while its crops were being restored.');
    const current = latest.fulfillmentRatios || {};
    latest.fulfillmentRatios = { ...restored, ...Object.fromEntries(Object.entries(current).filter(([, a]) => a?.productionReady)) };
    latest.fulfillmentRatiosReady = fulfillmentRatiosForOrientation(latest.orientation, latest.master)
      .every(r => Boolean(latest.fulfillmentRatios[r]?.productionReady));
    latest.fulfillmentRatiosUpdatedAt = new Date().toISOString();
  });
}

export async function resolveProviderArtworkAsset({
  artworkId,
  size,
  expiresIn = 7 * 24 * 60 * 60
}) {
  const id = String(artworkId || '').trim().toUpperCase();
  const ratio = fulfillmentRatioForSize(size);
  let manifest = await loadArtworkManifest(id);
  if (!manifest?.master?.key) throw new Error(`Artwork ${id} is not stored in R2`);

  let asset = manifest.fulfillmentRatios?.[ratio];
  if (!asset?.productionReady || !asset?.key) {
    const repaired = await restoreRatiosFromStatus(id, manifest).catch(() => null);
    if (repaired?.fulfillmentRatios?.[ratio]?.productionReady) { manifest = repaired; asset = repaired.fulfillmentRatios[ratio]; }
    else throw new Error(`Artwork ${id} does not have a production-ready ${ratio} crop for size ${size}. ` +
      `In Listings, open ${id} and click Regenerate crops from stored master (with the PC crop worker running), then refresh this order.`);
  }

  const issue = orientationIssue(asset, manifest.orientation);
  if (issue) throw new Error(`Artwork ${id} ${ratio} crop is unsafe: ${issue}`);

  const expectedKey = fulfillmentRatioObjectKey(id, ratio);
  const revisionExpected = /^artworks\/(?:SAC\d+)\/revisions\/[0-9a-f-]{36}\/fulfillment\/(?:1x1|1x2|1x3|2x3|3x4|4x5|11x14|5x7|14x15)\.jpg$/;
  const revisionValid=revisionExpected.test(String(asset.key)) &&
    String(asset.key).startsWith('artworks/'+id+'/') &&
    String(asset.key).endsWith('/'+ratio+'.jpg') &&
    String(asset.sourceMasterKey||'')===String(manifest.master.key);
  if (String(asset.key) !== expectedKey && !revisionValid) {
    throw new Error(`Artwork ${id} ${ratio} crop is stored at an unexpected R2 key`);
  }

  return {
    artworkId: id,
    size: String(size),
    ratio,
    orientation: normalizedOrientation(manifest.orientation),
    key: asset.key,
    width: Number(asset.width || 0) || null,
    height: Number(asset.height || 0) || null,
    url: await signedArtworkUrl(asset.key, expiresIn)
  };
}
