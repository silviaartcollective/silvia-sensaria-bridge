import test from 'node:test';
import assert from 'node:assert/strict';
import {
  printShrimpQuotedBasketTotal,
  printShrimpCandidateCostBreakdown,
  printShrimpModeledBasketCost
} from '../src/printshrimp-basket-cost.mjs';

test('quoted basket applies first item shipping once across multiple quantities', () => {
  const result = printShrimpQuotedBasketTotal([
    { livePrice: 10, liveShipping: 4, quantity: 2 },
    { livePrice: 12, liveShipping: 6, quantity: 1 }
  ]);

  assert.deepEqual(result, {
    lineCount: 2,
    totalQuantity: 3,
    shippingChargeCount: 1,
    quotedProductSubtotal: 32,
    quotedShipping: 4,
    quotedOrderTotalBeforeAnyPublishedBulkDiscount: 36,
    shippingScope: 'order-once-first-item'
  });
});

test('routing cost breakdown converts source-currency product and shipping into USD components', () => {
  const result = printShrimpCandidateCostBreakdown({
    provider: 'PrintShrimp',
    productCost: 15,
    shippingCost: 5,
    totalUsd: 25,
    currency: 'GBP',
    contingencyRate: 0.02
  });

  assert.deepEqual(result, {
    quotedProductUsd: 18.75,
    quotedShippingUsd: 6.25,
    contingencyRate: 0.02,
    shippingScope: 'order-once-first-item',
    sourceCurrency: 'GBP'
  });
});

test('modeled basket multiplies products by quantity and charges shipping once', () => {
  const total = printShrimpModeledBasketCost([
    {
      quantity: 2,
      breakdown: {
        quotedProductUsd: 5,
        quotedShippingUsd: 4,
        contingencyRate: 0.02,
        shippingScope: 'order-once-first-item'
      }
    },
    {
      quantity: 3,
      breakdown: {
        quotedProductUsd: 6,
        quotedShippingUsd: 9,
        contingencyRate: 0.02,
        shippingScope: 'order-once-first-item'
      }
    }
  ]);

  // (5*2 + 6*3 + first-line shipping 4) * 1.02
  assert.equal(total, 32.64);
});
