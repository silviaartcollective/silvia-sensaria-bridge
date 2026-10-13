import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const html=readFileSync(new URL('../src/listing-converter-page.mjs',import.meta.url),'utf8');
const server=readFileSync(new URL('../src/server.mjs',import.meta.url),'utf8');

test('old failed Etsy jobs can retry from stored artwork without a second upload',()=>{
 const js=html.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(js,'converter embeds a script');
 assert.doesNotThrow(()=>new vm.Script(js[1]));
 assert.match(js[1],/async function retrySavedEtsyConversion\(item,card\)/);
 assert.match(js[1],/item\.conversionStatus==='reserved'/);
 assert.match(js[1],/job\.status!=='failed'/);
 assert.match(js[1],/if\(await retrySavedEtsyConversion\(item,card\)\)return/);
 const retry=js[1].slice(js[1].indexOf('async function retrySavedEtsyConversion('),js[1].indexOf('async function convertListing('));
 assert.match(retry,/queuedConversion\(item,card,\{listingId:item\.listingId,artworkId:item\.artworkId\}\)/);
 assert.doesNotMatch(retry,/\/reserve|putFile|\/crop|reconvert:true/);
 assert.match(html,/Retry Etsy conversion/);
 assert.match(html,/Earlier conversion attempt failed before the updated verification/);
});

test('server rechecks saved artwork ownership, R2 master, and finished crops on retry',()=>{
 const section=server.slice(server.indexOf('async function performListingConversion(body)'),server.indexOf('async function runPendingListingConversions()'));
 assert.match(section,/hasAuthorizedConverterLink\(/);
 assert.match(section,/artworkObjectExists\(manifest\.master\.key\)/);
 assert.match(section,/cropJob\.status !== 'completed'/);
 assert.match(section,/\['reserved','converted'\]/);
 assert.match(section,/const expectedDescription=reviseCanvasThickness\(originalDescription\)/);
});
