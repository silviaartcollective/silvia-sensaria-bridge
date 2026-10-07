import test from 'node:test';
import assert from 'node:assert/strict';
import { profitAtRetail, suggestedCustomRetail, referenceRetailForSize } from '../src/custom-size-profit.mjs';

const policy = {
  etsyFeeReservePercent: 10,
  minimumMarginUsd: 7.5,
  minimumMarginPercent: 10,
  cadPerUsd: 1.39
};

test('Silvia 25% sale is calculated from Etsy listing retail, not guessed independently', () => {
  const pricing = suggestedCustomRetail({
    planningCostUsd: 44.83, quotedCostUsd: 37.36,
    policy, storeDiscountPercent: 25
  });
  assert.equal(pricing.shopSaleDiscountPercent, 25);
  assert.ok(Math.abs(pricing.suggestedRetailPriceUsd -
    (Math.trunc(pricing.suggestedRetailPriceUsd) + .99)) < 0.001);
  assert.equal(pricing.salePriceAfterDiscountUsd,
    Math.round(pricing.suggestedRetailPriceUsd * (1 - 25/100) * 100) / 100);
  assert.ok(pricing.estimatedContributionUsd >= policy.minimumMarginUsd);
  assert.ok(pricing.quotedProfitUsd > pricing.estimatedContributionUsd);
  assert.ok(pricing.suggestedRetailPriceUsd > pricing.salePriceAfterDiscountUsd);
});

test('Profit for an expensive supplier uses the SAME suggested checkout price', () => {
  const suggested = suggestedCustomRetail({
    planningCostUsd: 44.83, quotedCostUsd: 37.36,
    policy, storeDiscountPercent: 25
  });
  const prodigi = profitAtRetail({
    quotedCostUsd: 84.55,
    planningCostUsd: 109.92,
    salePriceUsd: suggested.salePriceAfterDiscountUsd,
    etsyFeePercent: 10,
    cadPerUsd: 1.39
  });
  assert.ok(prodigi.quotedProfitUsd < 0);
  assert.ok(prodigi.planningProfitUsd < prodigi.quotedProfitUsd);
  assert.equal(prodigi.etsyFeeReserveUsd, suggested.etsyFeeReserveUsd);
});

test('Missing provider costs produce no invented profit', () => {
  assert.equal(profitAtRetail({
    quotedCostUsd: null, planningCostUsd: null,
    salePriceUsd: 80, etsyFeePercent: 10, cadPerUsd: 1.39
  }).planningProfitUsd, null);
  assert.equal(suggestedCustomRetail({
    quotedCostUsd: null, planningCostUsd: null,
    policy, storeDiscountPercent: 25
  }), null);
});

test('custom 20x30 canvas is priced from adjacent shop sizes, not the low margin floor', () => {
  const ref = referenceRetailForSize({
    productCode: 'C', size: '20x30', cadPerUsd: 1.39,
    ladderCad: { C: {'18x24':209.95, '24x36':269.95} }
  });
  assert.equal(ref.source, 'interpolated-from-shop-sizes');
  assert.deepEqual(ref.referenceSizes,['18x24','24x36']);
  assert.equal(ref.regularUsd,167.83);
  const scenario=suggestedCustomRetail({
    planningCostUsd:44.83, quotedCostUsd:37.36, policy,
    storeDiscountPercent:25, referenceRetail: ref
  });
  assert.equal(scenario.suggestedRetailPriceUsd,167.99);
  assert.equal(scenario.salePriceAfterDiscountUsd,125.99);
  assert.ok(scenario.minimumViableRegularUsd < 80);
  assert.ok(scenario.estimatedContributionUsd > 65);
});

test('unavailable custom sizes do not pretend to have configured shop retail', () => {
  const ref=referenceRetailForSize({
    productCode: 'C', size:'60x90', cadPerUsd:1.39,
    ladderCad:{C:{'18x24':209.95,'24x36':269.95}}
  });
  assert.equal(ref,null);
});

test('expensive international shipping raises suggested retail above the shop base', () => {
  const ref=referenceRetailForSize({
    productCode:'C', size:'20x30',cadPerUsd:1.39,
    ladderCad:{C:{'18x24':209.95,'24x36':269.95}}
  });
  const scenario=suggestedCustomRetail({
    planningCostUsd:180,quotedCostUsd:125.43,policy,
    storeDiscountPercent:25,referenceRetail:ref
  });
  assert.equal(scenario.retailPriceSource,'raised-above-shop-reference-for-shipping');
  assert.ok(scenario.suggestedRetailPriceUsd>ref.regularUsd);
  assert.ok(scenario.estimatedContributionUsd>7.5);
});
