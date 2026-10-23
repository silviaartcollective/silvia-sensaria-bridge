import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {readFileSync} from 'node:fs';
import {photoFingerprint,comparePhotos,scanForPhoto,replacePhotos,stopPhotoJob} from '../src/photo-replacer.mjs';
import {renderListingsPage} from '../src/listings-page.mjs';

const svg=(title,sub,frame='#3b2a1e',bg='#f4efe8')=>Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1600">
<rect width="1600" height="1600" fill="${bg}"/>
<text x="800" y="220" font-size="120" text-anchor="middle" font-family="serif" fill="#222">${title}</text>
<text x="800" y="330" font-size="56" text-anchor="middle" font-family="sans-serif" fill="#555">${sub}</text>
${[0,1,2].map(i=>`<rect x="${160+i*450}" y="560" width="380" height="520" fill="${frame}"/><rect x="${185+i*450}" y="585" width="330" height="470" fill="#d9cbb8"/>`).join('')}
</svg>`);
const room=(art)=>Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1600"><rect width="1600" height="1600" fill="#c9bfb0"/>
<rect x="500" y="300" width="600" height="800" fill="#4a3424"/><rect x="530" y="330" width="540" height="740" fill="${art}"/></svg>`);
// Etsy's 570px rendition of an upload.
const etsy=async source=>sharp(await sharp(source).png().toBuffer()).resize(570).jpeg({quality:80}).toBuffer();
const presetSource=await sharp(svg('Choose Your Frame','Three frame colours available')).png().toBuffer();
const photos={
 preset:await etsy(presetSource),
 presetOld:await etsy(svg('Choose Your Frame','Two frame colours available')),
 newPhoto:await etsy(svg('Pick Your Frame','Black, natural oak or walnut','#20201e','#ffffff')),
 mockA:await etsy(room('#8a8f6e')),mockB:await etsy(room('#b9a38f')),mockC:await etsy(room('#7d93a6'))
};

test('the same photo matches after Etsy re-encodes it; an older version is similar; a mockup is different',async()=>{
 const preset=await photoFingerprint(photos.preset);
 assert.equal(comparePhotos(preset,await photoFingerprint(presetSource)).kind,'same');
 assert.equal(comparePhotos(preset,await photoFingerprint(await sharp(presetSource).resize(1200).jpeg({quality:70}).toBuffer())).kind,'same');
 assert.equal(comparePhotos(preset,await photoFingerprint(photos.presetOld)).kind,'similar');
 assert.equal(comparePhotos(preset,await photoFingerprint(photos.mockA)).kind,'different');
 assert.equal(comparePhotos(preset,await photoFingerprint(photos.newPhoto)).kind,'different');
});

// A fake Etsy shop. Each photo is {id,name}; the image bytes come from `photos`.
function fakeShop(layout,{honourOverwrite=true}={}){
 let nextId=9000;const store=new Map(),bytes=new Map(),calls={upload:0,delete:0,rank:0,getImages:0};
 const image=(name)=>{const id=String(++nextId);bytes.set('https://i.etsystatic.com/'+id+'.jpg',photos[name]);return {id,name};};
 for(const [listingId,names] of Object.entries(layout))store.set(Number(listingId),names.map(image));
 const asEtsy=list=>list.map((p,i)=>({listing_image_id:Number(p.id),rank:i+1,url_570xN:'https://i.etsystatic.com/'+p.id+'.jpg',full_width:570,full_height:570}));
 let saved=null;
 const deps={
  newId:()=>'job-'+Math.random().toString(16).slice(2),pause:async()=>{},
  loadJob:async()=>saved&&structuredClone(saved),saveJob:async job=>{saved=structuredClone(job);},
  listListings:async()=>[...store.keys()].map(id=>({listingId:id,title:'Listing '+id,state:'active',artworkId:null})),
  getImages:async id=>{calls.getImages++;return asEtsy(store.get(Number(id)));},
  fetchImage:async url=>{if(!bytes.has(url))throw Error('no image '+url);return bytes.get(url);},
  newImage:async()=>({buffer:photos.newPhoto,filename:'new.jpg',contentType:'image/jpeg'}),
  uploadPhoto:async({listingId,rank,overwrite})=>{
   calls.upload++;const list=store.get(listingId),fresh=image('newPhoto');
   if(overwrite&&honourOverwrite&&list[rank-1])list[rank-1]=fresh;else list.splice(list.length,0,fresh);
   return {listing_image_id:Number(fresh.id)};
  },
  deletePhoto:async({listingId,listingImageId})=>{calls.delete++;const list=store.get(listingId);list.splice(list.findIndex(p=>p.id===String(listingImageId)),1);},
  setRank:async({listingId,listingImageId,rank})=>{calls.rank++;const list=store.get(listingId),i=list.findIndex(p=>p.id===String(listingImageId));const [p]=list.splice(i,1);list.splice(rank-1,0,p);},
  updatePreset:async role=>{deps.presetUpdated=role;},
  onReplaced:async row=>{(deps.replaced||=[]).push(row.listingId);}
 };
 const names=id=>store.get(Number(id)).map(p=>p.name);
 const referenceOf=(listingId,rank)=>{const p=store.get(listingId)[rank-1];return {listingId,listingImageId:p.id,rank,url:'https://i.etsystatic.com/'+p.id+'.jpg',width:570,height:570};};
 const settled=async()=>{for(let i=0;i<400;i++){const job=await deps.loadJob();if(job&&!['scanning','replacing'].includes(job.status))return job;await new Promise(r=>setTimeout(r,10));}throw Error('job did not finish');};
 return {deps,store,names,calls,referenceOf,settled};
}
const layout={
 1:['mockA','preset','mockB'],          // the preset in the usual slot
 2:['mockA','presetOld','mockC'],       // an older version in the usual slot
 3:['mockA','mockB','mockC','preset'],  // the preset in another slot
 4:['mockA','mockB'],                   // no preset
 5:['mockA','newPhoto','mockB']         // already replaced
};

