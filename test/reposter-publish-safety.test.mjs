import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
test('publication rechecks complete Etsy inventory and media before disabling the original',()=>{
 const code=readFileSync(new URL('../src/listing-reposter.mjs',import.meta.url),'utf8');
 const publish=code.slice(code.indexOf('export async function finalizeReplacement'));
 const assertPos=publish.indexOf('assertSameInventory(originalInventory,draftInventory)');
 const publishPos=publish.indexOf("listing:{state:'active'}");
 const deactivatePos=publish.indexOf("listing:{state:'inactive'}");
 assert.ok(assertPos>=0);
 assert.ok(publishPos>assertPos);
 assert.ok(deactivatePos>publishPos);
 assert.ok(publish.includes('draftVideos.length!==sourceVideos.length'));
 assert.ok(publish.includes('listingSalesCount(session,id)'));
});
