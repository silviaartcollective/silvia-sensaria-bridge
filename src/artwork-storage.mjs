import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import {
  artworkObjectExists,
  getJsonObject,
  putArtworkFile,
  putJsonObject,
  signedArtworkUrl,
  signedArtworkUploadUrl,
  nextArtworkId,
  deleteArtworkObject,
  downloadArtworkObjectToFile
} from './r2.mjs';
import {
  manifestObjectKey,
  masterObjectKey,
  mockupObjectKey,
  productionObjectKey,
  productionSpecFor,
  renderProductionArtworkToFile
} from './production.mjs';

let productionRenderTail = Promise.resolve();

async function withProductionRenderSlot(task) {
  const run = productionRenderTail.then(task, task);
  productionRenderTail = run.catch(() => {});
  return run;
}

export async function loadArtworkManifest(artworkId) {
  return getJsonObject(manifestObjectKey(artworkId));
}

export async function saveArtworkManifest(manifest) {
  if (!manifest?.artworkId) throw new Error('Artwork manifest is missing artworkId');
  manifest.updatedAt = new Date().toISOString();
  if (!manifest.createdAt) manifest.createdAt = manifest.updatedAt;
  await putJsonObject(manifestObjectKey(manifest.artworkId), manifest);
  return manifest;
}

function extensionFromFilename(filename, fallback = 'jpg') {
  const match = String(filename || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] || fallback;
}

function normalizeContentType(value, filename) {
  const provided = String(value || '').trim().toLowerCase();
  if (provided) return provided;
  const ext = extensionFromFilename(filename);
  return ({
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    tif: 'image/tiff',
    tiff: 'image/tiff',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    m4v: 'video/x-m4v'
  })[ext] || 'application/octet-stream';
}

function mockupSortOrder(filename, fallbackIndex) {
  const normalized = String(filename || '').toLowerCase().trim();
  const numbered = normalized.match(/(?:^|[_\-\s])(\d{1,2})(?=\.[^.]+$)/);
  if (numbered) return Number(numbered[1]);
  if (/^choose\s+option\.(?:jpe?g|png|webp)$/i.test(normalized)) return 15;
  if (/^choose\s+frame\.(?:jpe?g|png|webp)$/i.test(normalized)) return 16;
  if (/^promotion\.(?:jpe?g|png|webp)$/i.test(normalized)) return 17;
  if (/^video\.(?:mp4|mov|m4v)$/i.test(normalized)) return 18;
  return 1000 + fallbackIndex;
}

