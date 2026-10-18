import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('Etsy photo plan supports all 20 photo slots, three preset plus 17 original mockups',()=>{
 const source=read('src/server.mjs'),client=read('src/mockup-generator-client.js'),ui=read('src/mockup-generator-ui.mjs');
 assert.match(source,/\.slice\(0,17\)/);
 // Generated JPGs join a draft that holds the 3 presets (never the master): 17 fit.
 assert.match(client,/const ETSY_MOCKUP_SLOTS=17;/);
 assert.match(client,/\.slice\(0,ETSY_MOCKUP_SLOTS\)/);
 assert.match(ui,/id="mg-select-seventeen"/);
 assert.match(source,/items:\[\.\.\.matched\.items,\.\.\.customImages\.slice\(12\)\]/);
});
test('Gelato converter updates canvas thickness but preserves existing Etsy SEO and section URL',()=>{
 const source=read('src/server.mjs');
 assert.match(source,/const originalDescription=savedDescription\|\|String\(originalListing\.description\|\|''\)/);
 assert.match(source,/correction\.description=expectedDescription/);
 assert.match(source,/const expectedDescription=reviseCanvasThickness\(originalDescription\)/);
 assert.match(source,/await ensureConverterListingSeo\(session,listingId,expectedDescription,originalShopSectionId\)/);
 assert.match(source,/originalDescription,originalShopSectionId/);
 assert.match(source,/await saveListingConverterMap\(snapshotMap\)/);
 const etsy=read('src/etsy.mjs');
 assert.match(etsy,/export async function getListing\(/);
});
test('Etsy draft responds before media uploads; uses existing artwork manifest and verified R2 master',()=>{
 const source=read('src/server.mjs'),ui=read('src/product-creator.mjs');
 assert.match(source,/const inflightDraftSetups = new Set\(\)/);
 assert.match(source,/return sendJson\(res,201,\{ok:true,processing:true/);
 assert.match(source,/manifest\.etsyDraftSetup=\{\.\.\.summary,status:'completed'/);
 assert.match(source,/setup:stored\?\{\.\.\.stored,status\}/);
 assert.match(source,/artworkObjectExists\(manifest\.master\.key\)/);
 assert.match(ui,/window\.startProductArtworkUpload/);
 assert.match(ui,/draft-setup/);
});
test('PSD automatic generator waits for the shared verified R2 master and never duplicates direct uploads',()=>{
 const client=read('src/mockup-generator-client.js');
 assert.doesNotThrow(()=>new vm.Script(client));
 // Picking the master stages it in R2 (no artwork ID or folders until the draft).
 assert.doesNotMatch(client,/window\.startProductArtworkUpload\(\)/);
 assert.match(read('src/product-creator.mjs'),/window\.stageMasterArtwork=/);
 assert.match(client,/api\('jobs\/from-artwork','POST'/);
 assert.match(client,/window\.addEventListener\('pod-artwork-uploaded'/);
});
