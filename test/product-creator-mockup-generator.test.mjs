import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {renderProductCreator} from '../src/product-creator.mjs';
import {ADMIN_LINKS} from '../src/admin-sidebar.mjs';
test('mockup generator lives INSIDE Product Creator and existing Etsy form remains',()=>{
 const html=renderProductCreator();
 for(const id of ['mockup-generator-panel','mg-editor','creator-form','mockup_files','master_file','mg-generate','mg-psds','mg-templates'])
  assert.ok(html.includes('id="'+id+'"'),id);
 assert.ok(html.includes('/assets/mockup-generator-client.js'));
 assert.ok(!html.includes('id="creator-mockup-tab"'));
 assert.ok(!html.includes('Photopea renderer</h2>'));
 assert.ok(html.indexOf('id="mockup-generator-panel"')>html.indexOf('id="master_file"'));
 assert.equal(ADMIN_LINKS.filter(x=>x.href==='/product-creator').length,1);
 assert.ok(!ADMIN_LINKS.some(x=>x.label==='Mockup Generator'));
 assert.ok(!ADMIN_LINKS.some(x=>x.href==='/mockup-generator'));
});
test('embedded photopea iframe client parses and has no hardcoded external credentials',()=>{
 const script=readFileSync(new URL('../src/mockup-generator-client.js',import.meta.url),'utf8');
 assert.doesNotThrow(()=>new vm.Script(script));
 assert.ok(script.includes('https://www.photopea.com'));
 assert.ok(script.includes('app.activeDocument'));
 assert.ok(script.includes('placedLayerEditContents'));
 assert.ok(script.includes('saveToOE'));
 assert.ok(script.includes('24000000'));
 assert.ok(!script.includes('R2_SECRET_ACCESS_KEY'));
});
