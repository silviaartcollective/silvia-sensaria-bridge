import crypto from 'node:crypto';
import {loadArtworkManifest,saveArtworkManifest} from './artwork-storage.mjs';
import {createCropJob,getCropJob} from './crop-job-store.mjs';
import {getJsonObject,putJsonObject,artworkObjectExists,signedArtworkUploadUrl} from './r2.mjs';
import {FULFILLMENT_RATIOS,fulfillmentRatioObjectKey} from './artwork-ratios.mjs';
const PREFIX='SAC';
const validId=v=>{const id=String(v||'').toUpperCase();if(!new RegExp('^'+PREFIX+'\\d+$').test(id))throw Error('Converted '+PREFIX+' artwork required.');return id;};
const listId=v=>{const id=String(v||'');if(!/^[1-9]\d{0,19}$/.test(id))throw Error('Valid Etsy listing ID required.');return id;};
const recordKey=(shop,id)=>'reposter/'+String(shop)+'/'+listId(id)+'/artwork-revision.json';
function revisionMaster(id,rev,ext){return 'artworks/'+validId(id)+'/revisions/'+rev+'/master.'+ext;}
export function artworkIdFromInventory(inventory){
 const products=(inventory?.products||[]).filter(p=>(p.offerings||[]).some(x=>x.is_enabled));
 if(!products.length)throw Error('No enabled variants found.');
 const ids=new Set();
 for(const p of products){
  const match=new RegExp('^('+PREFIX+'\\d+)-(?:P|C|FC)-\\d{3,4}(?:-(?:BLK|WHT|NAT|BRN|DWD))?$').exec(String(p.sku||'').toUpperCase());
  if(!match)throw Error('Replace artwork requires converted '+PREFIX+' SKUs. Convert this listing first.');
  ids.add(match[1]);
 }
 if(ids.size!==1)throw Error('Variants reference multiple artworks.');
 return [...ids][0];
}
export function isStagedRevisionJob(job){
 const key=String(job?.masterKey||'');
 return /^artworks\/SAC\d+\/revisions\/[0-9a-f-]{36}\/master\.(?:jpg|jpeg|png|webp|tif|tiff)$/.test(key) &&
 key.startsWith('artworks/'+validId(job.artworkId)+'/');
}
export function cropOutputKeyForJob(job,ratio){
 const id=validId(job.artworkId);
 if(!FULFILLMENT_RATIOS.includes(ratio))throw Error('Invalid crop ratio.');
 if(isStagedRevisionJob(job)){
  const revision=job.masterKey.split('/')[3];
  return 'artworks/'+id+'/revisions/'+revision+'/fulfillment/'+ratio+'.jpg';
 }
 return fulfillmentRatioObjectKey(id,ratio);
}
async function optionalRecord(shop,id){
 try{return await getJsonObject(recordKey(shop,id))}
 catch(e){if(e?.$metadata?.httpStatusCode===404||['NoSuchKey','NotFound'].includes(e?.name))return null;throw e;}
}
const types={jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',tif:'image/tiff',tiff:'image/tiff'};
export async function reserveArtworkRevision({shopId,listingId,inventory,file}){
 const id=listId(listingId),artworkId=artworkIdFromInventory(inventory);
 const manifest=await loadArtworkManifest(artworkId);
 if(manifest?.status!=='ready'||!manifest.master?.key)throw Error('Artwork master is not ready in R2.');
 if(await optionalRecord(shopId,id))throw Error('An artwork revision already exists for this listing. Continue its existing crop job.');
 const size=Number(file?.size||0), ext=String(file?.name||'').toLowerCase().match(/\.(jpg|jpeg|png|webp|tif|tiff)$/)?.[1];
 if(!ext)throw Error('Artwork source must be JPG, PNG, WebP, or TIFF.');
 if(!Number.isSafeInteger(size)||size<1024||size>200*1024*1024)throw Error('Master must be 1KB–200MB.');
 const rev=crypto.randomUUID(),masterKey=revisionMaster(artworkId,rev,ext);
 const record={shopId:String(shopId),listingId:id,artworkId,revision:rev,masterKey,
  filename:String(file.name).slice(0,180),contentType:types[ext],size,
  previousMasterKey:manifest.master.key,orientation:manifest.orientation,
  status:'awaiting_upload',jobId:null,createdAt:new Date().toISOString()};
 await putJsonObject(recordKey(shopId,id),record);
 return {artworkId,revision:rev,masterKey,orientation:record.orientation,
  uploadUrl:await signedArtworkUploadUrl(masterKey,record.contentType,45*60)};
}
export async function startArtworkRevisionCrop({shopId,listingId}){
 const record=await optionalRecord(shopId,listingId);
 if(!record)throw Error('Upload a replacement source first.');
 if(record.jobId){
  const job=await getCropJob(record.jobId);
  if(!job)throw Error('Saved crop job expired; review before retrying.');
  return {record,job,reused:true};
 }
 if(!await artworkObjectExists(record.masterKey))throw Error('New source upload has not finished.');
 const manifest=await loadArtworkManifest(record.artworkId);
 if(manifest.master?.key!==record.previousMasterKey)throw Error('Artwork changed since upload reservation.');
 const created=await createCropJob({artworkId:record.artworkId,masterKey:record.masterKey,orientation:record.orientation});
 record.jobId=created.job.id;record.status='cropping';record.cropQueuedAt=new Date().toISOString();
 await putJsonObject(recordKey(shopId,listingId),record);
 return {record,job:created.job,reused:created.reused};
}
export async function checkedRevisionAssets(record,job){
 if(!record?.jobId||!job||job.id!==record.jobId||job.status!=='completed')throw Error('New artwork crops have not completed.');
 if(job.masterKey!==record.masterKey||job.artworkId!==record.artworkId)throw Error('Crop job was generated from a different master.');
 const assets={};
 for(const ratio of FULFILLMENT_RATIOS){
  const asset=job.resultAssets?.[ratio],expected=cropOutputKeyForJob(job,ratio);
  if(!asset?.productionReady||asset.key!==expected||asset.sourceMasterKey!==record.masterKey||
     !Number.isFinite(Number(asset.width))||!Number.isFinite(Number(asset.height)))
    throw Error('Replacement '+ratio+' crop is not verified.');
  if(!await artworkObjectExists(expected))throw Error('Missing '+ratio+' crop in R2.');
  assets[ratio]=asset;
 }
 if(!await artworkObjectExists(record.masterKey))throw Error('Replacement master missing.');
 return assets;
}
export async function getArtworkRevisionStatus(shopId,listingId){
 const record=await optionalRecord(shopId,listingId);
 if(!record)return {exists:false};
 const job=record.jobId?await getCropJob(record.jobId):null;
 let ready=false,error='';
 if(job?.status==='completed')try{await checkedRevisionAssets(record,job);ready=true}catch(e){error=String(e.message||e)}
 return {exists:true,artworkId:record.artworkId,filename:record.filename,jobId:record.jobId,
  status:record.status==='activated'?'activated':job?.status||record.status,
  ready,progress:job?.progress||0,currentRatio:job?.currentRatio||'',message:error||job?.error||job?.message||'',
  upscaledRatios:Object.entries(job?.resultAssets||{}).filter(([,v])=>v.upscaled).map(([k])=>k)};
}
export async function assertArtworkRevisionReady(shopId,listingId,artworkId){
 const record=await optionalRecord(shopId,listingId);
 if(!record||record.artworkId!==validId(artworkId))throw Error('This listing has no matching replacement master.');
 const job=await getCropJob(record.jobId),assets=await checkedRevisionAssets(record,job);
 return {record,assets};
}
export async function activateArtworkRevision(shopId,listingId,artworkId){
 const {record,assets}=await assertArtworkRevisionReady(shopId,listingId,artworkId);
 const manifest=await loadArtworkManifest(record.artworkId);
 if(manifest.master?.key===record.masterKey)return {artworkId:record.artworkId,alreadyActive:true};
 if(manifest.master?.key!==record.previousMasterKey)throw Error('Original master changed while reposter was in progress.');
 const archiveKey='artworks/'+record.artworkId+'/revisions/'+record.revision+'/previous-manifest.json';
 await putJsonObject(archiveKey,manifest);
 await saveArtworkManifest({...manifest,master:{key:record.masterKey,originalFilename:record.filename,
  contentType:record.contentType,size:record.size},
  fulfillmentRatios:assets,fulfillmentRatiosReady:true,fulfillmentRatioInsufficient:{},
  fulfillmentRatiosUpdatedAt:new Date().toISOString(),production:{},cropWorkerJobId:record.jobId,
  activeArtworkRevision:record.revision,previousManifestSnapshotKey:archiveKey,
  lastArtworkReplacement:{sourceListingId:record.listingId,revision:record.revision,
   previousMasterKey:record.previousMasterKey,activatedAt:new Date().toISOString()}});
 record.status='activated';record.activatedAt=new Date().toISOString();
 await putJsonObject(recordKey(shopId,listingId),record);
 return {artworkId:record.artworkId,revision:record.revision,alreadyActive:false};
}
