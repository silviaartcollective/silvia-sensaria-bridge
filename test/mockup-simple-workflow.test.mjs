import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {renderProductCreator} from '../src/product-creator.mjs';
const client=readFileSync(new URL('../src/mockup-generator-client.js',import.meta.url),'utf8');
test('mockup controls reside in one Etsy Product Creator form',()=>{
 const html=renderProductCreator();
 const formStart=html.indexOf('<form class="form" id="creator-form">');
 const formEnd=html.indexOf('</form>',formStart);
 assert.ok(formStart!==-1&&formEnd>formStart);
 const inline=html.slice(formStart,formEnd);
 assert.ok(inline.includes('id="master_file"'));
 assert.ok(inline.includes('id="mg-generate"'));
 assert.ok(inline.includes('id="mg-psds"'));
 assert.ok(inline.includes('id="mockup_files"'));
 assert.ok(inline.includes('id="create-btn"'));
 assert.ok(!html.includes('id="creator-mockup-tab"'));
 assert.ok(!html.includes('Photopea renderer</h2>'));
 assert.ok(inline.includes('aria-hidden="true"'));
});
test('generated JPGs automatically attach before Etsy draft creation',()=>{
 assert.ok(client.includes("const art=$('master_file').files[0]"));
 assert.ok(client.includes("$('mockup_files').files=dt.files"));
 assert.ok(client.includes("await useResults()"));
 assert.ok(client.includes("stopImmediatePropagation()"));
 assert.ok(client.includes("j.templates.every(t=>ids.includes(t.id))"));
 assert.ok(client.includes("slice(0,7)"));
 assert.ok(!client.includes("$('creator-listing-tab').click()"));
});
test('stalled PSD imports are bounded with diagnostic progress and reset',()=>{
 assert.ok(client.includes("message('Downloading '+label"));
 assert.ok(client.includes("message('Importing '+label"));
 assert.ok(client.includes("AbortController()"));
 assert.ok(client.includes("await pp.reset()"));
 assert.ok(client.includes("180000"));
 assert.doesNotThrow(()=>new vm.Script(client));
});
