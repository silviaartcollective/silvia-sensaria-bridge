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
import { apiFor, WORKER_VERSION as WORKER_VERSION_LABEL } from './api.mjs';
import {rotatingApps,heartbeatFor} from './worker-scheduling.mjs';
import {
  generateProductionCrop,
  inspectMaster,
  validateRatioSource
} from './crop.mjs';
import {renderMockupOnPC} from './mockup-processor.mjs';
import {RENDER_THREADS,prepareInPool} from './render-pool.mjs';
import {isTemplatePrepared} from './native-mockup.mjs';
import {startLocalIntake} from './local-intake.mjs';
import {patchAgPsd} from './patch-ag-psd.mjs';
import {downloadCached,cachedFilePath} from './asset-cache.mjs';
import sharp from 'sharp';

const LOCK_PATH = path.join(os.tmpdir(), 'pod-crop-worker.lock');
const tempPaths = new Set();
const clients = new Map();
let lastWorkAt = Date.now();
let stopping = false;
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

async function uploadFile(url, filePath) {
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

async function uploadBuffer(url,body){
  const response=await fetch(url,{method:'PUT',headers:{'Content-Type':'image/jpeg'},body,signal:AbortSignal.timeout(2*60*1000)});
  if(!response.ok)throw new Error('R2 upload failed (HTTP '+response.status+')');
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
  const extension=path.extname(claim.template.name).toLowerCase()==='.psb'?'.psb':'.psd';
  const templateMeta={shop:app.appUrl,id:claim.template.id,key:claim.template.key,
   size:claim.template.size,ext:extension};
  psdPath=cachedFilePath(templateMeta);
  // A prepared template renders from its prepared data: no PSD download.
  if(!await isTemplatePrepared({psdPath,mapping:claim.template.mapping||null,psdSize:claim.template.size}))
   psdPath=(await downloadCached(claim.templateUrl,templateMeta,stage)).path;
  measure('templateReadMs');
  await stage('Preparing master artwork on PC');
  artworkPath=(await downloadCached(claim.artworkUrl,{
   shop:app.appUrl,id:claim.job.id,key:claim.job.artworkKey,
   size:claim.job.artworkSize,ext:path.extname(claim.job.filename)||'.jpg'},stage)).path;
  measure('artworkReadMs');
  outputPath=path.join(os.tmpdir(),'pod-mockup-'+id+'-'+crypto.randomUUID()+'.jpg');
  tempPaths.add(outputPath);
  const render=await renderMockupOnPC({
   psdPath,artworkPath,outputPath,templateName:claim.template.name,mapping:claim.template.mapping||null,
   psdSize:claim.template.size,
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
  // The full JPG goes up with a 900 px preview for the Product Creator and a
  // 2400 px copy the server uploads to Etsy without resizing it on Render.
  const sized=(url,side,quality,label)=>url?sharp(outputPath).resize(side,side,{fit:'inside',withoutEnlargement:true})
   .jpeg({quality,chromaSubsampling:'4:4:4'}).toBuffer().then(body=>uploadBuffer(url,body)).then(()=>true,
    error=>{console.error('['+app.name+'] '+label+' upload failed (the full JPG is fine):',error.message);return false}):false;
  const [,previewUploaded,etsyUploaded]=await Promise.all([uploadFile(claim.output.uploadUrl,outputPath),
   sized(claim.output.previewUploadUrl,900,82,'Preview'),sized(claim.output.etsyUploadUrl,2400,90,'Etsy copy')]);
  measure('generatedJpgR2UploadMs');
  await queue(()=>api.mockupComplete(id,mockupOwner,itemId,claim.output.key,render.usedMapping,previewUploaded,etsyUploaded));
  measure('serverVerificationMs');
  completionRecorded=true;
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
  console.error('['+app.name+'] PSD mockup failed '+claim.item.name+': '+error.message);
  try{await queue(()=>api.mockupFail(id,mockupOwner,itemId,error,false))}
  catch(reportError){console.error('['+app.name+'] Could not mark PSD failed:',reportError.message)}
  if(!error.nativeUnsupported&&/timed out|time.?out|did not respond|interrupted|stalled/i.test(error.message||'')){
   console.error('['+app.name+'] Pausing the batch after an unresponsive PSD renderer. Completed JPGs are safe.');
   try{await queue(()=>api.mockupPause(id,mockupOwner))}
   catch(pauseError){console.error('['+app.name+'] Could not pause stalled batch:',pauseError.message)}
  }
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
async function heartbeatAll(){
  if(heartbeatInFlight)return;
  heartbeatInFlight=true;
  try{
    await Promise.allSettled(APP_CONNECTIONS.map(async app=>{
      try{await clientFor(app).heartbeat(heartbeatFor(app,activeFor(app)));}
      catch(error){console.error('['+app.name+'] heartbeat failed:',error.message);}
    }));
  }finally{heartbeatInFlight=false;}
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
async function warmUpLane(){
  await sleep(15000);
  while(!stopping){
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
        const ext=path.extname(template.name).toLowerCase()==='.psb'?'.psb':'.psd';
        const meta={shop:app.appUrl,id:template.id,key:template.key,size:template.size,ext};
        const mapping=template.mapping||null;
        try{
          if(await isTemplatePrepared({psdPath:cachedFilePath(meta),mapping,psdSize:template.size}))continue;
          const psdPath=(await downloadCached(template.url,meta)).path;
          await prepareInPool({psdPath,mapping,psdSize:template.size});
          prepared++;
        }catch(error){console.error('['+app.name+'] Could not prepare '+template.name+' in advance:',error.message)}
      }
      if(prepared)console.log('['+app.name+'] Prepared '+prepared+' PSD template(s) in advance.');
    }
    await sleep(WARM_UP_EVERY_MS);
  }
}
async function main(){
  validateWorkerConfig();
  await acquireSingleInstance();
  // Before any render thread loads ag-psd (also applied by `npm install`).
  try{console.log('ag-psd mask patch: '+patchAgPsd().join('; '))}
  catch(error){console.error('ag-psd mask patch failed:',error.message)}
  process.on('SIGINT',()=>{stopping=true;});
  process.on('SIGTERM',()=>{stopping=true;});
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
      stopping=true;
    }
  },5000):null;
  try{
    await Promise.all([cropLane(),mockupLane(),warmUpLane()]);
  }finally{
    if(idleCheck)clearInterval(idleCheck);
    clearInterval(ticker);
    await cleanup();
  }
}

main().catch(async error => {
  console.error(error.message);
  await cleanup();
  process.exit(1);
});
