// Bounded asynchronous preparation for manual Sensaria CSV downloads.
// This only prepares a file. No external supplier order or Etsy mutation occurs.
const jobs=new Map();
const TTL_MS=30*60*1000;
const TIMEOUT_MS=4*60*1000;

function cleanup(){
 const now=Date.now();
 for(const [id,entry] of jobs)
   if(entry.expiresAt<now && entry.status!=='running') jobs.delete(id);
}
export function csvJobStatus(receiptId){
 cleanup();
 const job=jobs.get(String(receiptId));
 if(!job)return null;
 return {
   receiptId:job.receiptId,status:job.status,stage:job.stage,
   startedAt:job.startedAt,updatedAt:job.updatedAt,
   error:job.error||null,ready:job.status==='completed'
 };
}
export function csvJobResult(receiptId){
 const job=jobs.get(String(receiptId));
 return job?.status==='completed'?job.csv:null;
}
export function startCsvJob(receiptId,work){
 const id=String(receiptId);
 if(!/^[1-9]\d{0,19}$/.test(id))throw Error('Invalid Etsy receipt ID.');
 if(typeof work!=='function')throw Error('CSV preparation function required.');
 cleanup();
 const existing=jobs.get(id);
 if(existing && (existing.status==='running'||existing.status==='completed'))
   return csvJobStatus(id);
 const startedAt=new Date().toISOString();
 const job={receiptId:id,status:'running',stage:'Checking Etsy payment and supplier recommendation',
   startedAt,updatedAt:startedAt,expiresAt:Date.now()+TTL_MS,error:null,csv:null};
 jobs.set(id,job);
 const stage=value=>{
   if(job.status!=='running')return;
   job.stage=String(value).slice(0,180);
   job.updatedAt=new Date().toISOString();
   console.info('[sensaria CSV] #'+id+' stage: '+job.stage);
 };
 let timer;
 const timeout=new Promise((_,reject)=>{
   timer=setTimeout(()=>reject(Error('Sensaria artwork preparation exceeded four minutes. Retry the download; if it persists, check the R2 production image and server logs.')),TIMEOUT_MS);
 });
 // Start after the HTTP request returns, and keep the preparation work separate
 // from the browser request lifetime.
 void Promise.race([Promise.resolve().then(()=>work(stage)),timeout]).then(result=>{
   if(typeof result!=='string'||!result.includes('Product Code'))
     throw Error('No valid Sensaria GO CSV was generated.');
   job.csv=result;
   job.status='completed';job.stage='Ready to download';
   job.expiresAt=Date.now()+TTL_MS;
 }).catch(error=>{
   job.status='failed';job.error=String(error?.message||error).slice(0,600);
   console.error('[sensaria CSV] #'+id+' failed: '+job.error);
   job.stage='Preparation failed';job.expiresAt=Date.now()+5*60*1000;
 }).finally(()=>{
   clearTimeout(timer);job.updatedAt=new Date().toISOString();
 });
 return csvJobStatus(id);
}
