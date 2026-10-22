// Safe staged replacement used ONLY for reconverting existing Etsy listings.
// New master and crops are isolated until Etsy verification passes.
import crypto from 'node:crypto';
import { loadArtworkManifest,saveArtworkManifest } from './artwork-storage.mjs';
import { createCropJob,getCropJob,readCropJobStore } from './crop-job-store.mjs';
import { checkedRevisionAssets } from './artwork-revision.mjs';
import {inspectStoredMasterGeometry} from './master-geometry.mjs';
import {FULFILLMENT_RATIOS,SQUARE_FULFILLMENT_RATIOS,PANORAMIC_FULFILLMENT_RATIOS,fulfillmentRatioObjectKey,fulfillmentRatiosForOrientation} from './artwork-ratios.mjs';
import { getJsonObject,putJsonObject,artworkObjectExists,artworkObjectInfo,signedArtworkUploadUrl,
  copyArtworkObject,deleteArtworkObject,listArtworkObjectKeys,listArtworkObjects } from './r2.mjs';

const TYPES={jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',tif:'image/tiff',tiff:'image/tiff'};
const textId=value=>{
 const id=String(value||'').trim();
 if(!/^[1-9]\d{0,19}$/.test(id))throw Error('A valid Etsy listing ID is required.');
 return id;
};
const artId=value=>{
 const id=String(value||'').trim().toUpperCase();
 if(!/^(SAC|JAC)\d+$/.test(id))throw Error('A linked artwork ID is required.');
 return id;
};
const keyFor=(shopId,listingId)=>'migrations/listing-reconverter/'+textId(shopId)+'/'+textId(listingId)+'.json';
async function readOptional(key){
 try{return await getJsonObject(key)}
 catch(e){if(e?.$metadata?.httpStatusCode===404||['NoSuchKey','NotFound'].includes(e?.name))return null;throw e}
}
export async function getConverterArtworkRevision(shopId,listingId){
 return readOptional(keyFor(shopId,listingId));
}
function checkUploadedSource(input){
 const filename=String(input?.filename||'').trim().slice(0,180);
 const ext=filename.toLowerCase().match(/\.([a-z]+)$/)?.[1];
 const size=Number(input?.size),sha256=String(input?.sha256||'').toLowerCase();
 if(!TYPES[ext])throw Error('Choose a JPG, PNG, WebP or TIFF master image.');
 if(!Number.isSafeInteger(size)||size<1024||size>200*1024*1024)
  throw Error('The master artwork must be between 1 KB and 200 MB.');
 if(!/^[a-f0-9]{64}$/.test(sha256))
  throw Error('The new artwork file fingerprint is missing. Select the file again and retry.');
 return {filename,ext,contentType:TYPES[ext],size,sha256};
}
export async function reserveConverterArtworkRevision({shopId,listingId,artworkId,master,orientation}){
 const id=textId(listingId),aid=artId(artworkId);
 const file=checkUploadedSource(master);
 const manifest=await loadArtworkManifest(aid);
 if(manifest?.status!=='ready'||!manifest.master?.key)
  throw Error('The existing master artwork is not ready in R2.');
 const requested=String(orientation||'auto').toLowerCase();
 const targetOrientation=requested==='auto'?manifest.orientation:requested;
 if(targetOrientation!==String(manifest.orientation||'portrait').toLowerCase())
  throw Error('The uploaded artwork orientation differs from the existing listing. Choose artwork with the same orientation.');
 const recordKey=keyFor(shopId,id);
 const previous=await readOptional(recordKey);
 const stagingActive=previous&&previous.status!=='activated'&&previous.status!=='abandoned';
 if(stagingActive){
  if(previous.artworkId!==aid || previous.originalMasterKey!==manifest.master.key)
   throw Error('An earlier reconversion changed the artwork linkage. Refresh the listing before retrying.');
  const job=previous.jobId?await getCropJob(previous.jobId):null;
  const sameFile=previous.filename===file.filename&&previous.size===file.size&&
   Boolean(previous.sha256)&&previous.sha256===file.sha256;
  if(sameFile&&job?.status!=='failed'&&!previous.masterKey.includes('/revisions/')){
   const present=await artworkObjectExists(previous.masterKey);
   const validUpload=present&&(await artworkObjectInfo(previous.masterKey)).size===file.size;
   if(present&&!validUpload&&previous.jobId)
    throw Error('The uploaded master is incomplete but its crop job has started. Wait for that job to fail before retrying with a new revision.');
   return {resumed:true,revision:previous.revision,artworkId:aid,
    uploadAlreadyPresent:validUpload,cropJobId:previous.jobId||null,
    status:previous.status,
    upload:{key:previous.masterKey,contentType:previous.contentType,
      uploadUrl:await signedArtworkUploadUrl(previous.masterKey,previous.contentType,45*60)}};
  }
  if(job&&['pending','claimed','processing','uploading'].includes(job.status))
   throw Error('A different artwork file is still being cropped for this listing. Wait for the current job to finish before uploading another.');
  // Failed/completed previous jobs are immutable. Use a new staging key for a new
  // file (or a clean retry), never overwrite bytes a crop worker might be reading.
 }
 const revision=crypto.randomUUID();
 const masterKey='artworks/'+aid+'/.reconvert/'+revision+'/master.'+file.ext;
 const record={
  shopId:String(shopId),listingId:id,artworkId:aid,revision,masterKey,
  filename:file.filename,contentType:file.contentType,size:file.size,sha256:file.sha256,
  originalMasterKey:manifest.master.key,orientation:targetOrientation,
  jobId:null,status:'awaiting_upload',temporary:true,createdAt:new Date().toISOString()
 };
 await putJsonObject(recordKey,record);
 return {resumed:false,revision,artworkId:aid,uploadAlreadyPresent:false,cropJobId:null,
  status:record.status,upload:{key:masterKey,contentType:file.contentType,
   uploadUrl:await signedArtworkUploadUrl(masterKey,file.contentType,45*60)}};
}
// Regenerate production crops from the master already stored in R2, without
// re-uploading it. The master is copied inside R2 into the same staging folder
// a fresh upload would use, so cropping, Etsy verification and promotion follow
// exactly the same safe path.
export async function reserveConverterArtworkRegeneration({shopId,listingId,artworkId}){
 const id=textId(listingId),aid=artId(artworkId);
 const manifest=await loadArtworkManifest(aid);
 if(manifest?.status!=='ready'||!manifest.master?.key)
  throw Error('The existing master artwork is not ready in R2.');
 const sourceKey=String(manifest.master.key);
 const ext=sourceKey.toLowerCase().match(/\.([a-z]+)$/)?.[1];
 if(!TYPES[ext])throw Error('The stored master has an unsupported file type: '+sourceKey);
 const recordKey=keyFor(shopId,id);
 const previous=await readOptional(recordKey);
 if(previous&&previous.status!=='activated'&&previous.status!=='abandoned'){
  if(previous.artworkId!==aid||previous.originalMasterKey!==sourceKey)
   throw Error('An earlier reconversion changed the artwork linkage. Refresh the listing before retrying.');
  const job=previous.jobId?await getCropJob(previous.jobId):null;
  if(previous.source==='existing-master'&&job?.status!=='failed'&&await artworkObjectExists(previous.masterKey))
   return {resumed:true,revision:previous.revision,artworkId:aid,uploadAlreadyPresent:true,
    cropJobId:previous.jobId||null,status:previous.status,source:'existing-master'};
  if(job&&['pending','claimed','processing','uploading'].includes(job.status))
   throw Error('Another artwork file is still being cropped for this listing. Wait for it to finish first.');
 }
 const info=await artworkObjectInfo(sourceKey);
 const revision=crypto.randomUUID();
 const masterKey='artworks/'+aid+'/.reconvert/'+revision+'/master.'+ext;
 await copyArtworkObject(sourceKey,masterKey);
 const original=String(manifest.master.originalFilename||'').trim();
 const filename=(original.toLowerCase().endsWith('.'+ext)?original:aid+'-master.'+ext).slice(0,180);
 const record={
  shopId:String(shopId),listingId:id,artworkId:aid,revision,masterKey,
  filename,contentType:info.contentType||TYPES[ext],size:info.size,sha256:'',
  source:'existing-master',originalMasterKey:sourceKey,orientation:manifest.orientation,
  jobId:null,status:'uploaded',temporary:true,createdAt:new Date().toISOString()
 };
 await putJsonObject(recordKey,record);
 return {resumed:false,revision,artworkId:aid,uploadAlreadyPresent:true,cropJobId:null,
  status:record.status,source:'existing-master'};
}
export async function startConverterArtworkCrop({shopId,listingId,revision,artworkId}){
 const record=await getConverterArtworkRevision(shopId,listingId);
 if(!record||record.revision!==String(revision)||record.artworkId!==artId(artworkId))
  throw Error('The replacement reservation is missing or changed. Refresh this listing.');
 const manifest=await loadArtworkManifest(record.artworkId);
 if(manifest.master?.key!==record.originalMasterKey)
  throw Error('The existing master changed before the replacement crops could start.');
 if(!await artworkObjectExists(record.masterKey))
  throw Error('Finish uploading the new artwork before requesting crops.');
 const uploaded=await artworkObjectInfo(record.masterKey);
 if(uploaded.size!==record.size)
  throw Error('New artwork upload size mismatch. Select and upload the master again before cropping.');
 const geometry=await inspectStoredMasterGeometry(record.masterKey);
 if(geometry.orientation!==manifest.orientation)
  throw Error('The replacement source is '+geometry.orientation+' but the listing is '+manifest.orientation+
    '. The app will not crop horizontal artwork into vertical ratios.');
 record.orientation=geometry.orientation;
 record.masterGeometry=geometry;
 if(record.jobId){
  const job=await getCropJob(record.jobId);
  if(!job)throw Error('Previously queued crop job could not be found. Review the listing before retrying.');
  return {record,job,reused:true};
 }
 const result=await createCropJob({artworkId:record.artworkId,
  masterKey:record.masterKey,orientation:record.orientation,width:geometry.width,height:geometry.height});
 record.jobId=result.job.id;record.status='cropping';record.cropQueuedAt=new Date().toISOString();
 await putJsonObject(keyFor(shopId,listingId),record);
 return {record,job:result.job,reused:result.reused};
}
export async function getConverterArtworkRevisionStatus(shopId,listingId){
 const record=await getConverterArtworkRevision(shopId,listingId);
 if(!record)return {exists:false};
 const job=record.jobId?await getCropJob(record.jobId):null;
 let ready=false,error='';
 if(job?.status==='completed'&&record.status!=='activated')
  try{await checkedRevisionAssets({...record,jobId:record.jobId},job);ready=true}
  catch(e){error=String(e.message||e)}
 return {exists:true,revision:record.revision,artworkId:record.artworkId,
  filename:record.filename,jobId:record.jobId,
  status:record.status==='activated'?'activated':job?.status||record.status,
  ready:ready||record.status==='activated',progress:job?.progress||0,
  currentRatio:job?.currentRatio||'',message:error||job?.error||job?.message||''};
}
// The status of several listings' artwork jobs from one read of the crop
// queue, for a page running several at once. Waiting jobs get their place
// in the queue (the PC worker crops one job at a time, oldest first).
export async function getConverterArtworkRevisionStatuses(shopId,listingIds){
 const ids=[...new Set(listingIds.map(Number).filter(id=>Number.isSafeInteger(id)&&id>0))].slice(0,60);
 const records=await Promise.all(ids.map(id=>getConverterArtworkRevision(shopId,id).catch(()=>null)));
 const jobs=(await readCropJobStore()).jobs||[];
 const pending=jobs.filter(job=>job.status==='pending').sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt)));
 const statuses={};
 for(const [index,record] of records.entries()){
  if(!record){statuses[ids[index]]={exists:false};continue}
  const job=record.jobId?jobs.find(item=>item.id===record.jobId)||null:null;
  let ready=false,error='';
  if(job?.status==='completed'&&record.status!=='activated')
   try{await checkedRevisionAssets({...record,jobId:record.jobId},job);ready=true}
   catch(e){error=String(e.message||e)}
  const place=job?.status==='pending'?pending.findIndex(item=>item.id===job.id)+1:0;
  statuses[ids[index]]={exists:true,revision:record.revision,artworkId:record.artworkId,
   filename:record.filename,source:record.source||'upload',jobId:record.jobId||null,
   status:record.status==='activated'?'activated':job?.status||record.status,
   ready:ready||record.status==='activated',progress:job?.progress||0,queuePosition:place,
   queuedAt:record.cropQueuedAt||null,
   currentRatio:job?.currentRatio||'',message:error||job?.error||job?.message||''};
 }
 return statuses;
}
export async function assertConverterArtworkReady({shopId,listingId,revision,artworkId}){
 const record=await getConverterArtworkRevision(shopId,listingId);
 if(!record||record.revision!==String(revision)||record.artworkId!==artId(artworkId))
  throw Error('The reconversion master upload does not match this listing.');
 if(record.status==='activated')throw Error('This artwork revision has already been activated. Select a new master for another reconversion.');
 const job=record.jobId?await getCropJob(record.jobId):null;
 const assets=await checkedRevisionAssets({...record,jobId:record.jobId},job);
 const uploaded=await artworkObjectInfo(record.masterKey);
 if(uploaded.size!==record.size)
  throw Error('Replacement master differs from the verified upload. Production artwork was not activated.');
 const manifest=await loadArtworkManifest(record.artworkId);
 if(manifest.master?.key!==record.originalMasterKey)
  throw Error('Existing master changed while the replacement was cropping. Reconversion stopped.');
 return {record,assets};
}
// Staged uploads and crops are disposable; successful artwork always uses
// artworks/ID/master.ext + artworks/ID/fulfillment/{ratio}.jpg + manifest.json.
export function canonicalReconversionKeys(artworkId,extension,orientation='portrait',master={}){
 const id=artId(artworkId),ext=String(extension||'').toLowerCase();
 if(!/^(jpg|jpeg|png|webp|tif|tiff)$/.test(ext))throw Error('Invalid master extension.');
 return {
  master:'artworks/'+id+'/master.'+ext,
  ratios:Object.fromEntries(fulfillmentRatiosForOrientation(orientation,master).map(r=>[r,fulfillmentRatioObjectKey(id,r)]))
 };
}
const pendingRoot=(record)=>'artworks/'+artId(record.artworkId)+'/.reconvert/'+record.revision+'/';
// Files derived from a previous master that the manifest no longer references
// after a reconversion. Mockups, the master, ratio crops and the manifest are
// never touched. Recent files are kept because a Sensaria or supplier order
// placed in the last 7 days may still be downloading them by signed URL.
export const STALE_DERIVED_FOLDERS=Object.freeze(['production/','fulfillment/by-size/','fulfillment/sensaria/']);
export const STALE_DERIVED_MIN_AGE_MS=7*24*60*60*1000;
export async function cleanupStaleDerivedFiles(artworkId,{now=Date.now(),minAgeMs=STALE_DERIVED_MIN_AGE_MS}={}){
 const root='artworks/'+artId(artworkId)+'/';
 const deleted=[],kept=[];
 for(const folder of STALE_DERIVED_FOLDERS){
  for(const item of await listArtworkObjects(root+folder)){
   const age=item.lastModified?now-item.lastModified.getTime():0;
   if(age>=minAgeMs){await deleteArtworkObject(item.key);deleted.push(item.key)}
   else kept.push(item.key);
  }
 }
 return {deleted,kept};
}
// Ratio crops that fit neither the old nor the new layout of an artwork (1:2
// and 1:3 on a horizontal listing, the regular ratios on a panoramic one).
// Its listing never sold those sizes, so no order can be downloading them.
// A replaced master keeps its old layout's crops for orders still in progress.
export function foreignRatioCrops(before,after){
 const used=new Set([...before,...after]);
 return [...FULFILLMENT_RATIOS,...SQUARE_FULFILLMENT_RATIOS,...PANORAMIC_FULFILLMENT_RATIOS].filter(ratio=>!used.has(ratio));
}
async function cleanupTemporary(record){
 const prefix=pendingRoot(record),keys=await listArtworkObjectKeys(prefix);
 await Promise.all(keys.map(key=>deleteArtworkObject(key)));
}
export async function activateConverterArtworkRevision({shopId,listingId,revision,artworkId}){
 const record=await getConverterArtworkRevision(shopId,listingId);
 if(!record||record.revision!==String(revision)||record.artworkId!==artId(artworkId))
  throw Error('The replacement upload has changed. Refresh the listing.');
 let manifest=await loadArtworkManifest(record.artworkId);
 if(record.status==='activated'||manifest.lastArtworkReconversion?.revision===record.revision){
  if(manifest.lastArtworkReconversion?.revision!==record.revision)
   throw Error('Artwork status does not match the active master.');
  if(record.status!=='activated'){
   record.status='activated';record.activatedAt||=new Date().toISOString();
   await putJsonObject(keyFor(shopId,listingId),record);
  }
  await cleanupTemporary(record).catch(error=>console.warn('Temporary reconversion cleanup:',error.message));
  return {artworkId:record.artworkId,revision:record.revision,alreadyActive:true};
 }
 const {record:checked,assets}=await assertConverterArtworkReady({shopId,listingId,revision,artworkId});
 manifest=await loadArtworkManifest(checked.artworkId);
 if(manifest.master?.key!==checked.originalMasterKey)
  throw Error('Original master changed before replacement. Nothing was deleted.');
 const ext=checked.filename.split('.').pop().toLowerCase(),dest=canonicalReconversionKeys(checked.artworkId,ext,checked.orientation,checked.masterGeometry);
 const sources=[
  {from:checked.masterKey,to:dest.master},
  ...fulfillmentRatiosForOrientation(checked.orientation,checked.masterGeometry).map(r=>({from:assets[r].key,to:dest.ratios[r]}))
 ];
 // Canonical assets are backed up only while promotion is in progress.
 let backups=Array.isArray(checked.promotionBackups)?checked.promotionBackups:null;
 if(!backups){
  backups=[];
  for(let i=0;i<sources.length;i++){
   const target=sources[i].to,exists=await artworkObjectExists(target);
   const backup=pendingRoot(checked)+'rollback/'+i;
   if(exists)await copyArtworkObject(target,backup);
   backups.push({target,backup:exists?backup:null});
  }
  checked.promotionBackups=backups;
  checked.status='promoting';
  await putJsonObject(keyFor(shopId,listingId),checked);
 }
 const rollback=async()=>{
  for(const item of backups){
   if(item.backup)await copyArtworkObject(item.backup,item.target);
   else await deleteArtworkObject(item.target);
  }
 };
 let manifestSaved=false;
 try{
  for(const pair of sources)await copyArtworkObject(pair.from,pair.to);
  const updatedAt=new Date().toISOString();
  const ratios=Object.fromEntries(fulfillmentRatiosForOrientation(checked.orientation,checked.masterGeometry).map(r=>[r,{
   ...assets[r],key:dest.ratios[r],sourceMasterKey:dest.master
  }]));
  const next={
   ...manifest,orientation:checked.orientation,master:{key:dest.master,originalFilename:checked.filename,
     contentType:checked.contentType,size:checked.size,
     width:checked.masterGeometry?.width,height:checked.masterGeometry?.height,
     orientation:checked.orientation},
   fulfillmentSizeCrops:{},
   fulfillmentRatios:ratios,fulfillmentRatiosReady:true,
   fulfillmentRatioInsufficient:{},fulfillmentRatiosUpdatedAt:updatedAt,
   production:{},cropWorkerJobId:checked.jobId,
   lastArtworkReconversion:{
    listingId:String(listingId),revision:checked.revision,
    previousMasterKey:checked.originalMasterKey,activatedAt:updatedAt
   }
  };
  delete next.activeArtworkRevision;
  delete next.previousManifestSnapshotKey;
  await saveArtworkManifest(next);
  manifestSaved=true;
  checked.status='activated';checked.activatedAt=updatedAt;
  await putJsonObject(keyFor(shopId,listingId),checked);
 }catch(error){
  if(!manifestSaved){
   try{await rollback()}
   catch(rollbackError){
    throw Error('Artwork promotion failed and restoring original assets also failed: '+
     rollbackError.message+'. Original manifest remains unchanged. '+error.message);
   }
   checked.status='cropping';
   delete checked.promotionBackups;
   await putJsonObject(keyFor(shopId,listingId),checked);
  }
  throw error;
 }
 await cleanupTemporary(checked).catch(error=>console.warn('Reconversion cleanup:',error.message));
 if(checked.originalMasterKey!==dest.master)
  await deleteArtworkObject(checked.originalMasterKey)
   .catch(error=>console.warn('Old master cleanup:',error.message));
 const legacyPrefix='artworks/'+checked.artworkId+'/revisions/';
 try{
  const queue=await readCropJobStore();
  const busy=(queue.jobs||[]).some(job=>
   ['pending','claimed','processing','uploading'].includes(job.status)&&
   String(job.masterKey||'').startsWith(legacyPrefix));
  if(busy)console.warn('Legacy revision cleanup delayed: another active crop job uses the old folder.');
  else{
   const legacyKeys=await listArtworkObjectKeys(legacyPrefix);
   for(const key of legacyKeys)await deleteArtworkObject(key);
  }
 }catch(error){console.warn('Legacy revision cleanup skipped:',error.message)}
 try{
  const cleaned=await cleanupStaleDerivedFiles(checked.artworkId);
  if(cleaned.deleted.length||cleaned.kept.length)
   console.info('[reconvert] '+checked.artworkId+': removed '+cleaned.deleted.length+
    ' stale derived file(s); kept '+cleaned.kept.length+' newer than 7 days.');
 }catch(error){console.warn('Stale derived file cleanup skipped:',error.message)}
 try{
  const removed=[],now=fulfillmentRatiosForOrientation(checked.orientation,checked.masterGeometry);
  // Regenerating from the stored master cannot change the listing's layout.
  const before=checked.source==='existing-master'?now:fulfillmentRatiosForOrientation(manifest.orientation,manifest.master);
  for(const ratio of foreignRatioCrops(before,now)){
   const key=fulfillmentRatioObjectKey(checked.artworkId,ratio);
   if(await artworkObjectExists(key)){await deleteArtworkObject(key);removed.push(ratio)}
  }
  if(removed.length)console.info('[reconvert] '+checked.artworkId+': removed crops for sizes its listing does not sell: '+removed.join(', '));
 }catch(error){console.warn('Unused ratio crop cleanup skipped:',error.message)}
 return {artworkId:checked.artworkId,revision:checked.revision,alreadyActive:false};
}
