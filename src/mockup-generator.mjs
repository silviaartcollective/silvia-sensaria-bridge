import crypto from 'node:crypto';
import {normalizeTemplateOrientation,validateTemplateSelection} from './mockup-orientation.mjs';
import sharp from 'sharp';
import {ListObjectsV2Command} from '@aws-sdk/client-s3';
import {r2Client,r2Config,getJsonObject,putJsonObject,artworkObjectExists,isMissingR2Object,putArtworkFile,signedArtworkUrl,deleteArtworkObject} from './r2.mjs';

const ROOT='mockup-generator/v1/silvia';
const idOK=id=>/^[a-f0-9-]{36}$/.test(String(id||''));
const iso=()=>new Date().toISOString();
const templateKey=id=>ROOT+'/templates/'+id+'/meta.json';
const jobKey=id=>ROOT+'/jobs/'+id+'/meta.json';
const limitText=(x,max=130)=>String(x||'').trim().slice(0,max);
const extFile=(name,exts)=>{const ext=String(name||'').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];if(!exts.includes(ext))throw Error('Unsupported file type: '+name);return ext;};
const own=(obj,key)=>Object.prototype.hasOwnProperty.call(obj,key);
function assertId(id){if(!idOK(id))throw Error('Invalid mockup record ID.');return id}
async function optional(key){try{return await getJsonObject(key)}catch(e){if(isMissingR2Object(e))return null;throw e}}
export function knownMockupArtworkTarget(name){
 if(/^mockup[ _-]*19\.(?:psd|psb)$/i.test(String(name||'')))return '5';
 if(/^vertical[ _-]*close[ _-]*up[ _-]*framed[ _-]*(?:light[ _-]*wood|dark[ _-]*wood|black)[ _-]*mockup\.(?:psd|psb)$/i.test(String(name||'')))
   return '5';
 return null;
}
export function safeFilename(name) {
 const clean=limitText(name,180).replace(/[\\/\0-\x1f<>:"|?*]/g,'_');
 if(!clean||clean==='.'||clean==='..')throw Error('Invalid filename');
 return clean;
}
export function outputFileName(psd) {
 return safeFilename(psd).replace(/\.(psd|psb)$/i,'')+'.jpg';
}
export function max24MP(width,height){
 if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<=0||height<=0)throw Error('Invalid image dimensions.');
 if(width*height<=24_000_000)return {width,height};
 const scale=Math.sqrt(24_000_000/(width*height));
 let w=Math.max(1,Math.floor(width*scale)),h=Math.max(1,Math.floor(height*scale));
 while(w*h>24_000_000){if(w>=h)w--;else h--}
 return {width:w,height:h};
}
export function validateMappingPath(path){
 const value=limitText(path,400);
 if(!value||value.split('/').some(s=>!s.trim()))throw Error('Choose a valid artwork Smart Object path');
 return value;
}
export function classifySmartObjects(list,template){
 const visible=(Array.isArray(list)?list:[]).filter(x=>x&&x.kind==='smart'&&x.visible!==false&&typeof x.path==='string');
 // `kind` is kept: the Product Creator's artwork-layer picker lists smart objects only.
 const objects=visible.map(x=>({name:limitText(x.name,160),path:limitText(x.path,400),visible:true,kind:'smart'}));
 const suggested=visible.filter(x=>x.suggested===true);
 // A saved choice matches by layer path first, then by name, like the PC worker.
 const expected=template?.mapping?.path||knownMockupArtworkTarget(template?.name);
 const selected=expected&&(objects.find(x=>x.path===expected)||objects.find(x=>x.name===expected));
 if(selected)return {status:'mapped',path:selected.path,objects};
 if(objects.length===1)return {status:'mapped',path:objects[0].path,objects};
 // Several visible Smart Objects (or a saved choice no longer in the PSD): the
 // PC worker uses the one that is clearly the artwork, else the top one, and
 // marks it.
 if(suggested.length===1)return {status:'mapped',path:limitText(suggested[0].path,400),objects,suggested:true};
 return {status:'needs_mapping',reason:objects.length?'Multiple visible Smart Objects; select the artwork layer.':'No visible editable Smart Objects detected.',objects};
}
// Lists every matching key (cheap: 1000 per request), then reads only the most
// recently modified `limit` records. R2 lists keys alphabetically, so stopping
// the listing early returned a random subset and every record was then read.
async function listJSON(prefix,regex,limit=1000) {
 const client=r2Client(),bucket=r2Config().bucket;
 const found=[];let marker;
 do {
   const data=await client.send(new ListObjectsV2Command({Bucket:bucket,Prefix:prefix,ContinuationToken:marker,MaxKeys:1000}));
   for(const o of data.Contents||[])if(regex.test(o.Key||''))found.push(o);
   marker=data.IsTruncated?data.NextContinuationToken:null;
 }while(marker);
 const keys=found.sort((a,b)=>new Date(b.LastModified||0)-new Date(a.LastModified||0))
  .slice(0,limit).map(o=>o.Key);
 const results=[];for(let i=0;i<keys.length;i+=8){
  results.push(...(await Promise.all(keys.slice(i,i+8).map(async key=>optional(key)))).filter(Boolean));
 }
 return results;
}
export async function listMockupTemplates(){
 const records=await listJSON(ROOT+'/templates/',/\/meta\.json$/,1800),folder=await getPcMockupFolder();
 return folderOrUploads(records.filter(x=>x.status!=='deleted')).map(r=>withFolderOrientation(r,folder))
  .sort((a,b)=>a.name.localeCompare(b.name));
}
// The folder names are applied whenever templates are read, so a folder rule
// takes effect at once, not only when the worker next reports the folder.
function withFolderOrientation(record,folder){
 if(record?.source!=='pc'||record.orientationSource==='user')return record;
 const orientation=orientationFromFolder(record.localPath,folder);
 return orientation?{...record,orientation,orientationSource:'folder'}:record;
}
// While the PC mockup folder holds PSDs, the template list is exactly that
// folder: uploaded templates are kept (and offered again if the folder is
// cleared) but not offered, so no PSD renders twice, renamed or not.
export function folderOrUploads(records){
 return records.some(r=>r.source==='pc'&&r.status==='ready')?records.filter(r=>r.source==='pc'):records;
}
const twinName=record=>String(record?.name||'').toLowerCase();
export async function getMockupTemplate(id){
 const value=await optional(templateKey(assertId(id)));
 if(!value||value.status==='deleted')throw Error('Mockup template not found.');
 return withFolderOrientation(value,await getPcMockupFolder());
}
export async function reserveMockupTemplate({name,size,collection='Unsorted',orientation='unclassified',squareCompatible=false}){
 const filename=safeFilename(name),ext=extFile(filename,['psd','psb']),bytes=Number(size);
 if(!Number.isSafeInteger(bytes)||bytes<100||bytes>350*1024*1024)throw Error('PSD/PSB must be 100 bytes–350 MB.');
 const id=crypto.randomUUID();
 const record={id,name:filename,collection:limitText(collection,100)||'Unsorted',size:bytes,
  orientation:normalizeTemplateOrientation(orientation),squareCompatible:squareCompatible===true,
  status:'awaiting_upload',key:ROOT+'/templates/'+id+'/original.'+ext,
  mapping:knownMockupArtworkTarget(filename)?{path:'5',verifiedFrom:'known-template'}:null,
  smartObjects:[],previewKey:null,createdAt:iso(),updatedAt:iso()};
 await putJsonObject(templateKey(id),record);return record;
}
export async function confirmMockupTemplateUpload(id){
 const record=await getMockupTemplate(id);
 if(!await artworkObjectExists(record.key))throw Error('PSD/PSB has not been uploaded.');
 record.status='ready';record.updatedAt=iso();await putJsonObject(templateKey(record.id),record);return record;
}
export async function updateMockupTemplate(id,params){
 const record=await getMockupTemplate(id);
 if(own(params,'collection'))record.collection=limitText(params.collection,100)||'Unsorted';
 if(own(params,'orientation')){
  record.orientation=normalizeTemplateOrientation(params.orientation);
  // Chosen in the app: the PC folder name or the detected shape no longer change it.
  record.orientationSource='user';
 }
 if(own(params,'squareCompatible'))record.squareCompatible=params.squareCompatible===true;
 if(own(params,'mapping')){
  record.mapping=params.mapping?{path:validateMappingPath(params.mapping.path),verifiedFrom:'admin-selected'}:null;
 }
 if(own(params,'smartObjects')){
  record.smartObjects=(Array.isArray(params.smartObjects)?params.smartObjects:[]).slice(0,200)
    .map(x=>({path:limitText(x.path,400),name:limitText(x.name,160),visible:!!x.visible,kind:limitText(x.kind,20)}));
 }
 record.updatedAt=iso();await putJsonObject(templateKey(record.id),record);return record;
}
export async function deleteMockupTemplate(id){
 const r=await getMockupTemplate(id);
 if(r.source==='pc')throw Error('"'+r.name+'" comes from the mockup folder on the PC: delete or move the file there.');
 r.status='deleted';r.updatedAt=iso();await putJsonObject(templateKey(id),r);
 await deleteArtworkObject(r.key);
 if(r.previewKey)await deleteArtworkObject(r.previewKey);
 return {id,deleted:true};
}
// ------------------------------------------------------- PC folder templates
// PSDs kept in a folder on the PC (the worker's "mockupFolder" for this shop).
// The worker reports the files; each keeps a stable ID from its path in the
// folder, so its artwork layer and orientation survive edits. The PSD never
// goes to R2: the worker renders straight from the file.
const PC_TEMPLATE_PATH=/^(?!.*(?:^|\/)\.\.(?:\/|$))[^\\:*?"<>|]{1,400}\.(psd|psb)$/i;
export function pcTemplateId(relativePath){
 const h=crypto.createHash('sha256').update('pc-folder|'+String(relativePath).toLowerCase()).digest('hex');
 return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20,32);
}
// "Vertical", "Horizontal", "Square" or "Panoramic" in a folder name gives the
// orientation: the subfolders the PSD is in, or the chosen mockup folder itself
// (e.g. "Silvia Art Co Horizontal"). The folder nearest the file wins, and
// "Horizontal Panoramic" is panoramic.
export function orientationFromFolder(relativePath,mockupFolder=''){
 const chosen=String(mockupFolder).split(/[\\/]/).filter(Boolean).pop()||'';
 const folders=[chosen,...String(relativePath).split('/').slice(0,-1)].filter(Boolean).reverse();
 for(const name of folders.map(f=>f.toLowerCase())){
  if(/\b(panoramic|panoramas?|panos?)\b/.test(name))return 'panoramic';
  if(/\b(vertical|portrait)s?\b/.test(name))return 'portrait';
  if(/\b(horizontal|landscape)s?\b/.test(name))return 'landscape';
  if(/\bsquares?\b/.test(name))return 'square';
 }
 return '';
}
export async function syncPcTemplates(files,{mockupFolder=''}={}){
 if(!Array.isArray(files))throw Error('The PC folder list is missing.');
 const all=await listJSON(ROOT+'/templates/',/\/meta\.json$/,1800);
 const records=all.filter(r=>r.source==='pc');
 // The uploaded copy of the same PSD, if any (same name, or same size when the
 // file was renamed): its settings carry over.
 const uploads=all.filter(r=>r.source!=='pc'&&r.status==='ready');
 const uploaded=new Map(uploads.map(r=>[twinName(r),r])),uploadedBySize=new Map(uploads.map(r=>[Number(r.size),r]));
 const byId=new Map(records.map(r=>[r.id,r])),seen=new Set();
 let changed=0;
 for(const file of files.slice(0,600)){
  const relativePath=String(file?.path||'').replace(/\\/g,'/').replace(/^\/+/,'');
  const size=Number(file?.size),mtimeMs=Math.round(Number(file?.mtimeMs));
  if(!PC_TEMPLATE_PATH.test(relativePath)||!Number.isSafeInteger(size)||size<100||!Number.isFinite(mtimeMs))continue;
  const id=pcTemplateId(relativePath),previous=byId.get(id),folderOrientation=orientationFromFolder(relativePath,mockupFolder);
  seen.add(id);
  const name=safeFilename(relativePath.split('/').pop());
  const record=previous?{...previous}:{id,source:'pc',localPath:relativePath,name,key:null,
   collection:relativePath.includes('/')?relativePath.split('/').slice(0,-1).join(' / ').slice(0,100):'PC folder',
   orientation:'unclassified',squareCompatible:false,smartObjects:[],previewKey:null,createdAt:iso(),
   mapping:knownMockupArtworkTarget(name)?{path:'5',verifiedFrom:'known-template'}:null};
  record.localPath=relativePath;record.name=name;record.size=size;record.mtimeMs=mtimeMs;record.status='ready';
  // Settings made on the uploaded copy (artwork layer, orientation) carry over.
  const twin=uploaded.get(twinName(record))||uploadedBySize.get(size);
  if(twin){
   if(!record.mapping?.path&&twin.mapping?.path)record.mapping={...twin.mapping};
   if(record.orientation==='unclassified'&&twin.orientation&&twin.orientation!=='unclassified'){
    record.orientation=twin.orientation;record.orientationSource='uploaded';
   }
   record.squareCompatible=record.squareCompatible||twin.squareCompatible===true;
  }
  if(folderOrientation&&record.orientationSource!=='user'){record.orientation=folderOrientation;record.orientationSource='folder'}
  const differs=!previous||['status','size','mtimeMs','localPath','orientation','squareCompatible'].some(k=>previous[k]!==record[k])||
   JSON.stringify(previous.mapping||null)!==JSON.stringify(record.mapping||null);
  if(differs){record.updatedAt=iso();await putJsonObject(templateKey(id),record);changed++}
 }
 // A PSD no longer in the folder is no longer offered.
 for(const record of records)if(!seen.has(record.id)&&record.status!=='deleted'){
  record.status='deleted';record.updatedAt=iso();await putJsonObject(templateKey(record.id),record);changed++;
 }
 return {templates:seen.size,changed};
}
// The folder on the PC (set in the Product Creator); the worker learns it from
// its heartbeat reply. A "mockupFolder" in the worker's own config wins.
const PC_FOLDER_KEY=ROOT+'/pc-folder.json';
let pcFolderCache=null;
export async function getPcMockupFolder(){
 if(pcFolderCache===null){
  try{pcFolderCache=String((await optional(PC_FOLDER_KEY))?.folder||'')}catch{return ''}
 }
 return pcFolderCache;
}
export async function setPcMockupFolder(folder){
 const value=String(folder||'').trim().replace(/^"(.*)"$/,'$1').slice(0,300);
 if(/[\u0000-\u001f<>|?*]/.test(value))throw Error('That folder path contains characters a Windows folder cannot have.');
 await putJsonObject(PC_FOLDER_KEY,{folder:value,updatedAt:iso()});
 pcFolderCache=value;
 return value;
}
// The worker detects a PC template's orientation from its artwork layer's shape
// once it has prepared it; a folder name or the app's choice comes first.
export async function setDetectedTemplateOrientation(id,orientation,squareCompatible=false){
 const record=await getMockupTemplate(id);
 if(record.source!=='pc'||['user','folder','uploaded'].includes(record.orientationSource))return record;
 const detected=normalizeTemplateOrientation(orientation);
 if(record.orientation===detected&&record.orientationSource==='detected')return record;
 record.orientation=detected;record.orientationSource='detected';
 record.squareCompatible=record.squareCompatible||squareCompatible===true;
 record.updatedAt=iso();await putJsonObject(templateKey(id),record);return record;
}
export async function registerMockupTemplatePreview(id,key){
 const r=await getMockupTemplate(id);r.previewKey=key;r.updatedAt=iso();await putJsonObject(templateKey(id),r);return r;
}
export async function listMockupJobs(limit=1000){
 const records=await listJSON(ROOT+'/jobs/',/\/meta\.json$/,limit);
 return records.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
}
export async function getMockupJob(id){
 const value=await optional(jobKey(assertId(id)));
 if(!value||value.deleted)throw Error('Mockup batch not found.');
 return value;
}
// The artwork fills the template's artwork layer ("cover"): where their shapes
// differ its edges are trimmed rather than leaving white bands ("contain").
export async function createMockupJob({filename,size,templateIds,fitMode='cover',artworkOrientation='unclassified'}){
 const artName=safeFilename(filename),extension=extFile(artName,['jpg','jpeg','png','webp','tif','tiff']);
 if(!Array.isArray(templateIds)||!templateIds.length||templateIds.length>150)
  throw Error('Select between 1 and 150 templates.');
 if(!['contain','cover'].includes(fitMode))throw Error('Invalid artwork fitting mode.');
 if(!Number.isSafeInteger(Number(size))||Number(size)<100||Number(size)>200*1024*1024)
  throw Error('Artwork must be 100 bytes–200 MB.');
 const ids=[...new Set(templateIds.map(assertId))];const templates=await Promise.all(ids.map(getMockupTemplate));
 if(templates.some(t=>t.status!=='ready'))throw Error('One or more selected PSD templates have not finished uploading.');
 const normalizedArtworkOrientation=normalizeTemplateOrientation(artworkOrientation);
 if(normalizedArtworkOrientation!=='unclassified')
  validateTemplateSelection(templates,normalizedArtworkOrientation);
 const id=crypto.randomUUID(),created=iso();
 const job={id,createdAt:created,updatedAt:created,filename:artName,
  artworkKey:ROOT+'/jobs/'+id+'/artwork.'+extension,artworkSize:Number(size),artworkUploaded:false,
  fitMode,artworkOrientation:normalizedArtworkOrientation,status:'awaiting_artwork',paused:false,lease:null,
  templates:templates.map(t=>({id:t.id,name:t.name,outputName:outputFileName(t.name),
    status:'queued',progress:'Waiting for PC worker',attempts:0,outputKey:null,error:null,dimensions:null,usedMapping:null})),
  history:[{at:created,event:'created'}]};
 await putJsonObject(jobKey(id),job);return job;
}
// Batch records are read, changed and written back to R2. The PC worker now
// renders several PSDs of a batch at once, so changes to one batch run one at a
// time (this server is a single process) and no update overwrites another.
const jobLocks=new Map();
export function withMockupJobLock(id,task){
 const previous=jobLocks.get(id)||Promise.resolve();
 const result=previous.then(task,task);
 const tail=result.catch(()=>{});
 jobLocks.set(id,tail);
 void tail.then(()=>{if(jobLocks.get(id)===tail)jobLocks.delete(id)});
 return result;
}
export async function putMockupJob(job){job.updatedAt=iso();job.history=(job.history||[]).slice(-120);await putJsonObject(jobKey(job.id),job);return job}
// `local`: the browser handed the artwork straight to the PC worker on this
// computer, so nothing is in R2 yet (it is copied there when linked).
export async function markMockupArtworkUploaded(id,{local=false}={}){
 return withMockupJobLock(id,async()=>{
 const r=await getMockupJob(id);
 if(!local&&!await artworkObjectExists(r.artworkKey))throw Error('Artwork upload missing.');
 r.artworkUploaded=true;r.artworkLocal=local===true;r.status='queued';
 r.history.push({at:iso(),event:local?'artwork_given_to_pc_worker':'artwork_uploaded'});
 return putMockupJob(r);
});
}
export const MOCKUP_LEASE_MS=120_000;
// Ties a batch started straight from the selected file to the artwork record
// once its R2 upload completes, so its JPGs can be applied to the Etsy draft.
export async function linkMockupArtwork(id,{artworkId,masterKey,orientation}){
 return withMockupJobLock(id,async()=>{
 const j=await getMockupJob(id);
 j.artworkId=artworkId;j.sourceMasterKey=masterKey;
 if(orientation)j.artworkOrientation=normalizeTemplateOrientation(orientation);
 j.history.push({at:iso(),event:'linked_to_artwork',artworkId});
 return putMockupJob(j);
});
}
export function hasActiveMockupLease(job,now=Date.now()){
 const lease=job?.lease;
 if(!lease?.owner)return false;
 const expires=Date.parse(lease.expiresAt);
 // Legacy 30-minute leases are judged by last activity too, so abandoned tabs recover promptly.
 const renewed=Date.parse(lease.renewedAt||job.updatedAt||'');
 return Number.isFinite(expires)&&Number.isFinite(renewed)&&expires>now&&renewed+MOCKUP_LEASE_MS>now;
}
const newMockupLease=owner=>{
 const now=Date.now();
 return {owner,renewedAt:new Date(now).toISOString(),expiresAt:new Date(now+MOCKUP_LEASE_MS).toISOString()};
};
export function isLeaseOwner(job,owner){
 return hasActiveMockupLease(job)&&job.lease.owner===owner;
}
export async function controlMockupJob(id,action,owner){
 return withMockupJobLock(id,async()=>{
 const j=await getMockupJob(id),active=hasActiveMockupLease(j);
 if(active&&j.lease.owner!==owner&&action!=='pause')
  throw Error('This batch is already being processed by the shared PC worker. Wait for the current PSD or stop the batch.');
 if(action==='pause'){
  j.paused=true;j.status='paused';
  if(!active)j.lease=null; // An active worker keeps its lease until it finishes the current PSD.
 }else if(action==='release'){
  // Called after the processor stops or when its browser closes.
  if(j.lease?.owner===owner||!active){
   j.lease=null;
   if(j.paused)j.status='paused';
   else if(j.templates.every(t=>t.status==='completed'))j.status='completed';
   else j.status='attention';
  }
 }else if(action==='resume'){
  if(!j.artworkUploaded)throw Error('Upload artwork first.');
  // An abandoned worker may leave one item marked processing; preserve completed JPGs.
  if(!active)for(const t of j.templates)if(t.status==='processing'){
   t.status='queued';t.error=null;t.startedAt=null;
  }
  j.paused=false;j.status='queued';j.lease=null; // Shared PC worker claims queued items independently.
 }else if(action==='retry'||action==='regenerate'){
  if(!j.artworkUploaded)throw Error('Upload artwork first.');
  for(const t of j.templates){
   if(action==='regenerate'||['failed','needs_mapping','processing','deleted'].includes(t.status)){
    t.status='queued';t.error=null;
    // Verified JPGs stay in R2 until replacements pass validation.
   }
  }
  j.paused=false;j.status='queued';j.lease=null; // Shared PC worker claims queued items independently.
 }else throw Error('Unsupported batch action.');
 j.history.push({at:iso(),event:action});return putMockupJob(j);
});
}
// Width and height from a JPEG's start-of-frame marker, or null.
export function jpegDimensions(buffer){
 if(!buffer||buffer[0]!==0xff||buffer[1]!==0xd8)return null;
 let offset=2;
 while(offset+9<buffer.length){
  if(buffer[offset]!==0xff){offset++;continue}
  const marker=buffer[offset+1];
  if(marker===0xd8||marker===0x01||(marker>=0xd0&&marker<=0xd7)){offset+=2;continue}
  const length=buffer.readUInt16BE(offset+2);
  if(marker>=0xc0&&marker<=0xcf&&![0xc4,0xc8,0xcc].includes(marker))
   return {height:buffer.readUInt16BE(offset+5),width:buffer.readUInt16BE(offset+7)};
  offset+=2+length;
 }
 return null;
}
export const mockupPreviewKey=outputKey=>String(outputKey).replace(/\.jpg$/,'.preview.jpg');
// 2400 px copy the server uploads to Etsy as-is.
export const mockupEtsyKey=outputKey=>String(outputKey).replace(/\.jpg$/,'.etsy.jpg');
// The JPG to read now: the full-size one, or its 2400 px Etsy copy while the
// PC worker is still uploading the full-size one.
export const mockupFileKey=item=>item?.fullPending&&item.etsyKey?item.etsyKey:item?.outputKey;
// Claims up to `limit` queued PSDs of a batch in one write: the PC worker
// renders several at once.
export async function claimMockupWork(id,owner,limit=1){
 return withMockupJobLock(id,async()=>{
 const j=await getMockupJob(id);
 if(!j.artworkUploaded)throw Error('Artwork is not uploaded.');
 if(j.paused)return {job:j,item:null,paused:true};
 const active=hasActiveMockupLease(j);
 if(active&&j.lease.owner!==owner)
  throw Error('The shared PC worker or another session is still processing this batch.');
 if(!active){
  // The previous worker is gone. Requeue anything it could not finish.
  for(const t of j.templates)if(t.status==='processing'){
   t.status='queued';t.error=null;t.startedAt=null;
  }
 }
 j.lease=newMockupLease(owner);
 const item=j.templates.find(t=>t.status==='queued');
 if(!item){
  // PSDs this worker is still rendering keep the batch leased to it.
  if(j.templates.some(t=>t.status==='processing')){j.status='running';await putMockupJob(j);return {job:j,item:null}}
  const incomplete=j.templates.filter(t=>t.status!=='completed');
  j.status=incomplete.length?'attention':'completed';j.lease=null;
  await putMockupJob(j);return {job:j,item:null,items:[]};
 }
 const items=j.templates.filter(t=>t.status==='queued').slice(0,Math.max(1,Math.min(8,Number(limit)||1)));
 for(const t of items){t.status='processing';t.attempts++;t.startedAt=iso();t.progressAt=t.startedAt;t.progress='Preparing PSD on PC'}
 j.status='running';
 await putMockupJob(j);return {job:j,item:items[0],items};
});
}
export async function completeMockupItem(id,owner,templateId,details){
 return withMockupJobLock(id,async()=>{
 const j=await getMockupJob(id);
 if(!isLeaseOwner(j,owner))throw Error('Worker lease expired or belongs to another browser.');
 const item=j.templates.find(x=>x.id===templateId);
 if(!item||item.status!=='processing')throw Error('This PSD is not claimed for processing.');
 item.status='completed';item.error=null;item.progress='Ready';item.outputKey=details.outputKey;item.dimensions=details.dimensions;
 item.previewKey=details.previewKey||null;
 item.etsyKey=details.etsyKey||null;
 // The worker sends the full-size JPG after the batch (fullPending until then).
 if(details.fullPending===true)item.fullPending=true;else delete item.fullPending;
 item.usedMapping=details.mapping||null;item.finishedAt=iso();
 j.history.push({at:iso(),event:'output_verified',name:item.name});
 await putMockupJob(j);return j;
});
}
// Failure notifications can arrive after a successful upload if the PC or HTTP reply stalls.
export function markMockupItemFailed(item,message,needsMapping=false){
 if(item.status==='completed')return false;
 if(item.status!=='processing')throw Error('This PSD is not claimed for processing.');
 item.status=needsMapping?'needs_mapping':'failed';
 item.error=limitText(message,500);
 item.progress=item.error;
 return true;
}
export async function failMockupItem(id,owner,templateId,message,needsMapping=false){
 return withMockupJobLock(id,async()=>{
 const j=await getMockupJob(id);
 if(!isLeaseOwner(j,owner))throw Error('Worker lease expired or belongs to another browser.');
 const item=j.templates.find(x=>x.id===templateId);
 if(!item)throw Error('Selected PSD is not part of this job.');
 if(!markMockupItemFailed(item,message,needsMapping))return j; // Keep a verified JPG completed.
 j.history.push({at:iso(),event:item.status,name:item.name,reason:item.error});
 await putMockupJob(j);return j;
});
}
export async function updateMockupItemProgress(id,owner,templateId,step){
 return withMockupJobLock(id,async()=>{
 const j=await getMockupJob(id);
 if(!isLeaseOwner(j,owner))throw Error('Worker lease expired or belongs to a different session.');
 const t=j.templates.find(x=>x.id===templateId);
 if(!t||t.status!=='processing')throw Error('PSD is not processing.');
 t.progress=limitText(step,220);t.progressAt=iso();
 j.lease=newMockupLease(owner); // Progress refreshes the renewable worker lease.
 return putMockupJob(j);
});
}
export function mockupOutputKey(jobId,templateId){
 assertId(jobId);assertId(templateId);
 return ROOT+'/jobs/'+jobId+'/outputs/'+templateId+'/'+crypto.randomUUID()+'.jpg';
}
export async function verifyMockupJpg(filePath){
 const metadata=await sharp(filePath,{limitInputPixels:24_000_001}).metadata();
 if(metadata.format!=='jpeg')throw Error('Output is not JPEG.');
 const {width,height}=metadata;
 if(!width||!height||width*height>24_000_000)throw Error('Mockup exceeds 24 megapixels.');
 if(width<150||height<150)throw Error('Output is unexpectedly small.');
 return {width,height};
}
export async function getMockupItemDownload(jobId,templateId){
 const job=await getMockupJob(jobId);
 const item=job.templates.find(t=>t.id===templateId);
 if(item?.status!=='completed'||!item.outputKey)throw Error('This mockup is not ready for download.');
 const key=mockupFileKey(item);
 return {url:await signedArtworkUrl(key,600),name:item.outputName,key,previewKey:item.previewKey||null};
}
// The full-size JPG of a completed mockup has arrived. Returns null when the
// mockup was regenerated or deleted meanwhile (that upload is not used).
export async function markMockupFullUploaded(id,templateId,outputKey,dimensions){
 return withMockupJobLock(id,async()=>{
 const j=await getMockupJob(id);
 const item=j.templates.find(x=>x.id===templateId);
 if(item?.status!=='completed'||item.outputKey!==outputKey||!item.fullPending)return null;
 delete item.fullPending;item.dimensions=dimensions;
 j.history.push({at:iso(),event:'full_jpg_uploaded',name:item.name});
 await putMockupJob(j);return {job:j,item};
});
}
export const MOCKUP_ROOT=ROOT;

export async function deleteMockupOutput(jobId,templateId){
 return withMockupJobLock(jobId,async()=>{
 const j=await getMockupJob(jobId);
 if(j.status==='running'&&Date.parse(j.lease?.expiresAt)>Date.now())
  throw Error('Pause the active batch before deleting an output.');
 const t=j.templates.find(x=>x.id===templateId);
 if(!t)throw Error('Mockup output not found in this job.');
 if(t.outputKey)await deleteArtworkObject(t.outputKey);
 if(t.previewKey)await deleteArtworkObject(t.previewKey).catch(()=>{});
 if(t.etsyKey)await deleteArtworkObject(t.etsyKey).catch(()=>{});
 t.outputKey=null;t.previewKey=null;t.etsyKey=null;t.dimensions=null;t.status='deleted';t.error=null;
 j.history.push({at:iso(),event:'output_deleted',name:t.name});
 return putMockupJob(j);
});
}
