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
  downloadArtworkObjectToFile,
  artworkObjectInfo,
  copyArtworkObject,
  listArtworkObjects
} from './r2.mjs';
import {
  manifestObjectKey,
  masterObjectKey,
  mockupObjectKey,
  productionObjectKey,
  productionSpecFor,
  renderProductionArtworkToFile
} from './production.mjs';
import { generateFulfillmentRatios } from './artwork-ratios.mjs';
import {inspectStoredMasterGeometry} from './master-geometry.mjs';

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

// Serialize read/modify/write operations for the same R2 artwork manifest.
const artworkManifestMutationTails = new Map();
export async function updateArtworkManifest(artworkId, mutate) {
  const id = String(artworkId || '').trim().toUpperCase();
  if (!id || typeof mutate !== 'function') throw Error('Artwork ID and manifest mutation are required.');
  const prior = artworkManifestMutationTails.get(id) || Promise.resolve();
  const work = prior.then(async () => {
    const current = await loadArtworkManifest(id);
    if (!current) throw Error('Artwork manifest is missing: ' + id);
    const result = await mutate(current);
    await saveArtworkManifest(current);
    return result === undefined ? current : result;
  });
  const settled = work.catch(() => {});
  artworkManifestMutationTails.set(id, settled);
  void settled.then(() => {
    if (artworkManifestMutationTails.get(id) === settled) artworkManifestMutationTails.delete(id);
  });
  return work;
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
// The master's file extension and type, as a reservation stores them.
export const artworkFileExtension = filename => extensionFromFilename(filename);
export const artworkContentType = (value, filename) => normalizeContentType(value, filename);

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

// Serializes ID allocation + manifest creation across simultaneous tabs/listings.
 // All consumers (converter and product creator) share this lock on one server instance.
// The master is uploaded as soon as it is picked, before any artwork ID or
// folder exists: it waits under staging/ and is moved into artworks/<ID>/ when
// the Etsy draft is created. Staged masters never used are removed after 3 days.
const STAGING_PREFIX = 'staging/';
const STAGED_MASTER_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
const stagedMasterKey = (stageId, ext) => {
  if (!/^[a-f0-9-]{36}$/.test(String(stageId || ''))) throw new Error('Invalid staged master ID');
  return STAGING_PREFIX + stageId + '/master.' + String(ext || 'jpg').replace(/[^a-z0-9]/g, '');
};
// Where a staged master waits (the batch poster renders mockups from it).
export const stagedMasterObjectKey = (stageId, filename) => stagedMasterKey(stageId, extensionFromFilename(filename));
export async function stageMasterUpload({ filename, contentType, size } = {}) {
  if (!filename) throw new Error('A master artwork file is required');
  if (!(Number(size) > 0)) throw new Error('The master artwork size is required');
  const stageId = randomUUID();
  const key = stagedMasterKey(stageId, extensionFromFilename(filename));
  const type = normalizeContentType(contentType, filename);
  return { stageId, key, contentType: type, uploadUrl: await signedArtworkUploadUrl(key, type) };
}
export async function pruneStagedMasters(now = Date.now()) {
  let removed = 0;
  for (const object of await listArtworkObjects(STAGING_PREFIX)) {
    if (object.lastModified && now - object.lastModified.getTime() > STAGED_MASTER_MAX_AGE_MS) {
      await deleteArtworkObject(object.key).catch(() => {});
      removed += 1;
    }
  }
  return removed;
}

let artworkReservationTail=Promise.resolve();
export async function reserveArtworkUpload(input){
 const task=artworkReservationTail.then(()=>reserveArtworkUploadUnlocked(input));
 artworkReservationTail=task.catch(()=>{});
 return task;
}
async function reserveArtworkUploadUnlocked({
  title = '',
  orientation = 'portrait',
  master,
  mockups = [],
  stagedMaster = null
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

  // A master already uploaded to staging is copied in place (server side) instead
  // of being uploaded again; any problem falls back to a normal upload.
  let masterAlreadyUploaded = false;
  if (stagedMaster?.stageId) {
    try {
      const staged = stagedMasterKey(stagedMaster.stageId, masterExt);
      const info = await artworkObjectInfo(staged);
      if (master.size && info.size !== Number(master.size)) throw new Error('Staged master size does not match');
      await copyArtworkObject(staged, masterKey);
      await deleteArtworkObject(staged).catch(() => {});
      masterAlreadyUploaded = true;
    } catch {}
  }
  const masterUploadUrl = masterAlreadyUploaded ? null : await signedArtworkUploadUrl(masterKey, masterType);
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
        uploadUrl: masterUploadUrl,
        alreadyUploaded: masterAlreadyUploaded
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

  // R2 pixel metadata is authoritative. A user dropdown must never turn a
  // horizontal master into vertical fulfillment crop files.
  const geometry=await inspectStoredMasterGeometry(manifest.master.key);
  const priorOrientation=String(manifest.orientation||'').toLowerCase();
  if(priorOrientation!==geometry.orientation){
    // Old wrong-orientation assets must not be served as production-ready.
    manifest.fulfillmentRatiosReady=false;
    manifest.fulfillmentRatios={};
    manifest.fulfillmentSizeCrops={};
    manifest.fulfillmentRatioInsufficient={};
    manifest.cropWorkerJobId=null;
    manifest.fulfillmentRatiosUpdatedAt=null;
  }
  manifest.orientation=geometry.orientation;
  manifest.master.width=geometry.width;
  manifest.master.height=geometry.height;
  manifest.master.orientation=geometry.orientation;
  manifest.master.orientationVerifiedAt=new Date().toISOString();
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
  urlExpiresIn = 6 * 60 * 60,
  onProgress = () => {}
}) {
  const manifest = await loadArtworkManifest(artworkId);
  if (!manifest?.master?.key) {
    throw new Error(`Artwork ${artworkId} has no master file configured`);
  }

  const outputKey = productionObjectKey({ artworkId, format, size, orientation });
  const spec = productionSpecFor({ format, size, orientation });

  if (!(await artworkObjectExists(outputKey))) {
    onProgress('Waiting for the production renderer');
    await withProductionRenderSlot(async () => {
      // Re-check after waiting for the render slot so concurrent requests for the
      // same asset never render the same large production file twice.
      if (await artworkObjectExists(outputKey)) return;

      const token = randomUUID();
      const sourcePath = join(tmpdir(), `jac-source-${token}`);
      const outputPath = join(tmpdir(), `jac-production-${token}.jpg`);
      try {
        onProgress('Downloading original artwork from Cloudflare R2');
        // Large canvas files can exceed hundreds of megapixels. Stream the R2
        // master to disk, let libvips render directly to a temp JPEG, then stream
        // that file back to R2. This avoids holding both source and rendered
        // production images in Node buffers and prevents Render OOM/502 crashes.
        await downloadArtworkObjectToFile(manifest.master.key, sourcePath);
        onProgress('Rendering canvas and mirrored 1.25-inch edges');
        await renderProductionArtworkToFile({
          input: sourcePath,
          outputPath,
          format,
          size,
          orientation
        });
        onProgress('Uploading production canvas to Cloudflare R2');
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
  } else {
    onProgress('Reusing a previously generated R2 production file');
  }

  onProgress('Verifying the R2 production-file reference');
  await updateArtworkManifest(artworkId,current=>{
    if(current.master?.key!==manifest.master.key)
      throw Error('Master artwork changed while preparing a production image.');
    current.production ||= {};
    current.production[`${format}|${size}|${orientation}`] = {
      key: outputKey,spec,updatedAt:new Date().toISOString()
    };
  });

  return {
    key: outputKey,
    spec,
    url: await signedArtworkUrl(outputKey, urlExpiresIn)
  };
}

export async function generateArtworkFulfillmentRatios(artworkId) {
  const manifest = await loadArtworkManifest(artworkId);
  if (!manifest?.master?.key) throw new Error(`Artwork ${artworkId} has no master file configured`);

  const generated = await withProductionRenderSlot(() => generateFulfillmentRatios({
    artworkId,
    masterKey: manifest.master.key,
    orientation: manifest.orientation,
    master: manifest.master
  }));

  manifest.fulfillmentRatios = generated.assets;
  manifest.fulfillmentRatioInsufficient = generated.insufficient;
  manifest.fulfillmentRatiosReady = generated.ready;
  manifest.fulfillmentRatiosUpdatedAt = new Date().toISOString();
  await saveArtworkManifest(manifest);

  return {
    artworkId,
    ready: generated.ready,
    ratios: generated.assets,
    insufficient: generated.insufficient
  };
}

export async function cancelArtworkUpload(artworkId) {
  const manifest = await loadArtworkManifest(artworkId);
  const keys = [
    manifest?.master?.key,
    ...(manifest?.mockups || []).map((item) => item.key),
    ...(Object.values(manifest?.production || {}).map((item) => item.key)),
    ...(Object.values(manifest?.fulfillmentRatios || {}).map((item) => item.key)),
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
