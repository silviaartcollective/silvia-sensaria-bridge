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
  AUTO_UPDATE,
  IDLE_EXIT_MS,
  POLL_INTERVAL_MS,
  UPDATE_FROM,
  WORKER_ID,
  validateWorkerConfig
} from './config.mjs';
import { apiFor, WORKER_VERSION as WORKER_VERSION_LABEL } from './api.mjs';
import {rotatingApps,heartbeatFor} from './worker-scheduling.mjs';
import {
  generateProductionCrop,
  inspectMaster,
  validateRatioSource
} from './crop.mjs';
import {renderMockupOnPC} from './mockup-processor.mjs';
import {RENDER_THREADS,prepareInPool} from './render-pool.mjs';
import {isTemplatePrepared,preparedArtworkShape,preparedPreviewJpeg} from './native-mockup.mjs';
import {scanMockupFolder,mockupFolderFile,localPsdVersion,orientationFromShape} from './local-templates.mjs';
import {startLocalIntake} from './local-intake.mjs';
import {patchAgPsd} from './patch-ag-psd.mjs';
import {downloadCached,cachedFilePath} from './asset-cache.mjs';
import {keepForFullUpload,pendingFullUploads,dropFullUpload,sendFullUpload} from './full-uploads.mjs';
import {isTransientError,withUploadRetries} from './retry.mjs';
import {mockupArtwork} from './mockup-artwork.mjs';
import sharp from 'sharp';
import { spawn } from 'node:child_process';
import {
  LOCK_PATH, WORKER_DIR, compareVersions, downloadUpdate, recentFailure, stageUpdate, updateSource
} from './updater.mjs';

const tempPaths = new Set();
const clients = new Map();
let lastWorkAt = Date.now();
let stopping = false;
// Resolves when the worker starts stopping, to cut long waits short.
let wakeLanes = () => {};
const stopped = new Promise(resolve => { wakeLanes = resolve; });
const stop = () => { stopping = true; wakeLanes(); };
let nextAppIndex = 0, nextMockupAppIndex = 0;
let heartbeatInFlight = false;
// Crops and mockups run at the same time in separate lanes; mockups render
// RENDER_THREADS at once. `active` lists everything in progress.
const active = new Set();
const inFlightByBatch = new Map(); // appUrl|batchId -> PSDs rendering now
const mockupOwner = crypto.randomUUID();
const mockupUnsupported=new Map(); // Retry temporarily unavailable PSD endpoints.
// Server confirmations of a template's artwork layer, reused while the same
// layers are found (saves a request per mockup).
const confirmedLayers=new Map();
// Each poll is outbound bandwidth on every shop's Render service. While a batch
// has queued PSDs the next one is claimed immediately; otherwise queues are
// checked every 5 s for a minute after the last job, then every 15 s.
const MOCKUP_IDLE_POLL_MS = 5000;
const IDLE_BACKOFF_AFTER_MS = 60000, IDLE_POLL_MS = 15000;
const idlePollMs = base => Date.now() - lastWorkAt > IDLE_BACKOFF_AFTER_MS ? Math.max(base, IDLE_POLL_MS) : base;

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

  try {
    const response = await fetch(url,{signal:AbortSignal.timeout(10*60*1000)});
    if (!response.ok || !response.body)
      throw new Error('Worker source download failed (HTTP '+response.status+').');
    await pipeline(Readable.fromWeb(response.body),createWriteStream(outputPath));
    return outputPath;
  } catch (error) {
    await rm(outputPath,{force:true}).catch(()=>{});
    tempPaths.delete(outputPath);
    throw error;
  }
}

// A dropped or slow connection is retried; a refused upload (4xx) is not.
function uploadFile(url, filePath) {
  return withUploadRetries(() => uploadFileOnce(url, filePath));
}
async function uploadFileOnce(url, filePath) {
  const info = await stat(filePath);
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'image/jpeg',
      'Content-Length': String(info.size)
    },
    body: createReadStream(filePath),
    duplex: 'half',
    signal:AbortSignal.timeout(10*60*1000)
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 300);
    throw new Error(
      `R2 upload failed (HTTP ${response.status})${detail ? ': ' + detail : ''}`
    );
  }
  return info.size;
}

