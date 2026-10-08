import test from 'node:test';
import assert from 'node:assert/strict';
import { supplierOrderEndpointStatus } from '../src/order-endpoints.mjs';
import { createGelatoOrder } from '../src/gelato.mjs';
import { createProdigiOrder } from '../src/prodigi.mjs';
import { createArteloOrder } from '../src/artelo.mjs';
import { createPrintShrimpOrder } from '../src/printshrimp.mjs';
import { readFileSync } from 'node:fs';
test('all five supplier order API clients inventoried; Sensaria stays manual CSV',()=>{
 const d=supplierOrderEndpointStatus();
 assert.equal(d.suppliers.length,6);
 assert.equal(d.suppliers.filter(x=>x.apiAvailable).length,5);
 assert.equal(d.suppliers.find(x=>x.name==='Sensaria').apiAvailable,false);
 assert.ok(d.suppliers.every(x=>!x.orderSubmissionWorkflowConnected));
});
test('supplier order API clients reject billable submissions when master flag disabled',async()=>{
 const original=process.env.FULFILLMENT_LIVE_SUBMISSION_ENABLED;
 delete process.env.FULFILLMENT_LIVE_SUBMISSION_ENABLED;
 try{
  for(const fn of [()=>createGelatoOrder({}),()=>createProdigiOrder({}),()=>createArteloOrder({}),()=>createPrintShrimpOrder({})])
   await assert.rejects(fn,/disabled/);
 }finally{if(original===undefined)delete process.env.FULFILLMENT_LIVE_SUBMISSION_ENABLED;
 else process.env.FULFILLMENT_LIVE_SUBMISSION_ENABLED=original;}
});
test('endpoint inventory stays private and never initiates provider orders',()=>{
 const code=readFileSync(new URL('../src/server.mjs',import.meta.url),'utf8');
 assert.match(code,/url.pathname === '\/api\/orders\/endpoints'/);
 assert.match(code,/requireAdminApi\(req,res\)/);
});
