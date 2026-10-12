import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {renderProductCreator} from '../src/product-creator.mjs';
import {starterDraftMedia} from '../src/draft-starter-media.mjs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('immediate draft uses master artwork as hero plus 3 preset images and video',()=>{
 const media=starterDraftMedia({key:'artworks/SAC0001/master.png',contentType:'image/png',originalFilename:'Painting.png'},[
  {role:'choose-option',key:'a',contentType:'image/jpeg',filename:'option.jpg'},
  {role:'choose-frame',key:'b',contentType:'image/png',filename:'frame.png'},
  {role:'promotion',key:'c',contentType:'image/jpeg',filename:'promotion.jpg'},
  {role:'video',key:'d',contentType:'video/quicktime',filename:'video.mov'}
 ]);
 assert.equal(media.length,5);
 assert.equal(media[0].key,'artworks/SAC0001/master.png');
 assert.equal(media[0].starterArtwork,true);
 assert.deepEqual(media.slice(1).map(x=>x.presetRole),['choose-option','choose-frame','promotion','video']);
 assert.throws(()=>starterDraftMedia({key:'x',contentType:'image/jpeg'},[]),/Missing required preset/);
 assert.throws(()=>starterDraftMedia(null,[]),/master artwork/);
});
test('draft endpoint explicitly permits no generated mockups and bypasses reference lookup',()=>{
 const server=read('src/server.mjs');
 assert.ok(server.includes("const starterOnly=customImages.length===0;"));
 assert.ok(server.includes("if(!starterOnly)"));
 assert.ok(server.includes('starterDraftMedia(manifest.master,PRESET_MEDIA)'));
 assert.ok(!server.includes('At least one listing mockup image is required before creating the Etsy draft.'));
 const html=renderProductCreator();
 assert.ok(html.includes('Create Etsy Draft'));
 assert.ok(html.includes('draft before mockups finish'));
});
test('PSD render jobs are explicit, with no automatic 26-template selection or draft gating',()=>{
 const js=read('src/mockup-generator-client.js'),ui=read('src/mockup-generator-ui.mjs');
 assert.doesNotThrow(()=>new vm.Script(js));
 assert.ok(js.includes("cb.checked=selected.has(template.id)"));
 assert.ok(js.includes("['mg-generate',createJob]"));
 assert.ok(!js.includes("event.stopImmediatePropagation()"));
 assert.ok(!js.includes('maybeAutoStart'));
 assert.ok(js.includes("['mg-select-seven',selectSeven]"));
 assert.ok(ui.includes('id="mg-select-seven"'));
});
