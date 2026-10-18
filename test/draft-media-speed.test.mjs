import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {mockupEtsyKey} from '../src/mockup-generator.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

test('Etsy receives ready 2400 px copies instead of Render resizing full-size originals',()=>{
 const server=read('src/server.mjs');
 assert.match(server,/async function etsyReadyImage\(key,\{etsyKey=''\}=\{\}\)/);
 // The media plan and both mockup syncs use the ready copies; the master
 // artwork is never sent to Etsy at all.
 assert.match(server,/await etsyReadyImage\(item\.key, \{ etsyKey: etsyKeyForMedia\(manifest, item\.key\) \}\)/);
 assert.doesNotMatch(server,/etsyReadyImage\(manifest\.master\.key/);
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

test('picking the master uploads only the master: it is never an Etsy photo, so no Etsy copy is made',()=>{
 const page=read('src/product-creator.mjs');
 assert.doesNotMatch(page,/etsyCopyOf|etsyUploadUrl/);
 assert.doesNotMatch(read('src/artwork-storage.mjs'),/etsy\.jpg/);
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
 // artwork, so the new draft starts with the preset photos only.
 const sync=server.slice(server.indexOf('async function syncGeneratedMockupsForArtwork'));
 const pending=sync.indexOf("message:'Selected PSD mockups are added when the Etsy draft is created.'");
 assert.ok(pending>0&&pending<sync.indexOf('await copyArtworkObject(t.outputKey,key)'));
 // After setup (completed or not) the chosen mockups and photo order are applied.
 const finallyBlock=server.slice(server.indexOf('inflightDraftSetups.delete(setupId);'));
 assert.match(finallyBlock.slice(0,900),/void reconcileCompletedMockupsForArtwork\(setupId\)/);
 assert.doesNotMatch(finallyBlock.slice(0,900),/status==='completed'\)\{\s*void reconcileCompletedMockupsForArtwork/);
});

test('selected mockups go on the draft straight after the preset photos, before inventory and attributes',()=>{
 const server=read('src/server.mjs');
 const setup=server.slice(server.indexOf("startMediaPlan();\n      // Photos first"));
 const reconcile=setup.indexOf('await reconcileCompletedMockupsForArtwork(setupId, { inSetup: true })');
 assert.ok(reconcile>0&&reconcile<setup.indexOf('updateListingInventory(')&&reconcile<setup.indexOf('applyAllListingAttributes('));
 // A photo or video problem is reported after the variants are still applied.
 assert.ok(setup.indexOf('if (mediaError) throw mediaError;')>setup.indexOf('applyAllListingAttributes('));
 assert.match(server,/if\(selected\.etsyDraftListingId&&!inSetup&&inflightDraftSetups\.has\(artworkId\)\)/);
});

test('the mockup sync never writes back an old copy of the artwork record',()=>{
 const server=read('src/server.mjs');
 const sync=server.slice(server.indexOf('async function syncGeneratedMockupsForArtwork'),server.indexOf('async function reconcileCompletedMockupsForArtwork'));
 // A copy read earlier could undo the Etsy draft ID saved meanwhile.
 assert.doesNotMatch(sync,/saveArtworkManifest\(/);
 assert.ok((sync.match(/await updateArtworkManifest\(artworkId,/g)||[]).length>=4);
});

test('each mockup is uploaded straight into its place in the chosen order, the next one read meanwhile',()=>{
 const server=read('src/server.mjs');
 const sync=server.slice(server.indexOf('async function syncGeneratedMockupsForArtwork'),server.indexOf('async function reconcileCompletedMockupsForArtwork'));
 assert.match(sync,/const rank=rankFor\(item\);/);
 assert.match(sync,/pendingSelected\.sort\(\(a,b\)=>placeOf\('key:'\+a\.key\)-placeOf\('key:'\+b\.key\)\)/);
 assert.match(sync,/nextPhoto=position\+1<pendingSelected\.length\?readPhoto\(pendingSelected\[position\+1\]\):null;/);
});

test('the Product Creator saves the chosen mockups and order before it creates the draft',()=>{
 const page=read('src/product-creator.mjs'),client=read('src/mockup-generator-client.js');
 const submit=page.slice(page.indexOf("form.addEventListener('submit'"));
 assert.ok(submit.indexOf('await window.mockupSelectionBeforeDraft(')<submit.indexOf("button.textContent='Creating Etsy draft…';"));
 assert.match(client,/window\.mockupSelectionBeforeDraft=async artworkId=>\{/);
 assert.match(client,/await pendingApplySaved\.catch\(\(\)=>\{\}\);/);
});
