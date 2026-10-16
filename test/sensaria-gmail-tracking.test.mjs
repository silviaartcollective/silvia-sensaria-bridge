import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSensariaShipment,extractGmailText,isTrustedSensariaSender,
  trustedSensariaDomains
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
