import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {auditListingDestination} from '../src/international-listing-audit.mjs';
import {renderInternationalShippingPage} from '../src/international-shipping-page.mjs';

const product=(sku,enabled=true,quantity=1)=>({
 sku,offerings:[{is_enabled:enabled,quantity}]
});
const inventory={products:[
 product('SAC0007-FC-4060-BLK'),
 product('SAC0007-P-812'),
 product('SAC0007-P-812',false),
]};
test('mixed-size listing uses the most expensive enabled country shipping, never cheapest size',()=>{
 const result=auditListingDestination({inventory,country:'CA',usdToShopCurrency:1.39,shopCurrency:'CAD'});
 assert.equal(result.variantCount,2);
 assert.equal(result.worstCase.basicShippingUsd,75);
 assert.equal(result.estimatedPrimaryShippingUsd,98.01);
 assert.equal(result.estimatedPrimaryShippingInShopCurrency,136.23);
 assert.equal(result.safeToPublish,false);
 assert.equal(result.updatedEtsy,false);
 assert.equal(result.recommendedSecondaryShipping,null);
});
test('unmapped active variations make an international quote incomplete',()=>{
 const result=auditListingDestination({inventory:{products:[product('UNMAPPED-SKU'),product('SAC0007-FC-4060-BLK')]},country:'CA'});
 assert.ok(result.unverifiedVariants.length);
 assert.equal(result.estimatedPrimaryShippingUsd,null);
});
test('disabled or zero-quantity offerings do not overcharge buyer',()=>{
 const result=auditListingDestination({inventory:{products:[
   product('SAC0007-FC-4060-BLK',false),product('SAC0007-P-812',true)
 ]},country:'CA'});
 assert.equal(result.variantCount,1);
 assert.equal(result.worstCase.format,'P');
});
test('US Etsy country-level profile cannot separately price Alaska and Hawaii',()=>{
 const result=auditListingDestination({inventory,country:'US'});
 assert.ok(result.blockers.some(b=>/Alaska or Hawaii/i.test(b)));
});
test('no verified FX means no shop-currency claim',()=>{
 const result=auditListingDestination({inventory,country:'CA',shopCurrency:'CAD'});
 assert.equal(result.estimatedPrimaryShippingInShopCurrency,null);
 assert.ok(result.blockers.some(b=>/conversion/i.test(b)));
});
test('shipping audit is read-only and has a functioning UI entry point',()=>{
 const html=renderInternationalShippingPage();
 assert.match(html,/id="audit-run"/);
 const server=readFileSync(new URL('../src/server.mjs',import.meta.url),'utf8');
 assert.match(server,/url.pathname==='\/api\/international-shipping\/listing-audit'/);
 assert.match(server,/Number\(listing.shop_id\)!==Number\(session.shop.shop_id\)/);
 assert.match(server,/readOnly:true,listingId:id/);
});
