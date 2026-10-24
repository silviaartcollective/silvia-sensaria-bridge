import {GetObjectCommand} from '@aws-sdk/client-s3';
import {getSignedUrl} from '@aws-sdk/s3-request-presigner';
import {pipeline} from 'node:stream/promises';
import sharp from 'sharp';
import {
 listMockupTemplates,getMockupTemplate,reserveMockupTemplate,confirmMockupTemplateUpload,updateMockupTemplate,
 deleteMockupTemplate,listMockupJobs,getMockupJob,createMockupJob,markMockupArtworkUploaded,
 controlMockupJob,claimMockupWork,completeMockupItem,failMockupItem,putMockupJob,markMockupFullUploaded,
 classifySmartObjects,mockupOutputKey,getMockupItemDownload,registerMockupTemplatePreview,deleteMockupOutput,
 hasActiveMockupLease,MOCKUP_LEASE_MS,updateMockupItemProgress,MOCKUP_ROOT,knownMockupArtworkTarget,withMockupJobLock,
 jpegDimensions,mockupPreviewKey,mockupEtsyKey,linkMockupArtwork,syncPcTemplates,setDetectedTemplateOrientation,
 getPcMockupFolder,setPcMockupFolder
} from './mockup-generator.mjs';
import {
 signedArtworkUploadUrl,signedArtworkUrl,getArtworkObject,artworkObjectExists,deleteArtworkObject,r2Client,r2Config
} from './r2.mjs';
import {randomUUID,createHmac} from 'node:crypto';
import {streamMockupZip} from './mockup-zip.mjs';
import {mockupOrientationOf} from './mockup-orientation.mjs';
import {loadArtworkManifest,saveArtworkManifest} from './artwork-storage.mjs';
import {copyArtworkObject,artworkObjectInfo,getArtworkObjectStart} from './r2.mjs';

// Generated outputs have immutable UUID keys. Cache their small previews
// to avoid repeated 24MP R2 downloads on every gallery review or refresh.
const thumbnailCache=new Map();
const THUMBNAIL_TTL_MS=15*60*1000,THUMBNAIL_MAX_ENTRIES=45;
async function generatedMockupThumbnail(key){
 const entry=thumbnailCache.get(key);
 if(entry&&entry.expiresAt>Date.now())
  return entry.pending||entry.bytes;
 const pending=(async()=>{
  const source=await getArtworkObject(key);
  if(!source.body.length||source.body.length>60*1024*1024)
   throw Error('Generated preview source is too large.');
  return sharp(source.body,{limitInputPixels:24_000_001})
   .rotate().resize(720,720,{fit:'inside',withoutEnlargement:true})
   .jpeg({quality:80}).toBuffer();
 })();
 thumbnailCache.set(key,{pending,expiresAt:Date.now()+THUMBNAIL_TTL_MS});
 if(thumbnailCache.size>THUMBNAIL_MAX_ENTRIES)
  thumbnailCache.delete(thumbnailCache.keys().next().value);
 try{
  const bytes=await pending;
  thumbnailCache.set(key,{bytes,expiresAt:Date.now()+THUMBNAIL_TTL_MS});
  return bytes;
 }catch(error){thumbnailCache.delete(key);throw error}
}

