import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {renderListingsPage} from '../src/listings-page.mjs';

const source=readFileSync(new URL('../src/converter-artwork-revision.mjs',import.meta.url),'utf8');
const identifier='SAC0007';
const DAY=24*60*60*1000;

function fixture({geometry={width:6000,height:4000,orientation:'landscape'}}={}){
 const originalKey='artworks/'+identifier+'/master.jpg';
 const old=new Date(Date.now()-30*DAY),recent=new Date(Date.now()-2*DAY);
 const objects=new Map([
  [originalKey,{size:321654,data:'stored master',contentType:'image/jpeg'}],
  ['artworks/'+identifier+'/fulfillment/2x3.jpg',{size:9000,data:'old 2x3 18000px'}],
  ['artworks/'+identifier+'/production/canvas/40x60-landscape.jpg',{size:5000,data:'old render',lastModified:old}],
  ['artworks/'+identifier+'/fulfillment/by-size/40x60.jpg',{size:5000,data:'old size crop',lastModified:old}],
  ['artworks/'+identifier+'/fulfillment/sensaria/40x60.jpg',{size:5000,data:'recent sensaria copy',lastModified:recent}],
  ['artworks/'+identifier+'/mockups/room.jpg',{size:5000,data:'mockup',lastModified:old}]
 ]);
 const states=new Map(),jobs=new Map(),ratios=['2x3','3x4','4x5','11x14'],clone=x=>JSON.parse(JSON.stringify(x));
 // As in artwork-ratios.mjs: 1:2 and 1:3 only for a 1.85:1 or wider master.
 const layoutRatios=(orientation,master={})=>orientation==='square'?['1x1']
  :Number(master?.width)/Number(master?.height)>=1.85?['1x2','1x3']:ratios;
 const manifest={artworkId:identifier,status:'ready',orientation:'landscape',
  master:{key:originalKey,size:321654,originalFilename:'tuscan-hills.jpg'},
  fulfillmentRatios:{},sourceEtsyListingId:4201324221};
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
  artworkObjectInfo:async key=>({size:objects.get(key)?.size||0,contentType:objects.get(key)?.contentType||''}),
  inspectStoredMasterGeometry:async()=>({...geometry}),
  signedArtworkUploadUrl:async key=>'https://example.invalid/'+key,
  copyArtworkObject:async(from,to)=>{
   if(!objects.has(from))throw Error('Missing copy source '+from);
   objects.set(to,{...objects.get(from)});return {key:to,size:objects.get(to).size};
  },
  deleteArtworkObject:async key=>objects.delete(key),
  listArtworkObjectKeys:async prefix=>[...objects.keys()].filter(key=>key.startsWith(prefix)),
  listArtworkObjects:async prefix=>[...objects.entries()].filter(([key])=>key.startsWith(prefix))
   .map(([key,value])=>({key,lastModified:value.lastModified||new Date()})),
  FULFILLMENT_RATIOS:ratios,
  SQUARE_FULFILLMENT_RATIOS:['1x1'],
  PANORAMIC_FULFILLMENT_RATIOS:['1x2','1x3'],
  fulfillmentRatiosForOrientation:layoutRatios,
  fulfillmentRatioObjectKey:(id,ratio)=>'artworks/'+id+'/fulfillment/'+ratio+'.jpg',
  createCropJob:async({artworkId,masterKey,orientation})=>{
   const job={id:'crop-'+seed,artworkId,masterKey,orientation,status:'pending',resultAssets:{}};
   jobs.set(job.id,job);return {job:clone(job),reused:false};
  },
  getCropJob:async id=>jobs.has(id)?clone(jobs.get(id)):null,
  readCropJobStore:async()=>({jobs:[...jobs.values()].map(clone)}),
  checkedRevisionAssets:async(record,job)=>{
   if(!job||job.status!=='completed'||record.jobId!==job.id||job.masterKey!==record.masterKey)
    throw Error('New artwork crops have not completed.');
   return clone(job.resultAssets);
  }
 };
 const body=source.replace(/^\s*import\s+[\s\S]*?\s+from\s+['"][^'"]+['"];?\s*$/gm,'').replace(/^export /gm,'');
 const sandbox=vm.createContext({...stubs,console:{...console,info(){},warn(){}}});
 vm.runInContext(body+';globalThis.api={reserveConverterArtworkRegeneration,startConverterArtworkCrop,'+
  'activateConverterArtworkRevision,cleanupStaleDerivedFiles,foreignRatioCrops};',sandbox);
 const args={shopId:'123456',listingId:4201324221,artworkId:identifier};
 function completeCrops(revision,stagedMaster,jobId){
  const job=jobs.get(jobId);job.status='completed';
  for(const ratio of layoutRatios(geometry.orientation,geometry)){
   const key='artworks/'+identifier+'/.reconvert/'+revision+'/fulfillment/'+ratio+'.jpg';
   objects.set(key,{size:12000,data:'new '+ratio});
   job.resultAssets[ratio]={key,sourceMasterKey:stagedMaster,productionReady:true,width:17499,height:11666};
  }
 }
 return {api:sandbox.api,manifest,objects,states,jobs,args,originalKey,completeCrops};
}

