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

export function profitAtRetail({ quotedCostUsd, planningCostUsd, salePriceUsd, etsyFeePercent = 10, cadPerUsd = 1.39 } = {}) {
  const sale = validMoney(salePriceUsd);
  if (sale === null) return null;
  const quoted = validMoney(quotedCostUsd);
  const planning = validMoney(planningCostUsd);
  const feeRate = Number(etsyFeePercent) / 100;
  const fx = Number(cadPerUsd);
  if (!Number.isFinite(feeRate) || feeRate < 0 || feeRate >= 1 ||
      !Number.isFinite(fx) || fx <= 0) return null;
  const etsyFeeReserveUsd = round(sale * feeRate);
  const quotedProfitUsd = quoted === null ? null : round(sale - etsyFeeReserveUsd - quoted);
  const planningProfitUsd = planning === null ? null : round(sale - etsyFeeReserveUsd - planning);
  return {
    salePriceUsd: sale,
    etsyFeeReserveUsd,
    quotedCostUsd: quoted,
    planningCostUsd: planning,
    quotedProfitUsd,
    planningProfitUsd,
    quotedProfitCad: quotedProfitUsd === null ? null : round(quotedProfitUsd * fx),
    planningProfitCad: planningProfitUsd === null ? null : round(planningProfitUsd * fx),
    planningMarginPercent: planningProfitUsd === null || sale === 0 ? null :
      round((planningProfitUsd / sale) * 100)
  };
}

export function suggestedCustomRetail({
  planningCostUsd,
  quotedCostUsd,
  policy = {},
  storeDiscountPercent
} = {}) {
  const cost = validMoney(planningCostUsd);
  if (cost === null) return null;
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
  const minSale = Math.max(
    (cost + contributionMinimum) / (1 - feeRate),
    cost / (1 - feeRate - marginPercent / 100)
  );
  // End the REGULAR LISTING PRICE in .99 and compute the sale price that Etsy
  // would actually show after 20% Japandi or 25% Silvia discount. Never treat
  // a pre-discount "minimum sale price" as the real final checkout price.
  let regular = next99AtOrAbove(minSale / (1 - discount));
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
    etsyFeePercent: feePercent,
    cadPerUsd: fx
  });
  if (!profit) return null;
  return {
    regularPriceBeforeShopSaleUsd: regular,
    suggestedRetailPriceUsd: regular,
    minimumCustomerPriceUsd: sale,
    salePriceAfterDiscountUsd: sale,
    minimumCustomerPriceCad: round(sale * fx),
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
