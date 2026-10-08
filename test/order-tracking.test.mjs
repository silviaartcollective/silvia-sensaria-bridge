import test from 'node:test';
import assert from 'node:assert/strict';
import {
  receiptId, parseCsv, sensariaCandidates, suggestCarrier, supplierShipments, normalizedShipment,
  receiptShipments, etsyCarrierCode, prepareStagedEtsyShipment, sendStagedShipmentToEtsy
} from '../src/order-tracking.mjs';

test('validates Etsy numeric receipt IDs safely',()=>{
  assert.equal(receiptId('123456789'),'123456789');
  for (const bad of ['','0','ABC','ETSY-123','12/3'])assert.throws(()=>receiptId(bad));
});
test('parses Sensaria quoted fields and shipped tracking without mutating anything',()=>{
  const csv='\uFEFFPartnerOrderReferenceNumber,OrderNumber,OrderStatus,Shipment Id,Shipping Date,ShipmentTrackingNumber,ShipmentTrackingURL,Comments\r\n'+
    '123456789,GO-123,Shipped,SHIP-77,2026-10-08,94001116990045395649372,https://tools.usps.com/go/TrackConfirmAction,"One, two"\r\n';
  const rows=parseCsv(csv);
  assert.equal(rows.length,1);
  assert.equal(rows[0].trackingNumber,'94001116990045395649372');
  const {rows: matched,skipped}=sensariaCandidates(csv,[
    {receiptId:'123456789',supplier:'sensaria',supplierOrderId:'GO-123'}
  ]);
  assert.equal(skipped.length,0);
  assert.equal(matched.length,1);
  assert.equal(matched[0].carrier,'USPS');
});
test('skips unknown or mismatched orders and de-duplicates repeated shipment rows',()=>{
 const csv='PartnerOrderReferenceNumber,OrderNumber,OrderStatus,ShipmentTrackingNumber,ShipmentTrackingURL,Shipping Date\n'+
 '123456789,GO-123,Shipped,ABC12345,https://www.ups.com/track,2026-10-08\n'+
 '123456789,GO-123,Shipped,ABC12345,https://www.ups.com/track,2026-10-08\n'+
 '555555555,GO-999,Shipped,ABC99999,https://www.ups.com/track,2026-10-08\n';
 const result=sensariaCandidates(csv,[{receiptId:'123456789',supplier:'sensaria',supplierOrderId:'GO-123'}]);
 assert.equal(result.rows.length,1);assert.equal(result.skipped.length,1);
});
test('rejects batch order-upload CSV, which is not tracking report',()=>{
 assert.throws(()=>parseCsv('PO Number,URL,Product Code\nA,http://test,12'),/ShipmentTrackingNumber/);
});
test('requires carrier and shipped/fulfilled status before staging',()=>{
 assert.throws(()=>normalizedShipment({trackingNumber:'1234567',status:'shipped'}),/carrier/);
 assert.throws(()=>normalizedShipment({trackingNumber:'1234567',carrier:'USPS',status:'printed'}),/confirmed shipped/);
 assert.equal(normalizedShipment({trackingNumber:'1234567',carrier:'USPS',status:'shipped'}).etsySentAt,null);
});
test('recognizes supported carrier tracking links without guessing unsupported sites',()=>{
 assert.equal(suggestCarrier('https://www.fedex.com/apps/track'),'FedEx');
 assert.equal(suggestCarrier('https://strange.example.net/item/123'),'');
});
test('reads Gelato v4 shipment packages and checks status',()=>{
 const data={fulfillmentStatus:'shipped',shipment:{shipmentMethodName:'UPS Ground',
    packages:[{id:'s1',trackingCode:'1ZAAA12345',trackingUrl:'https://www.ups.com/track'}]}};
 const out=supplierShipments('gelato',data);
 assert.equal(out.shipments.length,1);
 assert.equal(out.shipments[0].carrier,'UPS');
 assert.equal(supplierShipments('gelato',{...data,fulfillmentStatus:'printed'}).shipments.length,0);
});
test('reads Printify order shipments and rejects not-yet-shipped orders',()=>{
 const data={status:'fulfilled',shipments:[{carrier:'usps',number:'94001116990045395649372',url:'https://tools.usps.com/'}]};
 const out=supplierShipments('printify',data);
 assert.equal(out.shipments[0].trackingNumber,'94001116990045395649372');
 assert.equal(supplierShipments('printify',{...data,status:'on-hold'}).shipments.length,0);
});
test('normalizes existing Etsy receipt shipments to avoid duplicates',()=>{
 const items=receiptShipments({shipments:[{tracking_code:'ABC12345',carrier_name:'USPS'}]});
 assert.deepEqual(items[0].trackingNumber,'ABC12345');
});

test('does not treat Not Shipped as a shipped Sensaria order',()=>{
 const csv='PartnerOrderReferenceNumber,OrderNumber,OrderStatus,ShipmentTrackingNumber,ShipmentTrackingURL,Shipping Date\n'+
 '123456789,GO-123,Not Shipped,ABC12345,https://www.ups.com/track,\n';
 const result=sensariaCandidates(csv,[{receiptId:'123456789',supplier:'sensaria',supplierOrderId:'GO-123'}]);
 assert.equal(result.rows.length,0);
 assert.equal(result.skipped.length,1);
});

test('Etsy shipping has verified carrier codes and needs a paid matching shipment',()=>{
 const record={receiptId:'123456789',shopId:'42',supplier:'sensaria',
   shipments:[{trackingNumber:'ABC12345',carrier:'Canada Post',status:'shipped'}]};
 const receipt={shop_id:42,was_paid:true,is_shipped:false,shipments:[]};
 assert.equal(etsyCarrierCode('FedEx'),'fedex');
 const plan=prepareStagedEtsyShipment(record,receipt,{receiptId:'123456789',trackingNumber:'ABC12345'},42);
 assert.equal(plan.carrier,'canada-post');
 assert.equal(plan.alreadyOnEtsy,false);
 assert.equal(prepareStagedEtsyShipment(record,{...receipt,is_shipped:true,shipments:[{
   tracking_code:'ABC12345',carrier_name:'canada-post'
 }]},{receiptId:'123456789',trackingNumber:'ABC12345'},42).alreadyOnEtsy,true);
 assert.throws(()=>prepareStagedEtsyShipment(record,{...receipt,was_paid:false},{receiptId:'123456789',trackingNumber:'ABC12345'},42),/paid/);
 assert.throws(()=>prepareStagedEtsyShipment(record,{...receipt,is_shipped:true},{receiptId:'123456789',trackingNumber:'ABC12345'},42),/already marks/);
 assert.throws(()=>prepareStagedEtsyShipment(record,receipt,{receiptId:'123456789',trackingNumber:'BAD'},42),/not staged/);
});
test('shipment submission is disabled unless explicitly configured',async()=>{
 const current=process.env.ETSY_SHIPMENT_SUBMISSION_ENABLED;delete process.env.ETSY_SHIPMENT_SUBMISSION_ENABLED;
 try{await assert.rejects(()=>sendStagedShipmentToEtsy({},{}),/disabled/);}
 finally{if(current===undefined)delete process.env.ETSY_SHIPMENT_SUBMISSION_ENABLED;else process.env.ETSY_SHIPMENT_SUBMISSION_ENABLED=current;}
});
