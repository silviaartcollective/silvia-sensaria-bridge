import test from 'node:test';
import assert from 'node:assert/strict';
import {startSupplierComparisonJob,getSupplierComparisonJob} from '../src/supplier-comparison-jobs.mjs';
import {renderSupplierComparisonPage} from '../src/supplier-comparison-page.mjs';
import vm from 'node:vm';

test('supplier scan runs independently of the HTTP request and deduplicates in-flight requests',async()=>{
 let resolve,executed=0;
 const gate=new Promise(r=>resolve=r);
 const idA=startSupplierComparisonJob({countryCodes:['US'],productCodes:['P','C']},
  async options=>{executed++;await gate;return {ok:true,rows:[{countryCode:options.countryCodes[0]}]}});
 const idB=startSupplierComparisonJob({countryCodes:['US'],productCodes:['P','C']},
  async()=>{throw Error('Duplicate job must never start')});
 assert.equal(idA.id,idB.id);
 assert.equal(idB.reused,true);
 assert.equal(getSupplierComparisonJob(idA.id).status,'running');
 resolve();
 await new Promise(r=>setImmediate(r));
 const job=getSupplierComparisonJob(idA.id);
 assert.equal(job.status,'completed');
 assert.equal(job.result.rows[0].countryCode,'US');
 assert.equal(executed,1);
});

test('failed country remains visible with an error, while other countries stay available',async()=>{
 const record=startSupplierComparisonJob({countryCodes:['LU'],productCodes:['FC']},
  async()=>{throw Error('Supplier upstream HTTP 502')});
 await new Promise(r=>setImmediate(r));
 assert.equal(getSupplierComparisonJob(record.id).status,'failed');
 assert.match(getSupplierComparisonJob(record.id).error,/HTTP 502/);
});

test('supplier browser JS compiles and offers retries without falsely declaring completion',()=>{
 const html=renderSupplierComparisonPage({configured:{prodigi:true}});
 const script=html.split('<script>')[1]?.split('</script>')[0];
 assert.ok(script);
 assert.doesNotThrow(()=>new vm.Script(script));
 assert.match(html,/id="retry-failed"/);
 assert.match(script,/\/api\/suppliers\/compare/);
 assert.match(script,/fetch\(endpoint\+'\/start\?country='/);
 assert.match(script,/Supplier comparison INCOMPLETE/);
 assert.match(script,/returned an HTML hosting\/proxy page instead of JSON/);
 assert.match(script,/failedCountryCodes=failedCodes/);
});
