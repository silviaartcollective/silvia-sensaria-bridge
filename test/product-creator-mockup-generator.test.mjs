import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {renderProductCreator} from '../src/product-creator.mjs';
import {ADMIN_LINKS} from '../src/admin-sidebar.mjs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('PSD workflow stays in existing Product Creator without an iframe',()=>{
 const html=renderProductCreator();
 for(const id of ['mockup-generator-panel','mg-worker-status','creator-form','mockup_files','master_file','mg-generate','mg-psds','mg-templates'])
  assert.ok(html.includes('id="'+id+'"'),id);
 assert.ok(html.includes('/assets/mockup-generator-client.js'));
 assert.ok(!html.includes('id="mg-editor"'));
 assert.ok(html.indexOf('id="mockup-generator-panel"')>html.indexOf('id="master_file"'));
 assert.equal(ADMIN_LINKS.filter(x=>x.href==='/product-creator').length,1);
 assert.ok(!ADMIN_LINKS.some(x=>x.href==='/mockup-generator'));
});
test('Photopea runs only in PC background processor with hidden layers preserved',()=>{
 const browser=read('src/mockup-generator-client.js');
 const workerPage=read('worker/photopea-worker-page.js');
 const worker=read('worker/mockup-processor.mjs');
 assert.doesNotThrow(()=>new vm.Script(browser));
 assert.doesNotThrow(()=>new vm.Script(workerPage));
 assert.ok(!browser.includes('postMessage('));
 assert.ok(workerPage.includes('placedLayerEditContents'));
 assert.ok(workerPage.includes("app.activeDocument"));
 assert.ok(workerPage.includes("doc.saveToOE('jpg:0.9')"));
 assert.ok(workerPage.includes("24000000"));
 assert.ok(workerPage.includes('JSON.stringify(after)!==JSON.stringify(inspected.visibility)'));
 assert.ok(worker.includes('headless:true'));
 assert.ok(!browser.includes('R2_SECRET_ACCESS_KEY'));
});
