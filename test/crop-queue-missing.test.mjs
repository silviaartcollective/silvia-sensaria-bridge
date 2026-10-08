import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {isMissingR2Object} from '../src/r2.mjs';
import {readCropJobStore} from '../src/crop-job-store.mjs';
test('missing Cloudflare crop queue state creates an empty queue',async()=>{
 for(const error of [
  {name:'NoSuchKey',message:'The specified key does not exist.'},
  {name:'UnknownError',message:'The specified key does not exist.',$metadata:{httpStatusCode:404}},
  {message:'Not Found',$metadata:{httpStatusCode:404}}
 ]){
  assert.equal(isMissingR2Object(error),true);
  assert.deepEqual(await readCropJobStore(async()=>{throw error}),{version:1,jobs:[]});
 }
});
test('crop queue still rejects actual R2 access/outage errors',async()=>{
 for(const error of [{name:'AccessDenied',message:'Forbidden',$metadata:{httpStatusCode:403}},
                     {name:'InternalError',message:'Service failure',$metadata:{httpStatusCode:500}}]){
  assert.equal(isMissingR2Object(error),false);
  await assert.rejects(()=>readCropJobStore(async()=>{throw error}),error);
 }
});
test('resuming converted listing reserves the original artwork ID after an interruption',()=>{
 const code=readFileSync(new URL('../src/server.mjs',import.meta.url),'utf8');
 assert.ok(code.includes("existing?.status==='reserved'"));
 assert.ok(code.includes('uploadAlreadyPresent'));
 assert.ok(code.includes('cropJobId:previous.cropWorkerJobId'));
});
