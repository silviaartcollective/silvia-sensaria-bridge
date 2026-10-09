import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
test('listing converter, reposter and dashboard all launch the same shared PC worker',()=>{
 for(const filename of ['listing-converter-page.mjs','listing-reposter-page.mjs','dashboard.mjs']){
  const code=readFileSync(new URL('../src/'+filename,import.meta.url),'utf8');
  assert.ok(code.includes('pod-crop-worker://start'),filename);
 }
});
