import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTestReceipt } from '../src/test-order.mjs';

test('builds a safe poster dry-run receipt', () => {
  const { meta, receipt } = buildTestReceipt({
    artworkId: 'SAC0042',
    format: 'P',
    size: '24x36',
    orientation: 'portrait',
    quantity: 2,
    reference: 'TEST-POSTER-1'
  });

  assert.equal(meta.sku, 'SAC0042-P-2436');
  assert.equal(receipt.receipt_id, 'TEST-POSTER-1');
  assert.equal(receipt.transactions[0].sku, 'SAC0042-P-2436');
  assert.equal(receipt.transactions[0].quantity, 2);
});

test('builds framed canvas SKU with selected finish', () => {
  const { meta } = buildTestReceipt({
    artworkId: 'SAC0042',
    format: 'FC',
    size: '30x40',
    frame: 'walnut',
    orientation: 'landscape'
  });

  assert.equal(meta.sku, 'SAC0042-FC-3040-BRN');
  assert.equal(meta.orientation, 'landscape');
});

test('will not allow a non-test reference', () => {
  assert.throws(() => buildTestReceipt({
    artworkId: 'SAC0042',
    format: 'C',
    size: '24x36',
    reference: 'REAL-123'
  }), /TEST-/);
});