test('regenerating from the stored master copies it inside R2 and rewrites the artwork folder', async()=>{
 const f=fixture();
 const reserved=await f.api.reserveConverterArtworkRegeneration(f.args);
 assert.equal(reserved.source,'existing-master');
 assert.equal(reserved.uploadAlreadyPresent,true);
 const staged='artworks/'+identifier+'/.reconvert/'+reserved.revision+'/master.jpg';
 assert.equal(f.objects.get(staged).data,'stored master','stored master copied into staging, no upload');
 assert.equal(f.manifest.master.key,f.originalKey,'nothing replaced before crops are verified');

 const again=await f.api.reserveConverterArtworkRegeneration(f.args);
 assert.equal(again.revision,reserved.revision,'a second click resumes instead of starting over');

 const started=await f.api.startConverterArtworkCrop({...f.args,revision:reserved.revision});
 assert.equal(started.job.masterKey,staged);
 await assert.rejects(()=>f.api.activateConverterArtworkRevision({...f.args,revision:reserved.revision}),/crops have not completed/);

 f.completeCrops(reserved.revision,staged,started.job.id);
 const result=await f.api.activateConverterArtworkRevision({...f.args,revision:reserved.revision});
 assert.equal(result.alreadyActive,false);
 assert.equal(f.manifest.master.key,f.originalKey);
 assert.equal(f.manifest.master.originalFilename,'tuscan-hills.jpg');
 for(const ratio of ['2x3','3x4','4x5','11x14']){
  const key='artworks/'+identifier+'/fulfillment/'+ratio+'.jpg';
  assert.equal(f.objects.get(key).data,'new '+ratio,ratio+' overwritten in the SKU folder');
  assert.equal(f.manifest.fulfillmentRatios[ratio].width,17499);
 }
 assert.equal([...f.objects.keys()].filter(k=>k.includes('/.reconvert/')).length,0,'staging folder removed');
});

test('activation removes stale derived files older than 7 days and keeps mockups and recent files', async()=>{
 const f=fixture();
 const reserved=await f.api.reserveConverterArtworkRegeneration(f.args);
 const started=await f.api.startConverterArtworkCrop({...f.args,revision:reserved.revision});
 f.completeCrops(reserved.revision,'artworks/'+identifier+'/.reconvert/'+reserved.revision+'/master.jpg',started.job.id);
 await f.api.activateConverterArtworkRevision({...f.args,revision:reserved.revision});
 const keys=[...f.objects.keys()];
 assert.ok(!keys.includes('artworks/'+identifier+'/production/canvas/40x60-landscape.jpg'),'old render removed');
 assert.ok(!keys.includes('artworks/'+identifier+'/fulfillment/by-size/40x60.jpg'),'old size crop removed');
 assert.ok(keys.includes('artworks/'+identifier+'/fulfillment/sensaria/40x60.jpg'),'file from the last 7 days kept');
 assert.ok(keys.includes('artworks/'+identifier+'/mockups/room.jpg'),'mockups never touched');
 assert.ok(keys.includes(f.originalKey),'master kept');
});

