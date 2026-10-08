import crypto from 'node:crypto';
import { getJsonObject, putJsonObject, isMissingR2Object } from './r2.mjs';
import { FULFILLMENT_RATIOS } from './artwork-ratios.mjs';

const DEFAULT_STORE_KEY = 'state/crop-jobs.json';
const ACTIVE_STATUSES = new Set(['pending', 'claimed', 'processing', 'uploading']);
const STALE_JOB_MS = 45 * 60 * 1000;
const MAX_STORED_JOBS = 150;

let mutationTail = Promise.resolve();

function storeKey() {
  return String(process.env.CROP_JOB_STORE_R2_KEY || DEFAULT_STORE_KEY).trim() || DEFAULT_STORE_KEY;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function nowIso(now = new Date()) {
  return now.toISOString();
}

function normalizeArtworkId(raw) {
  const value = String(raw || '').trim().toUpperCase();
  if (/^SAC\d+$/.test(value)) return value;
  throw new Error('Artwork ID must look like SAC0001');
}

function normalizeOrientation(raw) {
  const value = String(raw || '').trim().toLowerCase();
  if (value === 'landscape' || value === 'horizontal') return 'landscape';
  if (value === 'portrait' || value === 'vertical' || !value) return 'portrait';
  if (value === 'square') {
    throw new Error('Silvia square fulfillment ratios are not configured yet.');
  }
  throw new Error('Artwork orientation must be portrait or landscape.');
}

function normalizeStore(raw) {
  return {
    version: 1,
    jobs: Array.isArray(raw?.jobs) ? raw.jobs : []
  };
}

export async function readCropJobStore(readObject=getJsonObject) {
  try {
    return normalizeStore(await readObject(storeKey()));
  } catch (error) {
    if (isMissingR2Object(error)) return { version: 1, jobs: [] };
    throw error;
  }
}
async function readStore() { return readCropJobStore(); }

async function writeStore(store) {
  const jobs = [...(store.jobs || [])]
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    .slice(0, MAX_STORED_JOBS);
  await putJsonObject(storeKey(), { version: 1, jobs });
  return { version: 1, jobs };
}

function withMutation(fn) {
  const run = mutationTail.then(fn, fn);
  mutationTail = run.catch(() => {});
  return run;
}

export function createCropJobRecord({
  artworkId,
  masterKey,
  orientation = 'portrait'
}, now = new Date()) {
  const id = normalizeArtworkId(artworkId);
  const key = String(masterKey || '').trim();
  if (!key) throw new Error('Stored master artwork is required before queueing crops');
  if (!key.startsWith(`artworks/${id}/`)) {
    throw new Error('Stored master artwork does not match the selected Artwork ID');
  }

  const safeOrientation = normalizeOrientation(orientation);
  const timestamp = nowIso(now);

  return {
    id: `crop_${crypto.randomUUID()}`,
    artworkId: id,
    orientation: safeOrientation,
    masterKey: key,
    ratios: [...FULFILLMENT_RATIOS],
    status: 'pending',
    workerId: '',
    currentRatio: '',
    completedRatios: [],
    progress: 0,
    message: 'Waiting for Silvia crop workstation',
    resultAssets: {},
    error: '',
    createdAt: timestamp,
    updatedAt: timestamp,
    claimedAt: '',
    completedAt: ''
  };
}

export function reclaimStaleJobs(store, now = new Date()) {
  const threshold = now.getTime() - STALE_JOB_MS;
  for (const job of store.jobs || []) {
    if (!['claimed', 'processing', 'uploading'].includes(job.status)) continue;
    const updated = Date.parse(job.updatedAt || 0);
    if (Number.isFinite(updated) && updated < threshold) {
      job.status = 'pending';
      job.workerId = '';
      job.currentRatio = '';
      job.message = 'Worker lease expired; waiting for workstation';
      job.updatedAt = nowIso(now);
    }
  }
  return store;
}

export function claimPendingJob(store, workerId, now = new Date()) {
  reclaimStaleJobs(store, now);
  const worker = String(workerId || '').trim();
  if (!worker) throw new Error('workerId is required');

  const job = (store.jobs || [])
    .filter(item => item.status === 'pending')
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))[0];

  if (!job) return null;

  job.status = 'claimed';
  job.workerId = worker;
  job.claimedAt = nowIso(now);
  job.updatedAt = nowIso(now);
  job.message = 'Claimed by Silvia crop workstation';
  return job;
}

