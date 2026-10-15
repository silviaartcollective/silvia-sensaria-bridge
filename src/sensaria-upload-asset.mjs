import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import sharp from 'sharp';
import {
  artworkObjectExists,
  downloadArtworkObjectToFile,
  putArtworkFile,
  signedArtworkUrl
} from './r2.mjs';
import {
  loadArtworkManifest,
  updateArtworkManifest,
  withProductionRenderSlot
} from './artwork-storage.mjs';

// Sensaria GO rejects RGB uploads whose longest side exceeds 17,500 px
// ("EZW1025 … File colour space is RGB and Max upload size limit is 17500px").
// The 2x3 ratio crop is stored at 12000×18000 (300 DPI at 40×60), so it needs a
// capped copy; every smaller crop is linked directly.
export const SENSARIA_MAX_UPLOAD_PX = 17500;

export function sensariaUploadKey(artworkId, size) {
  const id = String(artworkId || '').trim().toUpperCase();
  if (!/^SAC\d+$/.test(id)) throw new Error('Invalid artwork ID: ' + artworkId);
  if (!/^\d+(?:\.\d+)?x\d+(?:\.\d+)?$/.test(String(size))) throw new Error('Invalid size: ' + size);
  return 'artworks/' + id + '/fulfillment/sensaria/' + String(size).replaceAll('.', 'p') + '.jpg';
}

// Target dimensions for a capped copy, or null when the crop can be sent as is.
// The copy keeps the crop's exact aspect ratio and never exceeds either the
// Sensaria limit or the ordered size at 300 DPI.
export function sensariaUploadTarget({ width, height, size, maxPx = SENSARIA_MAX_UPLOAD_PX }) {
  const w = Number(width), h = Number(height);
  if (!(w > 0 && h > 0)) return null;
  const longest = Math.max(w, h);
  if (longest <= maxPx) return null;
  const largeInches = Math.max(...String(size).split('x').map(Number));
  const longTarget = Math.min(maxPx, Number.isFinite(largeInches) && largeInches > 0 ? Math.round(largeInches * 300) : maxPx);
  const scale = longTarget / longest;
  return {
    width: Math.max(1, Math.min(maxPx, Math.round(w * scale))),
    height: Math.max(1, Math.min(maxPx, Math.round(h * scale))),
    density: Number.isFinite(largeInches) && largeInches > 0 ? Math.floor(longTarget / largeInches) : 300
  };
}

function cropFingerprint(crop, record) {
  return [crop.key, record?.updatedAt || '', record?.sizeBytes || '', crop.width + 'x' + crop.height].join('|');
}

// Returns the R2 file Sensaria should receive for this order line: the verified
// size crop itself, or a cached capped copy of it.
export async function ensureSensariaUploadAsset({
  artworkId,
  size,
  crop,
  expiresIn = 7 * 24 * 60 * 60,
  maxPx = SENSARIA_MAX_UPLOAD_PX,
  onProgress = () => {}
}) {
  const target = sensariaUploadTarget({ width: crop.width, height: crop.height, size, maxPx });
  if (!target && crop.width && crop.height) {
    return { key: crop.key, url: crop.url, width: crop.width, height: crop.height, capped: false };
  }

  const manifest = await loadArtworkManifest(artworkId);
  const ratioRecord = manifest?.fulfillmentRatios?.[crop.ratio] || {};
  const fingerprint = cropFingerprint(crop, ratioRecord);
  const key = sensariaUploadKey(artworkId, size);
  const cached = manifest?.sensariaUploads?.[size];
  if (cached?.key === key && cached.sourceFingerprint === fingerprint &&
      cached.sourceMasterKey === manifest?.master?.key && await artworkObjectExists(key)) {
    onProgress('Reusing the Sensaria-sized copy of the ' + size + ' crop');
    return { key, url: await signedArtworkUrl(key, expiresIn), width: cached.width, height: cached.height, capped: true };
  }

  let produced = null;
  await withProductionRenderSlot(async () => {
    const token = randomUUID();
    const sourcePath = join(tmpdir(), 'sensaria-crop-' + token);
    const outputPath = join(tmpdir(), 'sensaria-upload-' + token + '.jpg');
    try {
      onProgress('Downloading the ' + size + ' crop from Cloudflare R2');
      await downloadArtworkObjectToFile(crop.key, sourcePath);
      const meta = await sharp(sourcePath, { limitInputPixels: false }).metadata();
      const rotated = [5, 6, 7, 8].includes(Number(meta.orientation || 1));
      const actualW = rotated ? meta.height : meta.width;
      const actualH = rotated ? meta.width : meta.height;
      const actualTarget = sensariaUploadTarget({ width: actualW, height: actualH, size, maxPx });
      if (!actualTarget) {
        produced = { key: crop.key, width: actualW, height: actualH, capped: false };
        return;
      }
      onProgress('Resizing the ' + size + ' crop to Sensaria\'s 17,500 px limit');
      // Baseline (non-progressive) JPEG streams row by row; progressive or
      // optimised Huffman encoding would buffer the whole image in memory.
      const info = await sharp(sourcePath, { limitInputPixels: false, sequentialRead: true, failOn: 'warning' })
        .rotate()
        .resize(actualTarget.width, actualTarget.height, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
        .toColourspace('srgb')
        .withMetadata({ density: actualTarget.density })
        .jpeg({ quality: 92, chromaSubsampling: '4:4:4', progressive: false, optimiseCoding: false })
        .toFile(outputPath);
      if (Math.max(info.width, info.height) > maxPx) {
        throw new Error('Sensaria copy is ' + info.width + '×' + info.height + '; it must not exceed ' + maxPx + ' px.');
      }
      onProgress('Uploading the Sensaria-sized copy to Cloudflare R2');
      await putArtworkFile({ key, filePath: outputPath, contentType: 'image/jpeg' });
      produced = { key, width: info.width, height: info.height, capped: true };
    } finally {
      await Promise.allSettled([rm(sourcePath, { force: true }), rm(outputPath, { force: true })]);
    }
  });

  if (produced.capped) {
    await updateArtworkManifest(artworkId, current => {
      if (current.master?.key !== manifest?.master?.key) {
        throw new Error('Master artwork changed while preparing the Sensaria copy.');
      }
      current.sensariaUploads ||= {};
      current.sensariaUploads[size] = {
        key, width: produced.width, height: produced.height,
        sourceKey: crop.key, sourceFingerprint: fingerprint,
        sourceMasterKey: current.master?.key || null,
        updatedAt: new Date().toISOString()
      };
    });
  }
  return { ...produced, url: produced.capped ? await signedArtworkUrl(key, expiresIn) : crop.url };
}
