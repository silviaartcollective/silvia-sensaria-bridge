import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
test('regular SEO-only reposters work for legacy listings while replacement requires converted SKUs',()=>{
 const file=readFileSync(new URL('../src/listing-reposter.mjs',import.meta.url),'utf8');
 const start=file.slice(file.indexOf('export async function prepareReplacement'),
   file.indexOf('export async function finalizeReplacement'));
 assert.ok(start.includes("if(seo.artworkMode==='replace')"),'Optional replace-artwork mode exists');
 assert.ok(start.includes('managedArtworkId=artworkIdFromInventory(inventory)'),'Managed artwork parsed only on replacement');
 assert.ok(start.indexOf("if(seo.artworkMode==='replace')") < start.indexOf('managedArtworkId=artworkIdFromInventory(inventory)'));
 assert.match(start,/assertArtworkRevisionReady\(shop,id,managedArtworkId\)/);
});
