import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSensariaShipment,extractGmailText,isTrustedSensariaSender,
  trustedSensariaDomains,receiptNumberCandidates
} from '../src/sensaria-gmail-parser.mjs';
import {renderTrackingPage} from '../src/tracking-page.mjs';
import {readFileSync} from 'node:fs';
const order={supplier:'sensaria',supplierOrderId:'4591174',receiptId:'4201324221'};
const sample={from:'Sensaria <updates@gooten.com>',
  subject:'Shipment confirmation - order 4591174',
  body:'Your order 4591174 has shipped. Carrier: UPS. Tracking Number: 1Z999AA10123456784'};
test('valid shipment email matches unique linked Sensaria order',()=>{
 const record=parseSensariaShipment(sample,[order]);
 assert.equal(record.status,'matched');
 assert.equal(record.receiptId,'4201324221');
 assert.equal(record.supplierOrderId,'4591174');
 assert.equal(record.trackingNumber,'1Z999AA10123456784');
 assert.equal(record.carrier,'UPS');
});
test('spoofed sender and ambiguous order ID are never staged',()=>{
 assert.equal(isTrustedSensariaSender('notifications@gooten.com.bad-domain.com'),false);
 assert.equal(parseSensariaShipment({...sample,from:'Fraud <notices@other-domain.com>'},[order]).status,'ignored');
 assert.equal(parseSensariaShipment(sample,[{...order,receiptId:'4201324222'},order]).status,'review');
 assert.equal(parseSensariaShipment({...sample,subject:'Shipment for order 4591173',
   body:'Order 4591173 has shipped. Carrier: UPS. Tracking Number: 1Z999AA10123456784'},[order]).status,'review');
});
test('pre-shipment label created and multiple tracking numbers are held for manual review',()=>{
 const label=parseSensariaShipment({...sample,subject:'Tracking label created for 4591174',
   body:'Tracking Number: 1Z999AA10123456784'},[order]);
 assert.equal(label.status,'review');
 assert.match(label.reason,/does not explicitly confirm shipment/i);
 const multiple=parseSensariaShipment({...sample,
   body:'Order 4591174 shipped. Carrier: UPS. Tracking Number: 1Z999AA10123456784 and Tracking Number: 1Z999AA10123456785'},[order]);
 assert.equal(multiple.status,'review');
});
test('unknown carrier cannot silently mark Etsy as shipped',()=>{
 const noCarrier=parseSensariaShipment({...sample,
   body:'Order 4591174 has shipped. Tracking Number: 1Z999AA10123456784'},[order]);
 assert.equal(noCarrier.status,'review');
 assert.match(noCarrier.reason,/carrier/i);
});
test('Gmail page remains review-first with separate Etsy shipment confirmation',()=>{
 const page=renderTrackingPage('Test Shop');
 assert.match(page,/Gmail.*tracking|Sensaria tracking from Gmail/);
 assert.match(page,/gmail-scan/);
 assert.match(page,/gmail-connect/);
 assert.match(page,/no CSV exports|No CSV exports/i);
 const app=readFileSync(new URL('../src/server.mjs',import.meta.url),'utf8');
 assert.match(app,/url.pathname==='\/api\/tracking\/gmail\/scan'/);
 assert.match(app,/url.pathname==='\/tracking\/gmail\/callback'/);
 assert.match(app,/ETSY_SHIPMENT_SUBMISSION_ENABLED|sendStagedShipmentToEtsy/);
 assert.match(app,/gmailOAuthConfigured\(\)/);
});

test('without a linked order, the Etsy receipt number (the CSV PO Number) in the email is checked with Etsy',()=>{
 const email={from:'Sensaria <updates@sensaria.com>',subject:'Your order has shipped',
  body:'PO Number: 4201324221 has shipped. Carrier: UPS. Tracking Number: 1Z999AA10123456784',messageId:'m1'};
 const result=parseSensariaShipment(email,[]);
 assert.equal(result.status,'check_receipt');
 assert.deepEqual(result.candidates,['4201324221']);
 assert.equal(result.trackingNumber,'1Z999AA10123456784');
 assert.equal(result.carrier,'UPS');
 // A linked Sensaria order number still matches directly.
 assert.equal(parseSensariaShipment({...email,body:email.body+' Order 4591174'},[order]).status,'matched');
 // Digits inside the tracking number, or too short or long to be a receipt, are not candidates.
 assert.deepEqual(receiptNumberCandidates('Tracking 9400111899223456789012 order 4591174 phone 15145551234567',''),[]);
 assert.deepEqual(receiptNumberCandidates('PO 4201324221 and tracking 9400111899223456789012','9400111899223456789012'),['4201324221']);
 // A number that is part of the tracking number is never taken for the order.
 assert.deepEqual(receiptNumberCandidates('ref 4201324221 tracking 942013242219999','942013242219999'),[]);
 assert.equal(parseSensariaShipment({...email,body:'Has shipped. Carrier: UPS. Tracking Number: 1Z999AA10123456784'},[]).status,'review');
});

test('the scan links, stages and (when switched on) completes Etsy orders; the switch needs Etsy shipping permission',()=>{
 const scanner=readFileSync(new URL('../src/sensaria-gmail-tracking.mjs',import.meta.url),'utf8');
 assert.match(scanner,/if\(open\.length!==1\)/);
 assert.match(scanner,/linkTrackingOrder\(session,\{receiptId:open\[0\],supplier:'sensaria',supplierOrderId:open\[0\]\}\)/);
 assert.match(scanner,/if\(settings\.autoCompleteEtsy\)await completeOnEtsy\(session,summary,review\)/);
 assert.match(scanner,/s\.source==='sensaria_gmail'&&!s\.etsySentAt/);
 assert.match(scanner,/return \{autoCompleteEtsy:false\}/);
 const app=readFileSync(new URL('../src/server.mjs',import.meta.url),'utf8');
 assert.match(app,/body\.confirm!=='COMPLETE ETSY ORDERS AUTOMATICALLY'/);
 assert.match(app,/sending tracking needs the transactions_w permission/);
 const page=renderTrackingPage('Test Shop');
 assert.match(page,/id="gmail-auto-complete"/);
});
