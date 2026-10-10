import test from 'node:test';
import assert from 'node:assert/strict';
import {automaticallyPrepareReceipt,automaticPreparationDecision,
 classifyAutomaticFailure,selectAutomaticCandidates} from '../src/auto-fulfillment.mjs';

const order=(review=null)=>({staged:{receipt:{receipt_id:123,was_paid:true,country_iso:'CA',
 transactions:[{quantity:1,sku:'SAC0001-P-2436'}]}},review});
test('new converted Etsy orders automatically enter the recommendation queue',()=>{
 assert.equal(automaticPreparationDecision(order()).action,'prepare');
 assert.equal(automaticPreparationDecision(order({classification:'custom'})).action,'skip');
 assert.equal(automaticPreparationDecision(order({status:'approved_for_manual_order'})).action,'skip');
 assert.equal(automaticPreparationDecision(order({status:'awaiting_supplier_approval',regularPlan:{supplier:'gelato'}})).action,'skip');
 assert.equal(automaticPreparationDecision(order({automaticRouting:{status:'manual_review'}})).action,'skip');
});
test('one quote generated once, no repeat purchasing or recommendation overwrite',async()=>{
 let reads=0, prepares=0;
 const read=async()=>{reads++;return order();};
 const prepare=async()=>{prepares++;return{plan:{supplier:'gelato',modeledLandedUsd:35}}};
 const first=await automaticallyPrepareReceipt('123',123,{read,prepare});
 assert.equal(first.status,'ready');assert.equal(first.supplier,'gelato');
 assert.equal(prepares,1);assert.equal(reads,1);
});
test('legacy items become manual-review entries without placing orders',async()=>{
 let saved;
 const read=async()=>order();
 const result=await automaticallyPrepareReceipt('123',123,{read,
 prepare:async()=>{throw Error('This item does not have a converted SKU. Review fulfillment manually.')},
 save:async(_id,value)=>{saved=value},log:{warn(){}}
 });
 assert.equal(result.status,'manual_review');
 assert.equal(saved.automaticRouting.status,'manual_review');
 assert.ok(!saved.approval);
});
test('temporary quote errors get bounded retry instead of buying fallback supplier',async()=>{
 let saved;
 const result=await automaticallyPrepareReceipt('123',123,{
  read:async()=>order(),
  prepare:async()=>{throw Error('Gelato API timed out')},
  save:async(_id,r)=>{saved=r},
  log:{warn(){}}
 });
 assert.equal(result.status,'retry');
 assert.ok(Date.parse(saved.automaticRouting.retryAfter)>Date.now());
});
test('candidate picker skips unpaid, shipped, canceled and already reviewed items',()=>{
 const items=[
  {receipt_id:1,was_paid:true,transactions:[{sku:'SAC0001-P-2436'}]},
  {receipt_id:2,was_paid:false},
  {receipt_id:3,was_paid:true,is_shipped:true},
  {receipt_id:4,was_paid:true},
  {receipt_id:5,was_paid:true,was_canceled:true}
 ];
 const reviews={'4':{status:'awaiting_supplier_approval',regularPlan:{supplier:'gelato'}}};
 assert.deepEqual(selectAutomaticCandidates(items,reviews),['1']);
});
