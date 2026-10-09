import fs from 'node:fs';
import { createWriteStream, createReadStream } from 'node:fs';
import { open, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  APP_CONNECTIONS,
  IDLE_EXIT_MS,
  POLL_INTERVAL_MS,
  WORKER_ID,
  validateWorkerConfig
} from './config.mjs';
import { apiFor } from './api.mjs';
import {rotatingApps,heartbeatFor} from './worker-scheduling.mjs';
import {
  generateProductionCrop,
  inspectMaster,
  validateRatioSource
} from './crop.mjs';

const LOCK_PATH = path.join(os.tmpdir(), 'pod-crop-worker.lock');
const tempPaths = new Set();
const clients = new Map();
let lastWorkAt = Date.now();
let busy = false;
let stopping = false;
let nextAppIndex = 0;
let activeJob = null;
let heartbeatInFlight = false;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function clientFor(app) {
  if (!clients.has(app.appUrl)) clients.set(app.appUrl, apiFor(app));
  return clients.get(app.appUrl);
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
    console.log('Shared POD Crop Worker is already running.');
    process.exit(0);
  }

  await rm(LOCK_PATH, { force: true });
  const handle = await open(LOCK_PATH, 'wx');
  await handle.writeFile(String(process.pid));
  await handle.close();
}

async function cleanup() {
  for (const tempPath of tempPaths) {
    await rm(tempPath, { force: true }).catch(() => {});
  }
  tempPaths.clear();
  await rm(LOCK_PATH, { force: true }).catch(() => {});
}

async function downloadToFile(url, extension = '.jpg') {
  const outputPath = path.join(
    os.tmpdir(),
    `pod-crop-master-${crypto.randomUUID()}${extension}`
  );
  tempPaths.add(outputPath);

  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Master download failed (HTTP ${response.status}).`);
  }
  await pipeline(
    Readable.fromWeb(response.body),
    createWriteStream(outputPath)
  );
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
    throw new Error(
      `R2 upload failed (HTTP ${response.status})${detail ? ': ' + detail : ''}`
    );
  }
  return info.size;
}

async function processJob(app, job) {
  const api = clientFor(app);
  lastWorkAt = Date.now();
  let masterPath = '';

  try {
    await api.updateProgress(job.id, {
      status: 'processing',
      progress: 2,
      message: 'Downloading master artwork'
    });

    const extension = path.extname(new URL(job.masterDownloadUrl).pathname) || '.jpg';
    masterPath = await downloadToFile(job.masterDownloadUrl, extension);
    const master = await inspectMaster(masterPath, job.orientation);

    for (const ratio of job.ratios) {
      validateRatioSource(master, ratio, job.targets?.[ratio]);
    }

    const completedRatios = [];
    const assets = {};

    for (let index = 0; index < job.ratios.length; index += 1) {
      const ratio = job.ratios[index];
      const outputPath = path.join(
        os.tmpdir(),
        `pod-crop-${job.artworkId}-${ratio}-${crypto.randomUUID()}.jpg`
      );
      tempPaths.add(outputPath);

      const baseProgress = 5 + Math.round((index / job.ratios.length) * 85);
      await api.updateProgress(job.id, {
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

      await api.updateProgress(job.id, {
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
        upscaled: crop.upscaled === true
      };

      await rm(outputPath, { force: true }).catch(() => {});
      tempPaths.delete(outputPath);
      lastWorkAt = Date.now();
    }

    await api.completeJob(job.id, assets);
    console.log(`[${app.name}] Completed ${job.artworkId}: ${job.id}`);
  } catch (error) {
    console.error(`[${app.name}] Crop job ${job.id} failed:`, error.message);
    await api.failJob(job.id, error).catch(() => {});
  } finally {
    if (masterPath) {
      await rm(masterPath, { force: true }).catch(() => {});
      tempPaths.delete(masterPath);
    }
    lastWorkAt = Date.now();
  }
}

async function heartbeatAll(){
  if(heartbeatInFlight)return;
  heartbeatInFlight=true;
  try{
    await Promise.allSettled(APP_CONNECTIONS.map(async app=>{
      try{await clientFor(app).heartbeat(heartbeatFor(app,activeJob));}
      catch(error){console.error('['+app.name+'] heartbeat failed:',error.message);}
    }));
  }finally{heartbeatInFlight=false;}
}
async function pollOnce(){
  if(busy||stopping)return;
  busy=true;
  try{
    const cycle=rotatingApps(APP_CONNECTIONS,nextAppIndex);
    if(APP_CONNECTIONS.length)nextAppIndex=(nextAppIndex+1)%APP_CONNECTIONS.length;
    for(const app of cycle){
      if(stopping)break;
      try{
        const api=clientFor(app);
        const result=await api.claimJob();
        if(!result.job)continue;
        activeJob={app,job:result.job};
        await heartbeatAll();
        try{await processJob(app,result.job);}
        finally{
          activeJob=null;
          // All three dashboards remain online, including when another shop finishes.
          await heartbeatAll();
        }
        break;
      }catch(error){console.error('['+app.name+'] Poll failed:',error.message);}
    }
  }finally{busy=false;}
}
async function main(){
  validateWorkerConfig();
  await acquireSingleInstance();
  process.on('SIGINT',()=>{stopping=true;});
  process.on('SIGTERM',()=>{stopping=true;});
  process.on('exit',()=>{try{fs.rmSync(LOCK_PATH,{force:true});}catch{}});
  console.log('Shared POD Crop Worker online as '+WORKER_ID+' for: '+
    APP_CONNECTIONS.map(app=>app.name).join(', '));
  await heartbeatAll();
  // A crop can take many minutes; keep every Render dashboard connected during it.
  const ticker=setInterval(()=>{if(!stopping)void heartbeatAll();},8000);
  ticker.unref();
  try{
    while(!stopping){
      await pollOnce();
      if(IDLE_EXIT_MS>0&&!busy&&Date.now()-lastWorkAt>=IDLE_EXIT_MS){
        console.log('Shared crop worker exiting after explicitly configured idle limit.');
        break;
      }
      await sleep(POLL_INTERVAL_MS);
    }
  }finally{
    clearInterval(ticker);
    await cleanup();
  }
}

main().catch(async error => {
  console.error(error.message);
  await cleanup();
  process.exit(1);
});
