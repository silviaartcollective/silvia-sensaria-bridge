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

test('the server reuses one R2 client instead of a new connection per request',()=>{
 const r2=read('src/r2.mjs');
 assert.match(r2,/if \(sharedClient\?\.key === key\) return sharedClient\.client;/);
 assert.equal((r2.match(/new S3Client\(/g)||[]).length,1);
});

test('batch lists read only the most recently changed batches',()=>{
 const generator=read('src/mockup-generator.mjs'),api=read('src/mockup-api.mjs');
 assert.match(generator,/new Date\(b\.LastModified\|\|0\)-new Date\(a\.LastModified\|\|0\)/);
 assert.match(api,/listMockupJobs\(40\)/);
 assert.match(api,/listMockupJobs\(300\)/);
});

test('an R2 timeout shows a readable message instead of "TimeoutError"',()=>{
 assert.match(read('src/mockup-api.mjs'),/Cloudflare R2 did not respond in time/);
});

test('the newest batch is rendered first so the current listing never waits behind old ones',()=>{
 assert.match(read('src/mockup-api.mjs'),/return jobs\.sort\(\(a,b\)=>String\(b\.createdAt\)\.localeCompare\(String\(a\.createdAt\)\)\);/);
});

test('a waiting batch says when the PC worker is busy elsewhere',()=>{
 const client=read('src/mockup-generator-client.js'),server=read('src/server.mjs');
 assert.match(client,/PC worker is finishing another job first/);
 assert.match(client,/lastWorker=worker;/);
 assert.match(server,/activeApp: online \? cropWorkerHeartbeat\.activeApp/);
});
