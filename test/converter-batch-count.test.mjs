// The converter's batch counter: listings started, how many are done, Done when
// none is still working, and a fresh count for the next batch.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {renderListingConverterPage} from '../src/listing-converter-page.mjs';

const html=renderListingConverterPage();
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
const between=(from,to)=>script.slice(script.indexOf(from),script.indexOf(to,script.indexOf(from)));

function counter(){
  const el=()=>({hidden:true,className:'',textContent:''});
  const els={'batch-bar':el(),'batch-status':el()};
  const ctx=vm.createContext({document:{getElementById:id=>els[id]},Map,String});
  vm.runInContext('let queueJobs=[];'+between('// The batch counter','const esc=')+
    ';globalThis.api={batchStart,batchJob,batchSettle,batchFromQueue,setQueue:j=>{queueJobs=j}};',ctx);
  return {...ctx.api,bar:els['batch-bar'],text:()=>els['batch-status'].textContent,cls:()=>els['batch-status'].className};
}

test('counts a batch, says Done when every listing finished, then starts a new count', () => {
  const c=counter();
  assert.equal(c.bar.hidden,true);
  for(const id of [1,2,3])c.batchStart(id);
  assert.equal(c.bar.hidden,false);
  assert.equal(c.text(),'Processing 3 listings · 0 done · 3 in progress');
  c.batchJob(1,'listing_a');c.batchJob(2,'listing_b');c.batchJob(3,'listing_c');
  c.setQueue([{id:'listing_a',status:'completed'},{id:'listing_b',status:'running'}]);
  c.batchFromQueue();
  assert.equal(c.text(),'Processing 3 listings · 1 done · 2 in progress');
  c.setQueue([{id:'listing_a',status:'completed'},{id:'listing_b',status:'completed'},{id:'listing_c',status:'failed'}]);
  c.batchFromQueue();
  assert.equal(c.text(),'Done · 2 of 3 listings converted · 1 need attention (see the red or amber cards)');
  assert.equal(c.cls(),'batch attention');

  // Starting again after Done: the count restarts.
  c.batchStart(4);
  assert.equal(c.text(),'Processing 1 listing · 0 done · 1 in progress');
  c.batchStart(5);
  c.batchJob(4,'listing_d');c.batchJob(5,'listing_e');
  c.setQueue([{id:'listing_d',status:'completed'},{id:'listing_e',status:'completed'}]);
  c.batchFromQueue();
  assert.equal(c.text(),'Done · 2 of 2 listings converted');
  assert.equal(c.cls(),'batch done');
});

test('adding listings while a batch runs joins it; an older job or an upload error is handled', () => {
  const c=counter();
  c.batchStart(1);c.batchJob(1,'listing_new');
  // The listing's earlier job in the queue does not finish the new attempt.
  c.batchSettle(1,'done','listing_old');
  c.batchStart(2);
  assert.equal(c.text(),'Processing 2 listings · 0 done · 2 in progress');
  c.batchSettle(2,'attention'); // e.g. the upload failed on the page
  assert.equal(c.text(),'Processing 2 listings · 0 done · 1 need attention · 1 in progress');
  c.setQueue([{id:'listing_new',status:'completed'}]);c.batchFromQueue();
  assert.equal(c.text(),'Done · 1 of 2 listings converted · 1 need attention (see the red or amber cards)');
});

test('every way to start a conversion counts it, and every way it stops is counted', () => {
  const source=readFileSync(new URL('../src/listing-converter-page.mjs',import.meta.url),'utf8');
  assert.equal((source.match(/batchStart\(item\.listingId\);/g)||[]).length,3,'convert, reconvert, retry');
  assert.equal((source.match(/batchSettle\(item\.listingId,'attention'\);/g)||[]).length,5);
  assert.match(source,/batchJob\(item\.listingId,result\.job\.id\);/);
  assert.match(between('async function refreshConversionQueue(){','async function queuedConversion('),/batchFromQueue\(\);/);
  assert.ok(html.includes('id="batch-status" role="status"'));
});
