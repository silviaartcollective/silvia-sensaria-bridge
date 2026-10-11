import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {renderListingConverterPage} from '../src/listing-converter-page.mjs';

const source=readFileSync(new URL('../src/converter-artwork-revision.mjs',import.meta.url),'utf8');
const identifier='SAC42';
function fixture(){
 const originalKey='artworks/'+identifier+'/master.jpg';
 const objects=new Map([[originalKey,{size:321654,data:'old master'}]]);
 const states=new Map(),jobs=new Map(),ratios=['2x3','3x4','4x5','11x14'],clone=x=>JSON.parse(JSON.stringify(x));
 const manifest={artworkId:identifier,status:'ready',orientation:'landscape',
  master:{key:originalKey,size:321654},fulfillmentRatios:{},sourceEtsyListingId:223344};
 let seed=0;
 const stubs={
  crypto:{randomUUID:()=>`00000000-0000-4000-8000-${String(++seed).padStart(12,'0')}`},
  loadArtworkManifest:async id=>id===identifier?clone(manifest):null,
  saveArtworkManifest:async value=>{for(const k of Object.keys(manifest))delete manifest[k];Object.assign(manifest,clone(value))},
  getJsonObject:async key=>{
   if(!states.has(key))throw Object.assign(Error('Missing R2 object'),{name:'NoSuchKey'});
   return clone(states.get(key));
  },
  putJsonObject:async(key,value)=>states.set(key,clone(value)),
  artworkObjectExists:async key=>objects.has(key),
  artworkObjectInfo:async key=>({size:objects.get(key)?.size||0}),
  signedArtworkUploadUrl:async key=>'https://example.invalid/'+key,
  copyArtworkObject:async(from,to)=>{
   if(!objects.has(from))throw Error('Missing copy source '+from);
   objects.set(to,clone(objects.get(from)));return {key:to,size:objects.get(to).size};
  },
  deleteArtworkObject:async key=>objects.delete(key),
  listArtworkObjectKeys:async prefix=>[...objects.keys()].filter(key=>key.startsWith(prefix)),
  FULFILLMENT_RATIOS:ratios,
  fulfillmentRatioObjectKey:(id,ratio)=>'artworks/'+id+'/fulfillment/'+ratio+'.jpg',
  createCropJob:async({artworkId,masterKey,orientation})=>{
   const job={id:'crop-'+seed,artworkId,masterKey,orientation,status:'pending',resultAssets:{}};
   jobs.set(job.id,job);return {job:clone(job),reused:false};
  },
  getCropJob:async id=>jobs.has(id)?clone(jobs.get(id)):null,
  checkedRevisionAssets:async(record,job)=>{
   if(!job||job.status!=='completed'||record.jobId!==job.id||job.masterKey!==record.masterKey)
    throw Error('New artwork crops have not completed.');
   return clone(job.resultAssets);
  }
 };
 const body=source.replace(/^\s*import\s+[\s\S]*?\s+from\s+['"][^'"]+['"];?\s*$/gm,'').replace(/^export /gm,'');
 const sandbox=vm.createContext({...stubs,console});
 vm.runInContext(body+';globalThis.api={reserveConverterArtworkRevision,startConverterArtworkCrop,assertConverterArtworkReady,activateConverterArtworkRevision};',sandbox);
 const args={shopId:'123456',listingId:223344,artworkId:identifier,
  orientation:'landscape',master:{filename:'new-landscape.jpg',size:150000,sha256:'a'.repeat(64)}};
 return {api:sandbox.api,manifest,objects,states,jobs,ratios,args,originalKey};
}

