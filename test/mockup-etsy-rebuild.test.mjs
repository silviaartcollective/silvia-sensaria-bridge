import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {verifyEtsyImageReceipts,missingEtsyImageReceipts} from '../src/etsy-media-verification.mjs';
import {artworkOrientationFromPixels,templateMatchesArtwork,validateTemplateSelection} from '../src/mockup-orientation.mjs';
import {renderProductCreator} from '../src/product-creator.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

test('missing R2 presets cannot block manually uploaded Etsy mockups',()=>{
 const server=read('src/server.mjs');
 assert.doesNotMatch(server,/if \(!presetStatus\.configured\) \{\s*throw new Error/);
 assert.match(server,/installedPresets = presetStatus\.items\.filter\(item=>item\.exists\)/);
 assert.match(server,/missingPresetRoles/);
 assert.match(server,/starterDraftMedia\(manifest.master,PRESET_MEDIA\)/);
 assert.match(server,/uploadedImages\.filter\(Boolean\)/);
 assert.match(server,/await verifyEtsyImageReceipts\(/);
 assert.match(server,/const readRemoteImages=\(\)=>getEtsyListingImages/);
});

test('an Etsy photo must have an ID and appear in actual listing readback',async()=>{
 const receipts=[{filename:'1.jpg',listingImageId:1},{filename:'2.jpg',listingImageId:2}];
 let calls=0;
 const result=await verifyEtsyImageReceipts({receipts,
  readImages:async()=>{calls++;return calls===1?
    [{listing_image_id:1}]:[{listing_image_id:1},{listing_image_id:2}]},
  pause:async()=>{},attempts:3});
 assert.equal(result.verified,2);
 assert.equal(calls,2);
 assert.equal(missingEtsyImageReceipts(receipts,[{listing_image_id:1}]).length,1);
 await assert.rejects(()=>verifyEtsyImageReceipts({receipts,
  readImages:async()=>[{listing_image_id:1}],pause:async()=>{},attempts:2
 }),/did not confirm 1 uploaded photo/);
});

test('regular mockups can be reserved and confirmed after the original master upload',async()=>{
 const source=read('src/regular-mockup-uploads.mjs');
 assert.match(source,/pendingRegularMockups/);
 assert.match(source,/source:'regular-upload'/);
 assert.match(source,/originalFilename:file\.filename/);
 assert.match(source,/mockupObjectKey/);
 const app=renderProductCreator();
 assert.match(app,/id="upload-regular-mockups"/);
 assert.match(app,/id="regular-mockup-status"/);
 assert.match(app,/regular-mockups'/);
 const server=read('src/server.mjs');
 assert.match(server,/queueRegularMockupEtsySync\(artworkId\)/);
 assert.match(server,/regular-mockups\(\?:/);
 assert.match(server,/manifest\.etsyDraftSetup\?\.status!=='completed'/);
 assert.match(server,/verifyEtsyImageReceipts\(\{receipts:newlyUploaded/);
});

test('vertical landscape and square mockups remain separated',()=>{
 assert.equal(artworkOrientationFromPixels(2000,3000),'portrait');
 assert.equal(artworkOrientationFromPixels(3000,2000),'landscape');
 assert.equal(artworkOrientationFromPixels(3000,3000),'square');
 const portrait={name:'Vertical Room',orientation:'portrait'};
 const landscape={name:'Horizontal Room',orientation:'landscape'};
 const squareSafe={name:'Square Compatible',orientation:'portrait',squareCompatible:true};
 assert.ok(templateMatchesArtwork(portrait,'portrait'));
 assert.ok(templateMatchesArtwork(landscape,'landscape'));
 assert.ok(templateMatchesArtwork(squareSafe,'square'));
 assert.equal(templateMatchesArtwork(landscape,'portrait'),false);
 assert.equal(templateMatchesArtwork(portrait,'square'),false);
 assert.throws(()=>validateTemplateSelection([portrait,landscape],'portrait'),/not designated/);
 const creator=renderProductCreator();
 assert.match(creator,/id="mg-psds-horizontal"/);
 assert.match(creator,/id="mg-psds"/);
 assert.match(read('src/mockup-generator.mjs'),/validateTemplateSelection/);
 assert.match(read('src/mockup-api.mjs'),/artworkOrientation:manifest\.orientation/);
});

test('PSD jobs reuse Chromium and default to Photopea',()=>{
 const processor=read('worker/mockup-processor.mjs');
 assert.match(processor,/POD_PSD_RENDERER\|\|'photopea'/);
 assert.match(processor,/getWarmPhotopeaBrowser/);
 assert.match(processor,/sharedPhotopeaBrowser\?\.isConnected/);
 assert.match(processor,/if\(page\)await page\.close/);
 assert.doesNotMatch(processor,/if\(browser\)await browser\.close/);
});

test('only manually selected JPGs are attached to Etsy and saved for restart recovery',()=>{
 const server=read('src/server.mjs');
 assert.match(server,/if\(!chosen\.size\)throw Error\('Select completed mockups/);
 assert.match(server,/manifest\.selectedMockupTemplates\[job\.id\]=\[\.\.\.chosen\]/);
 assert.match(server,/Object\.entries\(manifest\.selectedMockupTemplates\|\|\{\}\)/);
 assert.doesNotMatch(server,/jobId:verifiedJob\.id\s*\}\)\.catch/);
});
