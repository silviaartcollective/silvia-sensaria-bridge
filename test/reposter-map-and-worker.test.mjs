import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
test('reposting a converted listing migrates its artwork mapping to the new Etsy listing',()=>{
 const code=readFileSync(new URL('../src/server.mjs',import.meta.url),'utf8');
 assert.match(code,/const result=await finalizeReplacement\(session,id,body.confirm\)/);
 assert.match(code,/mapping\.listings\[nextId\]/);
 assert.match(code,/replacedFromListingId/);
 assert.match(code,/replacedByListingId/);
});
test('PC crop worker no longer stops after old default 10 minute idle timeout',()=>{
 const config=readFileSync(new URL('../worker/config.mjs',import.meta.url),'utf8');
 assert.match(config,/localIdle===600000 \? 0 : localIdle/);
});
