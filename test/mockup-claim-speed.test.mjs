import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('worker claims read only active batches, not every batch ever created',()=>{
 const api=read('src/mockup-api.mjs');
 assert.match(api,/const jobs=await claimCandidates\(\);/);
 assert.match(api,/Date\.now\(\)-activeBatches\.listedAt>10\*60\*1000/);
 for(const point of ['markMockupArtworkUploaded(job.id);markBatchActive(job.id)',
  'markMockupArtworkUploaded(id);markBatchActive(id)','ownerCheck(body));markBatchActive(id)'])
  assert.ok(api.includes(point),point);
});

test('re-inspecting an unchanged template does not rewrite it',()=>{
 assert.match(read('src/mockup-api.mjs'),/summary\(t\.smartObjects\)===summary\(classified\.objects\)\?t:/);
});

test('known templates send their artwork layer to the worker',()=>{
 assert.match(read('src/mockup-api.mjs'),/stored\.mapping\?\.path\|\|!known\?stored:\{\.\.\.stored,mapping:\{path:known\}\}/);
});

test('fast PSDs send no progress writes',()=>{
 const worker=read('worker/index.mjs');
 assert.match(worker,/let lastStageWriteAt=Date\.now\(\);/);
 assert.match(worker,/if\(now-lastStageWriteAt<2500\)return Promise\.resolve\(\);/);
});
