import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {automaticPreparationDecision} from '../src/auto-fulfillment.mjs';
import {renderFulfillmentReviewPage} from '../src/fulfillment-review-page.mjs';
import {renderOrdersPage} from '../src/orders-page.mjs';
const server=readFileSync(new URL('../src/server.mjs',import.meta.url),'utf8');
test('paid-order webhooks stage receipts and start the automatic supplier quote queue',()=>{
 const hook=server.slice(server.indexOf("if (req.method === 'POST' && url.pathname === '/etsy/webhook')"));
 assert.ok(hook.includes("await recordImportedReceipt(receipt,shopId)"));
 assert.ok(hook.includes('void scheduleAutomaticReview(receiptRef.receiptId,shopId)'));
 assert.ok(hook.includes("if((receipt.was_paid!==true&&receipt.is_paid!==true)"));
 assert.ok(!hook.includes('submitSupplierOrder('));
});
test('manual Etsy sync, import, background schedule and dashboard trigger auto recommendations',()=>{
 assert.match(server,/void scheduleAutomaticReview\(staged.receiptId,session.shop.shop_id\)/);
 assert.match(server,/void scheduleAutomaticReview\(staged.receiptId,shopId\)/);
 assert.match(server,/setInterval\(\(\)=>\{void reconcileNewEtsyPaidOrders\(\);\},AUTO_REVIEW_INTERVAL_MS\)/);
 assert.match(server,/!lastAutoReviewPoll \|\| Date\.now\(\)-Date\.parse\(lastAutoReviewPoll\)>120000/);
 assert.ok(server.includes('/api/fulfillment-auto/status'));
 assert.ok(server.includes('orderPurchasingEnabled:false'));
});
test('automatic queue ignores shipped, unpaid, canceled and previously approved receipts',()=>{
 const mk=(r,review=null)=>({staged:{receipt:r},review});
 assert.equal(automaticPreparationDecision(mk({was_paid:false})).action,'skip');
 assert.equal(automaticPreparationDecision(mk({was_paid:true,was_shipped:true})).action,'skip');
 assert.equal(automaticPreparationDecision(mk({was_paid:true,is_canceled:true})).action,'skip');
 assert.equal(automaticPreparationDecision(mk({was_paid:true}, {status:'approved_for_manual_order'})).action,'skip');
});
test('UI shows automatic quote and manual fallback, with no supplier purchase',()=>{
 const html=renderFulfillmentReviewPage('Test Shop');
 assert.match(html,/Automatically|automatic/i);
 assert.ok(html.includes('Refresh live supplier quote'));
 assert.ok(html.includes('readRecommendation()'));
 assert.ok(!html.includes('submit-supplier-order'));
 const script=html.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(script);
 assert.doesNotThrow(()=>new vm.Script(script[1]));
 assert.ok(renderOrdersPage().includes('View Supplier Recommendation'));
});
