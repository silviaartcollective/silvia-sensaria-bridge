import crypto from 'node:crypto';
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
 if(/^vertical[ _-]*close[ _-]*up[ _-]*framed[ _-]*(?:light[ _-]*wood|dark[ _-]*wood|black)[ _-]*mockup\.(?:psd|psb)$/i.test(String(name||'')))
   return '5';
 return null; // Never guess among multiple Smart Objects.
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
 const objects=(Array.isArray(list)?list:[]).filter(x=>x&&x.kind==='smart'&&x.visible!==false&&typeof x.path==='string')
    .map(x=>({name:limitText(x.name,160),path:limitText(x.path,400),visible:true}));
 const expected=template?.mapping?.path||knownMockupArtworkTarget(template?.name);
 if(expected){
   const selected=objects.find(x=>x.path===expected||x.name===expected);
   if(selected)return {status:'mapped',path:selected.path,objects};
   return {status:'needs_mapping',reason:'Saved artwork Smart Object not found or hidden.',objects};
 }
 if(objects.length===1)return {status:'mapped',path:objects[0].path,objects};
 return {status:'needs_mapping',reason:objects.length?'Multiple visible Smart Objects; select the artwork layer.':'No visible editable Smart Objects detected.',objects};
}
async function listJSON(prefix,regex,limit=1000) {
 const client=r2Client(),bucket=r2Config().bucket;
 const keys=[];let marker;
 do {
   const data=await client.send(new ListObjectsV2Command({Bucket:bucket,Prefix:prefix,ContinuationToken:marker,MaxKeys:1000}));
   for(const o of data.Contents||[])if(regex.test(o.Key||'')){keys.push(o.Key);if(keys.length>=limit)break}
   marker=data.IsTruncated?data.NextContinuationToken:null;
 }while(marker&&keys.length<limit);
 const results=[];for(let i=0;i<keys.length;i+=8){
  results.push(...(await Promise.all(keys.slice(i,i+8).map(async key=>optional(key)))).filter(Boolean));
 }
 return results;
}
export async function listMockupTemplates(){
 const records=await listJSON(ROOT+'/templates/',/\/meta\.json$/,1800);
 return records.filter(x=>x.status!=='deleted').sort((a,b)=>a.name.localeCompare(b.name));
}
export async function getMockupTemplate(id){
 const value=await optional(templateKey(assertId(id)));
 if(!value||value.status==='deleted')throw Error('Mockup template not found.');
 return value;
}
export async function reserveMockupTemplate({name,size,collection='Unsorted'}){
 const filename=safeFilename(name),ext=extFile(filename,['psd','psb']),bytes=Number(size);
 if(!Number.isSafeInteger(bytes)||bytes<100||bytes>350*1024*1024)throw Error('PSD/PSB must be 100 bytes–350 MB.');
 const id=crypto.randomUUID();
 const record={id,name:filename,collection:limitText(collection,100)||'Unsorted',size:bytes,
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
 const r=await getMockupTemplate(id);r.status='deleted';r.updatedAt=iso();await putJsonObject(templateKey(id),r);
 await deleteArtworkObject(r.key);
 if(r.previewKey)await deleteArtworkObject(r.previewKey);
 return {id,deleted:true};
}
export async function registerMockupTemplatePreview(id,key){
 const r=await getMockupTemplate(id);r.previewKey=key;r.updatedAt=iso();await putJsonObject(templateKey(id),r);return r;
}
export async function listMockupJobs(){
 const records=await listJSON(ROOT+'/jobs/',/\/meta\.json$/,1000);
 return records.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
}
export async function getMockupJob(id){
 const value=await optional(jobKey(assertId(id)));
 if(!value||value.deleted)throw Error('Mockup batch not found.');
 return value;
}
export async function createMockupJob({filename,size,templateIds,fitMode='contain'}){
 const artName=safeFilename(filename),extension=extFile(artName,['jpg','jpeg','png','webp','tif','tiff']);
 if(!Array.isArray(templateIds)||!templateIds.length||templateIds.length>150)
  throw Error('Select between 1 and 150 templates.');
 if(!['contain','cover'].includes(fitMode))throw Error('Invalid artwork fitting mode.');
 if(!Number.isSafeInteger(Number(size))||Number(size)<100||Number(size)>200*1024*1024)
  throw Error('Artwork must be 100 bytes–200 MB.');
 const ids=[...new Set(templateIds.map(assertId))];const templates=await Promise.all(ids.map(getMockupTemplate));
 if(templates.some(t=>t.status!=='ready'))throw Error('One or more selected PSD templates have not finished uploading.');
 const id=crypto.randomUUID(),created=iso();
 const job={id,createdAt:created,updatedAt:created,filename:artName,
  artworkKey:ROOT+'/jobs/'+id+'/artwork.'+extension,artworkSize:Number(size),artworkUploaded:false,
  fitMode,status:'awaiting_artwork',paused:false,lease:null,
  templates:templates.map(t=>({id:t.id,name:t.name,outputName:outputFileName(t.name),
    status:'queued',attempts:0,outputKey:null,error:null,dimensions:null,usedMapping:null})),
  history:[{at:created,event:'created'}]};
 await putJsonObject(jobKey(id),job);return job;
}
export async function putMockupJob(job){job.updatedAt=iso();job.history=(job.history||[]).slice(-120);await putJsonObject(jobKey(job.id),job);return job}
export async function markMockupArtworkUploaded(id){
 const r=await getMockupJob(id);
 if(!await artworkObjectExists(r.artworkKey))throw Error('Artwork upload missing.');
 r.artworkUploaded=true;r.status='queued';r.history.push({at:iso(),event:'artwork_uploaded'});
 return putMockupJob(r);
}
export function isLeaseOwner(job,owner){
 return job.lease?.owner===owner && Date.parse(job.lease?.expiresAt)>Date.now();
}
export async function controlMockupJob(id,action,owner){
 const j=await getMockupJob(id);
 if(action==='pause'){j.paused=true;j.status='paused';}
 else if(action==='resume'){
  if(!j.artworkUploaded)throw Error('Upload artwork first.');
  if(j.lease && Date.parse(j.lease.expiresAt)>Date.now() && j.lease.owner!==owner)
   throw Error('This batch is currently running in another browser.');
  j.paused=false;j.status='queued';
  j.lease={owner,expiresAt:new Date(Date.now()+30*60*1000).toISOString()};
 }else if(action==='retry'||action==='regenerate'){
  if(j.lease&&Date.parse(j.lease.expiresAt)>Date.now()&&j.lease.owner!==owner)
   throw Error('Cannot rerun while another browser owns the job.');
  for(const t of j.templates){
   if(action==='regenerate'||['failed','needs_mapping','processing'].includes(t.status)){
    t.status='queued';t.error=null;
    // The previous verified JPG remains stored until its replacement is verified.
   }
  }
  j.paused=false;j.status='queued';j.lease={owner,expiresAt:new Date(Date.now()+30*60*1000).toISOString()};
 }else throw Error('Unsupported batch action.');
 j.history.push({at:iso(),event:action});return putMockupJob(j);
}
export async function claimMockupWork(id,owner){
 const j=await getMockupJob(id);
 if(!j.artworkUploaded)throw Error('Artwork is not uploaded.');
 if(j.paused)return {job:j,item:null,paused:true};
 if(j.lease&&Date.parse(j.lease.expiresAt)>Date.now()&&j.lease.owner!==owner)
  throw Error('Another browser is running this job; retry after its lease expires.');
 j.lease={owner,expiresAt:new Date(Date.now()+30*60*1000).toISOString()};
 let item=j.templates.find(t=>t.status==='processing');
 if(item && (item.startedAt && Date.now()-Date.parse(item.startedAt)>30*60*1000)){
  item.status='queued';item=null;
 }
 if(!item)item=j.templates.find(t=>t.status==='queued');
 if(!item){
  const incomplete=j.templates.filter(t=>t.status!=='completed');
  j.status=incomplete.length?'attention':'completed';j.lease=null;
  await putMockupJob(j);return {job:j,item:null};
 }
 item.status='processing';item.attempts++;item.startedAt=iso();j.status='running';
 await putMockupJob(j);return {job:j,item};
}
export async function completeMockupItem(id,owner,templateId,details){
 const j=await getMockupJob(id);
 if(!isLeaseOwner(j,owner))throw Error('Worker lease expired or belongs to another browser.');
 const item=j.templates.find(x=>x.id===templateId);
 if(!item||item.status!=='processing')throw Error('This PSD is not claimed for processing.');
 item.status='completed';item.error=null;item.outputKey=details.outputKey;item.dimensions=details.dimensions;
 item.usedMapping=details.mapping||null;item.finishedAt=iso();
 j.history.push({at:iso(),event:'output_verified',name:item.name});
 await putMockupJob(j);return j;
}
export async function failMockupItem(id,owner,templateId,message,needsMapping=false){
 const j=await getMockupJob(id);
 if(!isLeaseOwner(j,owner))throw Error('Worker lease expired or belongs to another browser.');
 const item=j.templates.find(x=>x.id===templateId);
 if(!item)throw Error('Selected PSD is not part of this job.');
 item.status=needsMapping?'needs_mapping':'failed';item.error=limitText(message,500);
 j.history.push({at:iso(),event:item.status,name:item.name,reason:item.error});
 await putMockupJob(j);return j;
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
 return {url:await signedArtworkUrl(item.outputKey,600),name:item.outputName,key:item.outputKey};
}
export const MOCKUP_ROOT=ROOT;
