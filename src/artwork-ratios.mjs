import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import sharp from 'sharp';
import {
  downloadArtworkObjectToFile,
  putArtworkFile,
  signedArtworkUrl,
  getJsonObject
} from './r2.mjs';
import { manifestObjectKey } from './production.mjs';

sharp.cache(false);
sharp.concurrency(1);

export const FULFILLMENT_RATIOS = Object.freeze(['2x3', '3x4', '4x5', '11x14', '5x7', '14x15']);

export const FULFILLMENT_RATIO_DIMENSIONS = Object.freeze({
  '2x3': [2, 3],
  '3x4': [3, 4],
  '4x5': [4, 5],
  '11x14': [11, 14],
  '5x7': [5, 7],
  '14x15': [14, 15]
});

// Reference dimensions for 300-PPI planning only. Actual crop output uses
// original master pixels and must never upscale to these reference dimensions.
export const FULFILLMENT_RATIO_MIN_PIXELS = Object.freeze({
  // Sensaria GO rejects RGB uploads over 17,500 px, so the 2x3 crop is made at
  // the largest exact 2:3 size within that limit (about 292 DPI at 40x60).
  '2x3': [11666, 17499], // 40x60
  '3x4': [9000, 12000],  // 30x40
  '4x5': [4800, 6000],   // 16x20
  '11x14': [3300, 4200], // 11x14
  '5x7': [1500, 2100],    // 5x7
  '14x15': [8400, 9000]   // 28x30
});

export const SIZE_TO_FULFILLMENT_RATIO = Object.freeze({
  '5x7': '5x7',
  '8x10': '4x5',
  '8x12': '2x3',
  '11x14': '11x14',
  '12x16': '3x4',
  '12x18': '2x3',
  '16x20': '4x5',
  '16x24': '2x3',
  '18x24': '3x4',
  '24x36': '2x3',
  '28x30': '14x15',
  '30x40': '3x4',
  '40x60': '2x3'
});

function normalizeOrientation(value, width, height) {
  const actual=Number(width)>Number(height)?'landscape':Number(height)>Number(width)?'portrait':'square';
  if(actual==='square')throw Error('Square master artwork needs dedicated square crop ratios.');
  // Pixel dimensions are authoritative even if an older manifest says portrait.
  return actual;
}

function orientedPair(ratio, orientation) {
  const pair = FULFILLMENT_RATIO_DIMENSIONS[ratio];
  if (!pair) throw new Error(`Unsupported fulfillment ratio: ${ratio}`);
  return orientation === 'landscape' ? [pair[1], pair[0]] : pair;
}

function requiredDimensions(ratio, orientation) {
  const base = FULFILLMENT_RATIO_MIN_PIXELS[ratio];
  if (!base) throw new Error(`Unsupported fulfillment ratio: ${ratio}`);
  const pair = orientation === 'landscape' ? [base[1], base[0]] : base;
  return { width: pair[0], height: pair[1] };
}

export function fulfillmentRatioForSize(size) {
  const ratio = SIZE_TO_FULFILLMENT_RATIO[String(size || '').trim()];
  if (!ratio) throw new Error(`No fulfillment ratio configured for size ${size}`);
  return ratio;
}

export function fulfillmentRatioObjectKey(artworkId, ratio) {
  const id = String(artworkId || '').trim().toUpperCase();
  if (!/^SAC\d+$/.test(id)) throw new Error(`Invalid artwork ID: ${artworkId}`);
  const normalized = String(ratio || '').trim().toLowerCase();
  if (!FULFILLMENT_RATIOS.includes(normalized)) throw new Error(`Unsupported fulfillment ratio: ${ratio}`);
  return `artworks/${id}/fulfillment/${normalized}.jpg`;
}

function cropDimensions(width, height, ratio, orientation) {
  const pair = orientedPair(ratio, orientation);
  const targetRatio = pair[0] / pair[1];
  const sourceRatio = width / height;
  if (sourceRatio > targetRatio) {
    return { width: Math.floor(height * targetRatio), height };
  }
  return { width, height: Math.floor(width / targetRatio) };
}

