import { loadArtworkManifest } from './artwork-storage.mjs';
import {
  fulfillmentRatioForSize,
  fulfillmentRatioObjectKey
} from './artwork-ratios.mjs';
import { signedArtworkUrl } from './r2.mjs';

function normalizedOrientation(value) {
  const text = String(value || '').trim().toLowerCase();
  if (text === 'landscape' || text === 'horizontal') return 'landscape';
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
    const actual = width > height ? 'landscape' : 'portrait';
    if (actual !== expected) return `stored ratio file is ${actual}, not ${expected}`;
  }
  return '';
}

export async function resolveProviderArtworkAsset({
  artworkId,
  size,
  expiresIn = 7 * 24 * 60 * 60
}) {
  const id = String(artworkId || '').trim().toUpperCase();
  const ratio = fulfillmentRatioForSize(size);
  const manifest = await loadArtworkManifest(id);
  if (!manifest?.master?.key) throw new Error(`Artwork ${id} is not stored in R2`);

  const asset = manifest.fulfillmentRatios?.[ratio];
  if (!asset?.productionReady || !asset?.key) {
    throw new Error(`Artwork ${id} does not have a production-ready ${ratio} crop for size ${size}`);
  }

  const issue = orientationIssue(asset, manifest.orientation);
  if (issue) throw new Error(`Artwork ${id} ${ratio} crop is unsafe: ${issue}`);

  const expectedKey = fulfillmentRatioObjectKey(id, ratio);
  if (String(asset.key) !== expectedKey) {
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
