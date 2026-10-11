import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {renderProductCreator} from '../src/product-creator.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('mockup controls and live selection remain inside Etsy Product Creator',()=>{
 const html=renderProductCreator(),start=html.indexOf('<form class="form" id="creator-form">'),
  end=html.indexOf('</form>',start),inside=html.slice(start,end);
 assert.ok(start>=0&&end>start);
 for(const id of ['master_file','mockup_files','mg-generate','mg-psds','mg-templates','mg-preview-list','mg-select-all','mg-deselect-all','create-btn'])
  assert.ok(inside.includes('id="'+id+'"'),id);
 assert.ok(!inside.includes('id="mg-editor"'));
});
test('selected finished JPGs attach automatically and browser never renders PSDs',()=>{
 const client=read('src/mockup-generator-client.js');
 assert.doesNotThrow(()=>new vm.Script(client));
 assert.ok(client.includes("const art=$('master_file').files?.[0]"));
 assert.ok(client.includes('selected.slice(0,7)'));
 assert.ok(client.includes("$('mockup_files').files=dt.files"));
 assert.ok(client.includes('stopImmediatePropagation()'));
 assert.ok(client.includes('initialLoad'));
 assert.ok(!client.includes('placedLayerEditContents'));
 assert.ok(!client.includes('https://www.photopea.com'));
 const worker=read('worker/index.mjs');
 assert.ok(worker.includes('renderMockupOnPC('));
 assert.ok(worker.includes('await processJob(app,result.job)'));
});
