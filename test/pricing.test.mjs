import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sensariaShippingGroupFor,
  shippingZoneForAddress,
  sensariaTaxRateForAddress,
  basicShippingRateUsd,
  pricingForZone,
  pricingForAddress,
  pricingCatalogForMarket
} from '../src/pricing.mjs';

test('maps current product sizes to Sensaria shipping groups', () => {
  assert.equal(sensariaShippingGroupFor({ format: 'P', size: '30x40' }), 'Rolled Substrates');
  assert.equal(sensariaShippingGroupFor({ format: 'C', size: '24x36' }), 'Default');
  assert.equal(sensariaShippingGroupFor({ format: 'C', size: '30x40' }), 'Canvas Medium');
  assert.equal(sensariaShippingGroupFor({ format: 'C', size: '40x60' }), 'Canvas Large');
  assert.equal(sensariaShippingGroupFor({ format: 'FC', size: '40x60' }), 'Canvas Large');
});

test('maps key destinations to Sensaria zones', () => {
  assert.equal(shippingZoneForAddress({ country: 'US', state: 'CA' }), '1A');
  assert.equal(shippingZoneForAddress({ country: 'US', state: 'AK' }), '3A');
  assert.equal(shippingZoneForAddress({ country: 'CA', state: 'BC' }), '2A');
  assert.equal(shippingZoneForAddress({ country: 'GB' }), '1B');
  assert.equal(shippingZoneForAddress({ country: 'AU' }), '2B');
  assert.equal(shippingZoneForAddress({ country: 'NZ' }), '4NZ');
  assert.equal(shippingZoneForAddress({ country: 'RU' }), 'UNDELIVERABLE');
});

test('matches Sensaria Basic shipping examples', () => {
  assert.equal(basicShippingRateUsd({ format: 'P', size: '12x16', country: 'US', state: 'IL' }), 0);
  assert.equal(basicShippingRateUsd({ format: 'P', size: '12x16', country: 'CA', state: 'BC' }), 5);
  assert.equal(basicShippingRateUsd({ format: 'C', size: '30x40', country: 'CA', state: 'BC' }), 30);
  assert.equal(basicShippingRateUsd({ format: 'C', size: '40x60', country: 'CA', state: 'BC' }), 75);
  assert.equal(basicShippingRateUsd({ format: 'C', size: '40x60', country: 'AU' }), 5);
});

test('keeps tax unverified instead of guessing', () => {
  const tax = sensariaTaxRateForAddress({ country: 'US', state: 'CA' });
  assert.equal(tax.rate, null);
  assert.equal(tax.status, 'unverified');
});

test('uses verified BC Sensaria checkout tax', () => {
  const tax = sensariaTaxRateForAddress({ country: 'CA', state: 'BC' });
  assert.equal(tax.rate, 0.05);
  assert.equal(tax.status, 'verified_checkout');
});

test('Silvia free shipping absorbs Sensaria shipping', () => {
  const row = pricingForZone({ format: 'C', size: '40x60', zone: '2A' });
  assert.equal(row.regularPriceCad, 669.95);
  assert.equal(row.salePriceCad, 502.46);
  assert.equal(row.salePriceUsd, 361.49);
  assert.equal(row.productCostUsd, 184.18);
  assert.equal(row.shippingCostUsd, 75);
  assert.equal(row.customerShippingUsd, 0);
  assert.equal(row.totalFulfillmentCostBeforeTaxUsd, 259.18);
  assert.equal(row.profitBeforeTaxUsd, 102.31);
  assert.equal(row.profitAfterTaxUsd, null);
});

test('BC framed 40x60 matches verified Sensaria checkout totals', () => {
  const row = pricingForAddress({
    format: 'FC',
    size: '40x60',
    country: 'CA',
    state: 'BC',
    customerPaysShipping: false
  });
  assert.equal(row.productCostUsd, 233.31);
  assert.equal(row.shippingCostUsd, 75);
  assert.equal(row.totalFulfillmentCostBeforeTaxUsd, 308.31);
  assert.equal(row.taxRate, 0.05);
  assert.equal(row.sensariaTaxUsd, 15.42);
  assert.equal(row.trueFulfillmentCostUsd, 323.73);
  assert.equal(row.profitAfterTaxUsd, 107.89);
});


test('Italy market uses free shipping and the planning tax rate', () => {
  const priced = pricingCatalogForMarket('IT');
  assert.equal(priced.market.zone, '1C');
  assert.equal(priced.market.planningTaxRate, 0.22);
  const canvas = priced.rows.find((row) => row.format === 'C' && row.size === '40x60');
  assert.ok(canvas);
  assert.equal(canvas.shippingCostUsd, 75);
  assert.equal(canvas.customerShippingUsd, 0);
  assert.equal(canvas.salePriceUsd, 361.49);
  assert.equal(canvas.sensariaTaxUsd, 57.02);
  assert.equal(canvas.profitAfterTaxUsd, 45.29);
});
