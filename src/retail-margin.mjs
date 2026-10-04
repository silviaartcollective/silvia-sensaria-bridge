import {
  SILVIA_RETAIL_PRICE_LADDER_USD,
  SILVIA_SALE_DISCOUNT_PERCENT,
  SILVIA_REFERENCE_CAD_PER_USD
} from './variants.mjs';

function round(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function configured(name, fallback) {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid ${name}`);
  return value;
}

export function profitScenarioPolicy() {
  return {
    saleDiscountPercent: configured('SAC_SALE_DISCOUNT_PERCENT', SILVIA_SALE_DISCOUNT_PERCENT),
    etsyFeeReservePercent: configured('SAC_ETSY_FEE_RESERVE_PERCENT', 10),
    minimumMarginUsd: configured('SAC_MIN_MARGIN_USD', 7.5),
    minimumMarginPercent: configured('SAC_MIN_MARGIN_PERCENT', 10),
    cadPerUsd: configured('SAC_REFERENCE_CAD_PER_USD', SILVIA_REFERENCE_CAD_PER_USD),
    customerShippingUsd: 0,
    note: 'Single-item planning estimate for the current free-shipping Etsy policy. Etsy fee reserve is configurable and is not a statutory fee quote; excludes refunds, ads, fixed listing/payment fees and basket effects.'
  };
}

export function retailCatalogLookup(ladder = SILVIA_RETAIL_PRICE_LADDER_USD) {
  const lookup = new Map();
  for (const [format, sizes] of Object.entries(ladder || {})) {
    for (const [size, price] of Object.entries(sizes || {})) {
      const value = Number(price);
      if (Number.isFinite(value) && value > 0) lookup.set(`${format}|${size}`, value);
    }
  }
  return lookup;
}

export function loadRetailCatalogLookup() {
  return retailCatalogLookup();
}

export function withEstimatedMargin(row, retailLookup, policy = profitScenarioPolicy()) {
  const retailPriceUsd = retailLookup.get(`${row.productCode}|${row.size}`);
  const adjustedUsd = Number(row.winnerTotalUsd);
  if (!Number.isFinite(retailPriceUsd) || retailPriceUsd <= 0 ||
      !row.winner || !Number.isFinite(adjustedUsd) || adjustedUsd < 0) {
    return { ...row, profitScenario: null, marginStatus: 'unavailable' };
  }

  const discount = policy.saleDiscountPercent / 100;
  const salePriceUsd = round(retailPriceUsd * (1 - discount));
  const collectedUsd = round(salePriceUsd + policy.customerShippingUsd);
  const etsyFeeReserveUsd = round(collectedUsd * policy.etsyFeeReservePercent / 100);
  const contributionUsd = round(collectedUsd - adjustedUsd - etsyFeeReserveUsd);
  const minimumUsd = Math.max(policy.minimumMarginUsd, round(salePriceUsd * policy.minimumMarginPercent / 100));
  const qualified = contributionUsd >= minimumUsd;

  return {
    ...row,
    marginStatus: qualified ? 'estimated-pass' : 'review',
    profitScenario: {
      retailPriceUsd,
      discount,
      salePriceUsd,
      customerShippingUsd: policy.customerShippingUsd,
      collectedUsd,
      etsyFeeReserveUsd,
      adjustedSupplierUsd: adjustedUsd,
      contributionUsd,
      contributionCad: round(contributionUsd * policy.cadPerUsd),
      minimumUsd,
      assumedCadPerUsd: policy.cadPerUsd,
      qualified,
      assumptions: policy.note
    }
  };
}