async function regenerate(f){
 const reserved=await f.api.reserveConverterArtworkRegeneration(f.args);
 const started=await f.api.startConverterArtworkCrop({...f.args,revision:reserved.revision});
 f.completeCrops(reserved.revision,'artworks/'+identifier+'/.reconvert/'+reserved.revision+'/master.jpg',started.job.id);
 return f.api.activateConverterArtworkRevision({...f.args,revision:reserved.revision});
}
const crop=ratio=>'artworks/'+identifier+'/fulfillment/'+ratio+'.jpg';

test('a horizontal artwork is re-cropped to its own ratios and loses the panoramic crops made by mistake', async()=>{
 const f=fixture();
 for(const ratio of ['1x2','1x3'])f.objects.set(crop(ratio),{size:9000,data:'wrong '+ratio});
 await regenerate(f);
 for(const ratio of ['2x3','3x4','4x5','11x14'])assert.equal(f.objects.get(crop(ratio)).data,'new '+ratio);
 assert.ok(!f.objects.has(crop('1x2'))&&!f.objects.has(crop('1x3')),'panoramic crops removed');
 assert.deepEqual(Object.keys(f.manifest.fulfillmentRatios).sort(),['11x14','2x3','3x4','4x5']);
});

test('a panoramic artwork is re-cropped to 1:2 and 1:3 only and loses the regular crops', async()=>{
 const f=fixture({geometry:{width:6000,height:2000,orientation:'landscape'}});
 for(const ratio of ['3x4','4x5','11x14','1x1'])f.objects.set(crop(ratio),{size:9000,data:'wrong '+ratio});
 await regenerate(f);
 assert.equal(f.objects.get(crop('1x2')).data,'new 1x2');
 assert.equal(f.objects.get(crop('1x3')).data,'new 1x3');
 for(const ratio of ['2x3','3x4','4x5','11x14','1x1'])assert.ok(!f.objects.has(crop(ratio)),ratio+' removed');
 assert.deepEqual(Object.keys(f.manifest.fulfillmentRatios).sort(),['1x2','1x3']);
 assert.ok(f.objects.has(f.originalKey)&&f.objects.has('artworks/'+identifier+'/mockups/room.jpg'),'master and mockups kept');
});

test('a new master keeps the crops of the layout its listing sold before', ()=>{
 const f=fixture();
 // Only ratios neither layout uses are unused: the sandbox lists 2x3, 3x4, 4x5, 11x14, 1x1, 1x2, 1x3.
 assert.deepEqual([...f.api.foreignRatioCrops(['2x3','3x4','4x5','11x14'],['1x2','1x3'])],['1x1']);
 assert.deepEqual([...f.api.foreignRatioCrops(['1x2','1x3'],['1x2','1x3'])],['2x3','3x4','4x5','11x14','1x1']);
});

test('cleanup only looks inside the derived folders of that one artwork', async()=>{
 const f=fixture();
 f.objects.set('artworks/SAC0008/production/canvas/40x60-portrait.jpg',{size:1,lastModified:new Date(0)});
 const result=await f.api.cleanupStaleDerivedFiles(identifier);
 assert.ok(result.deleted.every(key=>key.startsWith('artworks/'+identifier+'/')));
 assert.ok(f.objects.has('artworks/SAC0008/production/canvas/40x60-portrait.jpg'));
 assert.deepEqual([...result.kept],['artworks/'+identifier+'/fulfillment/sensaria/40x60.jpg']);
});

