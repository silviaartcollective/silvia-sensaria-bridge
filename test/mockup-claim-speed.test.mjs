import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('worker claims read only active batches, not every batch ever created',()=>{
 const api=read('src/mockup-api.mjs');
 assert.match(api,/const jobs=await claimCandidates\(owner\);/);
 assert.match(api,/Date\.now\(\)-activeBatches\.listedAt>10\*60\*1000/);
 for(const point of ['markMockupArtworkUploaded(job.id);markBatchActive(job.id)',
  "markMockupArtworkUploaded(id,{local:body?.local===true});markBatchActive(id)",'ownerCheck(body));markBatchActive(id)'])
  assert.ok(api.includes(point),point);
});

test('re-inspecting an unchanged template does not rewrite it',()=>{
 assert.match(read('src/mockup-api.mjs'),/summary\(t\.smartObjects\)===summary\(classified\.objects\)\?t:/);
});

test('known templates send their artwork layer to the worker',()=>{
 assert.match(read('src/mockup-api.mjs'),/stored\.mapping\?\.path\|\|!known\?stored:\{\.\.\.stored,mapping:\{path:known\}\}/);
});

test('fast PSDs send no progress writes',()=>{
 const worker=read('worker/index.mjs');
 assert.match(worker,/let lastStageWriteAt=Date\.now\(\);/);
 assert.match(worker,/if\(now-lastStageWriteAt<2500\)return Promise\.resolve\(\);/);
});

test('the server reuses one R2 client instead of a new connection per request',()=>{
 const r2=read('src/r2.mjs');
 assert.match(r2,/if \(sharedClient\?\.key === key\) return sharedClient\.client;/);
 assert.equal((r2.match(/new S3Client\(/g)||[]).length,1);
});

test('batch lists read only the most recently changed batches',()=>{
 const generator=read('src/mockup-generator.mjs'),api=read('src/mockup-api.mjs');
 assert.match(generator,/new Date\(b\.LastModified\|\|0\)-new Date\(a\.LastModified\|\|0\)/);
 assert.match(api,/listMockupJobs\(40\)/);
 assert.match(api,/listMockupJobs\(300\)/);
});

test('an R2 timeout shows a readable message instead of "TimeoutError"',()=>{
 assert.match(read('src/mockup-api.mjs'),/Cloudflare R2 did not respond in time/);
});

test('the newest batch is rendered first so the current listing never waits behind old ones',()=>{
 assert.match(read('src/mockup-api.mjs'),/return jobs\.sort\(\(a,b\)=>String\(b\.createdAt\)\.localeCompare\(String\(a\.createdAt\)\)\);/);
});

test('a waiting batch says when the PC worker is busy elsewhere',()=>{
 const client=read('src/mockup-generator-client.js'),server=read('src/server.mjs');
 assert.match(client,/PC worker is finishing another job first/);
 assert.match(client,/lastWorker=worker;/);
 assert.match(server,/activeApp: online \? cropWorkerHeartbeat\.activeApp/);
});

test('every compatible template is generated; nothing is ticked until picked, at most 20',async()=>{
 const vm=await import('node:vm');
 const client=read('src/mockup-generator-client.js');
 assert.match(client,/const ETSY_MOCKUP_SLOTS=20;/);
 assert.doesNotMatch(client,/templateFitsOrientation\(t,detectedArtworkOrientation\)\)\.slice\(0,16\)/);
 // Run the selection model on its own.
 const start=client.indexOf('const ETSY_MOCKUP_SLOTS=20;'),end=client.indexOf('let lastStatus=');
 const context={job:null,messages:[],message(text){context.messages.push(text)}};
 vm.runInNewContext(client.slice(start,end)+';this.api={isSelected,setSelected,selectionByJob,firstSlots};',context);
 const {isSelected,setSelected,selectionByJob,firstSlots}=context.api;
 context.job={id:'b',templates:Array.from({length:28},(_,i)=>({id:'t'+i,status:'completed'}))};
 const ticked=()=>context.job.templates.filter(t=>isSelected('b',t.id)).length;
 assert.equal(ticked(),0,'previews start unticked');
 selectionByJob.set('b',{chosen:firstSlots(context.job)}); // "Select first 20"
 assert.equal(ticked(),20);
 assert.equal(isSelected('b','t20'),false);
 assert.equal(setSelected('b','t20',true),false,'a 21st mockup does not fit');
 assert.match(context.messages.at(-1),/Up to 20 mockups can be picked/);
 setSelected('b','t0',false);
 assert.equal(setSelected('b','t20',true),true,'swapping one in works');
 assert.equal(ticked(),20);
 assert.equal(isSelected('b','t20'),true);
});

test('completion reads only the JPEG header; dimensions come from its frame marker',async()=>{
 const {jpegDimensions,mockupPreviewKey}=await import('../src/mockup-generator.mjs');
 const sharp=(await import('sharp')).default;
 const jpg=await sharp({create:{width:1234,height:567,channels:3,background:'#808080'}}).withMetadata({icc:'srgb'}).jpeg().toBuffer();
 assert.deepEqual(jpegDimensions(jpg),{width:1234,height:567});
 assert.deepEqual(jpegDimensions(jpg.subarray(0,Math.min(jpg.length,131072))),{width:1234,height:567});
 assert.equal(jpegDimensions(Buffer.from('not a jpeg')),null);
 assert.equal(mockupPreviewKey('a/b/c.jpg'),'a/b/c.preview.jpg');
 const api=read('src/mockup-api.mjs');
 assert.match(api,/const start=await getArtworkObjectStart\(key\);/);
 assert.doesNotMatch(api,/data\.body\.length>60\*1024\*1024/);
});

test('the worker claims as many PSDs as it has free threads and uploads a preview with each JPG',()=>{
 const worker=read('worker/index.mjs'),api=read('src/mockup-api.mjs');
 assert.match(worker,/claimMockup\(mockupOwner,RENDER_THREADS-running\.size,LONG_POLL_MS\)/);
 assert.match(worker,/sized\(claim\.output\.previewUploadUrl,900,82,'4:4:4','Preview'\)/);
 assert.match(worker,/sized\(claim\.output\.etsyUploadUrl,2400,88,'4:2:0','Etsy copy'\)/);
 assert.match(worker,/confirmedLayers\.get\(layerKey\)/);
 assert.match(api,/claimMockupWork\(candidate\.id,owner,limit\)/);
 assert.match(api,/d\.previewKey\?\(await getArtworkObject\(d\.previewKey\)\)\.body/);
});
