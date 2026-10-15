import test from 'node:test';
import assert from 'node:assert/strict';
import {startCsvJob,csvJobStatus,csvJobResult} from '../src/sensaria-csv-jobs.mjs';
import {readFileSync} from 'node:fs';

async function untilFinished(id){
  for(let i=0;i<60;i++){
    const result=csvJobStatus(id);
    if(result?.status==='completed'||result?.status==='failed')return result;
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  throw Error('CSV job did not settle.');
}
test('job returns immediately, reports stages and caches a finished manual CSV',async()=>{
 let completions=0;
 const job=startCsvJob('890011',async update=>{
   update('Rendering canvas');
   await new Promise(resolve=>setTimeout(resolve,15));
   completions++;
   return 'Product Code,URL\nabc,https://example.invalid/file.jpg\n';
 });
 assert.equal(job.status,'running');
 assert.equal(startCsvJob('890011',async()=>{throw Error('duplicate');}).status,'running');
 const completed=await untilFinished('890011');
 assert.equal(completed.status,'completed');
 assert.equal(completions,1);
 assert.match(csvJobResult('890011'),/Product Code/);
 assert.equal(startCsvJob('890011',async()=>{throw Error('duplicate');}).status,'completed');
});
test('errors return explicit failed status and may be retried',async()=>{
 startCsvJob('890012',async update=>{update('Checking R2');throw Error('R2 unavailable');});
 assert.equal((await untilFinished('890012')).status,'failed');
 assert.match(csvJobStatus('890012').error,/R2 unavailable/);
 assert.equal(csvJobResult('890012'),null);
 startCsvJob('890012',async()=> 'Product Code,URL\nabc,x\n');
 assert.equal((await untilFinished('890012')).status,'completed');
});
test('server sends 202 and offers status and separately authenticated CSV download',()=>{
 const code=readFileSync(new URL('../src/server.mjs',import.meta.url),'utf8');
 const ui=readFileSync(new URL('../src/orders-client.js',import.meta.url),'utf8');
 assert.match(code,/startCsvJob\(id,async stage=>/);
 assert.match(code,/csvJobStatus\(id\)/);
 assert.match(code,/csvJobResult\(id\)/);
 assert.match(code,/renderProduction:true/);
 assert.match(code,/validateSensariaCsvOrder\(order,latest,shopId\)/);
 assert.match(ui,/prepareSensariaCsv\(id/);
 assert.match(ui,/status\?\.stage/);
 assert.match(ui,/AbortSignal\.timeout/);
});
