import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {mockupFileKey} from '../src/mockup-generator.mjs';
import {keepForFullUpload,pendingFullUploads,dropFullUpload,sendFullUpload} from '../worker/full-uploads.mjs';
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');

test('while the full-size JPG is on its way, downloads and copies read the Etsy copy',()=>{
 const item={outputKey:'jobs/j/outputs/t/a.jpg',etsyKey:'jobs/j/outputs/t/a.etsy.jpg'};
 assert.equal(mockupFileKey({...item,fullPending:true}),item.etsyKey);
 assert.equal(mockupFileKey(item),item.outputKey);
 assert.equal(mockupFileKey({outputKey:item.outputKey,fullPending:true}),item.outputKey);
 assert.match(read('src/mockup-zip.mjs'),/const key=mockupFileKey\(item\)/);
 assert.match(read('src/mockup-generator.mjs'),/const key=mockupFileKey\(item\);\n return \{url:await signedArtworkUrl\(key,600\)/);
 const server=read('src/server.mjs');
 assert.match(server,/copyArtworkObject\(mockupFileKey\(t\),key\)/);
 // The R2 copies into the artwork folder run side by side.
 assert.match(server,/await mapWithConcurrency\(planned,6,/);
 assert.match(server,/onMockupFullUploaded:\(\{job\}\)=>refreshArtworkMockupCopies\(job\.artworkId,job\.id\)/);
});

test('the shop offers the later full-size upload and checks the Etsy copy on completion',()=>{
 const api=read('src/mockup-api.mjs');
 assert.match(api,/deferFull:true\}\}/);
 assert.match(api,/verifiedJpeg\(fullPending\?mockupEtsyKey\(key\):key/);
 assert.match(api,/The Etsy copy is required before the full-size JPG\./);
 assert.match(api,/parts\[4\]==='full'/);
 assert.match(api,/if\(item\?\.status!=='completed'\|\|item\.outputKey!==key\|\|!item\.fullPending\)return send\(200,\{pending:false\}\)/);
});

test('the PC worker sends the preview and a lighter Etsy copy first and keeps the full-size JPG for later',()=>{
 const worker=read('worker/index.mjs');
 assert.match(worker,/sized\(claim\.output\.etsyUploadUrl,2400,88,'4:2:0','Etsy copy'\)/);
 assert.match(worker,/const deferFull=claim\.output\.deferFull===true;/);
 // An older shop without deferFull still gets the full-size JPG before completion.
 assert.match(worker,/deferFull\?null:uploadFile\(claim\.output\.uploadUrl,outputPath\)/);
 assert.match(worker,/if\(deferFull&&!etsyUploaded\)await uploadFile/);
 assert.match(worker,/Promise\.all\(\[cropLane\(\),mockupLane\(\),warmUpLane\(\),mockupFolderLane\(\),fullUploadLane\(\)\]\)/);
 assert.match(worker,/const quiet=!active\.size&&Date\.now\(\)-lastWorkAt>=FULL_UPLOAD_QUIET_MS;/);
});

test('pending full-size JPGs are kept across restarts and sent only while the shop still wants them',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'full-jpg-'));
 try{
  const jpg=path.join(dir,'render.jpg');await fs.writeFile(jpg,Buffer.from([255,216,255,0]));
  const entry={appUrl:'https://shop.test',jobId:'11111111-1111-1111-1111-111111111111',itemId:'22222222-2222-2222-2222-222222222222',outputKey:'k.jpg'};
  const name=await keepForFullUpload(jpg,entry,{dir:path.join(dir,'pending')});
  await assert.rejects(fs.stat(jpg));
  let pending=await pendingFullUploads({dir:path.join(dir,'pending')});
  assert.deepEqual(pending.map(p=>[p.name,p.outputKey]),[[name,'k.jpg']]);
  // A regenerated mockup (new output key) is kept beside, not over, the earlier render.
  const again=path.join(dir,'again.jpg');await fs.writeFile(again,'y');
  const second=await keepForFullUpload(again,{...entry,outputKey:'jobs/j/outputs/t/5f0c.jpg'},{dir:path.join(dir,'pending')});
  assert.notEqual(second,name);
  await dropFullUpload(second,{dir:path.join(dir,'pending')});
  // Sent while pending: a fresh URL, the upload, then the check.
  const calls=[],uploads=[];
  const api={mockupFull:async(jobId,itemId,key,action)=>{calls.push(action);return action==='url'?{pending:true,uploadUrl:'https://r2.test/put'}:{done:true}}};
  assert.equal(await sendFullUpload(pending[0],{api,upload:async(url,file)=>uploads.push([url,path.basename(file)])}),'uploaded');
  assert.deepEqual(calls,['url','done']);
  assert.deepEqual(uploads,[['https://r2.test/put',name+'.jpg']]);
  // A regenerated or deleted mockup no longer wants it: nothing is uploaded.
  const skipped=[];
  assert.equal(await sendFullUpload(pending[0],{api:{mockupFull:async()=>({pending:false})},upload:async()=>skipped.push(1)}),'not-needed');
  assert.equal(skipped.length,0);
  await dropFullUpload(name,{dir:path.join(dir,'pending')});
  assert.deepEqual(await pendingFullUploads({dir:path.join(dir,'pending')}),[]);
  // Entries older than a week are dropped.
  const old=path.join(dir,'old.jpg');await fs.writeFile(old,'x');
  await keepForFullUpload(old,{...entry,jobId:'33333333-3333-3333-3333-333333333333'},{dir:path.join(dir,'pending')});
  pending=await pendingFullUploads({dir:path.join(dir,'pending'),now:Date.now()+8*24*60*60*1000});
  assert.deepEqual(pending,[]);
  assert.deepEqual(await fs.readdir(path.join(dir,'pending')),[]);
 }finally{await fs.rm(dir,{recursive:true,force:true})}
});
