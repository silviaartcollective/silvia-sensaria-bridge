import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSensariaCsvOrder} from '../src/sensaria-order-csv.mjs';
import {quoteSignature} from '../src/regular-order-routing.mjs';
import {renderOrdersPage} from '../src/orders-page.mjs';

function orderFor(supplier='sensaria') {
 const receipt={
  receipt_id:4201324221,shop_id:123,was_paid:true,is_shipped:false,
  name:'Example Buyer',first_line:'123 Main St',city:'Sample Town',
  state:'MO',zip:'65202',country_iso:'US',
  transactions:[{sku:'SAC0007-FC-4060-BLK',quantity:1}]
 };
 const plan={
  receiptId:'4201324221',shopId:'123',supplier,
  artworkId:'SAC0007',sku:'SAC0007-FC-4060-BLK',
  productCode:'FC',size:'40x60',countryCode:'US',
  addressDigest:'placeholder',assetKey:'artworks/SAC0007/fulfillment/2x3.jpg',
  quotedTotalUsd:90,modeledLandedUsd:90,generatedAt:'2026-10-15T19:00:00Z',
  expiresAt:'2999-01-01T00:00:00Z'
 };
 // Digest the complete address consistently with the router.
 plan.addressDigest=shippingAddressDigest(receipt);
 plan.signature=quoteSignature(plan);
 return {order:{review:{classification:'regular',status:'awaiting_supplier_approval',regularPlan:plan}},receipt};
}
import {shippingAddressDigest} from '../src/regular-order-routing.mjs';

test('eligible Sensaria 40x60 black framed canvas can request a manual CSV',()=>{
 const {order,receipt}=orderFor();
 const checked=validateSensariaCsvOrder(order,receipt,123);
 assert.equal(checked.plan.supplier,'sensaria');
 assert.equal(checked.parsed.format,undefined);
 assert.equal(checked.parsed.productCode,'FC');
 assert.equal(checked.parsed.size,'40x60');
});
test('expired price recommendation still permits a validated manual CSV',()=>{
 const {order,receipt}=orderFor();
 order.review.regularPlan.expiresAt='2020-01-01T00:00:00Z';
 order.review.regularPlan.signature=quoteSignature(order.review.regularPlan);
 const result=validateSensariaCsvOrder(order,receipt,123);
 assert.equal(result.quoteExpired,true);
 // A stale price must not override current payment, SKU or shipment safety.
 assert.throws(()=>validateSensariaCsvOrder(order,{...receipt,is_shipped:true},123),/shipped/);
});

test('approved but unsubmitted Sensaria order remains downloadable',()=>{
 const {order,receipt}=orderFor();
 order.review.status='approved_for_manual_order';
 order.review.approval={supplierOrderSubmitted:false};
 assert.equal(validateSensariaCsvOrder(order,receipt,123).plan.supplier,'sensaria');
});
test('rejects wrong supplier, unpaid/canceled/shipped, wrong shop and changed order',()=>{
 const {order,receipt}=orderFor('sensaria');
 const expectReject=(o,r,pattern)=>assert.throws(()=>validateSensariaCsvOrder(o,r,123),pattern);
 expectReject({...order,review:{...order.review,regularPlan:{...order.review.regularPlan,supplier:'gelato'}}},receipt,/Sensaria/);
 expectReject(order,{...receipt,was_paid:false},/paid/);
 expectReject(order,{...receipt,was_canceled:true},/Cancelled/);
 expectReject(order,{...receipt,is_shipped:true},/shipped/);
 expectReject(order,{...receipt,shop_id:321},/authorized shop/);
 expectReject(order,{...receipt,zip:'00000'},/changed/);
 expectReject(order,{...receipt,transactions:[{quantity:1,sku:'SAC0008-FC-4060-BLK'}]},/changed/);
 expectReject(order,{...receipt,transactions:[{quantity:2,sku:'SAC0007-FC-4060-BLK'}]},/one-item/);
 order.review.approval={supplierOrderSubmitted:true};
 expectReject(order,receipt,/already submitted/);
});
test('Orders UI displays the new supplier emphasis and CSV download control',()=>{
 const html=renderOrdersPage();
 assert.match(html,/id="supplier-banner"/);
 assert.match(html,/id="supplier-name"/);
 assert.match(html,/id="sensaria-csv"/);
 assert.match(html,/Download Sensaria CSV/);
});