const ID='[a-f0-9-]{36}';
const maxLength=200;
function isId(v){return /^[a-f0-9-]{36}$/.test(v||'')}
const str=v=>String(v??'').slice(0,maxLength);
function checkOrigin(req){
 const h=String(req.headers.host||'');
 const origin=String(req.headers.origin||'');
 const proto=String(req.headers['x-forwarded-proto']||'https').split(',')[0];
 if(req.headers['sec-fetch-site']==='cross-site'||origin&&origin!==proto+'://'+h)
  throw Error('Cross-origin changes are not allowed.');
 if(!String(req.headers['content-type']||'').includes('application/json'))throw Error('JSON body required.');
}
function ownerCheck(body){
 if(!isId(body?.owner))throw Error('A worker session ID is required.');
 return body.owner;
}
async function streamObject(res,key,name=''){
 const client=r2Client(),config=r2Config();
 const result=await client.send(new GetObjectCommand({Bucket:config.bucket,Key:key}));
 res.writeHead(200,{
  'content-type':result.ContentType||'application/octet-stream',
  'content-length':result.ContentLength,
  'cache-control':'private, no-store',
  'x-content-type-options':'nosniff',
  ...(name?{'content-disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(name)}:{})
 });
 await pipeline(result.Body,res);
}
// Batches that may still have queued PSDs. Reading every batch ever created from
// R2 on each worker poll made every claim slow, so the full listing runs only
// at start-up and every 10 minutes; new and resumed batches are added directly.
const activeBatches={ids:null,listedAt:0};
const openBatch=j=>!!j&&j.artworkUploaded&&!j.deleted&&
 !!j.templates?.some(t=>t.status==='queued'||t.status==='processing');
// Workers waiting in a claim (long poll) are answered the moment a batch is queued.
const claimWaiters=new Set();
// Queues mockups from the already-uploaded R2 master instead of uploading it
// twice (the Product Creator and the batch poster).
export async function mockupJobFromArtwork({artworkId,templateIds,fitMode='cover'}){
 artworkId=String(artworkId||'');
 if(!/^[A-Z]{2,5}[0-9]{1,12}$/.test(artworkId))throw Error('Valid artwork ID required.');
 const manifest=await loadArtworkManifest(artworkId);
 if(!manifest||manifest.status!=='ready'||!manifest.master?.key)
  throw Error('Upload and confirm the master artwork before generating mockups.');
 const master=manifest.master;
 const info=await artworkObjectInfo(master.key);
 const job=await createMockupJob({
   filename:master.originalFilename||artworkId+'.jpg',
   size:info.size,templateIds,
    artworkOrientation:mockupOrientationOf(manifest),fitMode:fitMode||'cover'
 });
 job.artworkId=artworkId;job.sourceMasterKey=master.key;
 await putMockupJob(job);
 await copyArtworkObject(master.key,job.artworkKey);
 const confirmed=await markMockupArtworkUploaded(job.id);markBatchActive(job.id);
 // Persist the linkage for refresh/restart recovery and progress UI.
 manifest.mockupJobIds=[...new Set([...(manifest.mockupJobIds||[]),job.id])].slice(-30);
 await saveArtworkManifest(manifest);
 return confirmed;
}
function markBatchActive(id){
 activeBatches.ids?.add(id);
 for(const wake of claimWaiters)wake();
 claimWaiters.clear();
}
function waitForBatch(ms){
 return new Promise(resolve=>{
  const done=()=>{clearTimeout(timer);claimWaiters.delete(done);resolve()};
  const timer=setTimeout(done,ms);
  claimWaiters.add(done);
 });
}
// Authorizes the browser to hand this batch's artwork straight to the PC worker
// on the same computer. The worker checks it with its own copy of the token.
export function localArtworkToken(jobId,artworkKey,size){
 const secret=String(process.env.CROP_WORKER_TOKEN||'');
 if(!secret)return '';
 return createHmac('sha256',secret).update(['pod-local-artwork',jobId,artworkKey,String(Number(size)||0)].join('|')).digest('hex');
}
async function claimCandidates(owner=''){
 if(!activeBatches.ids||Date.now()-activeBatches.listedAt>10*60*1000){
  const listedAt=Date.now(),all=await listMockupJobs(300);
  activeBatches.ids=new Set(all.filter(openBatch).map(j=>j.id));activeBatches.listedAt=listedAt;
 }
 const jobs=[];
 for(const id of [...activeBatches.ids]){
  let j=null;
  try{j=await getMockupJob(id)}catch{}
  if(!openBatch(j)){activeBatches.ids.delete(id);continue}
  // A batch this worker already holds stays claimable while it has queued PSDs:
  // the worker renders several PSDs at once.
  if(j.paused)continue;
  if(!hasActiveMockupLease(j)||(j.lease.owner===owner&&j.templates.some(t=>t.status==='queued')))jobs.push(j);
 }
 // Newest batch first: the listing being created now should not wait behind
 // older batches that were queued while the worker was unavailable.
 return jobs.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
}
// Download links go straight to R2 so full-size JPGs never count against the
// Render service's outbound bandwidth.
async function redirectToObject(res,key,name){
 const config=r2Config();
 const url=await getSignedUrl(r2Client(),new GetObjectCommand({Bucket:config.bucket,Key:key,
  ResponseContentDisposition:"attachment; filename*=UTF-8''"+encodeURIComponent(name)}),{expiresIn:300});
 res.writeHead(302,{location:url,'cache-control':'no-store'});res.end();
}
// What the worker needs for each claimed PSD: template, signed URLs, output keys.
async function claimPayloads(jobId,claimed){
 const artworkUrl=await signedArtworkUrl(claimed.job.artworkKey,3600);
 return Promise.all(claimed.items.map(async item=>{
  const stored=await getMockupTemplate(item.id);
  // Known templates (e.g. mockup 19's layer "5") use the same layer the server verifies.
  const known=knownMockupArtworkTarget(stored.name);
  const template=stored.mapping?.path||!known?stored:{...stored,mapping:{path:known}};
  const key=mockupOutputKey(jobId,template.id),previewKey=mockupPreviewKey(key),etsyKey=mockupEtsyKey(key);
  // A PC folder template is read by the worker from its own disk.
  return {item,template,templateUrl:template.source==='pc'?null:await signedArtworkUrl(template.key,3600),artworkUrl,
   output:{key,uploadUrl:await signedArtworkUploadUrl(key,'image/jpeg',3600),
    previewKey,previewUploadUrl:await signedArtworkUploadUrl(previewKey,'image/jpeg',3600),
    etsyKey,etsyUploadUrl:await signedArtworkUploadUrl(etsyKey,'image/jpeg',3600),
    // The worker may report the mockup ready once the preview and Etsy copy are
    // in R2, and send the full-size JPG afterwards (worker/<job>/templates/<id>/full).
    deferFull:true}};
 }));
}
function makeError(error){
 if(error?.name==='TimeoutError'||/timed? ?out/i.test(String(error?.message||'')))
  return {ok:false,error:'Cloudflare R2 did not respond in time. This refreshes automatically; retry if it persists.'};
 const msg=String(error?.message||error||'Unexpected error');
 return {ok:false,error:msg.slice(0,450)};
}
// A JPG in R2, checked from its header only; returns its size.
async function verifiedJpeg(key,maxBytes){
 const start=await getArtworkObjectStart(key);
 if(!start.totalSize||start.totalSize>maxBytes)throw Error('Invalid mockup JPG size.');
 let metadata=jpegDimensions(start.body);
 if(!metadata&&start.body[0]===255&&start.body[1]===216)
  metadata=await sharp((await getArtworkObject(key)).body,{limitInputPixels:24_000_001}).metadata();
 if(!metadata)throw Error('Output is not a JPEG.');
 return checkedDimensions(metadata);
}
function checkedDimensions({width,height}){
 if(!(Number.isSafeInteger(width)&&Number.isSafeInteger(height))||width*height>24_000_000||width<150||height<150)
  throw Error('Export does not meet the 24MP JPG requirements.');
 return {width,height};
}
// The size the worker rendered, until the full-size JPG itself is in R2.
const reportedDimensions=value=>checkedDimensions({width:Number(value?.width),height:Number(value?.height)});
export async function handleMockupAPI(req,res,url,{authenticated,workerAuthorized=()=>false,readJson,sendJson,onMockupCompleted=()=>{},onMockupFullUploaded=()=>{}}){
 if(!url.pathname.startsWith('/api/mockups/'))return false;
 if(!authenticated(req,res))return true;
 if(req.method!=='GET'){
  try{checkOrigin(req)}catch(e){sendJson(res,403,makeError(e));return true;}
 }
 const send=(code,body)=>sendJson(res,code,{ok:true,...body});
 const parts=url.pathname.replace(/^\/api\/mockups\//,'').split('/').filter(Boolean);
 try{
  // The local crop/PSD worker uses the same bearer token and queue as production crops.
  if(parts[0]==='worker'){
   if(!workerAuthorized(req))return sendJson(res,403,{ok:false,error:'PC worker token required.'}),true;
   if(req.method==='POST'&&parts[1]==='claim'&&parts.length===2){
    const body=await readJson(req),owner=ownerCheck(body);
    const v=String(body.version||'0').split('.').map(Number);
    if(!(v[0]>4||(v[0]===4&&v[1]>=5))){
     sendJson(res,426,{ok:false,error:'PC mockup worker version 4.5.0 or newer is required (PSDs now render on the PC worker alone, without Photoshop or Photopea). Run worker/setup-worker.cmd and restart it.'});return true;
    }
    const jobs=await claimCandidates(owner);
    // Several PSDs per request: the worker asks for as many as it has free threads.
    const limit=Math.max(1,Math.min(8,Number(body.limit)||1));
    for(const candidate of jobs){
     let claimed;
     try{claimed=await claimMockupWork(candidate.id,owner,limit)}
     catch(error){if(/processing|lease|paused/i.test(String(error?.message)))continue;throw error}
     if(!claimed?.item)continue;
     const items=await claimPayloads(candidate.id,claimed);
     // The first claim stays at the top level for workers that take one at a time.
     return send(200,{job:claimed.job,...items[0],items}),true;
    }
    // Nothing queued: hold the request until a batch is queued (or `wait` ms),
    // then look once more. The worker learns of new work at once instead of polling.
    const wait=Math.max(0,Math.min(25000,Number(body.wait)||0));
    if(wait&&!body.retried){
     await waitForBatch(wait);
     body.retried=true;
     for(const candidate of await claimCandidates(owner)){
      let claimed;
      try{claimed=await claimMockupWork(candidate.id,owner,limit)}
      catch(error){if(/processing|lease|paused/i.test(String(error?.message)))continue;throw error}
      if(!claimed?.item)continue;
      const items=await claimPayloads(candidate.id,claimed);
      return send(200,{job:claimed.job,...items[0],items,longPoll:true}),true;
     }
    }
    return send(200,{job:null,item:null,items:[],longPoll:wait>0}),true;
   }
   // Saved templates, so an idle worker can prepare them before any artwork needs them.
   if(req.method==='GET'&&parts[1]==='templates'&&parts.length===2){
    const ready=(await listMockupTemplates()).filter(t=>t.status==='ready');
    const templates=await Promise.all(ready.map(async t=>{
     const known=knownMockupArtworkTarget(t.name);
     const mapping=t.mapping?.path?t.mapping:known?{path:known}:null;
     if(t.source==='pc')return {id:t.id,name:t.name,source:'pc',localPath:t.localPath,size:t.size,mtimeMs:t.mtimeMs,
      orientation:t.orientation,orientationSource:t.orientationSource||'',mapping};
     return {id:t.id,name:t.name,key:t.key,size:t.size,mapping,url:await signedArtworkUrl(t.key,3600)};
    }));
    return send(200,{templates}),true;
   }
   // The PSDs in the PC's mockup folder for this shop.
   if(req.method==='POST'&&parts[1]==='local-templates'&&parts.length===2){
    const body=await readJson(req);
    // The chosen folder's own name can give the orientation ("…Horizontal").
    return send(200,await syncPcTemplates(body.files,{mockupFolder:await getPcMockupFolder()})),true;
   }
   if(req.method==='POST'&&parts[1]==='templates'&&parts[3]==='orientation'&&parts.length===4&&isId(parts[2])){
    const body=await readJson(req);
    const template=await setDetectedTemplateOrientation(parts[2],str(body.orientation),body.squareCompatible===true);
    return send(200,{template:{id:template.id,orientation:template.orientation}}),true;
   }
   // The full-size JPG of a mockup already reported ready: a fresh upload URL
   // ("url"), then its check ("done"). A regenerated or deleted mockup answers
   // pending:false and the worker drops that file.
   if(req.method==='POST'&&parts.length===5&&parts[2]==='templates'&&parts[4]==='full'&&isId(parts[1])&&isId(parts[3])){
    const body=await readJson(req),key=str(body.outputKey);
    const item=(await getMockupJob(parts[1])).templates.find(x=>x.id===parts[3]);
    if(item?.status!=='completed'||item.outputKey!==key||!item.fullPending)return send(200,{pending:false}),true;
    if(body.action==='url')return send(200,{pending:true,uploadUrl:await signedArtworkUploadUrl(key,'image/jpeg',3600)}),true;
    const done=await markMockupFullUploaded(parts[1],parts[3],key,await verifiedJpeg(key,60*1024*1024));
    if(done)void Promise.resolve().then(()=>onMockupFullUploaded(done)).catch(
     error=>console.error('Full-size mockup notification failed:',error));
    return send(200,{pending:false,done:!!done}),true;
   }
   if(req.method==='POST'&&parts.length===5&&parts[2]==='templates'&&parts[4]==='progress'&&isId(parts[1])&&isId(parts[3])){
    const body=await readJson(req);
    return send(200,{job:await updateMockupItemProgress(parts[1],ownerCheck(body),parts[3],str(body.stage))}),true;
   }
   sendJson(res,404,{ok:false,error:'Unknown PC worker mockup operation.'});return true;
  }
  // The mockup folder on the PC: its PSDs are used without uploading them.
  if(parts[0]==='pc-folder'&&parts.length===1){
   if(req.method==='GET')return send(200,{folder:await getPcMockupFolder()}),true;
   if(req.method==='POST')return send(200,{folder:await setPcMockupFolder((await readJson(req)).folder)}),true;
  }
  if(parts[0]==='templates'){
   if(req.method==='GET'&&parts.length===1)return send(200,{templates:await listMockupTemplates()}),true;
   if(req.method==='POST'&&parts.length===1){
    const t=await reserveMockupTemplate(await readJson(req));
    return send(201,{template:t,uploadUrl:await signedArtworkUploadUrl(t.key,'application/octet-stream',3600)}),true;
   }
   const id=parts[1];
   if(!isId(id))throw Error('Invalid template ID.');
   if(req.method==='POST'&&parts[2]==='confirm'){
    return send(200,{template:await confirmMockupTemplateUpload(id)}),true;
   }
   if(req.method==='POST'&&parts[2]==='update'){
    return send(200,{template:await updateMockupTemplate(id,await readJson(req))}),true;
   }
   if(req.method==='POST'&&parts[2]==='inspect'){
    const body=await readJson(req),t=await getMockupTemplate(id);
    const classified=classifySmartObjects(body.objects,t);
    // The same template is inspected on every render; only write when it changed.
    const summary=list=>JSON.stringify((list||[]).map(o=>[o.path,o.name,!!o.visible]));
    const template=summary(t.smartObjects)===summary(classified.objects)?t:
     await updateMockupTemplate(id,{smartObjects:classified.objects});
    return send(200,{classification:classified,template}),true;
   }
   if(req.method==='POST'&&parts[2]==='preview'){
    const t=await getMockupTemplate(id);
    const key='mockup-generator/v1/silvia/templates/'+id+'/preview-'+randomUUID()+'.jpg';
    return send(200,{key,uploadUrl:await signedArtworkUploadUrl(key,'image/jpeg',3600)}),true;
   }
   if(req.method==='POST'&&parts[2]==='preview-confirm'){
    const body=await readJson(req),key=str(body.key);
    if(!key.startsWith('mockup-generator/v1/silvia/templates/'+id+'/preview-')||!key.endsWith('.jpg'))
      throw Error('Invalid preview location.');
    const data=await getArtworkObject(key);
    if(data.body.length>3*1024*1024)throw Error('Preview must be under 3MB.');
    const info=await sharp(data.body).metadata();
    if(info.format!=='jpeg'||info.width>1800||info.height>1800)throw Error('Invalid template preview.');
    return send(200,{template:await registerMockupTemplatePreview(id,key)}),true;
   }
   if(req.method==='DELETE'&&parts.length===2)return send(200,await deleteMockupTemplate(id)),true;
  }
  if(parts[0]==='jobs'){
   if(req.method==='GET'&&parts.length===1)return send(200,{jobs:await listMockupJobs(40)}),true;
   // Queue from the already-uploaded R2 master instead of uploading it twice.
   if(req.method==='POST'&&parts.length===2&&parts[1]==='from-artwork'){
    const body=await readJson(req);
    return send(201,{job:await mockupJobFromArtwork({artworkId:body.artworkId,templateIds:body.templateIds,fitMode:body.fitMode||'cover'})}),true;
   }
   if(req.method==='POST'&&parts.length===1){
    const job=await createMockupJob(await readJson(req));
    return send(201,{job,uploadUrl:await signedArtworkUploadUrl(job.artworkKey,'application/octet-stream',3600),
     localUpload:{token:localArtworkToken(job.id,job.artworkKey,job.artworkSize)}}),true;
   }
   const id=parts[1];if(!isId(id))throw Error('Invalid batch ID.');
   if(req.method==='GET'&&parts.length===2)return send(200,{job:await getMockupJob(id)}),true;
   if(req.method==='POST'&&parts[2]==='artwork-confirm'){
    const body=await readJson(req).catch(()=>({}));
    const job=await markMockupArtworkUploaded(id,{local:body?.local===true});markBatchActive(id);
    return send(200,{job}),true;
   }
   if(req.method==='POST'&&parts[2]==='link-artwork'){
    const body=await readJson(req),artworkId=str(body.artworkId);
    if(!/^SAC\d+$/.test(artworkId))throw Error('A valid artwork ID is required.');
    const manifest=await loadArtworkManifest(artworkId);
    if(!manifest||manifest.status!=='ready'||!manifest.master?.key)throw Error('The artwork is not verified in Cloudflare R2 yet.');
    const current=await getMockupJob(id);
    if(manifest.master.size&&Number(manifest.master.size)!==Number(current.artworkSize))
     throw Error('This batch was started from a different file than the uploaded master.');
    // A batch whose artwork went straight to the PC worker gets its R2 copy now.
    if(current.artworkLocal&&!await artworkObjectExists(current.artworkKey))
     await copyArtworkObject(manifest.master.key,current.artworkKey);
    const job=await linkMockupArtwork(id,{artworkId,masterKey:manifest.master.key,orientation:mockupOrientationOf(manifest)});
    return send(200,{job}),true;
   }
   if(req.method==='POST'&&parts[2]==='control'){
    const body=await readJson(req);
    const job=await controlMockupJob(id,str(body.action),ownerCheck(body));markBatchActive(id);
    return send(200,{job}),true;
   }
   if(req.method==='POST'&&parts[2]==='claim'){
    const body=await readJson(req),owner=ownerCheck(body);
    const claimed=await claimMockupWork(id,owner);
    if(!claimed.item)return send(200,claimed),true;
    const template=await getMockupTemplate(claimed.item.id);
    const key=mockupOutputKey(id,template.id);
    return send(200,{...claimed,template,
      output:{key,uploadUrl:await signedArtworkUploadUrl(key,'image/jpeg',3600)}}),true;
   }
   if(req.method==='POST'&&parts[2]==='heartbeat'){
    const body=await readJson(req),owner=ownerCheck(body);
    const j=await withMockupJobLock(id,async()=>{
     const j=await getMockupJob(id);
     if(!hasActiveMockupLease(j)||j.lease.owner!==owner)throw Error('This browser no longer owns the batch.');
     const now=Date.now();
     j.lease.renewedAt=new Date(now).toISOString();
     j.lease.expiresAt=new Date(now+MOCKUP_LEASE_MS).toISOString();
     return putMockupJob(j);
    });
    return send(200,{lease:j.lease,status:j.status,paused:j.paused}),true;
   }
   if(req.method==='POST'&&parts[2]==='complete'){
    const body=await readJson(req),owner=ownerCheck(body),itemId=str(body.templateId),key=str(body.outputKey);
    const j=await getMockupJob(id);
    const item=j.templates.find(x=>x.id===itemId);
    if(!item)throw Error('Output does not belong to this batch.');
    if(!key.startsWith('mockup-generator/v1/silvia/jobs/'+id+'/outputs/'+itemId+'/')||!key.endsWith('.jpg'))
     throw Error('Output path is not valid for this job.');
    if(!body.visibilityVerified||!body.mappingVerified||!body.artworkReplaced)
     throw Error('The artwork replacement, target Smart Object, and original layer visibility must be verified.');
    // Only the JPEG header is read: downloading the full 24MP JPG from R2 on
    // every completion was the slowest step per mockup. A worker sending the
    // full-size JPG later (fullPending) is verified by its Etsy copy now.
    const fullPending=body.fullPending===true;
    if(fullPending&&body.etsyUploaded!==true)throw Error('The Etsy copy is required before the full-size JPG.');
    const verified=await verifiedJpeg(fullPending?mockupEtsyKey(key):key,fullPending?20*1024*1024:60*1024*1024);
    const dimensions=fullPending?reportedDimensions(body.dimensions):verified;
    let previewKey=null;
    if(body.previewUploaded===true){
     const preview=await getArtworkObjectStart(mockupPreviewKey(key),4096).catch(()=>null);
     if(preview?.body?.[0]===255&&preview.body[1]===216&&preview.totalSize<5*1024*1024)previewKey=mockupPreviewKey(key);
    }
    let etsyKey=fullPending?mockupEtsyKey(key):null;
    if(!fullPending&&body.etsyUploaded===true){
     const copy=await getArtworkObjectStart(mockupEtsyKey(key),4096).catch(()=>null);
     if(copy?.body?.[0]===255&&copy.body[1]===216&&copy.totalSize<20*1024*1024)etsyKey=mockupEtsyKey(key);
    }
    const old=item.outputKey,oldPreview=item.previewKey,oldEtsy=item.etsyKey;
    const result=await completeMockupItem(id,owner,itemId,{outputKey:key,previewKey,etsyKey,fullPending,
     dimensions,mapping:str(body.mapping)});
    if(old&&old!==key)await deleteArtworkObject(old).catch(()=>{});
    if(oldPreview&&oldPreview!==previewKey)await deleteArtworkObject(oldPreview).catch(()=>{});
    if(oldEtsy&&oldEtsy!==etsyKey)await deleteArtworkObject(oldEtsy).catch(()=>{});
    // Successful JPG verification is the trigger; do not wait for all PSDs.
    void Promise.resolve().then(()=>onMockupCompleted(result)).catch(
      error=>console.error('PSD completion notification failed:',error)
    );
    return send(200,{job:result}),true;
   }
   if(req.method==='POST'&&parts[2]==='fail'){
    const body=await readJson(req);
    return send(200,{job:await failMockupItem(id,ownerCheck(body),str(body.templateId),
     str(body.error||'PSD rendering failed on the PC worker'),!!body.needsMapping,{retry:body.retry===true})}),true;
   }
   if(req.method==='DELETE'&&parts[2]==='download'&&isId(parts[3])){
    return send(200,{job:await deleteMockupOutput(id,parts[3])}),true;
   }
   if(req.method==='GET'&&parts[2]==='download-all'){
    await streamMockupZip(res,id);return true;
   }
   if(req.method==='GET'&&parts[2]==='thumbnail'&&isId(parts[3])){
    // Small previews avoid loading full-resolution 24MP JPGs into a long scrolling list.
    const d=await getMockupItemDownload(id,parts[3]);
    // The worker uploads a ready-made preview; older outputs are resized here.
    const thumbnail=d.previewKey?(await getArtworkObject(d.previewKey)).body:await generatedMockupThumbnail(d.key);
    res.writeHead(200,{
     'content-type':'image/jpeg','content-length':thumbnail.length,
     // The client URL carries ?v=finishedAt, so a regenerated JPG gets a new URL.
     'cache-control':'private, max-age=2592000, immutable','x-content-type-options':'nosniff'
    });
    res.end(thumbnail);return true;
   }
   if(req.method==='GET'&&parts[2]==='download'&&isId(parts[3])){
    const d=await getMockupItemDownload(id,parts[3]);
    if(url.searchParams.get('direct')==='1')return redirectToObject(res,d.key,d.name).then(()=>true);
    return streamObject(res,d.key,d.name).then(()=>true);
   }
   if(req.method==='DELETE'&&parts.length===2){
    const j=await getMockupJob(id);
    if(j.status==='running'&&Date.parse(j.lease?.expiresAt)>Date.now())
      throw Error('Pause this batch before deleting it.');
    for(const t of j.templates)if(t.outputKey)await deleteArtworkObject(t.outputKey);
    await deleteArtworkObject(j.artworkKey);
    j.deleted=true;j.status='deleted';await putMockupJob(j);
    return send(200,{deleted:true}),true;
   }
  }
  if(parts[0]==='file'&&req.method==='GET'){
    const kind=parts[1],id=parts[2];
    if(!isId(id))throw Error('Invalid source ID.');
    if(kind==='template'){
      const t=await getMockupTemplate(id);if(t.status!=='ready')throw Error('Template not ready.');
      if(t.source==='pc')throw Error('"'+t.name+'" is in the mockup folder on the PC, not stored online.');
      await streamObject(res,t.key);return true;
    }
    if(kind==='preview'){
      const t=await getMockupTemplate(id);
      if(!t.previewKey)throw Error('Template preview unavailable.');
      await streamObject(res,t.previewKey);return true;
    }
    if(kind==='artwork'){
      const j=await getMockupJob(id);if(!j.artworkUploaded)throw Error('Artwork not uploaded.');
      await streamObject(res,j.artworkKey);return true;
    }
  }
  sendJson(res,404,{ok:false,error:'Unknown mockup-generator operation.'});
 }catch(error){
  if(!res.headersSent)sendJson(res,400,makeError(error));
  else res.destroy(error);
 }
 return true;
}
