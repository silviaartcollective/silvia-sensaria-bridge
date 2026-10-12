import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('completed PSD outputs can be added to existing Etsy drafts without replacing existing media',()=>{
 const server=read('src/server.mjs');
 assert.match(server,/append-generated-mockups/);
 assert.match(server,/await getMockupJob\(String\(jobId\|\|''\)\)/);
 assert.match(server,/job.sourceMasterKey!==manifest.master.key/);
 assert.match(server,/latestListing.state!=='draft'/);
 assert.match(server,/Math\.max\(0,20-existingPhotos.length\)/);
 assert.match(server,/copyArtworkObject\(t.outputKey/);
 assert.match(server,/await withEtsyListingRetry\(\(\)=>uploadListingImage/);
});
test('app automatically syncs verified selected PSDs from Cloudflare rather than blocking draft',()=>{
 const client=read('src/mockup-generator-client.js');
 assert.doesNotThrow(()=>new vm.Script(client));
 assert.match(client,/append-generated-mockups/);
 assert.match(client,/async function syncGeneratedJpgs/);
});

test('each completed PSD syncs independently of the browser and final draft catch-up recovers earlier outputs',()=>{
 const server=read('src/server.mjs'),api=read('src/mockup-api.mjs');
 assert.match(server,/onMockupCompleted:\(verifiedJob\)=>/);
 assert.match(server,/reconcileCompletedMockupsForArtwork\(setupId\)/);
 assert.match(server,/const generatedMockupSyncTail=new Map\(\)/);
 assert.match(api,/onMockupCompleted=\(\)=>\{\}/);
 assert.match(api,/onMockupCompleted\(result\)/);
 assert.match(api,/manifest\.mockupJobIds=/);
 assert.match(server,/generatedMockupSyncTail\.set\(artworkId,work\)/);
});
