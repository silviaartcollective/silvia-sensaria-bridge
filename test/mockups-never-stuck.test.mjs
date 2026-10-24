import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {isTransientError,withUploadRetries} from '../worker/retry.mjs';
import {requeueMockupItem,MOCKUP_MAX_ATTEMPTS} from '../src/mockup-generator.mjs';

const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');

test('a dropped connection or a stopped render is temporary; a refused upload or broken PSD is not',()=>{
 for(const message of ['The operation was aborted due to timeout','fetch failed','read ECONNRESET','R2 upload failed (HTTP 503)',
  'PSD render timed out after 5 min and was stopped.','getaddrinfo EAI_AGAIN example.r2.dev'])
  assert.equal(isTransientError(Error(message)),true,message);
 assert.equal(isTransientError(Object.assign(Error('fetch failed'),{cause:{code:'ETIMEDOUT'}})),true);
 for(const message of ['R2 upload failed (HTTP 403)','Rendered mockup is not a valid JPEG within 24 megapixels.','Select the visible artwork Smart Object.'])
  assert.equal(isTransientError(Error(message)),false,message);
});

test('uploads are tried up to 3 times while the failures are temporary',async()=>{
 let calls=0;
 assert.equal(await withUploadRetries(async()=>{if(++calls<3)throw Error('fetch failed');return 'ok'},{delayMs:1,log(){}}),'ok');
 assert.equal(calls,3);
 calls=0;
 await assert.rejects(withUploadRetries(async()=>{calls++;throw Error('R2 upload failed (HTTP 403)')},{delayMs:1,log(){}}),/403/);
 assert.equal(calls,1,'a refused upload is not retried');
 calls=0;
 await assert.rejects(withUploadRetries(async()=>{calls++;throw Error('fetch failed')},{delayMs:1,log(){}}),/fetch failed/);
 assert.equal(calls,3);
});

test('a temporarily failed PSD goes back in the queue, up to 3 tries in all',()=>{
 const item={status:'processing',attempts:1};
 assert.equal(requeueMockupItem(item,'fetch failed'),true);
 assert.equal(item.status,'queued');
 assert.match(item.progress,/^Trying again \(2\/3\) after: fetch failed/);
 Object.assign(item,{status:'processing',attempts:MOCKUP_MAX_ATTEMPTS});
 assert.equal(requeueMockupItem(item,'fetch failed'),false,'the third try is the last');
 assert.equal(requeueMockupItem({status:'completed',attempts:1},'x'),false,'a finished JPG stays finished');
});

test('one PSD never pauses the batch; a paused batch shows Resume',()=>{
 const worker=read('worker/index.mjs');
 assert.doesNotMatch(worker,/api\.mockupPause\(/);
 assert.match(worker,/api\.mockupFail\(id,mockupOwner,itemId,error,false,\{retry\}\)/);
 assert.match(read('src/mockup-api.mjs'),/\{retry:body\.retry===true\}/);
 const client=read('src/mockup-generator-client.js');
 assert.match(client,/\['mg-pause',\(\)=>job\?\.paused\?resume\(\):pause\(\)\]/);
 assert.match(client,/button\.textContent=job\?\.paused\?'Resume':'Pause after current PSD'/);
 assert.match(client,/job\.paused\?'The batch is paused\. Click Resume to continue\.'/);
 assert.match(read('worker/api.mjs'),/WORKER_VERSION = '4\.7\.8'/);
});

test('a render that hangs is stopped and its slot keeps working; advance preparation gives way to a batch',async()=>{
 process.env.POD_RENDER_THREAD_SCRIPT=new URL('./fixtures/fake-render-thread.mjs',import.meta.url).pathname;
 process.env.POD_PREPARE_TIMEOUT_SECONDS='1';
 process.env.POD_MOCKUP_CONCURRENCY='1';
 const pool=await import('../worker/render-pool.mjs?never-stuck');
 const dir=mkdtempSync(path.join(os.tmpdir(),'pod-pool-'));
 const psd=name=>{const file=path.join(dir,name+'.psd');writeFileSync(file,'PSD');return file;};
 const args=name=>({psdPath:psd(name),artworkPath:path.join(dir,'a.jpg'),outputPath:path.join(dir,'o.jpg')});
 const started=Date.now();
 await assert.rejects(pool.renderInPool(args('hang')),/timed out .* and was stopped/);
 assert.ok(Date.now()-started<5000);
 assert.equal((await pool.renderInPool(args('fine'))).ok,true,'the slot renders again on a fresh thread');
 // A batch that needs a preparation stops the warm-up one at once.
 process.env.POD_PREPARE_TIMEOUT_SECONDS='30';
 const warm=pool.prepareInPool({psdPath:psd('hang-warm')}).then(()=>null,error=>error);
 await new Promise(resolve=>setTimeout(resolve,200));
 const t=Date.now();
 assert.equal((await pool.renderInPool(args('batch'))).ok,true);
 assert.ok(Date.now()-t<5000,'the batch did not wait for the warm-up');
 assert.equal((await warm)?.warmUpStopped,true);
 assert.equal(pool.renderTimeLimitMs({prepared:true}),5*60_000);
 delete process.env.POD_PREPARE_TIMEOUT_SECONDS;
 assert.equal(pool.renderTimeLimitMs({prepared:false,psdSize:450*1024*1024}),20*60_000,'10 min + 2 min per 100 MB');
});

test('a big master is shrunk once per batch to the 6000 px the renders use; a small one is used as it is',async()=>{
 const sharp=(await import('sharp')).default;
 const {mockupArtwork}=await import('../worker/mockup-artwork.mjs');
 const dir=mkdtempSync(path.join(os.tmpdir(),'pod-art-'));
 const big=path.join(dir,'master.jpg'),small=path.join(dir,'small.jpg');
 const gradient=(w,h)=>Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g"><stop offset="0" stop-color="#8a8f6e"/><stop offset="1" stop-color="#c98f6b"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/><circle cx="${w/2}" cy="${h/2}" r="${h/4}" fill="#3b2a1e"/></svg>`);
 await sharp(gradient(9000,6000)).jpeg({quality:90}).toFile(big);
 await sharp(gradient(3000,2000)).jpeg({quality:90}).toFile(small);
 const [a,b,c]=await Promise.all([mockupArtwork(big),mockupArtwork(big),mockupArtwork(big)]);
 assert.equal(a,b);assert.equal(b,c);
 assert.notEqual(a,big);
 const meta=await sharp(a).metadata();
 assert.deepEqual([meta.width,meta.height],[6000,4000]);
 assert.equal(await mockupArtwork(small),small,'a small master is read directly');
 // The same pixels the renders made from the full master (decodedArtwork in native-mockup.mjs).
 const fromMaster=await sharp(big,{limitInputPixels:false}).rotate().resize(6000,6000,{fit:'inside'}).flatten({background:'#ffffff'}).removeAlpha().raw().toBuffer();
 const fromCopy=await sharp(a).removeAlpha().raw().toBuffer();
 let total=0;for(let i=0;i<fromMaster.length;i+=97)total+=Math.abs(fromMaster[i]-fromCopy[i]);
 assert.ok(total/(fromMaster.length/97)<2,'visually identical');
 assert.match(readFileSync(new URL('../worker/index.mjs',import.meta.url),'utf8'),/artworkPath=await mockupArtwork\(masterPath\)/);
});