test('scanning finds the photo by slot first, then anywhere, and ticks what is safe to replace',async()=>{
 const shop=fakeShop(layout);
 await scanForPhoto(shop.deps,{reference:shop.referenceOf(1,2),slot:2,presetRole:'choose-frame',newImage:{key:'photo-replacer/x.jpg'}});
 const job=await shop.settled();
 assert.equal(job.status,'scanned');
 const row=id=>job.results.find(r=>r.listingId===id);
 assert.deepEqual([row(1).target.kind,row(1).target.atSlot,row(1).selected],['same',true,true]);
 assert.deepEqual([row(2).target.kind,row(2).target.atSlot,row(2).selected],['similar',true,true]);
 assert.deepEqual([row(3).target.kind,row(3).target.rank,row(3).target.atSlot,row(3).selected],['same',4,false,true]);
 assert.equal(row(4).target,null);assert.equal(row(4).selected,false);assert.ok(row(4).slotThumb,'shows what slot 2 holds');
 assert.equal(row(5).outcome.status,'already');
 assert.equal(shop.calls.upload,0,'scanning changes nothing');
});

test('replacing puts the new photo in the same position, removes the old one, and resumes after a stop',async()=>{
 const shop=fakeShop(layout);
 await scanForPhoto(shop.deps,{reference:shop.referenceOf(1,2),slot:2,presetRole:'choose-frame',newImage:{key:'photo-replacer/x.jpg'}});
 await shop.settled();
 await replacePhotos(shop.deps,{listingIds:[1,2,3]});
 const job=await shop.settled();
 assert.equal(job.status,'done');
 assert.deepEqual(shop.names(1),['mockA','newPhoto','mockB']);
 assert.deepEqual(shop.names(2),['mockA','newPhoto','mockC']);
 assert.deepEqual(shop.names(3),['mockA','mockB','mockC','newPhoto']);
 assert.deepEqual(shop.names(4),['mockA','mockB'],'unticked listings are untouched');
 assert.equal(shop.deps.presetUpdated,'choose-frame');
 assert.deepEqual(shop.deps.replaced,[1,2,3]);
 // Replacing again does nothing new.
 const uploads=shop.calls.upload;
 await assert.rejects(replacePhotos(shop.deps,{listingIds:[1,2,3]}),/Tick at least one/);
 assert.equal(shop.calls.upload,uploads);
});

test('if Etsy adds the photo instead of overwriting, the old one is deleted and the new one moved into place',async()=>{
 const shop=fakeShop({1:['mockA','preset','mockB']},{honourOverwrite:false});
 await scanForPhoto(shop.deps,{reference:shop.referenceOf(1,2),slot:2,newImage:{key:'photo-replacer/x.jpg'}});
 await shop.settled();
 await replacePhotos(shop.deps,{listingIds:[1]});
 await shop.settled();
 assert.deepEqual(shop.names(1),['mockA','newPhoto','mockB']);
 assert.equal(shop.calls.delete,1);assert.equal(shop.calls.rank,1);
});

