import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {defaultPlannedOrder,mergeOrder,desiredImageOrder,rankUpdates,ETSY_PHOTO_LIMIT} from '../src/etsy-photo-organizer.mjs';

const presets=[{role:'choose-option',key:'p/option.jpg'},{role:'choose-frame',key:'p/frame.png'},{role:'promotion',key:'p/promo.jpg'}];

test('a new draft puts a mockup first and the preset photos at their usual places; never the master',()=>{
 const generated=Array.from({length:17},(_,i)=>'generated:t'+i);
 const order=defaultPlannedOrder({presets,generated});
 assert.equal(order.length,20);
 assert.equal(order[0],'generated:t0');
 assert.equal(order[1],'key:p/option.jpg');
 assert.equal(order[4],'key:p/frame.png');
 assert.equal(order[14],'key:p/promo.jpg');
 assert.deepEqual(order.filter(id=>id.startsWith('generated:')),generated);
 // With few mockups the presets that would land past the end go last.
 assert.deepEqual(defaultPlannedOrder({presets,generated:['generated:a','generated:b']}),
  ['generated:a','key:p/option.jpg','generated:b','key:p/frame.png','key:p/promo.jpg']);
});
test('the organizer never shows the master, and saving removes it from an older draft',()=>{
 const server=readFileSync(new URL('../src/server.mjs',import.meta.url),'utf8');
 const organizer=server.slice(server.indexOf('async function etsyPhotoOrganizer'),server.indexOf('async function applyEtsyPhotoOrder'));
 assert.doesNotMatch(organizer,/Master artwork|kind:'master'/);
 assert.match(organizer,/live\.filter\(image=>!isMaster\(image\)\)/);
 const apply=server.slice(server.indexOf('async function applyEtsyPhotoOrder'));
 assert.match(apply,/if\(String\(listing\.state\)==='draft'\)\{\s*await withEtsyListingRetry\(\(\)=>deleteListingImage\(/);
 assert.match(server,/tiles:order\.filter\(id=>id!=='master'&&id!==master\)/);
});
test('a saved order keeps only photos that still exist, and new photos follow it',()=>{
 assert.deepEqual(mergeOrder(['c','gone','a'],['a','b','c']),['c','a','b']);
 assert.equal(mergeOrder([],Array.from({length:25},(_,i)=>'x'+i)).length,ETSY_PHOTO_LIMIT);
});

test('the chosen order maps to Etsy photo ids, and unmanaged photos keep their place after it',()=>{
 const liveImages=[{listing_image_id:1,rank:1},{listing_image_id:2,rank:2},{listing_image_id:3,rank:3},{listing_image_id:9,rank:4}];
 const receipts=[{key:'master.jpg',listingImageId:1},{key:'p/option.jpg',listingImageId:2},{key:'artworks/SAC1/mockups/0.jpg',listingImageId:3}];
 const desired=desiredImageOrder({order:['generated:t7','key:p/option.jpg','key:master.jpg'],liveImages,receipts,
  keyForGenerated:id=>id==='t7'?'artworks/SAC1/mockups/0.jpg':''});
 assert.deepEqual(desired,['3','2','1','9']);
});

test('only the photos from the first difference are re-ranked, in order',()=>{
 assert.deepEqual(rankUpdates(['1','2','3','4'],['1','2','4','3']),[{listingImageId:'4',rank:3},{listingImageId:'3',rank:4}]);
 assert.deepEqual(rankUpdates(['1','2'],['1','2']),[]);
 // Applying the updates as Etsy does (insert at rank, others shift) gives the wanted order.
 const apply=(list,updates)=>{const out=[...list];for(const {listingImageId,rank} of updates){out.splice(out.indexOf(listingImageId),1);out.splice(rank-1,0,listingImageId)}return out};
 const current=['1','2','3','4','5','6'],desired=['6','3','1','5','2','4'];
 assert.deepEqual(apply(current,rankUpdates(current,desired)),desired);
});

test('Apply selected opens the organizer; saving re-ranks Etsy photos or keeps the order for the draft',()=>{
 const client=readFileSync(new URL('../src/mockup-generator-client.js',import.meta.url),'utf8');
 const ui=readFileSync(new URL('../src/mockup-generator-ui.mjs',import.meta.url),'utf8');
 const server=readFileSync(new URL('../src/server.mjs',import.meta.url),'utf8');
 const etsy=readFileSync(new URL('../src/etsy.mjs',import.meta.url),'utf8');
 assert.match(client,/await openOrganizer\(batchId,selected\.map\(t=>t\.id\)\);/);
 assert.match(client,/pendingApply=\{batchId,templateIds,order:\[\.\.\.order\]\}/);
 assert.match(client,/pendingApplySaved=pending\.order\?saveOrderToServer\(artworkId,pending\):/);
 for(const id of ['mg-org-list','mg-org-back','mg-org-save','mg-org-status'])assert.match(ui,new RegExp('id="'+id+'"'));
 assert.match(server,/await applyEtsyPhotoOrder\(artworkId\)/);
 assert.match(etsy,/form\.append\('listing_image_id', String\(listingImageId\)\);/);
});

test('the organizer looks like Etsy\'s photo editor: rows of six, drag to reorder, the preset video fixed second',()=>{
 const client=readFileSync(new URL('../src/mockup-generator-client.js',import.meta.url),'utf8');
 const ui=readFileSync(new URL('../src/mockup-generator-ui.mjs',import.meta.url),'utf8');
 const server=readFileSync(new URL('../src/server.mjs',import.meta.url),'utf8');
 assert.match(ui,/id="mg-org-modal" hidden/);
 assert.match(ui,/<span>Drag to reorder\.<\/span>/);
 assert.match(ui,/\.mg-org-list\{[^}]*grid-template-columns:repeat\(6,minmax\(0,1fr\)\)/);
 // The video sits in the second spot and is never a drop target.
 assert.match(client,/if\(organizer\.video\)ids\.splice\(Math\.min\(1,ids\.length\),0,VIDEO_TILE\)/);
 assert.match(client,/if\(id===undefined\|\|id===VIDEO_TILE\|\|id===drag\.id\)return;/);
 // Pointer events, so mouse, pen and touch all drag; arrow keys move too.
 assert.match(client,/node\.addEventListener\('pointerdown',event=>pressTile\(event,id,node\)\)/);
 assert.match(client,/ArrowLeft:from-1,ArrowRight:from\+1/);
 assert.doesNotMatch(client,/draggable:'true'/);
 // The browser loads the preset video's frame from R2, not through the server.
 assert.match(server,/src:await signedArtworkUrl\(videoPreset\.key,3600\)/);
});

test('a photo lifts the moment it is pressed and lands the moment it is let go; moving touches layers only',()=>{
 const client=readFileSync(new URL('../src/mockup-generator-client.js',import.meta.url),'utf8');
 const ui=readFileSync(new URL('../src/mockup-generator-ui.mjs',import.meta.url),'utf8');
 const press=client.slice(client.indexOf('function pressTile('),client.indexOf('function dragMove('));
 // Picked up on press: no movement threshold, no copy of the photo to load.
 assert.match(press,/node\.classList\.add\('dragging'\)/);
 assert.doesNotMatch(client,/Math\.hypot|cloneNode|mg-org-ghost/);
 const frame=client.slice(client.indexOf('function dragFrame(){'),client.indexOf('function nearestSlot('));
 assert.doesNotMatch(frame,/getBoundingClientRect|offsetLeft|offsetTop|style\.left|style\.top/);
 assert.match(frame,/drag\.node\.style\.transform='translate3d\(/);
 assert.match(client,/if\(!drag\.frame\)drag\.frame=requestAnimationFrame\(dragFrame\);/);
 // Lands at once: no glide after release.
 const finish=client.slice(client.indexOf('function finishDrag('),client.indexOf('function cancelDrag('));
 assert.doesNotMatch(finish,/setTimeout|transition/);
 // Every tile is its own layer from the start; tiles slide in 120 ms.
 assert.match(ui,/\.mg-org-tile\{[^}]*will-change:transform\}/);
 assert.match(ui,/\.mg-org-list\.sorting \.mg-org-tile\{transition:transform \.12s/);
 assert.doesNotMatch(ui,/body\.mg-org-dragging \*/);
});
