import test from 'node:test';
import assert from 'node:assert/strict';
import {
  suggestedCustomRetail,
  profitAtRetail,
  recommendedCustomShippingCharge
} from '../src/custom-size-profit.mjs';

const shopDiscount=25;
const policy={
  etsyFeeReservePercent:10,
  minimumMarginUsd:7.5,
  minimumMarginPercent:10,
  cadPerUsd:1.39
};
const retail={regularUsd:167.83,regularCad:233.28,source:'interpolated-from-shop-sizes'};

function scenario(planning, quoted, charged=0) {
  return suggestedCustomRetail({
    planningCostUsd:planning,
    quotedCostUsd:quoted,
    referenceRetail:retail,
    storeDiscountPercent:shopDiscount,
    customerShippingUsd:charged,
    policy
  });
}

test('No customer shipping means the original free-delivery calculation', () => {
  const p=scenario(44.83,37.36);
  assert.equal(p.customerShippingUsd,0);
  assert.equal(p.buyerTotalUsd,p.salePriceAfterDiscountUsd);
  assert.equal(p.etsyFeeReserveUsd,Math.round(p.buyerTotalUsd*.1*100)/100);
  assert.ok(p.estimatedContributionUsd>0);
});

test('Separate customer shipping is NOT reduced by the store sale', () => {
  const charge=recommendedCustomShippingCharge(100,10);
  assert.equal(charge,111.99);
  const p=scenario(177.33,136.41,charge);
  assert.equal(p.customerShippingUsd,111.99);
  assert.equal(p.suggestedRetailPriceUsd,167.99);
  assert.equal(p.salePriceAfterDiscountUsd,
    Math.round(p.suggestedRetailPriceUsd*(1-shopDiscount/100)*100)/100);
  assert.equal(p.buyerTotalUsd,
    Math.round((p.salePriceAfterDiscountUsd+111.99)*100)/100);
  assert.equal(p.etsyFeeReserveUsd,Math.round(p.buyerTotalUsd*.1*100)/100);
  assert.equal(p.estimatedContributionUsd,
    Math.round((p.buyerTotalUsd-p.etsyFeeReserveUsd-177.33)*100)/100);
  assert.ok(p.estimatedContributionUsd>=7.5);
});

test('Free shipping may require raising artwork retail for expensive destinations', () => {
  const free=scenario(177.33,136.41);
  const separate=scenario(177.33,136.41,recommendedCustomShippingCharge(100,10));
  assert.ok(free.suggestedRetailPriceUsd>separate.suggestedRetailPriceUsd);
  assert.equal(separate.retailPriceSource,'interpolated-from-shop-sizes');
});

test('Profit is calculated after fee reserve on artwork PLUS shipping', () => {
  const result=profitAtRetail({
    quotedCostUsd:136.41,
    planningCostUsd:177.33,
    salePriceUsd:125.99,
    customerShippingUsd:111.99,
    etsyFeePercent:10,
    cadPerUsd:1.39
  });
  assert.equal(result.buyerTotalUsd,237.98);
  assert.equal(result.etsyFeeReserveUsd,23.8);
  assert.equal(result.quotedProfitUsd,77.77);
  assert.equal(result.planningProfitUsd,36.85);
});

test('Missing shipping cost cannot be treated as free delivery', () => {
  assert.equal(recommendedCustomShippingCharge(null,10),null);
  assert.equal(recommendedCustomShippingCharge(undefined,10),null);
  assert.equal(recommendedCustomShippingCharge(-10,10),null);
  assert.equal(recommendedCustomShippingCharge(0,10),0);
  assert.equal(scenario(200,155,null),null);
});