test('one job at a time, and a stopped job keeps what it did',async()=>{
 const shop=fakeShop(Object.fromEntries(Array.from({length:30},(_,i)=>[i+1,['mockA','preset']])));
 await scanForPhoto(shop.deps,{reference:shop.referenceOf(1,2),slot:2,newImage:{key:'photo-replacer/x.jpg'}});
 await assert.rejects(scanForPhoto(shop.deps,{reference:shop.referenceOf(1,2),slot:2,newImage:{key:'k'}}),/already working/);
 await shop.settled();
 // Stop after the third listing.
 let replacedSoFar=0;shop.deps.pause=async()=>{if(++replacedSoFar===3)stopPhotoJob();};
 await replacePhotos(shop.deps,{listingIds:Array.from({length:30},(_,i)=>i+1)});
 const stopped=await shop.settled();
 assert.equal(stopped.status,'stopped');
 const done=stopped.results.filter(r=>r.outcome?.status==='replaced').length;
 assert.equal(done,3);
 shop.deps.pause=async()=>{};
 await replacePhotos(shop.deps,{listingIds:Array.from({length:30},(_,i)=>i+1)});
 const finished=await shop.settled();
 assert.equal(finished.results.filter(r=>r.outcome?.status==='replaced').length,30);
 assert.equal(shop.calls.upload,30,'each listing replaced exactly once');
});

test('Listings has a Replace a photo tab; the server checks before it changes Etsy',()=>{
 const page=renderListingsPage();
 assert.match(page,/id=\\?"tab-photos\\?"[^>]*>Replace a photo</);
 assert.match(page,/photo-replacer-client\.js/);
 const client=readFileSync(new URL('../src/photo-replacer-client.js',import.meta.url),'utf8');
 assert.match(client,/confirm:'REPLACE PHOTOS ON ETSY'/);
 const server=readFileSync(new URL('../src/server.mjs',import.meta.url),'utf8');
 assert.match(server,/body\.confirm!=='REPLACE PHOTOS ON ETSY'/);
 // Only Etsy's photo addresses are downloaded, and only the uploaded key is used.
 assert.match(server,/etsystatic\\\.com\$\/i\.test\(parsed\.hostname\)/);
 assert.match(server,/\^photo-replacer\\\/\[0-9a-f-\]\{36\}/);
});

test('the converter puts the choose-frame photo in slot 5: replaced there, added last, or left alone', async()=>{
 const {placePhotoAtSlot}=await import('../src/photo-replacer.mjs');
 const shop=fakeShop({
  1:['mockA','mockB','mockC','mockA','mockB','mockC'], // something else in slot 5
  2:['mockA','mockB'],                                 // fewer than 5 photos
  3:['mockA','mockB','mockC','mockA','newPhoto'],      // already there
  4:['newPhoto','mockB','mockC','mockA','mockB','mockC'] // an older copy in slot 1
 });
 const photo={buffer:photos.newPhoto,filename:'Choose Frame.jpg',contentType:'image/jpeg'};
 assert.equal((await placePhotoAtSlot(shop.deps,{listingId:1,slot:5,photo})).status,'placed');
 assert.deepEqual(shop.names(1),['mockA','mockB','mockC','mockA','newPhoto','mockC']);
 assert.equal((await placePhotoAtSlot(shop.deps,{listingId:2,slot:5,photo})).rank,3);
 assert.deepEqual(shop.names(2),['mockA','mockB','newPhoto']);
 const uploads=shop.calls.upload;
 assert.equal((await placePhotoAtSlot(shop.deps,{listingId:3,slot:5,photo})).status,'already');
 assert.equal(shop.calls.upload,uploads,'no upload when slot 5 already shows it');
 await placePhotoAtSlot(shop.deps,{listingId:4,slot:5,photo});
 assert.deepEqual(shop.names(4).filter(n=>n==='newPhoto').length,1,'no duplicate');
 assert.equal(shop.names(4)[4],'newPhoto');
 assert.equal(shop.names(4).length,5,'the photo in slot 5 was replaced and the old copy removed');
});