test('Listings editor offers re-upload / regenerate and activates through a confirmed endpoint', ()=>{
 const html=renderListingsPage();
 assert.ok(html.includes('id="artwork-section"'));
 assert.ok(html.includes('id="artwork-file"'));
 assert.ok(html.includes('id="artwork-replace"'));
 const client=readFileSync(new URL('../src/listings-client.js',import.meta.url),'utf8');
 assert.doesNotThrow(()=>new vm.Script(client));
 assert.ok(client.includes("useExistingMaster:true"));
 assert.ok(client.includes("'/api/listing-converter/reconvert/crop'"));
 assert.ok(client.includes("'/api/listing-converter/reconvert/activate'"));
 assert.ok(client.includes("confirm:'REPLACE SILVIA ARTWORK'"));
 const server=readFileSync(new URL('../src/server.mjs',import.meta.url),'utf8');
 assert.ok(server.includes("url.pathname==='/api/listing-converter/reconvert/activate'"));
 assert.ok(server.includes("body.confirm!=='REPLACE SILVIA ARTWORK'"));
 assert.ok(server.includes('reserveConverterArtworkRegeneration({'));
});

test('new Product Creator listings are linked by their SKUs, not shown as "Not linked"', async()=>{
 const {artworkIdFromSkus}=await import('../src/master-listings.mjs');
 assert.equal(artworkIdFromSkus(['SAC0012-P-1218','SAC0012-FC-2436-BLK']),'SAC0012');
 assert.equal(artworkIdFromSkus(['sac0031-c-4060']),'SAC0031');
 assert.equal(artworkIdFromSkus(['SAC0001-P-1218','SAC0002-P-1218']),null,'mixed artworks are not guessed');
 assert.equal(artworkIdFromSkus(['GELATO-123','']),null);
 assert.equal(artworkIdFromSkus(undefined),null);
 const client=readFileSync(new URL('../src/listings-client.js',import.meta.url),'utf8');
 assert.ok(!client.includes('Not linked to Silvia'));
 assert.ok(!client.includes('No Silvia artwork mapping'));
 assert.ok(client.includes('data?.artworkEditable'));
 const server=readFileSync(new URL('../src/server.mjs',import.meta.url),'utf8');
 assert.ok(server.includes('artworkId:mapping?.artworkId||artworkIdFromSkus(x.skus)'));
 // Artwork edits still require a verified link: converter map or the artwork's
 // own manifest recording this Etsy listing ID.
 assert.ok(server.includes('async function resolveListingArtwork({listingId,listing,map})'));
 assert.ok(server.includes('manifest?.etsyDraftListingId,manifest?.etsyConfiguration?.listingId,manifest?.sourceEtsyListingId'));
 assert.ok(server.includes("error:'Artwork ownership could not be verified for this listing.'"));
});

test('crop completion treats .reconvert staging jobs as staged, not as a changed master', async()=>{
 const {isStagedConverterCropJob,isStagedRevisionJob,cropOutputKeyForJob}=await import('../src/artwork-revision.mjs');
 const job={artworkId:'SAC0007',masterKey:'artworks/SAC0007/.reconvert/00000000-0000-4000-8000-000000000001/master.jpeg'};
 assert.equal(isStagedConverterCropJob(job),true);
 assert.equal(isStagedRevisionJob(job),false);
 assert.equal(cropOutputKeyForJob(job,'2x3'),'artworks/SAC0007/.reconvert/00000000-0000-4000-8000-000000000001/fulfillment/2x3.jpg');
 assert.equal(isStagedConverterCropJob({artworkId:'SAC0007',masterKey:'artworks/SAC0007/master.jpg'}),false);
 const server=readFileSync(new URL('../src/server.mjs',import.meta.url),'utf8');
 const complete=server.slice(server.indexOf("const currentJob = await getCropJob(jobId);"),server.indexOf('const job = await completeCropJob(jobId, workerId, assets);')+400);
 assert.ok(complete.includes('if (isStagedCropJob(currentJob)) {'),'staged master is not compared with the live master');
 assert.ok(complete.includes('} else if (!isStagedCropJob(currentJob)) {'),'staged crops never overwrite live manifest crops');
 assert.ok(!/isStagedRevisionJob\(currentJob\)/.test(complete),'every completion check covers both staging folders');
 assert.ok(server.includes('return isStagedRevisionJob(job)||isStagedConverterCropJob(job);'));
});