async function generateOne({ artworkId, sourcePath, sourceKey, ratio, orientation }) {
  const metadata = await sharp(sourcePath, { limitInputPixels: false, sequentialRead: true }).metadata();
  let width = Number(metadata.width || 0);
  let height = Number(metadata.height || 0);
  if ([5,6,7,8].includes(Number(metadata.orientation || 1))) [width, height] = [height, width];
  if (!width || !height) throw new Error('Could not determine master artwork dimensions');

  const normalizedOrientation = normalizeOrientation(orientation, width, height);
  const crop = cropDimensions(width, height, ratio, normalizedOrientation);
  const required = requiredDimensions(ratio, normalizedOrientation);
  const recommendedPixelsMet = crop.width >= required.width && crop.height >= required.height;
  // Small formats scale down uniformly to their reference resolution. Larger
  // formats never exceed the pixel dimensions of the original source crop.
  const scale = Math.min(1, required.width / crop.width, required.height / crop.height);
  const output = {
    width: Math.max(1, Math.floor(crop.width * scale)),
    height: Math.max(1, Math.floor(crop.height * scale))
  };

  const result = {
    ratio,
    orientation: normalizedOrientation,
    ready: true,
    upscaled: false,
    downscaled: output.width < crop.width || output.height < crop.height,
    recommendedPixelsMet,
    source: { key: sourceKey, width, height },
    crop: {
      width: crop.width,
      height: crop.height,
      requiredWidth: required.width,
      requiredHeight: required.height
    }
  };


  const key = fulfillmentRatioObjectKey(artworkId, ratio);
  const outputPath = join(tmpdir(), `silvia-${artworkId}-${ratio}-${randomUUID()}.jpg`);
  try {
    let image = sharp(sourcePath, {
      failOn: 'warning',
      limitInputPixels: false,
      sequentialRead: true
    })
      .rotate()
      .extract({
        left: Math.floor((width - crop.width) / 2),
        top: Math.floor((height - crop.height) / 2),
        width: crop.width,
        height: crop.height
      });
    if (output.width !== crop.width || output.height !== crop.height) {
      image = image.resize(output.width, output.height, {
        fit: 'fill', withoutEnlargement: true, kernel: sharp.kernel.lanczos3
      });
    }
    await image.flatten({ background: '#ffffff' })
      .withMetadata({ density: 300 })
      .jpeg({ quality: 88, chromaSubsampling: '4:2:0', progressive: true, optimiseCoding: true })
      .toFile(outputPath);

    await putArtworkFile({ key, filePath: outputPath, contentType: 'image/jpeg' });
    return {
      ...result,
      key,
      width: output.width,
      height: output.height,
      productionReady: true,
      url: await signedArtworkUrl(key, 60 * 60)
    };
  } finally {
    await rm(outputPath, { force: true }).catch(() => {});
  }
}

export async function generateFulfillmentRatios({ artworkId, masterKey, orientation = '' }) {
  if (!masterKey) throw new Error('Master artwork key is required');
  const sourcePath = join(tmpdir(), `silvia-${artworkId}-master-${randomUUID()}`);
  try {
    await downloadArtworkObjectToFile(masterKey, sourcePath);
    const assets = {};
    const insufficient = {};
    for (const ratio of FULFILLMENT_RATIOS) {
      const generated = await generateOne({
        artworkId,
        sourcePath,
        sourceKey: masterKey,
        ratio,
        orientation
      });
      if (generated.ready) assets[ratio] = generated;
      else insufficient[ratio] = generated;
    }
    return {
      artworkId,
      ready: FULFILLMENT_RATIOS.every((ratio) => Boolean(assets[ratio]?.productionReady)),
      assets,
      insufficient
    };
  } finally {
    await rm(sourcePath, { force: true }).catch(() => {});
  }
}

export async function signedFulfillmentRatioUrl({ artworkId, size, ratio, expiresIn = 7 * 24 * 60 * 60 }) {
  const resolvedRatio = ratio || fulfillmentRatioForSize(size);
  const manifest=await getJsonObject(manifestObjectKey(artworkId));
  const asset=manifest.fulfillmentRatios?.[resolvedRatio];
  if(!asset?.productionReady||!asset.key)throw new Error('No verified '+resolvedRatio+' production crop');
  return signedArtworkUrl(asset.key, expiresIn);
}
