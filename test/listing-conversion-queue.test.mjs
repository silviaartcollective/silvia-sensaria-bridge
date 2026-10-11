import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../src/listing-conversion-queue.mjs',import.meta.url),'utf8');
function fixture(){
 const store=new Map(),copy=x=>JSON.parse(JSON.stringify(x));
 let serial=0;
 const deps={
  crypto:{randomUUID:()=>`00000000-0000-4000-8000-${String(++serial).padStart(12,'0')}`},
  getJsonObject:async key=>{
   if(!store.has(key))throw Object.assign(Error('missing object'),{name:'NoSuchKey'});
   return copy(store.get(key));
  },
  putJsonObject:async(key,value)=>{store.set(key,copy(value))},
  isMissingR2Object:e=>e?.name==='NoSuchKey',
  console,Date,Promise,Set,JSON
 };
 const script=source.replace(/^\s*import\s+[\s\S]*?\s+from\s+['"][^'"]+['"];?\s*$/gm,'').replace(/^export /gm,'');
 const context=vm.createContext(deps);
 vm.runInContext(script+';globalThis.api={enqueueConversion,claimNextConversion,getConversionQueueSummary,getConversionJob,updateConversionJob,cancelConversion};',context);
 return {api:context.api,store};
}
test('multiple Etsy listings queue in FIFO order and duplicate submissions never create another job',async()=>{
 const {api}=fixture();
 const first=await api.enqueueConversion({listingId:100,artworkId:'SAC001'});
 const second=await api.enqueueConversion({listingId:200,artworkId:'SAC002'});
 const duplicate=await api.enqueueConversion({listingId:100,artworkId:'SAC001'});
 assert.equal(duplicate.reused,true);
 assert.equal(duplicate.job.id,first.job.id);
 assert.equal(second.position,2);
 await assert.rejects(()=>api.enqueueConversion({listingId:100,artworkId:'SAC099'}),/already queued/);
 const running=await api.claimNextConversion();
 assert.equal(running.request.listingId,100);
 assert.equal(running.status,'running');
 assert.equal(await api.claimNextConversion(),null,'only one Etsy listing may run at once');
 await api.updateConversionJob(running.id,{status:'completed',result:{verified:true,enabledVariants:80}});
 const next=await api.claimNextConversion();
 assert.equal(next.id,second.job.id);
 assert.equal(next.request.listingId,200);
 await api.updateConversionJob(next.id,{status:'failed',error:'Rate limit exceeded'});
 const again=await api.enqueueConversion({listingId:200,artworkId:'SAC002'});
 assert.notEqual(again.job.id,next.id,'retry receives a new queue record');
});

test('queued conversions persist, can be canceled and are not mistaken for successful conversion',async()=>{
 const {api,store}=fixture();
 const first=await api.enqueueConversion({listingId:501,artworkId:'JAC020',reconvert:true,
  revision:'00000000-0000-4000-8000-000000000001'});
 const second=await api.enqueueConversion({listingId:502,artworkId:'JAC021'});
 assert.ok(store.has('state/listing-conversion-queue-v1.json'),'queue stored in R2 JSON');
 assert.equal((await api.getConversionJob(first.job.id)).status,'queued');
 const canceled=await api.cancelConversion(second.job.id);
 assert.equal(canceled.status,'canceled');
 await assert.rejects(()=>api.cancelConversion(second.job.id),/Only waiting/);
 const running=await api.claimNextConversion();
 assert.equal(running.id,first.job.id);
 await assert.rejects(()=>api.cancelConversion(running.id),/Only waiting/);
 const result=await api.updateConversionJob(running.id,{status:'completed',
  result:{verified:true,reconverted:true,replacementMasterActivated:true}});
 assert.equal(result.status,'completed');
 assert.equal((await api.getConversionJob(running.id)).result.verified,true);
 const summary=await api.getConversionQueueSummary();
 assert.ok(summary.some(j=>j.id===first.job.id&&j.status==='completed'));
});