function uploadBuffer(url,body){
  return withUploadRetries(async()=>{
    const response=await fetch(url,{method:'PUT',headers:{'Content-Type':'image/jpeg'},body,signal:AbortSignal.timeout(2*60*1000)});
    if(!response.ok)throw new Error('R2 upload failed (HTTP '+response.status+')');
  });
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
        sourceCropWidth: crop.sourceCropWidth,
        sourceCropHeight: crop.sourceCropHeight,
        sourceMasterWidth: crop.sourceMasterWidth,
        sourceMasterHeight: crop.sourceMasterHeight,
        recommendedPixelsMet: crop.recommendedPixelsMet,
        downscaled: crop.downscaled === true,
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

// R2 progress, lease heartbeats and completion must never overwrite one another.
function serialWrites(){
 let tail=Promise.resolve();
 return task=>{
  const result=tail.then(task);
  tail=result.catch(()=>{});
  return result;
 };
}
async function processPSDJob(app,claim){
 const startedAt=Date.now();
 const timings={};
 let checkpoint=startedAt;
 const measure=key=>{const now=Date.now();timings[key]=now-checkpoint;checkpoint=now;};
 let completionRecorded=false;
 const api=clientFor(app),id=claim.job.id,itemId=claim.item.id;
 let psdPath='',artworkPath='',outputPath='';
 const queue=serialWrites();
 let alive=true;
 const keepAlive=setInterval(()=>{
  if(alive)void queue(()=>api.mockupHeartbeat(id,mockupOwner)).catch(error=>
    console.error('['+app.name+'] PSD lease renewal failed:',error.message));
 },20000);
 let lastStageWriteAt=Date.now();
 const stage=value=>{
  console.log('['+app.name+'] '+claim.item.name+': '+value);
  const now=Date.now();
  // One remote progress write can require a complete R2 JSON round trip,
  // so stage updates closer than 2.5 s apart stay local.
  // A cached template renders in about a second, so short items send no
  // progress writes at all; completion is reported separately.
  if(now-lastStageWriteAt<2500)return Promise.resolve();
  lastStageWriteAt=now;
  // Progress writes are advisory; R2 latency must not hold up rendering.
  // Completion/failure still awaits the same write queue in order.
  void queue(()=>api.mockupProgress(id,itemId,mockupOwner,value)).catch(error=>
   console.error('['+app.name+'] Non-fatal PSD progress update error:',error.message));
  return Promise.resolve();
 };
 try{
  await stage('Preparing PSD template on PC');
  let psdSize=claim.template.size,psdVersion='';
  if(claim.template.source==='pc'){
   // In this PC's mockup folder: read straight from the file (no R2 at all).
   const local=await localTemplateFile(app,claim.template);
   psdPath=local.path;psdSize=local.size;psdVersion=local.version;
  }else{
   const extension=path.extname(claim.template.name).toLowerCase()==='.psb'?'.psb':'.psd';
   const templateMeta={shop:app.appUrl,id:claim.template.id,key:claim.template.key,
    size:claim.template.size,ext:extension};
   psdPath=cachedFilePath(templateMeta);
   // A prepared template renders from its prepared data: no PSD download.
   if(!await isTemplatePrepared({psdPath,mapping:claim.template.mapping||null,psdSize:claim.template.size}))
    psdPath=(await downloadCached(claim.templateUrl,templateMeta,stage)).path;
  }
  measure('templateReadMs');
  await stage('Preparing master artwork on PC');
  const masterPath=(await downloadCached(claim.artworkUrl,{
   shop:app.appUrl,id:claim.job.id,key:claim.job.artworkKey,
   size:claim.job.artworkSize,ext:path.extname(claim.job.filename)||'.jpg'},stage)).path;
  measure('artworkReadMs');
  // Every render of the batch reads one 6000 px copy, made once, not the full master.
  artworkPath=await mockupArtwork(masterPath).catch(error=>{
   console.error('['+app.name+'] Could not make the smaller mockup artwork; using the master:',error.message);
   return masterPath;
  });
  measure('artworkShrinkMs');
  outputPath=path.join(os.tmpdir(),'pod-mockup-'+id+'-'+crypto.randomUUID()+'.jpg');
  tempPaths.add(outputPath);
  const render=await renderMockupOnPC({
   psdPath,artworkPath,outputPath,templateName:claim.template.name,mapping:claim.template.mapping||null,
   psdSize,psdVersion,
   fitMode:claim.job.fitMode||'contain',
   onStage:stage
  });
  measure('renderMs');
  const layerKey=app.appUrl+'|'+claim.template.id+'|'+(claim.template.mapping?.path||'')+'|'+JSON.stringify(render.objects||[]);
  let classification=confirmedLayers.get(layerKey);
  if(!classification){
   const inspected=await queue(()=>api.inspectMockupTemplate(itemId,render.objects));
   classification=inspected.classification||{};
   if(classification.status==='mapped'&&classification.path===render.usedMapping){
    confirmedLayers.set(layerKey,classification);
    if(confirmedLayers.size>500)confirmedLayers.delete(confirmedLayers.keys().next().value);
   }
  }
  measure('smartObjectVerificationMs');
  if(render.needsMapping||classification.status!=='mapped'||
      classification.path!==render.usedMapping){
   const why=String(render.reason||classification.reason||'Select the visible artwork Smart Object.');
   await queue(()=>api.mockupFail(id,mockupOwner,itemId,why,true));
   console.log('['+app.name+'] PSD needs artwork-layer mapping: '+claim.item.name);
   return;
  }
  await stage('Uploading and verifying '+claim.item.outputName);
  // A 900 px preview for the Product Creator and a 2400 px copy the server
  // uploads to Etsy as it is. Etsy keeps its photos in 4:2:0 colour, so the
  // Etsy copy is too (a third smaller).
  const sized=(url,side,quality,chromaSubsampling,label)=>url?sharp(outputPath).resize(side,side,{fit:'inside',withoutEnlargement:true})
   .jpeg({quality,chromaSubsampling}).toBuffer().then(body=>uploadBuffer(url,body)).then(()=>true,
    error=>{console.error('['+app.name+'] '+label+' upload failed (the full JPG is fine):',error.message);return false}):false;
  const small=Promise.all([sized(claim.output.previewUploadUrl,900,82,'4:4:4','Preview'),
   sized(claim.output.etsyUploadUrl,2400,88,'4:2:0','Etsy copy')]);
  // A shop that takes the full-size JPG later (deferFull) gets it after the
  // batch: the mockup is ready once its preview and Etsy copy are in R2.
  const deferFull=claim.output.deferFull===true;
  const [[previewUploaded,etsyUploaded]]=await Promise.all([small,deferFull?null:uploadFile(claim.output.uploadUrl,outputPath)]);
  const fullPending=deferFull&&etsyUploaded;
  if(deferFull&&!etsyUploaded)await uploadFile(claim.output.uploadUrl,outputPath);
  measure('generatedJpgR2UploadMs');
  await queue(()=>api.mockupComplete(id,mockupOwner,itemId,claim.output.key,render.usedMapping,previewUploaded,etsyUploaded,
   fullPending?{fullPending:true,dimensions:render.dimensions}:{}));
  measure('serverVerificationMs');
  completionRecorded=true;
  if(fullPending){
   const entry={appUrl:app.appUrl,jobId:id,itemId,outputKey:claim.output.key};
   try{
    await keepForFullUpload(outputPath,entry);
    tempPaths.delete(outputPath);outputPath='';requestFullUploads();
   }catch(error){
    console.error('['+app.name+'] Could not keep the full-size JPG for later; sending it now:',error.message);
    await sendFullUpload({...entry,file:outputPath},{api,upload:uploadFile}).catch(sendError=>
     console.error('['+app.name+'] Full-size JPG upload failed (downloads use the Etsy copy):',sendError.message));
   }
  }
  console.log('['+app.name+'] PSD_TIMINGS '+JSON.stringify({
   template:claim.item.name,artworkId:claim.job.artworkId||null,
   ...timings,totalMs:Date.now()-startedAt,preparedFromCache:!!render.preparedFromCache
  }));
  console.log('['+app.name+'] PSD completed '+claim.item.outputName+
   ' ('+render.dimensions.width+'x'+render.dimensions.height+', '+
   ((Date.now()-startedAt)/1000).toFixed(1)+'s total)');
 }catch(error){
  if(completionRecorded){
   // A post-completion reporting error must not downgrade a verified JPG.
   console.error('['+app.name+'] PSD mockup completed, but post-completion reporting failed '+claim.item.name+': '+error.message);
   return;
  }
  // One PSD's problem never pauses the batch: the others carry on. A
  // temporary one (a dropped connection, a render stopped for taking too
  // long) puts the PSD back in the queue; the shop gives it up to 3 tries.
  const retry=!error.nativeUnsupported&&(isTransientError(error)||/render thread stopped/i.test(error.message||''));
  console.error('['+app.name+'] PSD mockup '+(retry?'will be retried ':'failed ')+claim.item.name+': '+error.message);
  try{await queue(()=>api.mockupFail(id,mockupOwner,itemId,error,false,{retry}))}
  catch(reportError){console.error('['+app.name+'] Could not mark PSD failed:',reportError.message)}
 }finally{
  alive=false;clearInterval(keepAlive);
  const batch=app.appUrl+'|'+id,left=(inFlightByBatch.get(batch)||1)-1;
  if(left>0)inFlightByBatch.set(batch,left);else inFlightByBatch.delete(batch);
  // Other PSDs of this batch still rendering keep the batch leased.
  if(!left){
   try{await queue(()=>api.mockupRelease(id,mockupOwner))}
   catch(error){console.error('['+app.name+'] Could not release PSD batch:',error.message)}
  }
  for(const file of [outputPath]){
   if(file){
    await rm(file,{force:true}).catch(()=>{});
    tempPaths.delete(file);
   }
  }
  lastWorkAt=Date.now();
 }
}

// What a shop's dashboard should show: its own mockup, else its own crop, else
// whatever the worker is doing for another shop.
function activeFor(app){
  const list=[...active];
  return list.find(a=>a.app.appUrl===app.appUrl&&a.type==='mockup')||
    list.find(a=>a.app.appUrl===app.appUrl)||list[0]||null;
}
// Why supervise.mjs last started the worker again, sent with the heartbeats
// for a while so each shop's log shows it.
const RESTART=(()=>{try{return JSON.parse(process.env.POD_WORKER_RESTART||'null')}catch{return null}})();
const STARTED_AT=Date.now(),RESTART_REPORT_MS=15*60*1000;
async function heartbeatAll(){
  if(heartbeatInFlight)return;
  heartbeatInFlight=true;
  try{
    await Promise.allSettled(APP_CONNECTIONS.map(async app=>{
      try{
        const reply=await clientFor(app).heartbeat({...heartbeatFor(app,activeFor(app)),update:updateState,autoUpdate:AUTO_UPDATE,
          ...(RESTART&&Date.now()-STARTED_AT<RESTART_REPORT_MS?{restart:RESTART}:{}),
          mockupFolder:app.mockupFolder?{path:app.mockupFolder,count:folderStatus.get(app.appUrl)?.count||0,
            error:folderStatus.get(app.appUrl)?.error||'',fromConfig:!!app.configMockupFolder}:null});
        if(app===UPDATE_SOURCE)void considerUpdate(reply?.latestWorkerVersion);
        // The folder chosen in the Product Creator, unless config.local.json sets one.
        if(!app.configMockupFolder&&typeof reply?.mockupFolder==='string'&&reply.mockupFolder!==app.mockupFolder){
          app.mockupFolder=reply.mockupFolder;folderReports.delete(app.appUrl);folderStatus.delete(app.appUrl);
          if(app.mockupFolder)console.log('['+app.name+'] Mockup folder set in the Product Creator: '+app.mockupFolder);
          // No folder any more: the shop stops offering its PSDs.
          else void clientFor(app).localTemplates([]).catch(()=>{});
        }
      }catch(error){console.error('['+app.name+'] heartbeat failed:',error.message);}
    }));
  }finally{heartbeatInFlight=false;}
}
// Self-update. The update shop's heartbeat reply names the latest worker; a
// newer one is downloaded and checked in the background, then installed once
// nothing has run for 30 s: the lanes finish their work, update-worker.mjs takes
// over and this process exits. That installs the files, starts the new worker
// and restores this version if the new one does not stay running.
const UPDATE_SOURCE=updateSource(APP_CONNECTIONS,UPDATE_FROM);
const UPDATE_IDLE_MS=30000,UPDATE_RETRY_MS=10*60*1000;
let updateState=null,stagedUpdate=null,updateBusy=false,updateRetryAt=0,installingUpdate=null;
async function considerUpdate(latest){
  if(!AUTO_UPDATE||updateBusy||stopping||!latest||Date.now()<updateRetryAt)return;
  if(compareVersions(latest,WORKER_VERSION_LABEL)<=0||stagedUpdate?.version===latest)return;
  const failed=recentFailure(latest);
  if(failed){updateState={state:'failed',to:latest,error:failed.error};return;}
  updateBusy=true;updateState={state:'downloading',to:latest};
  try{
    const update=await downloadUpdate(UPDATE_SOURCE);
    if(compareVersions(update.version,WORKER_VERSION_LABEL)<=0){updateState=null;return;}
    stagedUpdate={version:update.version,dir:await stageUpdate(update)};
    updateState={state:'waiting',to:update.version};
    console.log('Worker v'+update.version+' downloaded; it is installed once the current work is done.');
  }catch(error){
    updateRetryAt=Date.now()+UPDATE_RETRY_MS;
    updateState={state:'failed',to:latest,error:String(error.message).slice(0,200)};
    console.error('Worker update could not be downloaded:',error.message);
  }finally{updateBusy=false;}
}
function installUpdateWhenIdle(){
  if(!stagedUpdate||stopping||active.size||Date.now()-lastWorkAt<UPDATE_IDLE_MS)return;
  installingUpdate=stagedUpdate;
  updateState={state:'restarting',to:stagedUpdate.version};
  console.log('Installing worker v'+stagedUpdate.version+'; the worker restarts in a moment.');
  void heartbeatAll();
  stop();
}
function handOverToUpdater(update){
  spawn(process.execPath,[path.join(WORKER_DIR,'update-worker.mjs'),'--apply',update.dir,'--after',String(process.pid)],
    {cwd:WORKER_DIR,detached:true,stdio:'ignore',windowsHide:true}).unref();
}
function track(entry,task){
  active.add(entry);void heartbeatAll();
  return task.finally(()=>{active.delete(entry);lastWorkAt=Date.now();void heartbeatAll();});
}

// Crop lane: one production crop at a time, never waiting for mockups.
async function claimCrop(){
  const cycle=rotatingApps(APP_CONNECTIONS,nextAppIndex);
  if(APP_CONNECTIONS.length)nextAppIndex=(nextAppIndex+1)%APP_CONNECTIONS.length;
  for(const app of cycle){
    if(stopping)return null;
    try{
      const result=await clientFor(app).claimJob();
      if(result.job)return {app,job:result.job};
    }catch(error){console.error('['+app.name+'] Crop polling failed:',error.message)}
  }
  return null;
}
async function cropLane(){
  while(!stopping){
    const claimed=await claimCrop();
    if(claimed){await track({app:claimed.app,job:claimed.job,type:'crop'},processJob(claimed.app,claimed.job));continue;}
    await sleep(idlePollMs(POLL_INTERVAL_MS));
  }
}

// Mockup lane: claims queued PSDs until every render thread is busy.
// Mockup lane: one loop per shop. Each asks for as many PSDs as there are free
// render threads; servers that support it hold the request until a batch is
// queued, so new work starts at once without polling.
const LONG_POLL_MS=25000;
async function mockupLane(){
  const running=new Set();
  const start=(app,claims)=>{
    for(const claimed of claims){
      const batch=app.appUrl+'|'+claimed.job.id;
      inFlightByBatch.set(batch,(inFlightByBatch.get(batch)||0)+1);
      const task=track({app,job:{id:claimed.job.id},type:'mockup'},processPSDJob(app,claimed)).catch(()=>{});
      running.add(task);void task.finally(()=>running.delete(task));
    }
  };
  const shopLoop=async app=>{
    while(!stopping){
      if((mockupUnsupported.get(app.appUrl)||0)>Date.now()){await sleep(5000);continue}
      if(running.size>=RENDER_THREADS){await Promise.race(running);continue}
      let claimed;
      try{claimed=await clientFor(app).claimMockup(mockupOwner,RENDER_THREADS-running.size,LONG_POLL_MS)}
      catch(error){
        // Arte Antica may not have the PSD endpoints yet. Its crop jobs still work.
        if(/404|not found|non-json/i.test(error.message)){
          mockupUnsupported.set(app.appUrl,Date.now()+60000);
          console.log('['+app.name+'] PSD API unavailable; will retry in one minute. Crop service remains enabled.');
        }else console.error('['+app.name+'] PSD polling failed:',error.message);
        await sleep(idlePollMs(MOCKUP_IDLE_POLL_MS));continue;
      }
      if(claimed.item){
        // Servers before multi-claim return one PSD at the top level.
        start(app,Array.isArray(claimed.items)&&claimed.items.length
          ?claimed.items.map(entry=>({...entry,job:claimed.job})):[claimed]);
        continue; // claim the next queued PSD straight away
      }
      // Older servers answer at once: fall back to polling.
      if(!claimed.longPoll)await Promise.race([sleep(idlePollMs(MOCKUP_IDLE_POLL_MS)),...running]);
    }
  };
  await Promise.all(APP_CONNECTIONS.map(shopLoop));
  await Promise.allSettled([...running]);
}

// Warm-up: while no mockups are rendering, prepare every saved template so a
// new artwork never waits for a PSD download or first-time preparation.
const WARM_UP_EVERY_MS=10*60*1000;
let warmUpRequested=null,requestWarmUp=()=>{};
const nextWarmUpRequest=()=>{warmUpRequested=new Promise(resolve=>{requestWarmUp=resolve})};
nextWarmUpRequest();
async function warmUpLane(){
  await Promise.race([sleep(15000),stopped]);
  while(!stopping){
    nextWarmUpRequest();
    for(const app of APP_CONNECTIONS){
      if(stopping||(mockupUnsupported.get(app.appUrl)||0)>Date.now())continue;
      let templates=[];
      try{templates=(await clientFor(app).mockupTemplates()).templates||[]}
      catch{continue} // older servers have no template list
      let prepared=0;
      for(const template of templates){
        if(stopping)break;
        // Real mockups first: wait until nothing is rendering.
        while(!stopping&&[...active].some(a=>a.type==='mockup'))await sleep(2000);
        const mapping=template.mapping||null;
        if(template.source==='pc'){
          try{if(await prepareLocalTemplate(app,template))prepared++}
          catch(error){
            // Deleted since the last scan: the next scan removes it from the shop.
            if(!error.warmUpStopped&&!/no longer in the mockup folder/.test(error.message))
              console.error('['+app.name+'] Could not prepare '+template.name+' from the mockup folder:',error.message);
          }
          continue;
        }
        const ext=path.extname(template.name).toLowerCase()==='.psb'?'.psb':'.psd';
        const meta={shop:app.appUrl,id:template.id,key:template.key,size:template.size,ext};
        try{
          const ref={psdPath:cachedFilePath(meta),mapping,psdSize:template.size};
          if(!await isTemplatePrepared(ref)){
            const psdPath=(await downloadCached(template.url,meta)).path;
            await prepareInPool({psdPath,mapping,psdSize:template.size});
            prepared++;
          }
          await sendTemplatePreview(app,template,ref,'r2:'+template.key);
        }catch(error){if(!error.warmUpStopped)console.error('['+app.name+'] Could not prepare '+template.name+' in advance:',error.message)}
      }
      if(prepared)console.log('['+app.name+'] Prepared '+prepared+' PSD template(s) in advance.');
    }
    // A changed mockup folder is prepared straight away.
    await Promise.race([sleep(WARM_UP_EVERY_MS),stopped,warmUpRequested]);
  }
}

// ---------------------------------------------------- full-size JPGs
// Mockups reported ready send their full-size JPG here, oldest first and one
// at a time, once the worker has had nothing else to do for a few seconds, so
// renders, crops and Etsy copies never wait behind them. Resumed after a restart.
const FULL_UPLOAD_QUIET_MS=3000;
let requestFullUploads=()=>{},fullUploadsRequested=null;
const nextFullUploadRequest=()=>{fullUploadsRequested=new Promise(resolve=>{requestFullUploads=resolve})};
nextFullUploadRequest();
async function fullUploadLane(){
  const failures=new Map(); // name -> {count, retryAt}
  while(!stopping){
    nextFullUploadRequest();
    const quiet=!active.size&&Date.now()-lastWorkAt>=FULL_UPLOAD_QUIET_MS;
    const next=quiet?(await pendingFullUploads()).find(entry=>!(failures.get(entry.name)?.retryAt>Date.now())):null;
    if(!next){await Promise.race([sleep(quiet?15000:1000),stopped,fullUploadsRequested]);continue}
    const app=APP_CONNECTIONS.find(item=>item.appUrl===next.appUrl);
    if(!app){await dropFullUpload(next.name);continue}
    try{
      const result=await sendFullUpload(next,{api:clientFor(app),upload:uploadFile});
      await dropFullUpload(next.name);failures.delete(next.name);
      if(result==='uploaded')console.log('['+app.name+'] Full-size JPG uploaded for mockup '+next.itemId+'.');
    }catch(error){
      const count=(failures.get(next.name)?.count||0)+1;
      failures.set(next.name,{count,retryAt:Date.now()+Math.min(10*60*1000,15000*2**Math.min(count,6))});
      console.error('['+app.name+'] Full-size JPG upload will be retried: '+error.message);
    }
  }
}

// ---------------------------------------------------- PC mockup folder
// A shop's PSDs can live in a folder on this PC (config "mockupFolder"). The
// folder is scanned every 15 s and the shop told about any change; renders read
// the files directly, and an edited PSD is prepared again while idle.
async function localTemplateFile(app,template){
  if(!app.mockupFolder)throw Error('"'+template.name+'" is in a PC mockup folder, but no mockupFolder is set for '+
    app.name+' in config.local.json on this PC.');
  const file=mockupFolderFile(app.mockupFolder,template.localPath);
  const stat=await fs.promises.stat(file).catch(()=>null);
  if(!stat)throw Error('"'+template.localPath+'" is no longer in the mockup folder ('+app.mockupFolder+').');
  return {path:file,size:stat.size,version:localPsdVersion(template.localPath,stat.mtimeMs)};
}
// Each template's preview (its scene, 480 px) is sent to the shop once per
// version of the PSD, so the shop's pages show what every mockup looks like.
const previewsSent=new Map(); // appUrl|templateId -> version
async function sendTemplatePreview(app,template,ref,version){
  const sent=app.appUrl+'|'+template.id;
  if(template.previewVersion===version||previewsSent.get(sent)===version)return;
  try{
    const jpeg=await preparedPreviewJpeg(ref);
    if(!jpeg)return;
    await clientFor(app).templatePreview(template.id,jpeg,version);
    previewsSent.set(sent,version);
  }catch(error){
    // An older shop without previews, or a dropped connection: tried again when the worker restarts.
    previewsSent.set(sent,version);
    console.error('['+app.name+'] Preview of '+template.name+' not sent: '+error.message);
  }
}
// Prepares one PC folder template if needed, and tells the shop its orientation
// from the artwork layer's shape unless a folder name or the app set it.
async function prepareLocalTemplate(app,template){
  const local=await localTemplateFile(app,template),mapping=template.mapping||null;
  const ref={psdPath:local.path,mapping,psdSize:local.size,psdVersion:local.version};
  let prepared=false;
  if(!await isTemplatePrepared(ref)){await prepareInPool(ref);prepared=true}
  await sendTemplatePreview(app,template,ref,local.version);
  if(!['user','folder'].includes(template.orientationSource||'')){
    const shape=await preparedArtworkShape(ref);
    const orientation=shape?orientationFromShape(shape):'unclassified';
    if(orientation!=='unclassified'&&orientation!==template.orientation){
      await clientFor(app).templateOrientation(template.id,orientation);
      console.log('['+app.name+'] '+template.localPath+': '+orientation+' (from its artwork layer).');
    }
  }
  return prepared;
}
const folderReports=new Map(); // appUrl -> {signature, at, retryAt}
const folderStatus=new Map(); // appUrl -> {count, error}: shown in the Product Creator
for(const app of APP_CONNECTIONS)app.configMockupFolder=app.mockupFolder||'';
const FOLDER_SCAN_MS=15000,FOLDER_REPORT_REFRESH_MS=10*60*1000;
async function mockupFolderLane(){
  while(!stopping){
    for(const app of APP_CONNECTIONS){
      if(stopping||!app.mockupFolder)continue;
      const last=folderReports.get(app.appUrl)||{};
      if((last.retryAt||0)>Date.now())continue;
      let files;
      try{files=await scanMockupFolder(app.mockupFolder);folderStatus.set(app.appUrl,{count:files.length,error:''})}
      catch(error){
        // Not found (yet): reported in the Product Creator and checked again next scan.
        if(folderStatus.get(app.appUrl)?.error!==error.message)console.error('['+app.name+'] '+error.message);
        folderStatus.set(app.appUrl,{count:0,error:error.message});
        continue;
      }
      try{
        const signature=JSON.stringify(files);
        if(signature===last.signature&&Date.now()-(last.at||0)<FOLDER_REPORT_REFRESH_MS)continue;
        const result=await clientFor(app).localTemplates(files);
        folderReports.set(app.appUrl,{signature,at:Date.now()});
        if(signature!==last.signature){
          console.log('['+app.name+'] Mockup folder: '+files.length+' PSD(s)'+
            (result.changed?' · '+result.changed+' new or changed':'')+'.');
          if(result.changed)requestWarmUp();
        }
      }catch(error){
        folderReports.set(app.appUrl,{...last,retryAt:Date.now()+(/404|not found|unknown/i.test(error.message)?10*60*1000:60*1000)});
        console.error('['+app.name+'] Mockup folder could not be reported:',error.message);
      }
    }
    await Promise.race([sleep(FOLDER_SCAN_MS),stopped]);
  }
}
async function main(){
  validateWorkerConfig();
  await acquireSingleInstance();
  // Before any render thread loads ag-psd (also applied by `npm install`).
  try{console.log('ag-psd mask patch: '+patchAgPsd().join('; '))}
  catch(error){console.error('ag-psd mask patch failed:',error.message)}
  process.on('SIGINT',stop);
  process.on('SIGTERM',stop);
  // A failed promise nobody waited for is logged; the worker carries on.
  process.on('unhandledRejection',error=>console.error('Unexpected error (the worker carries on):',error?.stack||error));
  if(RESTART)console.log('Started again after it stopped unexpectedly ('+RESTART.reason+').');
  process.on('exit',()=>{try{fs.rmSync(LOCK_PATH,{force:true});}catch{}});
  console.log('Shared POD Crop Worker online as '+WORKER_ID+' for: '+
    APP_CONNECTIONS.map(app=>app.name).join(', '));
  await heartbeatAll();
  // A crop can take many minutes; keep every Render dashboard connected during it.
  const ticker=setInterval(()=>{if(!stopping)void heartbeatAll();},8000);
  ticker.unref();
  console.log('Rendering up to '+RENDER_THREADS+' mockups at once; crops run alongside.');
  // The Product Creator in this PC's browser hands artwork straight to the worker.
  startLocalIntake({apps:APP_CONNECTIONS,version:WORKER_VERSION_LABEL,
    onArtwork:({app,size})=>console.log('['+app.name+'] Artwork received from this PC\'s browser ('+
      (size/1048576).toFixed(1)+' MB); no R2 download needed.')});
  const idleCheck=IDLE_EXIT_MS>0?setInterval(()=>{
    if(!active.size&&Date.now()-lastWorkAt>=IDLE_EXIT_MS){
      console.log('Shared crop worker exiting after explicitly configured idle limit.');
      stop();
    }
  },5000):null;
  const updateCheck=setInterval(installUpdateWhenIdle,5000);
  updateCheck.unref();
  try{
    await Promise.all([cropLane(),mockupLane(),warmUpLane(),mockupFolderLane(),fullUploadLane()]);
  }finally{
    if(idleCheck)clearInterval(idleCheck);
    clearInterval(ticker);
    clearInterval(updateCheck);
    await cleanup();
  }
  if(installingUpdate){
    // Tell every shop the worker is restarting for its update, then hand over.
    for(let i=0;i<40&&heartbeatInFlight;i++)await sleep(250);
    await heartbeatAll();
    handOverToUpdater(installingUpdate);
    process.exit(0);
  }
}

main().catch(async error => {
  console.error(error.message);
  await cleanup();
  process.exit(1);
});
