import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {classifySmartObjects,knownMockupArtworkTarget} from '../src/mockup-generator.mjs';

test('mockup 19 PSD chooses visible layer 5 and never targets its hidden Smart Object',()=>{
 const actualLayers=[
  {name:'mockup 1 (1)',path:'0',visible:false,kind:'smart'},
  {name:'Background',path:'1',visible:true,kind:'other'},
  {name:'5',path:'2',visible:true,kind:'smart'}
 ];
 assert.equal(knownMockupArtworkTarget('mockup 19.psd'),'5');
 const result=classifySmartObjects(actualLayers,{name:'mockup 19.psd'});
 assert.equal(result.status,'mapped');
 assert.equal(result.path,'2');
 assert.deepEqual(result.objects.map(o=>o.name),['5']);
 const noVisibleFive=actualLayers.map(l=>({...l,visible:l.name==='5'?false:l.visible}));
 assert.equal(classifySmartObjects(noVisibleFive,{name:'mockup 19.psd'}).status,'needs_mapping');
});

test('PC worker validates the PSD original visibility before exporting',()=>{
 const code=readFileSync(new URL('../worker/photopea-worker-page.js',import.meta.url),'utf8');
 const renderer=readFileSync(new URL('../worker/mockup-processor.mjs',import.meta.url),'utf8');
 assert.doesNotThrow(()=>new vm.Script(code));
 assert.ok(code.includes("config.templateName"));
 assert.ok(code.includes("o.name==='5'&&o.kind==='smart'"));
 assert.ok(code.includes("o.name==='mockup 1 (1)'&&o.kind==='smart'"));
 assert.ok(code.includes("hidden?.visible"));
 assert.ok(code.includes('JSON.stringify(after)!==JSON.stringify(inspected.visibility)'));
 assert.ok(renderer.includes('headless:true'));
});

test('a running crop-only worker is not reported as PSD capable',()=>{
 const server=readFileSync(new URL('../src/server.mjs',import.meta.url),'utf8');
 const client=readFileSync(new URL('../src/mockup-generator-client.js',import.meta.url),'utf8');
 const worker=readFileSync(new URL('../worker/api.mjs',import.meta.url),'utf8');
 assert.ok(server.includes('mockups: online ? cropWorkerHeartbeat.mockups===true : false'));
 assert.ok(client.includes('Old crop-only worker online'));
 assert.ok(worker.includes("const WORKER_VERSION = '4.0.1'"));
});
