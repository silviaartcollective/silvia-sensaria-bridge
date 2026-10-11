import crypto from 'node:crypto';
import {getJsonObject,putJsonObject,isMissingR2Object} from './r2.mjs';

const STORE_KEY='state/listing-conversion-queue-v1.json';
const MAX_RECORDS=350;
const RUNNING_EXPIRES_MS=25*60*1000;
let tail=Promise.resolve();
const clone=value=>JSON.parse(JSON.stringify(value));
const lock=fn=>{
 const job=tail.then(fn,fn);
 tail=job.catch(()=>{});
 return job;
};
export function normalizeConversionQueue(data){
 return {version:1,jobs:Array.isArray(data?.jobs)?data.jobs:[]};
}
export async function readConversionQueue(){
 try{return normalizeConversionQueue(await getJsonObject(STORE_KEY))}
 catch(error){if(isMissingR2Object(error))return {version:1,jobs:[]};throw error}
}
async function saveQueue(store){
 const jobs=[...store.jobs].sort((a,b)=>
  String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,MAX_RECORDS);
 await putJsonObject(STORE_KEY,{version:1,jobs});
}
function validate(input){
 const listingId=Number(input?.listingId),artworkId=String(input?.artworkId||'').toUpperCase();
 if(!Number.isSafeInteger(listingId)||listingId<=0)throw Error('Valid Etsy listing ID required.');
 if(!/^(SAC|JAC)\d+$/.test(artworkId))throw Error('A linked artwork ID is required.');
 const reconvert=input?.reconvert===true,revision=String(input?.revision||'');
 if(reconvert&&!/^[a-f0-9-]{36}$/i.test(revision))
  throw Error('The newly uploaded artwork revision is required for reconversion.');
 return {listingId,artworkId,reconvert,revision:reconvert?revision:null};
}
export async function enqueueConversion(input){
 const request=validate(input);
 return lock(async()=>{
  const store=await readConversionQueue();
  const existing=store.jobs.find(job=>job.request.listingId===request.listingId&&
   (job.status==='queued'||job.status==='running'));
  if(existing){
   if(JSON.stringify(existing.request)!==JSON.stringify(request))
    throw Error('Another conversion is already queued for this listing. Wait for it to complete or cancel before trying different artwork.');
   return {job:clone(existing),reused:true,position:queuePosition(store,existing.id)};
  }
  const now=new Date().toISOString();
  const job={id:'listing_'+crypto.randomUUID(),request,status:'queued',createdAt:now,
   updatedAt:now,startedAt:null,completedAt:null,attempts:0,progress:'Waiting for Etsy conversion queue',
   error:null,result:null};
  store.jobs.push(job);
  await saveQueue(store);
  return {job:clone(job),reused:false,position:queuePosition(store,job.id)};
 });
}
function queuePosition(store,id){
 const awaiting=store.jobs.filter(job=>job.status==='queued')
  .sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt)));
 return awaiting.findIndex(job=>job.id===id)+1;
}
export async function getConversionJob(id){
 const store=await readConversionQueue();
 const job=store.jobs.find(row=>row.id===String(id));
 if(!job)return null;
 return {...clone(job),position:job.status==='queued'?queuePosition(store,job.id):0};
}
export async function getConversionQueueSummary(){
 const store=await readConversionQueue();
 const jobs=store.jobs.filter(j=>['queued','running','failed'].includes(j.status));
 return jobs.map(j=>({...clone(j),position:j.status==='queued'?queuePosition(store,j.id):0}));
}
export async function claimNextConversion(){
 return lock(async()=>{
  const store=await readConversionQueue(),now=Date.now();
  // After a Render restart an orphan can be retried; conversion operations
  // verify SKU/pricing before reporting success and reuse existing Artwork ID.
  for(const job of store.jobs){
   if(job.status!=='running')continue;
   const updated=Date.parse(job.updatedAt||0);
   if(Number.isFinite(updated)&&now-updated>RUNNING_EXPIRES_MS){
    job.status='queued';job.progress='Recovering conversion after an interrupted server run';
   }
  }
  if(store.jobs.some(j=>j.status==='running')){await saveQueue(store);return null}
  const next=store.jobs.filter(j=>j.status==='queued')
    .sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt)))[0];
  if(!next){await saveQueue(store);return null}
  next.status='running';next.startedAt=new Date().toISOString();
  next.updatedAt=next.startedAt;next.attempts++;
  next.progress='Applying and verifying Etsy variants';
  await saveQueue(store);
  return clone(next);
 });
}
export async function updateConversionJob(id,{status,progress,error,result}={}){
 return lock(async()=>{
  const store=await readConversionQueue(),job=store.jobs.find(j=>j.id===String(id));
  if(!job)throw Error('Conversion queue job not found');
  if(['completed','failed','canceled'].includes(job.status))return clone(job);
  if(status&&['running','completed','failed','canceled'].includes(status))job.status=status;
  if(progress!==undefined)job.progress=String(progress).slice(0,300);
  if(error!==undefined)job.error=String(error||'').slice(0,700);
  if(result!==undefined)job.result=result;
  job.updatedAt=new Date().toISOString();
  if(['completed','failed','canceled'].includes(job.status))job.completedAt=job.updatedAt;
  await saveQueue(store);
  return clone(job);
 });
}
export async function cancelConversion(id){
 return lock(async()=>{
  const store=await readConversionQueue(),job=store.jobs.find(j=>j.id===String(id));
  if(!job)throw Error('Conversion job not found');
  if(job.status!=='queued')throw Error('Only waiting conversions can be canceled.');
  job.status='canceled';job.error='Canceled before Etsy changes';job.completedAt=new Date().toISOString();
  job.updatedAt=job.completedAt;job.progress='Canceled';
  await saveQueue(store);
  return clone(job);
 });
}
