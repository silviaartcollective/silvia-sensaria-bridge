import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {renderMockupGeneratorSection} from '../src/mockup-generator-ui.mjs';
import {MOCKUP_LEASE_MS,hasActiveMockupLease} from '../src/mockup-generator.mjs';

const read=path=>readFileSync(new URL('../src/'+path,import.meta.url),'utf8');

test('auto-run and preview selections are embedded in the existing Product Creator flow',()=>{
 const client=read('mockup-generator-client.js');
 const html=renderMockupGeneratorSection();
 assert.doesNotThrow(()=>new vm.Script(client));
 for(const id of ['mg-preview-list','mg-preview-count','mg-select-all','mg-deselect-all','mg-apply-selected'])
  assert.ok(html.includes('id="'+id+'"'),id);
 assert.ok(html.includes('class="mg-workspace"'));
 assert.ok(html.includes('class="mg-preview"'));
 assert.ok(html.includes('mg-preview-list{max-height:370px'));
 assert.ok(client.includes("$('master_file').addEventListener('change'"));
 assert.ok(client.includes("$('mg-psds').addEventListener('change'"));
 assert.ok(client.includes('await createJob()'));
 assert.ok(client.includes('defaultSelected:true'));
 assert.ok(client.includes('selected.slice(0,7)'));
 assert.ok(client.includes("$('mockup_files').files=dt.files"));
 assert.ok(client.includes('if(requested&&(!ready||running||preparing))'));
});

test('browser batch leases expire promptly if heartbeats stop, even for legacy leases',()=>{
 const now=Date.now(),iso=ms=>new Date(ms).toISOString();
 assert.equal(MOCKUP_LEASE_MS,120000);
 assert.equal(hasActiveMockupLease({lease:null},now),false);
 assert.equal(hasActiveMockupLease({lease:{owner:'a',renewedAt:iso(now-30000),expiresAt:iso(now+90000)}},now),true);
 assert.equal(hasActiveMockupLease({lease:{owner:'a',renewedAt:iso(now-125000),expiresAt:iso(now+600000)}},now),false);
 assert.equal(hasActiveMockupLease({lease:{owner:'a',expiresAt:iso(now+600000)},updatedAt:iso(now-125000)},now),false);
});

test('thumbnails are authenticated small JPEG previews, and stop releases the job',()=>{
 const api=read('mockup-api.mjs'),client=read('mockup-generator-client.js');
 assert.ok(api.includes("parts[2]==='thumbnail'"));
 assert.ok(api.includes("resize(280,280,{fit:'inside'"));
 assert.ok(client.includes("action:'release'"));
 assert.ok(client.includes("action:'pause'"));
 assert.ok(client.includes('pagehide'));
 assert.ok(client.includes('heartbeatInFlight'));
});
