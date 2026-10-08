import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validReceiptId, receiptKey, inferOrder, paidReceipt, summarizeOrder, money
} from '../src/custom-order-store.mjs';
import { validateApproval, validCustomArtworkId } from '../src/custom-order-workflow.mjs';

function receipt(overrides = {}) {
  return {
    receipt_id: 3912345678, name: 'Example Customer', country_iso: 'CA', was_paid: true,
    transactions: [{ title: 'Custom Canvas Print 20x28 in', sku: '', quantity: 1 }],
    total_price: { amount: 15000, divisor: 100, currency_code: 'USD' },
    ...overrides
  };
}
function testOrder(overrides = {}) {
  return {
    staged: { source: 'etsy-webhook', receipt: receipt() },
    review: {
      classification: 'custom', status: 'needs_review',
      plan: {
        countryCode: 'CA', supplier: 'gelato', artworkId: 'SAC0003', artworkMasterKey: 'artworks/SAC0003/source/SAC0003-master.jpeg', quoteGeneratedAt: new Date().toISOString()
      }
    }, ...overrides
  };
}
const accepted = () => ({
  confirm: 'APPROVE', addressVerified: true, artworkVerified: true,
  supplierVerified: true, amountVerified: true
});

test('receipt IDs are numeric and cannot traverse R2 prefixes', () => {
  assert.equal(receiptKey(3912345678), 'orders/etsy/3912345678/receipt.json');
  for (const bad of ['../../x', 'abc', '-3', '', '0', '3/file']) {
    assert.throws(() => validReceiptId(bad));
  }
});
test('private custom listing clues are suggestions, not automatic approvals', () => {
  const found = inferOrder(receipt());
  assert.equal(found.categoryHint, 'possible_custom');
  assert.equal(found.productCode, 'C');
  assert.deepEqual(found.size, { width: 20, height: 28, units: 'in' });
  assert.equal(inferOrder(receipt({transactions:[{title:'Landscape',sku:'SAC0001-P-1624',quantity:1}]})).categoryHint,'needs_review');
});
test('centimeter sizes do not silently become inches', () => {
  const hint = inferOrder(receipt({ transactions:[{ title:'Custom Poster 50×70 cm' }] }));
  assert.equal(hint.size.units,'cm');
  assert.equal(hint.productCode,'P');
});
test('only confirmed paid noncanceled receipts proceed to approval', () => {
  assert.equal(paidReceipt(receipt(), 'manual-etsy-import'), true);
  assert.equal(paidReceipt(receipt({was_paid:false}), 'etsy-webhook'), false);
  assert.equal(paidReceipt(receipt({was_canceled:true}), 'etsy-webhook'), false);
  assert.equal(paidReceipt({},'manual-etsy-import'),false);
  assert.equal(paidReceipt({},'etsy-webhook'),true);
});
test('summary exposes order status and Etsy money currency', () => {
  const s = summarizeOrder({ receipt: receipt(), source:'manual-etsy-import',receivedAt:'2026-10-07T00:00:00Z' });
  assert.equal(s.paid,true);
  assert.equal(s.itemCount,1);
  assert.deepEqual(s.merchandise,{amount:150,currency:'USD'});
  assert.equal(money({amount:100,divisor:0,currency_code:'USD'}).amount,1);
});
test('approval requires review, fresh quote and all explicit confirmations', () => {
  assert.equal(validateApproval(testOrder(), accepted()), undefined);
  assert.throws(() => validateApproval(testOrder(),{...accepted(),artworkVerified:false}),/Confirm/);
  assert.throws(() => validateApproval(testOrder({
    review: { classification:'regular',plan:null,status:'needs_review'}
  }),accepted()),/Save a custom/);
  assert.throws(() => validateApproval(testOrder({
    review:{classification:'custom',status:'needs_review',plan:{
      countryCode:'CA',artworkId:'SAC0003',artworkMasterKey:'artworks/SAC0003/source/SAC0003-master.jpeg',quoteGeneratedAt:new Date(Date.now()-25*3600000).toISOString()
    }}
  }),accepted()),/older than 24 hours/);
});
test('multi-item paid custom orders cannot be auto-approved', () => {
  assert.throws(() => validateApproval(testOrder({
    staged:{receipt:receipt({transactions:[{title:'A',quantity:2}]}),source:'etsy-webhook'}
  }),accepted()),/one purchased item/);
});

test('custom private order requires a linked SAC ID before approval', () => {
  const order = testOrder();
  delete order.review.plan.artworkId;
  assert.throws(() => validateApproval(order, accepted()), /Link a verified SAC artwork ID/);
  assert.equal(validCustomArtworkId('sac0003'), 'SAC0003');
  assert.throws(() => validCustomArtworkId(''), /valid Silvia artwork ID/);
  assert.throws(() => validCustomArtworkId('SAC../../3'), /valid Silvia artwork ID/);
});

test('custom inbox can distinguish normal listings from custom private items', () => {
  const regular = summarizeOrder({
    source: 'manual-etsy-import', receivedAt: '2026-10-08T00:00:00Z',
    receipt: receipt({transactions: [{
      title: 'Neutral Abstract Landscape Wall Art', sku:'SAC0004-P-1824', quantity:1
    }], was_shipped: true})
  });
  const custom = summarizeOrder({
    source: 'manual-etsy-import', receivedAt: '2026-10-08T00:00:00Z',
    receipt: receipt({transactions: [{
      title: 'Custom 20x28 Canvas Wall Art', sku:'', quantity:1
    }]})
  });
  assert.equal(regular.inference.categoryHint, 'needs_review');
  assert.equal(regular.shipped, true);
  assert.equal(custom.inference.categoryHint, 'possible_custom');
  assert.equal(custom.shipped, false);
});
