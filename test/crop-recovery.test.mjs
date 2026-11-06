// A crop left marked "processing" (the shop restarted while the PC worker
// reported it, or the worker restarted) goes back in the queue within minutes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {releaseJobsNotHeld,ABANDONED_CROP_MS} from '../src/crop-job-store.mjs';
import {withReportRetries} from '../worker/retry.mjs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const NOW=new Date('2026-11-04T20:00:00Z');
const ago=ms=>new Date(NOW.getTime()-ms).toISOString();
const job=(id,extra)=>({id,status:'processing',workerId:'pod-crop-main-pc',updatedAt:ago(5*60000),currentRatio:'2x3',...extra});

test('only crops the worker no longer holds, unchanged for 2 minutes, are queued again', () => {
  const store={jobs:[
    job('crop_held'),                                   // the worker still names it
    job('crop_lost'),                                   // finished during a restart
    job('crop_uploading',{status:'uploading'}),
    job('crop_recent',{updatedAt:ago(ABANDONED_CROP_MS-1000)}),
    job('crop_other',{workerId:'another-pc'}),
    job('crop_done',{status:'completed'}),
    job('crop_waiting',{status:'pending',workerId:''})
  ]};
  assert.deepEqual(releaseJobsNotHeld(store,'pod-crop-main-pc','crop_held',NOW),['crop_lost','crop_uploading']);
  const byId=Object.fromEntries(store.jobs.map(j=>[j.id,j]));
  assert.equal(byId.crop_lost.status,'pending');
  assert.equal(byId.crop_lost.workerId,'');
  assert.match(byId.crop_lost.message,/queued again/);
  for(const id of ['crop_held','crop_recent','crop_other'])assert.equal(byId[id].status,'processing',id);
  assert.equal(byId.crop_done.status,'completed');
  // An idle worker (holding nothing) frees everything stale it held.
  assert.deepEqual(releaseJobsNotHeld({jobs:[job('a')]},'pod-crop-main-pc','',NOW),['a']);
  assert.deepEqual(releaseJobsNotHeld({jobs:[job('a')]},'','',NOW),[]);
});

test('the shop checks on worker heartbeats that name their crop, at most once a minute', () => {
  const server=read('src/server.mjs');
  assert.match(server,/logWorkerRestart\(input\.restart\);\s*releaseAbandonedCrops\(input\);/);
  assert.match(server,/if\(!\('cropJobId' in input\)\|\|Date\.now\(\)-abandonedCropCheckAt<60\*1000\)return;/);
  const worker=read('worker/index.mjs');
  assert.match(worker,/cropJobId:\[\.\.\.active\]\.find\(a=>a\.type==='crop'&&a\.app\.appUrl===app\.appUrl\)\?\.job\.id\|\|''/);
  assert.match(worker,/await withReportRetries\(\(\) => api\.completeJob\(job\.id, assets\)\);/);
  assert.match(worker,/await withReportRetries\(\(\) => api\.failJob\(job\.id, error\)\)\.catch/);
});

test('a finished crop keeps being reported while the shop is restarting, but a refusal is not retried', async () => {
  let calls=0;const logs=[];
  const result=await withReportRetries(async()=>{calls++;if(calls<5)throw Error('Silvia returned non-JSON (HTTP 502).');return 'ok'},{delayMs:1,log:m=>logs.push(m)});
  assert.equal(result,'ok');assert.equal(calls,5);
  assert.match(logs[0],/^Report interrupted/);
  calls=0;
  await assert.rejects(withReportRetries(async()=>{calls++;throw Error('Crop job not found')},{delayMs:1,log:()=>{}}),/not found/);
  assert.equal(calls,1);
  calls=0;
  await assert.rejects(withReportRetries(async()=>{calls++;throw Error('fetch failed')},{delayMs:1,log:()=>{}}),/fetch failed/);
  assert.equal(calls,12,'about 3 minutes at the default 15 s');
});
