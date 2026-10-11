import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {renderListingConverterPage} from '../src/listing-converter-page.mjs';

const source=readFileSync(new URL('../src/converter-artwork-revision.mjs',import.meta.url),'utf8');
function fixture(){
 const objects=new Map([['artworks/SAC42/master.jpg',321654]]);
 const state=new Map(),jobs=new Map(),archive=[];
 const copy=v=>JSON.parse(JSON.stringify(v));
 const manifest={
  artworkId:'SAC42',status:'ready',orientation:'landscape',
  master:{key:'artworks/SAC42/master.jpg',size:321654},
  fulfillmentRatios:{legacy:{key:'old-crop.jpg'}},
  sourceEtsyListingId:223344
 };
 let next=0;
 const mock={
  crypto:{randomUUID:()=>`00000000-0000-4000-8000-${String(++next).padStart(12,'0')}`},
  loadArtworkManifest:async()=>copy(manifest),
  saveArtworkManifest:async value=>{Object.keys(manifest).forEach(key=>delete manifest[key]);Object.assign(manifest,copy(value))},
  getJsonObject:async key=>{
   if(!state.has(key))throw Object.assign(Error('Missing R2 object'),{name:'NoSuchKey'});
   return copy(state.get(key));
  },
  putJsonObject:async(key,value)=>{state.set(key,copy(value));if(key.endsWith('/previous-manifest.json'))archive.push(key)},
  artworkObjectExists:async key=>objects.has(key),
  artworkObjectInfo:async key=>({size:objects.get(key)||0}),
  signedArtworkUploadUrl:async key=>`https://r2.example.invalid/${key}`,
  createCropJob:async({artworkId,masterKey,orientation})=>{
   const job={id:'crop-'+next,artworkId,masterKey,orientation,status:'pending'};
   jobs.set(job.id,job);return {job:copy(job),reused:false};
  },
  getCropJob:async id=>jobs.has(id)?copy(jobs.get(id)):null,
  checkedRevisionAssets:async(record,job)=>{
   if(!job||job.status!=='completed'||record.jobId!==job.id||job.masterKey!==record.masterKey)
    throw Error('New artwork crops have not completed.');
   if(!objects.has(record.masterKey))throw Error('Replacement master missing.');
   return {twoByThree:{key:'artworks/SAC42/revisions/'+record.revision+'/fulfillment/2x3.jpg',
    sourceMasterKey:record.masterKey,productionReady:true}};
  }
 };
 const script=source.replace(/^import[^\n]*\n/gm,'').replace(/^export /gm,'');
 const context=vm.createContext(mock);
 vm.runInContext(script+`
 globalThis.api={reserveConverterArtworkRevision,startConverterArtworkCrop,
  assertConverterArtworkReady,activateConverterArtworkRevision,getConverterArtworkRevisionStatus};
 `,context);
 const basic={shopId:'123456',listingId:223344,artworkId:'SAC42',orientation:'landscape',
  master:{filename:'new-landscape.jpg',size:150000,sha256:'a'.repeat(64)}};
 return {api:context.api,manifest,objects,state,jobs,archive,basic};
}

