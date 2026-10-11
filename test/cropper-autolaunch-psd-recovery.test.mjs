import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {decorateAdminHtml} from '../src/admin-sidebar.mjs';
const src=path=>readFileSync(new URL('../src/'+path,import.meta.url),'utf8');

test('all authenticated admin pages request crop worker startup without affecting login',()=>{
 const decorated=decorateAdminHtml('<!doctype html><html><head></head><body><div class="shell"><aside><nav><a class="nav active" href="/">Dashboard</a></nav></aside><main>App</main></div></body></html>');
 assert.match(decorated,/<script id="shared-worker-auto-script" defer src="\/assets\/crop-worker-auto\.js"><\/script>/);
 assert.equal((decorated.match(/id="shared-worker-auto-script"/g)||[]).length,1);
 assert.equal(decorateAdminHtml('<html><head></head><body><main>Login</main></body></html>'),'<html><head></head><body><main>Login</main></body></html>');
 const server=src('server.mjs');
 assert.ok(server.includes("mockupUrl.pathname==='/assets/crop-worker-auto.js'"));
 assert.ok(server.includes("if(!requireAdminApi(req,res))return;"));
});

test('shared cropper checks live status and avoids duplicate or repeated launches',()=>{
 const script=src('crop-worker-auto.js');
 assert.doesNotThrow(()=>new vm.Script(script));
 assert.ok(script.includes('/api/crop-worker/status'));
 assert.ok(script.includes('pod-crop-worker://start'));
 assert.ok(script.includes('status.online'));
 assert.ok(script.includes('status?.configured'));
 assert.ok(script.includes('COOLDOWN'));
 assert.ok(script.includes('isWindows'));
 assert.ok(script.includes('manualFallback'));
 assert.ok(script.includes('DOMContentLoaded'));
});

test('stalled mockups have operation identifiers, deadlines and a visible recovery path',()=>{
 const client=src('mockup-generator-client.js');
 assert.doesNotThrow(()=>new vm.Script(client));
 assert.ok(client.includes('MG_SENTINEL:'));
 assert.ok(client.includes('statusClock=setInterval'));
 assert.ok(client.includes("method==='GET'"));
 assert.ok(client.includes('Photopea did not finish this'));
 assert.ok(client.includes('stalledError='));
 assert.ok(client.includes('Open Saved batches & troubleshooting to retry this PSD'));
 assert.ok(client.includes('await pp.reset()'));
});
