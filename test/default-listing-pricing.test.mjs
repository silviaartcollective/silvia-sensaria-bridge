import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildOwnSilviaInventory} from '../src/variants.mjs';
import {planDefaultTemplateInventory,templateInventoryFingerprint} from '../src/default-listing-pricing.mjs';
import {renderPricingPage} from '../src/pricing-page.mjs';
const catalog=JSON.parse(readFileSync(new URL('../config/products.json',import.meta.url),'utf8'));
const artworkId='SAC0042';
function build(direction){
 return buildOwnSilviaInventory({artworkId,catalog,readinessStateId:123,orientation:direction});
}
function plan(inventory,orientation){
 return planDefaultTemplateInventory({
  inventory,artworkId,orientation,catalog,readinessStateId:123,buildInventory:buildOwnSilviaInventory
 });
}
test('universal price/template planner does not mutate correct default inventories',()=>{
 for(const direction of ['portrait','landscape','square']){
  const current=build(direction),snapshot=JSON.stringify(current);
  const result=plan(current,direction);
  assert.equal(result.changed,false);
  assert.deepEqual(result.added,[]);
  assert.deepEqual(result.removed,[]);
  assert.equal(JSON.stringify(current),snapshot);
 }
});
test('missing or wrong-price products are previewed, without changing originals',()=>{
 for(const direction of ['portrait','landscape','square']){
  const current=build(direction),enabled=current.products.filter(p=>p.offerings[0].is_enabled);
  const missing=enabled[0].sku;
  current.products=current.products.filter(p=>p.sku!==missing);
  const priced=current.products.find(p=>p.sku&&p.offerings[0].is_enabled);
  priced.offerings[0].price=1234.56;
  const fingerprint=templateInventoryFingerprint(current,{artworkId,orientation:direction});
  const fixed=plan(current,direction);
  assert.equal(fixed.changed,true);
  assert.ok(fixed.added.includes(missing));
  assert.ok(fixed.repriced.some(p=>p.sku===priced.sku));
  assert.notEqual(templateInventoryFingerprint(fixed.inventory,{artworkId,orientation:direction}),fingerprint);
  assert.equal(priced.offerings[0].price,1234.56);
  assert.ok(fixed.inventory.products.every(p=>
    (p.offerings||[]).filter(o=>o.is_enabled).every(o=>p.sku.startsWith(artworkId+'-'))));
 }
});
test('shop templates never mix square and non-square sizes',()=>{
 const square=plan(build('square'),'square').inventory;
 const rect=plan(build('portrait'),'portrait').inventory;
 for(const p of square.products.filter(p=>p.offerings[0].is_enabled)){
  const match=p.sku.match(/-(?:P|C|FC)-(\d{2,4})/);
  assert.ok(match);
  const size=p.property_values[0].values[0].match(/(\d+)x(\d+)″/);
  assert.equal(size?.[1],size?.[2]);
 }
 assert.ok(!rect.products.some(p=>String(p.sku).includes('-P-2020')));
 assert.ok(rect.products.some(p=>String(p.sku).includes('-P-2030')));
});
test('refuses unrelated SKUs, handmade axes, disabled-only templates, and unverified orientation',()=>{
 const one=build('portrait');
 one.products.find(p=>p.sku).sku='WRONG-P-810';
 assert.throws(()=>plan(one,'portrait'),/outside the linked artwork/);
 const handmade=build('square');
 handmade.products[0].property_values[1].property_id=777;
 assert.throws(()=>plan(handmade,'square'),/default Size/i);
 const noEnabled=build('portrait');
 for(const p of noEnabled.products)for(const o of p.offerings)o.is_enabled=false;
 assert.throws(()=>plan(noEnabled,'portrait'),/No enabled/i);
 assert.throws(()=>plan(build('portrait'),'unknown'),/orientation/i);
});
test('the Price & Shipping page includes both price-only and template rebuilding tools',()=>{
 const html=renderPricingPage();
 assert.match(html,/id="preview-prices"/);
 assert.match(html,/id="tpl-preview"/);
 assert.match(html,/id="tpl-apply"/);
 assert.match(html,/api\/pricing\/templates-preview/);
 assert.match(html,/api\/pricing\/templates-apply/);
 const s=readFileSync(new URL('../src/server.mjs',import.meta.url),'utf8');
 assert.match(s,/defaultTemplatePlan\(session,id\)/);
 assert.match(s,/fingerprint!==selectedRow.fingerprint/);
 assert.match(s,/Number\(listing.shop_id\)!==Number\(session.shop.shop_id\)/);
 assert.match(s,/getListingInventory\(\{listingId:id,\.\.\.auth\}\)/);
});

function templateBatchCoordinator(){
 const html=renderPricingPage();
 const start=html.indexOf('async function applyDefaultTemplateBatches(');
 const end=html.indexOf('\ntplA.addEventListener(',start);
 assert.ok(start>=0&&end>start,'Template batch coordinator must appear in pricing page');
 assert.match(html,/tplA\.disabled=tplBusy\|\|!selectedTemplates\(\)\.length/);
 assert.match(html,/tplAll\.disabled=tplBusy\|\|!tplRows\.some/);
 return new Function(html.slice(start,end)+'; return applyDefaultTemplateBatches;')();
}
test('template updater submits all 45 checked listings in safe sequential 20-listing batches',async()=>{
 const run=templateBatchCoordinator();
 const selected=Array.from({length:45},(_,i)=>({listingId:i+1,fingerprint:'fingerprint'+i}));
 const batches=[],progress=[];
 const result=await run(selected,async batch=>{
  batches.push(batch.map(item=>item.listingId));
  return {ok:true,verifiedUpdated:batch.length,results:batch.map(row=>({
   listingId:row.listingId,updated:true,verified:true
  }))};
 },status=>progress.push(status));
 assert.deepEqual(batches.map(batch=>batch.length),[20,20,5]);
 assert.deepEqual(batches.flat(),selected.map(row=>row.listingId));
 assert.equal(result.processed,45);
 assert.equal(result.verifiedUpdated,45);
 assert.equal(result.batches,3);
 assert.deepEqual(result.failed,[]);
 assert.equal(progress.at(-1).processed,45);
});
test('template updater continues after per-listing errors and retains their Etsy IDs',async()=>{
 const run=templateBatchCoordinator();
 const selected=Array.from({length:23},(_,i)=>({listingId:100+i}));
 const result=await run(selected,async batch=>({
  ok:true,
  verifiedUpdated:batch.length-(batch.some(x=>x.listingId===112)?1:0),
  results:batch.map(row=>row.listingId===112?
   {listingId:112,error:'Etsy rejected this listing'}:
   {listingId:row.listingId,updated:true,verified:true})
 }),()=>{});
 assert.equal(result.processed,23);
 assert.equal(result.verifiedUpdated,22);
 assert.deepEqual(result.failed,[{listingId:112,error:'Etsy rejected this listing'}]);
});
test('template updater stops after transport failure without repeating previously updated batches',async()=>{
 const run=templateBatchCoordinator(),selected=Array.from({length:41},(_,i)=>({listingId:i+1}));
 let calls=0;
 await assert.rejects(()=>run(selected,async batch=>{
  calls++;
  if(calls===2)throw Error('Etsy connection dropped');
  return {ok:true,verifiedUpdated:batch.length,results:[]};
 },()=>{}),error=>{
  assert.match(error.message,/connection dropped/);
  assert.equal(error.partial.processed,20);
  assert.equal(error.partial.verifiedUpdated,20);
  assert.equal(error.partial.batches,1);
  return true;
 });
 assert.equal(calls,2);
});
