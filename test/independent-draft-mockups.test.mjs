import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('mockup reference is advisory, never required to create an Etsy draft',()=>{
 const s=read('src/server.mjs'),begin=s.indexOf('async function prepareMediaPlan({ session, manifest })'),
 end=s.indexOf('async function uploadPreparedMediaToEtsy',begin),code=s.slice(begin,end);
 assert.ok(begin>0&&end>begin);
 assert.ok(code.includes('const reference=starterOnly?null:currentMockupReference(session);'));
 assert.ok(code.includes('catch(error)'));
 assert.ok(code.includes('items:customImages'));
 assert.ok(!code.includes('No usable active Etsy listing was found'));
 assert.ok(!code.includes('No locked Etsy mockup reference is available'));
 assert.ok(!code.includes('Exact mockup ordering could not be matched'));
 assert.ok(code.includes('for(const role of [\'choose-option\',\'choose-frame\',\'promotion\'])'));
 assert.ok(code.includes('starterDraftMedia(manifest.master,PRESET_MEDIA)'));
 assert.ok(code.includes('const canonicalCustomItems = starterOnly ? [] :'));
});
test('selecting a master queues PSDs before the Etsy draft action',()=>{
 const js=read('src/mockup-generator-client.js'),product=read('src/product-creator.mjs');
 assert.doesNotThrow(()=>new vm.Script(js));
 assert.ok(js.includes("const art=$('master_file').files?.[0]"));
 assert.ok(js.includes("if(file&&$('mg-auto-queue').checked)"));
 assert.ok(js.includes("createJob({automatic:true})"));
 assert.ok(js.includes('async function createJob('));
 assert.ok(js.includes("api('jobs','POST'"));
 assert.ok(js.includes("api('jobs/from-artwork','POST'"));
 assert.ok(js.includes("if(activeJobId&&activeMasterSignature===fileSignature(file))return;"));
 assert.ok(!js.includes('const existing=jobs.find('));
 const submit=product.slice(product.indexOf("form.addEventListener('submit',async"));
 assert.ok(!submit.includes('await createJob('));
});
