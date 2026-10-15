import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

test('fresh master cannot inherit archived completed JPGs',()=>{
 const client=read('src/mockup-generator-client.js');
 assert.doesNotThrow(()=>new vm.Script(client));
 assert.ok(!client.includes('if(jobs[0])void showJob(jobs[0].id)'));
 assert.ok(!client.includes('const existing=jobs.find('));
 assert.ok(client.includes('job.id===activeJobId'));
 assert.ok(client.includes("if(!currentBatch())throw Error("));
 assert.ok(client.includes("window.addEventListener('pod-artwork-uploaded'"));
 assert.ok(client.includes("templates.filter(t=>t.status==='ready'&&templateFitsOrientation(t,detectedArtworkOrientation)).slice(0,16)"));
 assert.ok(client.includes("$('artwork_id').value=''"));
 assert.ok(client.includes("$('mg-apply-selected').disabled=!currentBatch()"));
});

test('uploaded R2 master is copied into fresh background PSD batch without redownloading',()=>{
 const app=read('src/product-creator.mjs'),api=read('src/mockup-api.mjs'),client=read('src/mockup-generator-client.js');
 assert.ok(app.includes("window.dispatchEvent(new CustomEvent('pod-artwork-uploaded'"));
 assert.ok(api.includes("parts[1]==='from-artwork'"));
 assert.ok(api.includes('loadArtworkManifest(artworkId)'));
 assert.ok(api.includes('copyArtworkObject(master.key,job.artworkKey)'));
 assert.ok(api.includes('job.artworkId=artworkId'));
 assert.ok(api.includes('markMockupArtworkUploaded(job.id)'));
 assert.ok(client.includes("api('jobs/from-artwork','POST'"));
 assert.ok(!client.includes('const existing=jobs.find('));
 assert.ok(client.includes("if(automatic&&!$('mg-auto-queue').checked)return"));
 const draft=app.slice(app.indexOf("form.addEventListener('submit',async("));
 assert.ok(!draft.includes('await createJob('));
});