test('fresh master is required and crop output stays outside any permanent revisions folder',async()=>{
 const f=fixture();
 await assert.rejects(()=>f.api.reserveConverterArtworkRevision({...f.args,
  master:{filename:'new-landscape.jpg',size:150000}}),/fingerprint/);
 const reserved=await f.api.reserveConverterArtworkRevision(f.args);
 assert.match(reserved.upload.key,/\/.reconvert\/[0-9a-f-]{36}\/master\.jpg$/);
 assert.ok(!reserved.upload.key.includes('/revisions/'));
 assert.equal(f.manifest.master.key,f.originalKey);
 await assert.rejects(()=>f.api.startConverterArtworkCrop({...f.args,revision:reserved.revision}),/Finish uploading/);
 f.objects.set(reserved.upload.key,{size:149999,data:'short'});
 await assert.rejects(()=>f.api.startConverterArtworkCrop({...f.args,revision:reserved.revision}),/size mismatch/);
 f.objects.set(reserved.upload.key,{size:150000,data:'new master'});
 const staged=await f.api.startConverterArtworkCrop({...f.args,revision:reserved.revision});
 await assert.rejects(()=>f.api.assertConverterArtworkReady({...f.args,revision:reserved.revision}),/crops have not completed/);
 assert.equal(f.manifest.master.key,f.originalKey,'do not replace before successful crops');
 const job=f.jobs.get(staged.job.id);job.status='completed';
 for(const ratio of f.ratios){
  const key='artworks/'+identifier+'/.reconvert/'+reserved.revision+'/fulfillment/'+ratio+'.jpg';
  f.objects.set(key,{size:12000,data:'new '+ratio});
  job.resultAssets[ratio]={key,sourceMasterKey:reserved.upload.key,productionReady:true,width:3500,height:5200};
 }
 await f.api.assertConverterArtworkReady({...f.args,revision:reserved.revision});
 const result=await f.api.activateConverterArtworkRevision({...f.args,revision:reserved.revision});
 assert.equal(result.artworkId,identifier);
 assert.equal(result.alreadyActive,false);
 assert.equal(f.manifest.master.key,f.originalKey);
 assert.equal(f.objects.get(f.originalKey).data,'new master');
 for(const ratio of f.ratios){
  const key='artworks/'+identifier+'/fulfillment/'+ratio+'.jpg';
  assert.equal(f.manifest.fulfillmentRatios[ratio].key,key);
  assert.equal(f.manifest.fulfillmentRatios[ratio].sourceMasterKey,f.originalKey);
  assert.equal(f.objects.get(key).data,'new '+ratio);
 }
 assert.equal([...f.objects.keys()].filter(x=>x.includes('/.reconvert/')||x.includes('/revisions/')).length,0,
  'no disposable R2 folder remains after a successful promotion');
 const another=await f.api.reserveConverterArtworkRevision(f.args);
 assert.notEqual(another.revision,reserved.revision);
});

test('interrupted upload resumes only with identical filename, size and SHA-256',async()=>{
 const f=fixture(),first=await f.api.reserveConverterArtworkRevision(f.args);
 const same=await f.api.reserveConverterArtworkRevision(f.args);
 assert.equal(same.revision,first.revision);
 assert.equal(same.uploadAlreadyPresent,false);
 f.objects.set(first.upload.key,{size:150000});
 assert.equal((await f.api.reserveConverterArtworkRevision(f.args)).uploadAlreadyPresent,true);
 await f.api.startConverterArtworkCrop({...f.args,revision:first.revision});
 const modified={...f.args,master:{...f.args.master,sha256:'b'.repeat(64)}};
 await assert.rejects(()=>f.api.reserveConverterArtworkRevision(modified),/still being cropped/);
 f.jobs.get('crop-1').status='completed';
 const other=await f.api.reserveConverterArtworkRevision(modified);
 assert.notEqual(other.revision,first.revision);
});

test('reconverter UI submits work to persistent Etsy queue after crop verification',()=>{
 const html=renderListingConverterPage();
 const script=html.split('<script>')[1]?.split('</script>')[0];
 assert.ok(script);assert.doesNotThrow(()=>new vm.Script(script));
 assert.ok(script.includes("const file=input?.files?.[0]"));
 assert.ok(script.includes("await artworkFingerprint(file)"));
 assert.ok(script.includes("'/api/listing-converter/reconvert/reserve'"));
 assert.ok(script.includes("'/api/listing-converter/reconvert/crop'"));
 assert.ok(script.includes("await waitForCrop(result.job.id"));
 assert.ok(script.includes('await queuedConversion(item,card,'));
 assert.ok(script.includes('async function refreshConversionQueue()'));
 assert.ok(script.includes("setInterval(()=>{void refreshConversionQueue()},5000)"));
 const server=readFileSync(new URL('../src/server.mjs',import.meta.url),'utf8');
 assert.ok(server.includes('assertConverterArtworkReady({'));
 assert.ok(server.includes('activateConverterArtworkRevision({'));
 assert.ok(server.includes("async function runPendingListingConversions()"));
 assert.ok(server.includes('cachedConverterShippingProfiles(session)'));
 assert.ok(server.includes('existingMediaPreserved: true'));
 assert.ok(server.includes('existingSeoPreserved: true'));
});
