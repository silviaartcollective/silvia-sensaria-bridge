import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const html=read('src/listing-converter-page.mjs');
const script=html.slice(html.indexOf('<script>')+8,html.indexOf('</script>'));
const server=read('src/server.mjs');
const storage=read('src/artwork-storage.mjs');
const crop=read('src/crop-job-store.mjs');
const setup=script.slice(script.indexOf('const MAX_SIMULTANEOUS_SETUPS='),script.indexOf('async function detectOrientation('));

test('bulk setup keeps at most two simultaneous uploads and drains waiting tasks',async()=>{
 const ctx=vm.createContext({Promise,Math,sleep:async()=>{}});
 vm.runInContext(setup+';globalThis.withSlot=withSetupSlot;',ctx);
 let active=0,maxActive=0;
 const pending=[];
 const work=Array.from({length:9},(_,i)=>ctx.withSlot(async()=>{
  active++;maxActive=Math.max(maxActive,active);
  await new Promise(resolve=>pending.push(resolve));
  active--;
  return i;
 }));
 assert.equal(pending.length,2);
 for(let i=0;i<9;i++){
  pending.shift()();
  await new Promise(resolve=>setImmediate(resolve));
 }
 assert.deepEqual(await Promise.all(work),[0,1,2,3,4,5,6,7,8]);
 assert.equal(maxActive,2);
});

test('converter retries temporary network timeouts without losing upload and queue state',async()=>{
 let fetches=0;
 const ctx=vm.createContext({
  Promise,Math,sleep:async()=>{},
  fetch:async()=>{fetches++;
   if(fetches<3)throw Object.assign(Error('network timeout'),{name:'TimeoutError'});
   return {ok:true,status:200,json:async()=>({ok:true,artworkId:'JAC42'})};
  }
 });
 vm.runInContext(setup+';globalThis.request=requestJsonRetry;',ctx);
 const result=await ctx.request('/api/listing-converter/reserve',{method:'POST'},4);
 assert.equal(result.artworkId,'JAC42');
 assert.equal(fetches,3);
});

test('all active crop jobs share one status request and recover from transient failure',async()=>{
 const code=script.slice(script.indexOf('const cropWaiters=new Map()'),script.indexOf('async function refreshWorker(){'));
 let requests=0,statusText='';
 const ctx=vm.createContext({
  Promise,Map,Number,Math,Error,String,
  fetch:async()=>{requests++;
   if(requests===1)throw Object.assign(Error('TimeoutError'),{name:'TimeoutError'});
   return {ok:true,json:async()=>({ok:true,jobs:{
    'crop_00000000-0000-4000-8000-000000000001':{status:'completed',progress:100}
   }})};
  },
  setTimeout:fn=>{queueMicrotask(fn);return 1}
 });
 vm.runInContext(code+';globalThis.wait=waitForCrop;',ctx);
 const value=await ctx.wait('crop_00000000-0000-4000-8000-000000000001',
  text=>{statusText=text},()=>{});
 assert.equal(value.job.status,'completed');
 assert.equal(requests,2);
 assert.match(statusText,/reconnecting/);
 assert.match(code,/part=ids.slice\(index,index\+50\)/);
 assert.match(code,/encodeURIComponent\(part.join\(','\)\)/);
});

test('artwork ID reservations serialize across independent converter cards',async()=>{
 const start=storage.indexOf('let artworkReservationTail=Promise.resolve()');
 const end=storage.indexOf('async function reserveArtworkUploadUnlocked(',start);
 assert.ok(start>=0&&end>start);
 let active=0,maxActive=0; const gate=[];
 const ctx=vm.createContext({Promise,reserveArtworkUploadUnlocked:async input=>{
  active++;maxActive=Math.max(maxActive,active);
  await new Promise(resolve=>gate.push(resolve));
  active--;return input;
 }});
 vm.runInContext(storage.slice(start,end).replace('export async function','async function')+
  ';globalThis.reserve=reserveArtworkUpload;',ctx);
 const calls=Array.from({length:6},(_,i)=>ctx.reserve({index:i}));
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(gate.length,1);
 for(let i=0;i<6;i++){
  gate.shift()();
  await new Promise(resolve=>setImmediate(resolve));
 }
 assert.deepEqual((await Promise.all(calls)).map(x=>x.index),[0,1,2,3,4,5]);
 assert.equal(maxActive,1);
});

test('server uses one authenticated R2 store read for a batch of crop states',async()=>{
 const start=crop.indexOf('export async function getCropJobSummaries(ids)');
 const end=crop.indexOf('export async function getCropJob(jobId)',start);
 assert.ok(start>=0&&end>start);
 let reads=0;
 const ctx=vm.createContext({Set,Number,readStore:async()=>{
  reads++;
  return {jobs:[
   {id:'crop_a',status:'processing',progress:42,currentRatio:'3x4'},
   {id:'crop_b',status:'completed',progress:100},
   {id:'crop_c',status:'pending'}
  ]};
 }});
 vm.runInContext(crop.slice(start,end).replace('export async function','async function')+
  ';globalThis.lookup=getCropJobSummaries;',ctx);
 const found=await ctx.lookup(['crop_a','crop_b']);
 assert.deepEqual(Object.keys(found).sort(),['crop_a','crop_b']);
 assert.equal(found.crop_a.progress,42);
 assert.equal(reads,1);
 assert.match(server,/getCropJobSummaries\(ids\)/);
 assert.match(server,/requireAdminApi\(req,res\)/);
 assert.match(server,/ids.length>60/);
});