test('reconversion requires a new uploaded master and never overwrites old artwork before verification',async()=>{
 const f=fixture();
 await assert.rejects(()=>f.api.reserveConverterArtworkRevision({...f.basic,
  master:{filename:'new-landscape.jpg',size:150000}}),/fingerprint/);
 const reserved=await f.api.reserveConverterArtworkRevision(f.basic);
 assert.equal(reserved.resumed,false);
 assert.equal(reserved.artworkId,'SAC42');
 assert.match(reserved.upload.key,/^artworks\/SAC42\/revisions\/[0-9a-f-]{36}\/master\.jpg$/);
 assert.equal(f.manifest.master.key,'artworks/SAC42/master.jpg');
 await assert.rejects(()=>f.api.startConverterArtworkCrop({
  shopId:f.basic.shopId,listingId:f.basic.listingId,
  artworkId:f.basic.artworkId,revision:reserved.revision
 }),/Finish uploading/);
 f.objects.set(reserved.upload.key,149999);
 await assert.rejects(()=>f.api.startConverterArtworkCrop({
  shopId:f.basic.shopId,listingId:f.basic.listingId,
  artworkId:f.basic.artworkId,revision:reserved.revision
 }),/size mismatch/);
 f.objects.set(reserved.upload.key,150000);
 const staged=await f.api.startConverterArtworkCrop({
  shopId:f.basic.shopId,listingId:f.basic.listingId,
  artworkId:f.basic.artworkId,revision:reserved.revision
 });
 assert.equal(staged.job.masterKey,reserved.upload.key);
 assert.equal(f.manifest.master.key,'artworks/SAC42/master.jpg');
 await assert.rejects(()=>f.api.assertConverterArtworkReady({
  shopId:f.basic.shopId,listingId:f.basic.listingId,
  artworkId:f.basic.artworkId,revision:reserved.revision
 }),/crops have not completed/);
 f.jobs.get(staged.job.id).status='completed';
 const checked=await f.api.assertConverterArtworkReady({
  shopId:f.basic.shopId,listingId:f.basic.listingId,
  artworkId:f.basic.artworkId,revision:reserved.revision
 });
 assert.equal(checked.assets.twoByThree.sourceMasterKey,reserved.upload.key);
 assert.equal(f.manifest.master.key,'artworks/SAC42/master.jpg');
 const promoted=await f.api.activateConverterArtworkRevision({
  shopId:f.basic.shopId,listingId:f.basic.listingId,
  artworkId:f.basic.artworkId,revision:reserved.revision
 });
 assert.equal(promoted.artworkId,'SAC42');
 assert.equal(f.manifest.master.key,reserved.upload.key);
 assert.equal(f.manifest.cropWorkerJobId,staged.job.id);
 assert.equal(f.manifest.fulfillmentRatios.twoByThree.sourceMasterKey,reserved.upload.key);
 assert.equal(f.archive.length,1);
 assert.equal(f.objects.has('artworks/SAC42/master.jpg'),true,'original source remains recoverable');
 const next=await f.api.reserveConverterArtworkRevision(f.basic);
 assert.notEqual(next.revision,reserved.revision,'another reconversion must require a fresh upload');
});

test('interrupted uploads resume only for the same bytes and never replace an active crop source',async()=>{
 const f=fixture();
 const reserve=await f.api.reserveConverterArtworkRevision(f.basic);
 let retry=await f.api.reserveConverterArtworkRevision(f.basic);
 assert.equal(retry.revision,reserve.revision);
 assert.equal(retry.uploadAlreadyPresent,false);
 f.objects.set(reserve.upload.key,150000);
 retry=await f.api.reserveConverterArtworkRevision(f.basic);
 assert.equal(retry.uploadAlreadyPresent,true);
 const crop=await f.api.startConverterArtworkCrop({
  shopId:f.basic.shopId,listingId:f.basic.listingId,artworkId:f.basic.artworkId,revision:reserve.revision
 });
 const modified={...f.basic,master:{...f.basic.master,sha256:'b'.repeat(64)}};
 await assert.rejects(()=>f.api.reserveConverterArtworkRevision(modified),/still being cropped/);
 f.jobs.get(crop.job.id).status='completed';
 const changed=await f.api.reserveConverterArtworkRevision(modified);
 assert.notEqual(changed.revision,reserve.revision,'same file name and size cannot stand in for different content');
 assert.equal(changed.uploadAlreadyPresent,false);
});

test('reconversion rejects different orientations and unrelated artwork',async()=>{
 const f=fixture();
 await assert.rejects(()=>f.api.reserveConverterArtworkRevision({...f.basic,orientation:'portrait'}),/orientation differs/);
 await assert.rejects(()=>f.api.reserveConverterArtworkRevision({...f.basic,artworkId:'SAC900'}),/ready/);
});

test('both converter buttons require uploaded artwork and a completed crop before Etsy reconversion',()=>{
 const html=renderListingConverterPage(),code=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
 assert.ok(code);assert.doesNotThrow(()=>new vm.Script(code));
 assert.ok(code.includes("const file=input?.files?.[0]"));
 assert.ok(code.includes("if(!file){"));
 assert.ok(code.includes("await artworkFingerprint(file)"));
 assert.ok(code.includes("sha256}})"));
 assert.ok(code.includes("'/api/listing-converter/reconvert/reserve'"));
 assert.ok(code.includes("'/api/listing-converter/reconvert/crop'"));
 assert.ok(code.includes('await waitForCrop(result.job.id'));
 assert.ok(code.includes('result.replacementMasterActivated!==true'));
 const server=readFileSync(new URL('../src/server.mjs',import.meta.url),'utf8');
 assert.ok(server.includes('assertConverterArtworkReady({'));
 assert.ok(server.includes('activateConverterArtworkRevision({'));
 assert.ok(server.includes('cropJob.status !== \'completed\''));
 assert.ok(server.includes('hasAuthorizedConverterLink({'));
 assert.ok(server.includes('sourceListingId: manifest.sourceEtsyListingId'));
 assert.ok(server.includes('existingMediaPreserved: true'));
 assert.ok(server.includes('existingSeoPreserved: true'));
});
