import fs from 'node:fs';
import { createWriteStream, createReadStream } from 'node:fs';
import { open, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { APP_URL, IDLE_EXIT_MS, POLL_INTERVAL_MS, WORKER_ID, validateWorkerConfig } from './config.mjs';
import { claimJob, completeJob, failJob, heartbeat, updateProgress } from './api.mjs';
import { generateProductionCrop, inspectMaster, validateRatioSource } from './crop.mjs';

const LOCK_PATH = path.join(os.tmpdir(), 'silvia-crop-worker-'+crypto.createHash('sha256').update(APP_URL).digest('hex').slice(0,12)+'.lock');
const tempPaths = new Set();
let lastWorkAt = Date.now();
let busy = false;
let stopping = false;
let activeJobId = '';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function processExists(pid) {
  const number = Number(pid);
  if (!Number.isInteger(number) || number <= 0) return false;
  try {
    process.kill(number, 0);
    return true;
  } catch {
    return false;
  }
}

async function acquireSingleInstance() {
  try {
    const handle = await open(LOCK_PATH, 'wx');
    await handle.writeFile(String(process.pid));
    await handle.close();
    return;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }

  let oldPid = '';
  try { oldPid = (await readFile(LOCK_PATH, 'utf8')).trim(); } catch {}
  if (await processExists(oldPid)) {
    console.log('Silvia Crop Worker is already running.');
    process.exit(0);
  }

  await rm(LOCK_PATH, { force: true });
  const handle = await open(LOCK_PATH, 'wx');
  await handle.writeFile(String(process.pid));
  await handle.close();
}

async function cleanup() {
  for (const tempPath of tempPaths) await rm(tempPath, { force: true }).catch(() => {});
  tempPaths.clear();
  await rm(LOCK_PATH, { force: true }).catch(() => {});
}

async function downloadToFile(url, extension = '.jpg') {
  const outputPath = path.join(os.tmpdir(), `silvia-master-${crypto.randomUUID()}${extension}`);
  tempPaths.add(outputPath);

  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`Master download failed (HTTP ${response.status}).`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(outputPath));
  return outputPath;
}

async function uploadFile(url, filePath) {
  const info = await stat(filePath);
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'image/jpeg',
      'Content-Length': String(info.size)
    },
    body: createReadStream(filePath),
    duplex: 'half'
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 300);
    throw new Error(`R2 upload failed (HTTP ${response.status})${detail ? ': ' + detail : ''}`);
  }
  return info.size;
}

async function processJob(job) {
  lastWorkAt = Date.now();
  let masterPath = '';

  try {
    await updateProgress(job.id, { status: 'processing', progress: 2, message: 'Downloading master artwork' });
    const extension = path.extname(new URL(job.masterDownloadUrl).pathname) || '.jpg';
    masterPath = await downloadToFile(job.masterDownloadUrl, extension);
    const master = await inspectMaster(masterPath, job.orientation);

    for (const ratio of job.ratios) validateRatioSource(master, ratio, job.targets?.[ratio]);

    const completedRatios = [];
    const assets = {};

    for (let index = 0; index < job.ratios.length; index += 1) {
      const ratio = job.ratios[index];
      const outputPath = path.join(os.tmpdir(), `silvia-${job.artworkId}-${ratio}-${crypto.randomUUID()}.jpg`);
      tempPaths.add(outputPath);
      const baseProgress = 5 + Math.round((index / job.ratios.length) * 85);

      await updateProgress(job.id, {
        status: 'processing',
        currentRatio: ratio,
        completedRatios,
        progress: baseProgress,
        message: `Generating ${ratio} production crop (${index + 1}/${job.ratios.length})`
      });

      const crop = await generateProductionCrop({
        masterPath,
        outputPath,
        master,
        ratio,
        target: job.targets?.[ratio]
      });

      await updateProgress(job.id, {
        status: 'uploading',
        currentRatio: ratio,
        completedRatios,
        progress: baseProgress + 10,
        message: `Uploading ${ratio} production crop`
      });

      const sizeBytes = await uploadFile(job.uploadUrls[ratio], outputPath);
      completedRatios.push(ratio);
      assets[ratio] = {
        width: crop.width,
        height: crop.height,
        sizeBytes,
        density: crop.density,
        upscaled: crop.upscaled
      };

      await rm(outputPath, { force: true }).catch(() => {});
      tempPaths.delete(outputPath);
      lastWorkAt = Date.now();
    }

    await completeJob(job.id, assets);
    console.log(`Completed ${job.artworkId}: ${job.id}`);
  } catch (error) {
    console.error(`Crop job ${job.id} failed:`, error.message);
    await failJob(job.id, error).catch(() => {});
  } finally {
    if (masterPath) {
      await rm(masterPath, { force: true }).catch(() => {});
      tempPaths.delete(masterPath);
    }
    lastWorkAt = Date.now();
  }
}

async function pollOnce() {
  if (busy || stopping) return;
  busy = true;
  try {
    await heartbeat({ busy: false });
    const result = await claimJob();
    if (result.job) {
      activeJobId = result.job.id;
      await heartbeat({ busy: true, jobId: result.job.id });
      await processJob(result.job);
    }
  } catch (error) {
    console.error('Worker poll failed:', error.message);
  } finally {
    activeJobId = '';
    busy = false;
  }
}

async function main() {
  validateWorkerConfig();
  await acquireSingleInstance();

  process.on('SIGINT', async () => { stopping = true; await cleanup(); process.exit(0); });
  process.on('SIGTERM', async () => { stopping = true; await cleanup(); process.exit(0); });
  process.on('exit', () => { try { fs.rmSync(LOCK_PATH, { force: true }); } catch {} });

  console.log(`Silvia Crop Worker online as ${WORKER_ID}.`);
  await heartbeat({ busy: false });
  // Keep the service heartbeat accurate even during long high-resolution crops.
  const heartbeatTicker = setInterval(() => {
    if(!stopping) heartbeat({busy,jobId:activeJobId}).catch(e => console.error('Heartbeat retry:', e.message));
  }, 10000);
  heartbeatTicker.unref();

  while (!stopping) {
    await pollOnce();
    if (IDLE_EXIT_MS > 0 && !busy && Date.now() - lastWorkAt >= IDLE_EXIT_MS) {
      console.log('No crop jobs pending; worker exiting after idle timeout.');
      break;
    }
    await sleep(POLL_INTERVAL_MS);
  }

  clearInterval(heartbeatTicker);
  await cleanup();
}

main().catch(async error => {
  console.error(error.message);
  await cleanup();
  process.exit(1);
});
