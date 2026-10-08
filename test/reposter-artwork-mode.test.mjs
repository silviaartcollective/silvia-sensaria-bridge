import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {validateSeo} from '../src/listing-reposter.mjs';
test('optional artwork replacement keeps existing SKU inventory and waits for verified crops',()=>{
 const base={title:'Neutral Canvas Wall Art',description:'Neutral textures.',tags:['beige wall art'],
   confirmedRenewals:2,mockupMode:'keep'};
 assert.equal(validateSeo(base).artworkMode,'keep');
 assert.equal(validateSeo({...base,artworkMode:'replace'}).artworkMode,'replace');
 assert.throws(()=>validateSeo({...base,artworkMode:'remove'}),/keep or replace artwork/);
 const source=readFileSync(new URL('../src/listing-reposter.mjs',import.meta.url),'utf8');
 const prepare=source.slice(source.indexOf('export async function prepareReplacement'),
   source.indexOf('export async function finalizeReplacement'));
 assert.ok(prepare.indexOf('assertArtworkRevisionReady')<prepare.indexOf('createDraftListing'));
 const finalize=source.slice(source.indexOf('export async function finalizeReplacement'));
 assert.ok(finalize.indexOf('activateArtworkRevision')<finalize.indexOf("listing:{state:'inactive'}"));
});
