import test from 'node:test';
import assert from 'node:assert/strict';
import { retailCatalogLookup, withEstimatedMargin } from '../src/retail-margin.mjs';

test('retail lookup contains Poster, Canvas and Framed Canvas sizes', () => {
  const lookup = retailCatalogLookup();
  assert.ok(lookup.get('P|12x16') > 0);
  assert.ok(lookup.get('C|40x60') > 0);
  assert.ok(lookup.get('FC|40x60') > 0);
});

test('margin gate uses the current Etsy sale and free-shipping model', () => {
  const lookup = new Map([['P|12x16', 100]]);
  const row = withEstimatedMargin(
    { productCode: 'P', size: '12x16', winner: 'Prodigi', winnerTotalUsd: 40 },
    lookup,
    { saleDiscountPercent: 20, etsyFeeReservePercent: 10, minimumMarginUsd: 7.5, minimumMarginPercent: 10, cadPerUsd: 1.39, customerShippingUsd: 0, note: 'test' }
  );
  assert.equal(row.profitScenario.salePriceUsd, 80);
  assert.equal(row.profitScenario.etsyFeeReserveUsd, 8);
  assert.equal(row.profitScenario.contributionUsd, 32);
  assert.equal(row.marginStatus, 'estimated-pass');
});
