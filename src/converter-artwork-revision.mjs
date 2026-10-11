// Safe staged replacement used ONLY for reconverting existing Etsy listings.
// New master and crops are isolated until Etsy verification passes.
import crypto from 'node:crypto';
import { loadArtworkManifest,saveArtworkManifest } from './artwork-storage.mjs';
import { createCropJob,getCropJob } from './crop-job-store.mjs';
import { checkedRevisionAssets } from './artwork-revision.mjs';
import { getJsonObject,putJsonObject,artworkObjectExists,artworkObjectInfo,signedArtworkUploadUrl } from './r2.mjs';

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
 const targetOrientation=String(orientation||manifest.orientation||'portrait').toLowerCase();
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
  if(sameFile&&job?.status!=='failed'){
   const present=await artworkObjectExists(previous.masterKey);
   const validUpload=present&&(await artworkObjectInfo(previous.masterKey)).size===file.size;
   if(present&&!validUpload)throw Error('The previous replacement upload is incomplete. Contact support before resuming this crop job.');
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
 const masterKey='artworks/'+aid+'/revisions/'+revision+'/master.'+file.ext;
 const record={
  shopId:String(shopId),listingId:id,artworkId:aid,revision,masterKey,
  filename:file.filename,contentType:file.contentType,size:file.size,sha256:file.sha256,
  originalMasterKey:manifest.master.key,orientation:targetOrientation,
  jobId:null,status:'awaiting_upload',createdAt:new Date().toISOString()
 };
 await putJsonObject(recordKey,record);
 return {resumed:false,revision,artworkId:aid,uploadAlreadyPresent:false,cropJobId:null,
  status:record.status,upload:{key:masterKey,contentType:file.contentType,
   uploadUrl:await signedArtworkUploadUrl(masterKey,file.contentType,45*60)}};
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
 if(record.jobId){
  const job=await getCropJob(record.jobId);
  if(!job)throw Error('Previously queued crop job could not be found. Review the listing before retrying.');
  return {record,job,reused:true};
 }
 const result=await createCropJob({artworkId:record.artworkId,
  masterKey:record.masterKey,orientation:record.orientation});
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
export async function activateConverterArtworkRevision({shopId,listingId,revision,artworkId}){
 const record=await getConverterArtworkRevision(shopId,listingId);
 if(record?.status==='activated'&&record.revision===String(revision)&&record.artworkId===artId(artworkId))
  return {artworkId:record.artworkId,revision:record.revision,alreadyActive:true};
 const {record:verified,assets}=await assertConverterArtworkReady({shopId,listingId,revision,artworkId});
 const manifest=await loadArtworkManifest(verified.artworkId);
 if(manifest.master?.key===verified.masterKey){
  verified.status='activated';verified.activatedAt ||= new Date().toISOString();
  await putJsonObject(keyFor(shopId,listingId),verified);
  return {artworkId:verified.artworkId,revision:verified.revision,alreadyActive:true};
 }
 if(manifest.master?.key!==verified.originalMasterKey)
  throw Error('The original master changed. Staged artwork was NOT activated.');
 const archive='artworks/'+verified.artworkId+'/revisions/'+verified.revision+'/previous-manifest.json';
 await putJsonObject(archive,manifest);
 const updatedAt=new Date().toISOString();
 await saveArtworkManifest({...manifest,master:{
  key:verified.masterKey,originalFilename:verified.filename,
  contentType:verified.contentType,size:verified.size
 },fulfillmentRatios:assets,fulfillmentRatiosReady:true,
  fulfillmentRatioInsufficient:{},fulfillmentRatiosUpdatedAt:updatedAt,
  production:{},cropWorkerJobId:verified.jobId,
  activeArtworkRevision:verified.revision,previousManifestSnapshotKey:archive,
  lastArtworkReconversion:{listingId:String(listingId),revision:verified.revision,
   previousMasterKey:verified.originalMasterKey,activatedAt:updatedAt}
 });
 verified.status='activated';verified.activatedAt=updatedAt;
 await putJsonObject(keyFor(shopId,listingId),verified);
 return {artworkId:verified.artworkId,revision:verified.revision,alreadyActive:false};
}
