import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {renderMockupGeneratorSection} from '../src/mockup-generator-ui.mjs';
import {MOCKUP_LEASE_MS,hasActiveMockupLease,knownMockupArtworkTarget} from '../src/mockup-generator.mjs';
const read=p=>readFileSync(new URL('../src/'+p,import.meta.url),'utf8');
test('upload queues PC mockups automatically and preview checkboxes attach selected images',()=>{
 const client=read('mockup-generator-client.js'),html=renderMockupGeneratorSection();
 assert.doesNotThrow(()=>new vm.Script(client));
 for(const id of ['mg-preview-list','mg-preview-count','mg-select-all','mg-deselect-all','mg-apply-selected','mg-worker-status'])
  assert.ok(html.includes('id="'+id+'"'),id);
 assert.ok(!html.includes('id="mg-editor"'));
 assert.ok(client.includes("addEventListener('change',()=>act(maybeAutoStart))"));
 assert.ok(client.includes('await createJob()'));
 assert.ok(client.includes('defaultSelected:true'));
 assert.ok(client.includes('selected.slice(0,7)'));
 assert.ok(client.includes("$('mockup_files').files=dt.files"));
 assert.ok(client.includes('if(requested&&!ready)'));
});
test('worker lease expires after two minutes with legacy browser lock recovery',()=>{
 const now=Date.now(),iso=n=>new Date(n).toISOString();
 assert.equal(MOCKUP_LEASE_MS,120000);
 assert.equal(hasActiveMockupLease({lease:null},now),false);
 assert.equal(hasActiveMockupLease({lease:{owner:'a',renewedAt:iso(now-30000),expiresAt:iso(now+90000)}},now),true);
 assert.equal(hasActiveMockupLease({lease:{owner:'a',renewedAt:iso(now-125000),expiresAt:iso(now+600000)}},now),false);
 assert.equal(knownMockupArtworkTarget('mockup 19.psd'),'5');
});
test('private thumbnail API and worker-only claim route are present',()=>{
 const api=read('mockup-api.mjs');
 assert.ok(api.includes("parts[2]==='thumbnail'"));
 assert.ok(api.includes('resize(280,280'));
 assert.ok(api.includes("parts[0]==='worker'"));
 assert.ok(api.includes('workerAuthorized(req)'));
 assert.ok(api.includes('updateMockupItemProgress'));
});
