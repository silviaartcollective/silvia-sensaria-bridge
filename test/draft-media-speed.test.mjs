import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {mockupEtsyKey} from '../src/mockup-generator.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

test('Etsy receives ready 2400 px copies instead of Render resizing full-size originals',()=>{
 const server=read('src/server.mjs');
 assert.match(server,/async function etsyReadyImage\(key,\{etsyKey=''\}=\{\}\)/);
 // The media plan, master recovery and both mockup syncs use the ready copies.
 assert.match(server,/await etsyReadyImage\(item\.key, \{ etsyKey: etsyKeyForMedia\(manifest, item\.key\) \}\)/);
 assert.match(server,/etsyReadyImage\(manifest\.master\.key,\{etsyKey:manifest\.master\.etsyKey\|\|''\}\)/);
 assert.equal(server.match(/etsyReadyImage\(item\.key,\{etsyKey:item\.etsyKey\|\|''\}\)/g)?.length,2);
 assert.match(server,/if \(!object \|\| object\.etsyReady\) return;/);
 // Preset photos are resized once per server start, not once per draft.
 assert.match(server,/if\(PRESET_MEDIA\.some\(item=>item\.key===key\)\)presetEtsyImages\.set\(key,optimized\)/);
});

test('the PC worker uploads an Etsy copy with each mockup and the server checks it before using it',()=>{
 assert.equal(mockupEtsyKey('mockups/outputs/job/a.jpg'),'mockups/outputs/job/a.etsy.jpg');
 const api=read('src/mockup-api.mjs'),worker=read('worker/index.mjs'),workerApi=read('worker/api.mjs');
 assert.match(api,/etsyKey,etsyUploadUrl/);
 assert.match(api,/body\.etsyUploaded===true/);
 assert.match(worker,/sized\(claim\.output\.etsyUploadUrl,2400,90,'Etsy copy'\)/);
 assert.match(workerApi,/previewUploaded=false,etsyUploaded=false/);
 assert.match(read('src/mockup-generator.mjs'),/item\.etsyKey=details\.etsyKey\|\|null/);
 // Copied into the artwork folder with its mockup, so the artwork does not
 // depend on the batch's outputs.
 const server=read('src/server.mjs');
 assert.match(server,/etsyKey=key\.replace\(\/\\\.jpg\$\/,'\.etsy\.jpg'\);\s*await copyArtworkObject\(t\.etsyKey,etsyKey\)/);
});

test('the Product Creator makes the master Etsy copy in the browser while the master uploads',()=>{
 const page=read('src/product-creator.mjs');
 assert.match(page,/function etsyCopyOf\(file\)/);
 assert.match(page,/resizeWidth/);
 // Rotated or mirrored photos are resized by the server, which applies EXIF orientation.
 assert.match(page,/size\.orientation!==1\)return null/);
 assert.match(page,/imageOrientation:'none'/);
 assert.match(page,/data\.etsyUploadUrl\?putFile\(data\.etsyUploadUrl,blob,'image\/jpeg'\)/);
});

test('the preset video is uploaded to Etsy once and attached to later drafts by its video_id',()=>{
 const server=read('src/server.mjs'),etsy=read('src/etsy.mjs');
 assert.match(etsy,/export async function attachListingVideo/);
 assert.match(etsy,/form\.append\('video_id', String\(videoId\)\)/);
 assert.match(server,/const reusableVideoId = videoPreset \? await presetVideoId\(session\.shop\.shop_id, videoPreset\.key\) : null;/);
 assert.match(server,/if \(reusableVideoId\) return false;/);
 assert.match(server,/await savePresetVideoId\(session\.shop\.shop_id, videoItem\.key, uploaded\.video_id\)/);
});

test('selected PSD mockups reach the new draft even when a draft setup step failed',()=>{
 const server=read('src/server.mjs');
 // Before the draft exists only the choice is saved; nothing is copied into the
 // artwork, so the new draft starts as master + presets.
 const sync=server.slice(server.indexOf('async function syncGeneratedMockupsForArtwork'));
 const pending=sync.indexOf("message:'Selected PSD mockups are added when the Etsy draft is created.'");
 assert.ok(pending>0&&pending<sync.indexOf('await copyArtworkObject(t.outputKey,key)'));
 // After setup (completed or not) the chosen mockups and photo order are applied.
 const finallyBlock=server.slice(server.indexOf('inflightDraftSetups.delete(setupId);'));
 assert.match(finallyBlock.slice(0,900),/void reconcileCompletedMockupsForArtwork\(setupId\)/);
 assert.doesNotMatch(finallyBlock.slice(0,900),/status==='completed'\)\{\s*void reconcileCompletedMockupsForArtwork/);
});
