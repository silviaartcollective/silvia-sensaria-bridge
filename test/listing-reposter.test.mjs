import test from 'node:test';
import assert from 'node:assert/strict';
import {estimatedRenewals,scanCandidate,validateSeo,listingId,assertSameInventory} from '../src/listing-reposter.mjs';
const old={listing_id:12345,state:'active',original_creation_timestamp:100000000};
const at=(days)=> (old.original_creation_timestamp+days*86400)*1000;
test('age only suggests renewals and never claims exact history',()=>{
 const v=estimatedRenewals(old,at(290));
 assert.equal(v.estimated,2);
 assert.equal(v.ageDays,290);
 assert.equal(scanCandidate(old,0,at(290)).status,'review_renewals');
 assert.equal(scanCandidate(old,1,at(290)).status,'not_eligible');
 assert.equal(scanCandidate(old,null,at(290)).salesVerified,false);
 assert.equal(scanCandidate(old,0,at(600)).status,'not_eligible');
});
test('reposter demands confirmed renewals, safe listing ID and valid Etsy SEO',()=>{
 assert.equal(listingId(12345),'12345');
 assert.throws(()=>listingId('../x'));
 const valid={title:'Neutral Beige Wall Art',description:'Soft abstract texture.',tags:['beige wall art','neutral print'],mockupMode:'keep',confirmedRenewals:2};
 assert.equal(validateSeo(valid).confirmedRenewals,2);
 assert.throws(()=>validateSeo({...valid,confirmedRenewals:0}),/Confirm 2 or 3/);
 assert.throws(()=>validateSeo({...valid,tags:['x'.repeat(21)]}),/20 characters/);
 assert.throws(()=>validateSeo({...valid,mockupMode:'unsupported'}),/keep or replace/);
});

test('SKU, offering price, and quantities must be unchanged in replacement',()=>{
 const old={products:[{sku:'SAC0001-P-1624',property_values:[{property_id:1,value_ids:[3]}],
   offerings:[{price:{amount:7199,divisor:100},quantity:999,is_enabled:true}]}]};
 const good={products:[{sku:'SAC0001-P-1624',property_values:[{property_id:1,value_ids:[3]}],
   offerings:[{price:71.99,quantity:999,is_enabled:true}]}]};
 assert.equal(assertSameInventory(old,good),true);
 assert.throws(()=>assertSameInventory(old,{products:[{...good.products[0],sku:'WRONG'}]}),/differ/);
 assert.throws(()=>assertSameInventory(old,{products:[{...good.products[0],offerings:[{price:72,quantity:999,is_enabled:true}]}]}),/differ/);
});
