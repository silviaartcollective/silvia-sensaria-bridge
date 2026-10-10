import test from 'node:test';
import assert from 'node:assert/strict';
import {parseFulfillmentSku,eligibleRegularReceipt,rankEligibleOffers,quoteSignature} from '../src/regular-order-routing.mjs';
import {renderFulfillmentReviewPage} from '../src/fulfillment-review-page.mjs';
import vm from 'node:vm';
const sku='SAC0012-FC-2436-BRN';
test('converted SKU is authoritative for artwork, exact size and frame',()=>{
 assert.deepEqual(parseFulfillmentSku(sku),{sku,artworkId:'SAC0012',productCode:'FC',
 size:'24x36',width:24,height:36,frame:'Brown',finishCode:'BRN'});
 assert.equal(parseFulfillmentSku('SAC0012-P-810').size,'8x10');
 assert.throws(()=>parseFulfillmentSku('legacy-gelato_123'),/converted/);
 assert.throws(()=>parseFulfillmentSku('SAC0012-FC-2436'),/frame/i);
 assert.throws(()=>parseFulfillmentSku('SAC0012-C-2436-BLK'),/frame/i);
});
const receipt={receipt_id:312,shop_id:123,was_paid:true,country_iso:'CA',transactions:[{quantity:1,sku}]};
test('fail-closed paid, shop, shipped and quantity checks',()=>{
 const order=r=>({staged:{receipt:r,source:'manual-etsy-import'},review:null});
 assert.equal(eligibleRegularReceipt(order(receipt),123).item.artworkId,'SAC0012');
 assert.throws(()=>eligibleRegularReceipt(order({...receipt,was_paid:false}),123),/paid/);
 assert.throws(()=>eligibleRegularReceipt(order({...receipt,is_shipped:true}),123),/shipped/);
 assert.throws(()=>eligibleRegularReceipt(order({...receipt,transactions:[{quantity:2,sku}]}),123),/One purchased item/);
 assert.throws(()=>eligibleRegularReceipt(order({...receipt,shop_id:987}),123),/another Etsy shop/);
 const used=order(receipt);used.review={supplierOrderId:'SUP-100'};
 assert.throws(()=>eligibleRegularReceipt(used,123),/already recorded/);
});
test('rank excludes unsupported, incomplete, zero-price and non-eligible offers',()=>{
 const q={suppliers:{sensaria:{provider:'Sensaria',eligible:true,status:'available',totalUsd:32,modeledLandedUsd:34},
  gelato:{provider:'Gelato',eligible:true,status:'available',totalUsd:29,modeledLandedUsd:31},
  artelo:{provider:'Artelo',eligible:false,status:'unavailable',totalUsd:5},
  printify:{provider:'Printify',eligible:true,status:'available',totalUsd:null}}};
 assert.deepEqual(rankEligibleOffers(q).map(x=>x.supplier),['gelato','sensaria']);
});
test('quote approval fingerprint changes when supplier or price changes',()=>{
 const p={receiptId:'312',shopId:'123',sku,artworkId:'SAC0012',countryCode:'CA',
 assetKey:'artworks/SAC0012/fulfillment/2x3.jpg',supplier:'gelato',quotedTotalUsd:25,
 modeledLandedUsd:27,generatedAt:'2026-10-09T00:00:00Z'};
 assert.notEqual(quoteSignature(p),quoteSignature({...p,supplier:'prodigi'}));
 assert.notEqual(quoteSignature(p),quoteSignature({...p,quotedTotalUsd:30}));
});
test('review page is readable, shows checks and never submits orders',()=>{
 const html=renderFulfillmentReviewPage('Test Shop');
 assert.ok(html.includes('Supplier Fulfillment Review'));
 assert.ok(html.includes('No supplier orders are placed'));
 assert.ok(html.includes('APPROVE FOR REVIEW'));
 assert.ok(!html.includes('submit-supplier-order'));
 const m=html.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(m);assert.doesNotThrow(()=>new vm.Script(m[1]));
});
