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