export async function reserveArtworkUpload({
  title = '',
  orientation = 'portrait',
  master,
  mockups = []
}) {
  if (!master?.filename) throw new Error('A master artwork file is required');
  if (!Array.isArray(mockups)) throw new Error('Mockups must be an array');
  if (mockups.length > 20) throw new Error('A maximum of 20 mockups can be uploaded at once');

  const artworkId = await nextArtworkId();
  const masterExt = extensionFromFilename(master.filename);
  const masterKey = masterObjectKey(artworkId, masterExt);
  const masterType = normalizeContentType(master.contentType, master.filename);

  const sortedMockups = [...mockups]
    .map((item, originalIndex) => ({
      ...item,
      originalIndex,
      sortOrder: mockupSortOrder(item.filename, originalIndex)
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.originalIndex - b.originalIndex);

  const mockupEntries = sortedMockups.map((item, index) => {
    const ext = extensionFromFilename(item.filename);
    const contentType = normalizeContentType(item.contentType, item.filename);
    return {
      index,
      sortOrder: item.sortOrder,
      originalIndex: item.originalIndex,
      originalFilename: String(item.filename || ''),
      key: mockupObjectKey(artworkId, index, ext),
      contentType,
      size: Number(item.size || 0) || null
    };
  });

  const manifest = {
    artworkId,
    title: String(title || '').trim(),
    orientation: String(orientation || 'portrait').trim().toLowerCase(),
    status: 'uploading',
    master: {
      originalFilename: String(master.filename),
      key: masterKey,
      contentType: masterType,
      size: Number(master.size || 0) || null
    },
    mockups: mockupEntries,
    production: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  await saveArtworkManifest(manifest);

  const masterUploadUrl = await signedArtworkUploadUrl(masterKey, masterType);
  const mockupUploads = await Promise.all(
    mockupEntries.map(async (item) => ({
      ...item,
      uploadUrl: await signedArtworkUploadUrl(item.key, item.contentType)
    }))
  );

  return {
    artworkId,
    manifest,
    uploads: {
      master: {
        key: masterKey,
        contentType: masterType,
        uploadUrl: masterUploadUrl
      },
      mockups: mockupUploads
    }
  };
}

export async function completeArtworkUpload(artworkId) {
  const manifest = await loadArtworkManifest(artworkId);
  if (!manifest?.master?.key) throw new Error(`Artwork ${artworkId} has no master key`);

  const masterReady = await artworkObjectExists(manifest.master.key);
  if (!masterReady) throw new Error('Master artwork has not finished uploading to R2');

  const missingMockups = [];
  for (const mockup of manifest.mockups || []) {
    if (!(await artworkObjectExists(mockup.key))) missingMockups.push(mockup.key);
  }
  if (missingMockups.length) {
    throw new Error(`${missingMockups.length} mockup upload(s) have not finished`);
  }

  manifest.status = 'ready';
  manifest.uploadCompletedAt = new Date().toISOString();
  await saveArtworkManifest(manifest);
  return manifest;
}

export async function ensureProductionAsset({
  artworkId,
  format,
  size,
  orientation,
  urlExpiresIn = 6 * 60 * 60
}) {
  const manifest = await loadArtworkManifest(artworkId);
  if (!manifest?.master?.key) {
    throw new Error(`Artwork ${artworkId} has no master file configured`);
  }

  const outputKey = productionObjectKey({ artworkId, format, size, orientation });
  const spec = productionSpecFor({ format, size, orientation });

  if (!(await artworkObjectExists(outputKey))) {
    await withProductionRenderSlot(async () => {
      // Re-check after waiting for the render slot so concurrent requests for the
      // same asset never render the same large production file twice.
      if (await artworkObjectExists(outputKey)) return;

      const token = randomUUID();
      const sourcePath = join(tmpdir(), `jac-source-${token}`);
      const outputPath = join(tmpdir(), `jac-production-${token}.jpg`);
      try {
        // Large canvas files can exceed hundreds of megapixels. Stream the R2
        // master to disk, let libvips render directly to a temp JPEG, then stream
        // that file back to R2. This avoids holding both source and rendered
        // production images in Node buffers and prevents Render OOM/502 crashes.
        await downloadArtworkObjectToFile(manifest.master.key, sourcePath);
        await renderProductionArtworkToFile({
          input: sourcePath,
          outputPath,
          format,
          size,
          orientation
        });
        await putArtworkFile({
          key: outputKey,
          filePath: outputPath,
          contentType: 'image/jpeg'
        });
      } finally {
        await Promise.allSettled([
          rm(sourcePath, { force: true }),
          rm(outputPath, { force: true })
        ]);
      }
    });
  }

  manifest.production ||= {};
  manifest.production[`${format}|${size}|${orientation}`] = {
    key: outputKey,
    spec,
    updatedAt: new Date().toISOString()
  };
  await saveArtworkManifest(manifest);

  return {
    key: outputKey,
    spec,
    url: await signedArtworkUrl(outputKey, urlExpiresIn)
  };
}

export async function cancelArtworkUpload(artworkId) {
  const manifest = await loadArtworkManifest(artworkId);
  const keys = [
    manifest?.master?.key,
    ...(manifest?.mockups || []).map((item) => item.key),
    ...(Object.values(manifest?.production || {}).map((item) => item.key)),
    manifestObjectKey(artworkId)
  ].filter(Boolean);

  for (const key of keys) {
    try {
      await deleteArtworkObject(key);
    } catch {
      // Best effort cleanup; stale partial objects should not block a new reservation.
    }
  }
  return { artworkId, deleted: keys.length };
}
