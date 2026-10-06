import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PRINTSHRIMP_PRINT_PAPER_TYPE,
  PRINTSHRIMP_PAPER_TYPES,
  PRINTSHRIMP_FRAMED_SIZES,
  printShrimpPriceRow
} from '../src/printshrimp.mjs';

test('authenticated PrintShrimp defaults are represented', () => {
  assert.equal(PRINTSHRIMP_PRINT_PAPER_TYPE, 'Matte');
  assert.deepEqual(PRINTSHRIMP_PAPER_TYPES, ['Matte','Satin','Gloss']);
  assert.ok(PRINTSHRIMP_FRAMED_SIZES.includes('12x16'));
});

test('12x16 resolves the documented 30x40cm API alias', () => {
  const row = printShrimpPriceRow({ sizes: [{ size: '30x40cm', print: { price: 1 } }] }, '12x16');
  assert.equal(row.size, '30x40cm');
});


test('PrintShrimp preview charges shipping once using the first order item', async () => {
  const previousKey = process.env.PRINTSHRIMP_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.PRINTSHRIMP_API_KEY = 'psk_live_test';

  globalThis.fetch = async () => new Response(JSON.stringify({
    success: true,
    country: 'Canada',
    currency: 'GBP',
    sizes: [
      { size: '8x10', print: { price: 10, shipping: 4 } },
      { size: '11x14', print: { price: 12, shipping: 6 } }
    ]
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  try {
    const { validatePrintShrimpOrderPreview } = await import('../src/printshrimp.mjs');
    const result = await validatePrintShrimpOrderPreview({
      customerInfo: {
        name: 'Test Customer',
        address1: '1 Test St',
        city: 'Toronto',
        state: 'ON',
        zip: 'M5V 1A1',
        country: 'CA'
      },
      products: [
        { type: 'Print', paper_type: 'Matte', size: '8x10', quantity: 2, image: { artwork_url: 'https://example.com/a.jpg' } },
        { type: 'Print', paper_type: 'Matte', size: '11x14', quantity: 1, image: { artwork_url: 'https://example.com/b.jpg' } }
      ]
    });

    assert.equal(result.multiItem.combinedShippingConfirmed, true);
    assert.equal(result.multiItem.shippingChargeCount, 1);
    assert.equal(result.multiItem.quotedProductSubtotal, 32);
    assert.equal(result.multiItem.quotedShipping, 4);
    assert.equal(result.multiItem.quotedOrderTotalBeforeAnyPublishedBulkDiscount, 36);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.PRINTSHRIMP_API_KEY;
    else process.env.PRINTSHRIMP_API_KEY = previousKey;
  }
});
