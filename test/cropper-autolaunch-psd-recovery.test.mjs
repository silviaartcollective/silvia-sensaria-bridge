import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {decorateAdminHtml} from '../src/admin-sidebar.mjs';
const src=p=>readFileSync(new URL('../src/'+p,import.meta.url),'utf8');
test('authenticated admin pages attempt shared crop + PSD worker launch',()=>{
 const decorated=decorateAdminHtml('<html><head></head><body><div class="shell"><aside><nav><a class="nav active" href="/">Dashboard</a></nav></aside><main>App</main></div></body></html>');
 assert.match(decorated,/id="shared-worker-auto-script"/);
 assert.equal(decorateAdminHtml('<html><head></head><body><main>Login</main></body></html>'),'<html><head></head><body><main>Login</main></body></html>');
 assert.ok(src('server.mjs').includes("mockupUrl.pathname==='/assets/crop-worker-auto.js'"));
});
test('shared startup checks for a running PC worker first',()=>{
 const script=src('crop-worker-auto.js');
 assert.doesNotThrow(()=>new vm.Script(script));
 for(const phrase of ['/api/crop-worker/status','pod-crop-worker://start','status.online','COOLDOWN','isWindows'])
  assert.ok(script.includes(phrase),phrase);
});
test('PSD rendering runs on the PC worker and its errors remain visible in Product Creator',()=>{
 const renderer=src('../worker/mockup-processor.mjs');
 const worker=src('../worker/index.mjs');
 const client=src('mockup-generator-client.js');
 assert.ok(renderer.includes('renderInPool('));
 assert.ok(renderer.includes('onStage'));
 assert.ok(worker.includes('api.mockupFail(id,mockupOwner,itemId,error,false,{retry})'));
 assert.ok(client.includes("t.progress"));
 assert.ok(!client.includes('await pp.init()'));
});
