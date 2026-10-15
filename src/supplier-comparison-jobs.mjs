import crypto from 'node:crypto';

// Long-running catalog scans must not be tied to Render's HTTP request timeout.
// A short request starts a read-only background comparison; polling is fast JSON.
const jobs=new Map();
const byKey=new Map();
const MAX_JOBS=100;
const RETAIN_MS=45*60*1000;
const REUSE_COMPLETED_MS=10*60*1000;

function cleanup(){
 const now=Date.now();
 for(const [id,job] of jobs){
  if(job.updatedAt+RETAIN_MS<now){
   jobs.delete(id);
   if(byKey.get(job.key)===id)byKey.delete(job.key);
  }
 }
 if(jobs.size>MAX_JOBS){
  for(const job of [...jobs.values()].filter(j=>j.status!=='running')
    .sort((a,b)=>a.updatedAt-b.updatedAt).slice(0,jobs.size-MAX_JOBS)){
   jobs.delete(job.id);
   if(byKey.get(job.key)===job.id)byKey.delete(job.key);
  }
 }
}
function validCode(code){
 return /^[A-Z]{2}$/.test(String(code||'').toUpperCase());
}
export function startSupplierComparisonJob({countryCodes,productCodes,copies=1,shippingMethod,sensariaProducts}={},run){
 if(typeof run!=='function')throw Error('Supplier comparison runner is required.');
 const countries=[...new Set((countryCodes||[]).map(x=>String(x).toUpperCase()))];
 const products=[...new Set((productCodes||[]).map(x=>String(x).toUpperCase()))];
 if(countries.length!==1||!validCode(countries[0]))throw Error('Exactly one valid ISO country must be specified.');
 if(!products.length||products.some(x=>!['P','C','FC'].includes(x)))
  throw Error('A valid supplier product scope is required.');
 if(!Number.isSafeInteger(copies)||copies<1||copies>100)throw Error('Invalid item count.');
 cleanup();
 const options={countryCodes:countries,productCodes:products,copies,shippingMethod,sensariaProducts};
 const key=JSON.stringify({countries,products,copies,shippingMethod:shippingMethod||null});
 const previous=jobs.get(byKey.get(key));
 if(previous&&(previous.status==='running'||
    previous.status==='completed'&&Date.now()-previous.updatedAt<REUSE_COMPLETED_MS))
  return {id:previous.id,status:previous.status,reused:true};
 const id=crypto.randomUUID();
 const job={id,key,status:'running',countryCode:countries[0],createdAt:Date.now(),
  updatedAt:Date.now(),error:'',result:null};
 jobs.set(id,job);byKey.set(key,id);
 void Promise.resolve().then(()=>run(options)).then(result=>{
  if(!result?.ok||!Array.isArray(result.rows))
   throw Error('Supplier scan returned no valid JSON rows.');
  job.status='completed';job.result=result;job.updatedAt=Date.now();
 }).catch(error=>{
  job.status='failed';job.error=String(error?.message||error).slice(0,1000);
  job.updatedAt=Date.now();
 });
 return {id,status:'running',reused:false};
}
export function getSupplierComparisonJob(id){
 cleanup();
 const job=jobs.get(String(id||''));
 if(!job)return null;
 return {id:job.id,status:job.status,countryCode:job.countryCode,
   createdAt:new Date(job.createdAt).toISOString(),
   updatedAt:new Date(job.updatedAt).toISOString(),
   ...(job.status==='failed'?{error:job.error}:{}),
   ...(job.status==='completed'?{result:job.result}:{})};
}
