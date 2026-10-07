// Recommended custom-size Etsy listing price and estimated after-fee contribution.
// All values are USD unless explicitly labeled CAD. Taxes, Etsy fees and import
// charges are estimates and MUST NOT be described as confirmed profits.
function round(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function validMoney(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function next99AtOrAbove(value) {
  return round(Math.max(0.99, Math.ceil(value + 0.01 - 1e-9) - 0.01));
}


function areaForSize(size) {
  const parts = String(size || '').toLowerCase().split(/x|×/).map(Number);
  if (parts.length !== 2 || !parts.every(n => Number.isFinite(n) && n > 0)) return null;
  return parts[0] * parts[1];
}

// An exact established price wins. A CUSTOM size between two established
// sizes is interpolated from the SHOP'S approved CAD price ladder, not invented
// from a minimum-margin formula. We do not extrapolate beyond the ladder.
export function referenceRetailForSize({
  productCode, size, ladderCad = {}, cadPerUsd = 1.39, posterCadPerUsd
} = {}) {
  const ladder = ladderCad?.[productCode] || {};
  const rate = productCode === 'P' && posterCadPerUsd
    ? Number(posterCadPerUsd) : Number(cadPerUsd);
  if (!(rate > 0)) return null;
  const direct = validMoney(ladder[size]);
  if (direct != null && direct > 0) {
    return { regularUsd: round(direct / rate), regularCad: direct, source: 'existing-shop-size' };
  }
  const targetArea = areaForSize(size);
  if (targetArea === null) return null;
  const sizes = Object.entries(ladder)
    .map(([name, cad]) => ({ area: areaForSize(name), cad: validMoney(cad), name }))
    .filter(item => item.area != null && item.cad != null && item.cad > 0)
    .sort((a,b)=>a.area-b.area);
  const lower = [...sizes].reverse().find(x => x.area <= targetArea);
  const upper = sizes.find(x => x.area >= targetArea);
  if (!lower || !upper) return null;
  if (lower.area === upper.area) {
    return { regularUsd: round(lower.cad / rate), regularCad: lower.cad,
      source: 'same-area-shop-size', referenceSizes: [lower.name] };
  }
  const weight = (targetArea - lower.area) / (upper.area - lower.area);
  const regularCad = round(lower.cad + weight * (upper.cad - lower.cad));
  return {
    regularUsd: round(regularCad / rate),
    regularCad,
    source: 'interpolated-from-shop-sizes',
    referenceSizes: [lower.name, upper.name]
  };
}

export function profitAtRetail({
  quotedCostUsd, planningCostUsd, salePriceUsd, customerShippingUsd = 0,
  etsyFeePercent = 10, cadPerUsd = 1.39
} = {}) {
  const sale = validMoney(salePriceUsd);
  const shippingCharged = validMoney(customerShippingUsd);
  if (sale === null || shippingCharged === null) return null;
  const quoted = validMoney(quotedCostUsd);
  const planning = validMoney(planningCostUsd);
  const feeRate = Number(etsyFeePercent) / 100;
  const fx = Number(cadPerUsd);
  if (!Number.isFinite(feeRate) || feeRate < 0 || feeRate >= 1 ||
      !Number.isFinite(fx) || fx <= 0) return null;
  // Etsy transaction/payment fee reserves apply to the ARTWORK + the
  // separately charged shipping amount, not only to the artwork.
  // The shop discount applies to the artwork price, not to the custom
  // shipping profile's fixed charge.
  const buyerTotalUsd = round(sale + shippingCharged);
  const etsyFeeReserveUsd = round(buyerTotalUsd * feeRate);
  const quotedProfitUsd = quoted === null ? null : round(buyerTotalUsd - etsyFeeReserveUsd - quoted);
  const planningProfitUsd = planning === null ? null : round(buyerTotalUsd - etsyFeeReserveUsd - planning);
  return {
    salePriceUsd: sale,
    customerShippingUsd: shippingCharged,
    buyerTotalUsd,
    etsyFeeReserveUsd,
    quotedCostUsd: quoted,
    planningCostUsd: planning,
    quotedProfitUsd,
    planningProfitUsd,
    quotedProfitCad: quotedProfitUsd === null ? null : round(quotedProfitUsd * fx),
    planningProfitCad: planningProfitUsd === null ? null : round(planningProfitUsd * fx),
    planningMarginPercent: planningProfitUsd === null || sale === 0 ? null :
      round((planningProfitUsd / buyerTotalUsd) * 100)
  };
}

export function suggestedCustomRetail({
  planningCostUsd,
  quotedCostUsd,
  policy = {},
  storeDiscountPercent,
  referenceRetail = null,
  customerShippingUsd = 0
} = {}) {
  const cost = validMoney(planningCostUsd);
  const shippingCharged = validMoney(customerShippingUsd);
  if (cost === null || shippingCharged === null) return null;
  const discountPercent = Number(storeDiscountPercent);
  const feePercent = Number(policy.etsyFeeReservePercent ?? 10);
  const contributionMinimum = Number(policy.minimumMarginUsd ?? 7.5);
  const marginPercent = Number(policy.minimumMarginPercent ?? 10);
  const fx = Number(policy.cadPerUsd ?? 1.39);
  if (![discountPercent, feePercent, contributionMinimum, marginPercent, fx]
      .every(Number.isFinite) || discountPercent < 0 || discountPercent >= 100 ||
      feePercent < 0 || feePercent >= 100 ||
      marginPercent < 0 || marginPercent + feePercent >= 100 ||
      contributionMinimum < 0 || fx <= 0) return null;

  const discount = discountPercent / 100;
  const feeRate = feePercent / 100;
  // The buyer's separate shipping payment offsets fulfillment cost, while
  // the Etsy fee reserve still applies to both artwork and shipping. The
  // profit floor is defined on the after-discount artwork price.
  const minSale = Math.max(
    0.01,
    (cost + contributionMinimum) / (1 - feeRate) - shippingCharged,
    (cost - shippingCharged * (1 - feeRate)) /
      (1 - feeRate - marginPercent / 100)
  );
  // End the REGULAR LISTING PRICE in .99 and compute the sale price that Etsy
  // would actually show after 20% Japandi or 25% Silvia discount. Never treat
  // a pre-discount "minimum sale price" as the real final checkout price.
  const floorRegular = next99AtOrAbove(minSale / (1 - discount));
  const baseRegular = validMoney(referenceRetail?.regularUsd);
  const costAdjusted = baseRegular != null && floorRegular > baseRegular;
  // Preserve exact existing-shop pricing when it meets the margin floor.
  // For custom sizes, use a .99 suggested retail built from established
  // neighboring shop prices; if international shipping is high, raise it.
  const fromLadder = baseRegular == null ? null
    : referenceRetail?.source === 'existing-shop-size'
      ? baseRegular : next99AtOrAbove(baseRegular);
  let regular = Math.max(floorRegular, fromLadder ?? 0);
  let sale = round(regular * (1 - discount));
  for (let i = 0; sale + 0.000001 < minSale && i < 5; i++) {
    regular = round(regular + 1);
    sale = round(regular * (1 - discount));
  }
  if (sale + 0.000001 < minSale) return null;
  const profit = profitAtRetail({
    quotedCostUsd,
    planningCostUsd: cost,
    salePriceUsd: sale,
    customerShippingUsd: shippingCharged,
    etsyFeePercent: feePercent,
    cadPerUsd: fx
  });
  if (!profit) return null;
  return {
    retailPriceSource: baseRegular == null ? 'cost-based-minimum'
      : costAdjusted ? 'raised-above-shop-reference-for-shipping'
      : referenceRetail.source,
    referenceRetail,
    minimumViableRegularUsd: floorRegular,
    minimumViableSaleUsd: round(floorRegular * (1 - discount)),
    regularPriceBeforeShopSaleUsd: regular,
    suggestedRetailPriceUsd: regular,
    minimumCustomerPriceUsd: sale,
    salePriceAfterDiscountUsd: sale,
    minimumCustomerPriceCad: round(sale * fx),
    customerShippingUsd: shippingCharged,
    customerShippingCad: round(shippingCharged * fx),
    buyerTotalUsd: profit.buyerTotalUsd,
    buyerTotalCad: round(profit.buyerTotalUsd * fx),
    suggestedRetailPriceCad: round(regular * fx),
    shopSaleDiscountPercent: discountPercent,
    etsyFeeReservePercent: feePercent,
    assumedCadPerUsd: fx,
    etsyFeeReserveUsd: profit.etsyFeeReserveUsd,
    quotedProfitUsd: profit.quotedProfitUsd,
    quotedProfitCad: profit.quotedProfitCad,
    estimatedContributionUsd: profit.planningProfitUsd,
    estimatedContributionCad: profit.planningProfitCad,
    estimatedPlanningProfitMarginPercent: profit.planningMarginPercent,
    quotedSupplierUsd: profit.quotedCostUsd,
    plannedSupplierUsd: profit.planningCostUsd,
    minimumRequiredSaleUsd: round(minSale),
    note: policy.note || 'Conservative planning only: supplier pricing, taxes, Etsy fees and FX may change. Etsy ads, fixed fees and refunds are not included.'
  };
}

/**
 * A suggested fixed, separately payable shipping amount for a custom Etsy
 * listing. Uses the destination's quoted supplier shipping in USD. Does not
 * imply that Etsy will charge this automatically, or that Gelato's
 * country-level shipping estimate is an address-specific quote.
 */
export function recommendedCustomShippingCharge(quotedShippingUsd, etsyFeePercent = 10) {
  const quote = validMoney(quotedShippingUsd);
  const feeRate = Number(etsyFeePercent) / 100;
  if (quote === null || !Number.isFinite(feeRate) || feeRate < 0 || feeRate >= 1) {
    return null;
  }
  return quote === 0 ? 0 : next99AtOrAbove(quote / (1 - feeRate));
}
