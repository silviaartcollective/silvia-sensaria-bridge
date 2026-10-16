import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  boundedCustomProvider,
  CUSTOM_LOOKUP_PROVIDER_DEADLINES_MS,
  lookupCustomSize
} from '../src/custom-size-lookup.mjs';
import { renderCustomSizeLookupPage } from '../src/custom-size-page.mjs';

test('preview returns Sensaria and nonranked placeholders without waiting on any live POD APIs',async()=>{
 const result=await lookupCustomSize({
  countryCode:'US',productCode:'FC',width:40,height:60,frame:'Black',
  previewOnly:true
 });
 assert.equal(result.ok,true);
 assert.equal(result.partial,true);
 assert.equal(result.suppliers.sensaria.provider,'Sensaria');
 assert.equal(result.suppliers.sensaria.status,'available');
 assert.ok(result.suppliers.sensaria.totalUsd>0);
 assert.equal(result.winner?.provider,'Sensaria');
 assert.equal(result.incompleteProviders.length,5);
 for(const name of ['prodigi','printify','gelato','printshrimp','artelo']){
  assert.equal(result.suppliers[name].status,'checking');
  assert.equal(result.suppliers[name].eligible,false);
  assert.ok(!result.ranking.some(x=>x.provider===result.suppliers[name].provider));
 }
});

test('timebox returns unknown rather than false unavailable for a never-resolving provider',async()=>{
 const result=await boundedCustomProvider('gelato',()=>new Promise(()=>{}),20);
 assert.equal(result.provider,'Gelato');
 assert.equal(result.eligible,false);
 assert.equal(result.status,'timed-out');
 assert.equal(result.totalUsd,null);
 assert.match(result.reason,/not verified/i);
 assert.equal(CUSTOM_LOOKUP_PROVIDER_DEADLINES_MS.gelato,24000);
});

test('timebox preserves a successful provider quote',async()=>{
 const result=await boundedCustomProvider('printify',
  ()=>Promise.resolve({provider:'Printify',eligible:true,status:'available',totalUsd:345.67}),20);
 assert.equal(result.status,'available');
 assert.equal(result.totalUsd,345.67);
});

test('timebox reports provider failures instead of rejecting the entire comparison',async()=>{
 const result=await boundedCustomProvider('prodigi',()=>Promise.reject(Error('API 429')),20);
 assert.equal(result.status,'error');
 assert.match(result.reason,/429/);
});

test('browser sends immediate preview, has bounded full scan and explains partial quotes',()=>{
 const html=renderCustomSizeLookupPage();
 assert.match(html,/previewOnly:true/);
 assert.match(html,/requestCustomQuote\(body,36000\)/);
 assert.match(html,/requestCustomQuote\(\{\.\.\.body,previewOnly:true\},8000\)/);
 assert.match(html,/Partial comparison:/);
 assert.match(html,/PROVISIONAL: lowest of completed providers/);
 const code=readFileSync(new URL('../src/custom-size-lookup.mjs',import.meta.url),'utf8');
 assert.ok(code.includes("fresh: false"),'Catalog scans should reuse their cache rather than force fresh scans on every request');
});
