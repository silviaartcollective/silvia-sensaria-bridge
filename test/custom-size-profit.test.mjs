import test from 'node:test';
import assert from 'node:assert/strict';
import { profitAtRetail, suggestedCustomRetail } from '../src/custom-size-profit.mjs';

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
