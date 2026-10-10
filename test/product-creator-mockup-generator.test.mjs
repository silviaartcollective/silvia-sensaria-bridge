import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {renderProductCreator} from '../src/product-creator.mjs';
import {ADMIN_LINKS} from '../src/admin-sidebar.mjs';
test('mockup generator lives INSIDE Product Creator and existing Etsy form remains',()=>{
 const html=renderProductCreator();
 for(const id of ['creator-mockup-tab','creator-listing-tab','product-listing-panel','mockup-generator-panel','mg-editor','creator-form','mockup_files'])
  assert.ok(html.includes('id="'+id+'"'),id);
 assert.ok(html.includes('/assets/mockup-generator-client.js'));
 assert.equal(ADMIN_LINKS.find(x=>x.label==='Mockup Generator').href,'/product-creator#mockup-generator');
 assert.ok(!ADMIN_LINKS.some(x=>x.href==='/mockup-generator'));
});
test('embedded photopea iframe client parses and has no hardcoded external credentials',()=>{
 const script=readFileSync(new URL('../src/mockup-generator-client.js',import.meta.url),'utf8');
 assert.doesNotThrow(()=>new vm.Script(script));
 assert.match(script,/https:\\/\\/www\\.photopea\\.com/);
 assert.match(script,/app\\.activeDocument/);
 assert.match(script,/placedLayerEditContents/);
 assert.match(script,/saveToOE/);
 assert.match(script,/24000000/);
 assert.ok(!script.includes('R2_SECRET_ACCESS_KEY'));
});
