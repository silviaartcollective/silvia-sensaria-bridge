import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
test('regular SEO-only reposters work for legacy listings while replacement requires converted SKUs',()=>{
 const file=readFileSync(new URL('../src/listing-reposter.mjs',import.meta.url),'utf8');
 const start=file.slice(file.indexOf('export async function prepareReplacement'),
   file.indexOf('export async function finalizeReplacement'));
 assert.match(start,/if\(seo.artworkMode==='replace'\) \{\s*managedArtworkId=artworkIdFromInventory\(inventory\)/);
 assert.match(start,/assertArtworkRevisionReady\(shop,id,managedArtworkId\)/);
});