export function findReusableCropJob(store, input = {}) {
  const artworkId = normalizeArtworkId(input.artworkId);
  const orientation = normalizeOrientation(input.orientation);
  const masterKey = String(input.masterKey || '').trim();

  return (store?.jobs || []).find(job =>
    job.artworkId === artworkId &&
    ACTIVE_STATUSES.has(job.status) &&
    normalizeOrientation(job.orientation) === orientation &&
    String(job.masterKey || '') === masterKey
  ) || null;
}

export async function createCropJob(input) {
  return withMutation(async () => {
    const store = reclaimStaleJobs(await readStore());
    const existing = findReusableCropJob(store, input);
    if (existing) return { job: clone(existing), reused: true };

    const job = createCropJobRecord(input);
    store.jobs.push(job);
    await writeStore(store);
    return { job: clone(job), reused: false };
  });
}

export async function getCropJob(jobId) {
  const id = String(jobId || '').trim();
  if (!id) return null;
  const store = reclaimStaleJobs(await readStore());
  const job = store.jobs.find(item => item.id === id);
  return job ? clone(job) : null;
}

export async function claimNextCropJob(workerId) {
  return withMutation(async () => {
    const store = await readStore();
    const job = claimPendingJob(store, workerId);
    if (!job) return null;
    await writeStore(store);
    return clone(job);
  });
}

export async function updateCropJobProgress(jobId, workerId, patch = {}) {
  return withMutation(async () => {
    const store = await readStore();
    const job = store.jobs.find(item => item.id === String(jobId || '').trim());
    if (!job) throw new Error('Crop job not found');
    if (job.workerId && job.workerId !== String(workerId || '').trim()) {
      throw new Error('Crop job is claimed by another worker');
    }
    if (['completed', 'failed'].includes(job.status)) return clone(job);

    const allowedStatus = ['claimed', 'processing', 'uploading'];
    if (allowedStatus.includes(String(patch.status || ''))) job.status = patch.status;
    if (patch.currentRatio && FULFILLMENT_RATIOS.includes(patch.currentRatio)) {
      job.currentRatio = patch.currentRatio;
    }
    if (Array.isArray(patch.completedRatios)) {
      job.completedRatios = [...new Set(
        patch.completedRatios.filter(ratio => FULFILLMENT_RATIOS.includes(ratio))
      )];
    }
    if (Number.isFinite(Number(patch.progress))) {
      job.progress = Math.max(0, Math.min(100, Math.round(Number(patch.progress))));
    }
    if (patch.message) job.message = String(patch.message).slice(0, 500);
    job.updatedAt = nowIso();
    await writeStore(store);
    return clone(job);
  });
}

export async function completeCropJob(jobId, workerId, assets) {
  return withMutation(async () => {
    const store = await readStore();
    const job = store.jobs.find(item => item.id === String(jobId || '').trim());
    if (!job) throw new Error('Crop job not found');
    if (job.workerId && job.workerId !== String(workerId || '').trim()) {
      throw new Error('Crop job is claimed by another worker');
    }

    job.status = 'completed';
    job.resultAssets = clone(assets || {});
    job.completedRatios = [...(job.ratios || FULFILLMENT_RATIOS)];
    job.progress = 100;
    job.currentRatio = '';
    job.message = 'Production crops complete';
    job.error = '';
    job.updatedAt = nowIso();
    job.completedAt = job.updatedAt;
    await writeStore(store);
    return clone(job);
  });
}

export async function failCropJob(jobId, workerId, error) {
  return withMutation(async () => {
    const store = await readStore();
    const job = store.jobs.find(item => item.id === String(jobId || '').trim());
    if (!job) throw new Error('Crop job not found');
    if (job.workerId && job.workerId !== String(workerId || '').trim()) {
      throw new Error('Crop job is claimed by another worker');
    }

    job.status = 'failed';
    job.error = String(error || 'Crop worker failed').slice(0, 1000);
    job.message = job.error;
    job.updatedAt = nowIso();
    await writeStore(store);
    return clone(job);
  });
}
