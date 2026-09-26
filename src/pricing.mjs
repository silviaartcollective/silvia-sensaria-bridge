import { readFileSync } from 'node:fs';
import {
  SILVIA_REFERENCE_CAD_PER_USD,
  SILVIA_RETAIL_PRICE_LADDER_CAD,
  SILVIA_RETAIL_PRICE_LADDER_USD,
  SILVIA_SALE_DISCOUNT_PERCENT
} from './variants.mjs';

const costs = JSON.parse(
  readFileSync(new URL('../config/sensaria-costs.json', import.meta.url), 'utf8')
);
const shipping = JSON.parse(
  readFileSync(new URL('../config/shipping-rates.json', import.meta.url), 'utf8')
);
const taxes = JSON.parse(
  readFileSync(new URL('../config/tax-rates.json', import.meta.url), 'utf8')
);
const profitability = JSON.parse(
  readFileSync(new URL('../config/profitability-markets.json', import.meta.url), 'utf8')
);

function normalizeFormat(value) {
  const v = String(value || '').trim().toUpperCase();
  if (v === 'P' || v === 'C' || v === 'FC') return v;
  throw new Error(`Unsupported pricing format: ${value}`);
}

function normalizeSize(value) {
  const match = String(value || '').trim().match(/(\d{1,3})\s*[x×]\s*(\d{1,3})/i);
  if (!match) throw new Error(`Invalid size: ${value}`);
  return `${Number(match[1])}x${Number(match[2])}`;
}

function normalizeTaxRate(value) {
  if (value === null || value === undefined || value === '') return null;
  const rate = Number(value);
  if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
    throw new Error(`Invalid tax rate: ${value}. Use a decimal from 0 to 1.`);
  }
  return rate;
}

function sizePerimeterInches(size) {
  const normalized = normalizeSize(size);
  const [width, height] = normalized.split('x').map(Number);
  return 2 * (width + height);
}

export function sensariaShippingGroupFor({ format, size }) {
  const f = normalizeFormat(format);
  const s = normalizeSize(size);
  if (f === 'P') return 'Rolled Substrates';

  const perimeter = sizePerimeterInches(s);
  const t = shipping.canvasTierThresholdsInches;
  if (perimeter < Number(t.defaultMaxExclusive)) return 'Default';
  if (perimeter < Number(t.mediumMaxExclusive)) return 'Canvas Medium';
  if (perimeter <= Number(t.largeMaxInclusive)) return 'Canvas Large';
  return 'Canvas Oversized';
}

export function shippingZoneForAddress({ country, state = '' }) {
  const cc = String(country || '').trim().toUpperCase();
  const region = String(state || '').trim().toUpperCase();
  if (!cc) return null;

  if (cc === 'US') {
    if ((shipping.zones['3A']?.usStates || []).includes(region)) return '3A';
    return '1A';
  }

  for (const zone of ['1B','1C','2A','2B','3A','3B','4','4NZ','5','ROW','UNDELIVERABLE']) {
    if ((shipping.zones[zone]?.countries || []).includes(cc)) return zone;
  }
  return null;
}

export function sensariaTaxRateForAddress({ country, state = '', taxRateOverride = null }) {
  const override = normalizeTaxRate(taxRateOverride);
  if (override !== null) {
    return { rate: override, status: 'manual_override', key: null, note: 'Manual verified checkout/tax override.' };
  }

  const cc = String(country || '').trim().toUpperCase();
  const region = String(state || '').trim().toUpperCase();
  const subdivisionKey = cc && region ? `${cc}-${region}` : '';
  const observed = subdivisionKey ? taxes.observedRates?.[subdivisionKey] : null;
  if (observed && Number.isFinite(Number(observed.rate))) {
    return {
      rate: Number(observed.rate),
      status: observed.status || 'verified_checkout',
      key: subdivisionKey,
      note: observed.note || ''
    };
  }

  const countryConfig = cc ? taxes.countryRates?.[cc] : null;
  if (countryConfig && Number.isFinite(Number(countryConfig.rate))) {
    return {
      rate: Number(countryConfig.rate),
      status: countryConfig.status || 'verified_country',
      key: cc,
      note: countryConfig.note || ''
    };
  }

  return {
    rate: null,
    status: 'unverified',
    key: subdivisionKey || cc || null,
    note: 'Sensaria checkout tax has not been verified for this destination/account.'
  };
}

export function basicShippingRateUsdForZone({ format, size, zone }) {
  const group = sensariaShippingGroupFor({ format, size });
  const normalizedZone = String(zone || '').trim().toUpperCase();
  if (!normalizedZone || normalizedZone === 'UNDELIVERABLE') return null;
  const value = shipping.basicRatesUsd?.[group]?.[normalizedZone];
  return value === null || value === undefined ? null : Number(value);
}

export function basicShippingRateUsd({ format, size, country, state = '' }) {
  const zone = shippingZoneForAddress({ country, state });
  if (!zone) return null;
  return basicShippingRateUsdForZone({ format, size, zone });
}

export function variantProductCostUsd({ format, size }) {
  const f = normalizeFormat(format);
  const s = normalizeSize(size);
  const value = costs?.[f]?.[s];
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

export function regularRetailPriceCad({ format, size }) {
  const f = normalizeFormat(format);
  const s = normalizeSize(size);
  const value = SILVIA_RETAIL_PRICE_LADDER_CAD?.[f]?.[s];
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

export function saleRetailPriceCad({ format, size }) {
  const regular = regularRetailPriceCad({ format, size });
  if (regular === null) return null;
  return Number((regular * (1 - SILVIA_SALE_DISCOUNT_PERCENT / 100)).toFixed(2));
}

export function regularRetailPriceUsd({ format, size }) {
  const f = normalizeFormat(format);
  const s = normalizeSize(size);
  const value = SILVIA_RETAIL_PRICE_LADDER_USD?.[f]?.[s];
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

export function saleRetailPriceUsd({ format, size }) {
  const regular = regularRetailPriceUsd({ format, size });
  if (regular === null) return null;
  return Number((regular * (1 - SILVIA_SALE_DISCOUNT_PERCENT / 100)).toFixed(2));
}

export function pricingForZone({
  format,
  size,
  zone,
  customerPaysShipping = false,
  taxRate = null,
  taxStatus = 'unverified'
}) {
  const f = normalizeFormat(format);
  const s = normalizeSize(size);
  const normalizedTaxRate = normalizeTaxRate(taxRate);
  const regularPriceCad = regularRetailPriceCad({ format: f, size: s });
  const salePriceCad = saleRetailPriceCad({ format: f, size: s });
  const regularPriceUsd = regularRetailPriceUsd({ format: f, size: s });
  const salePriceUsd = saleRetailPriceUsd({ format: f, size: s });
  const productCostUsd = variantProductCostUsd({ format: f, size: s });
  const shippingGroup = sensariaShippingGroupFor({ format: f, size: s });
  const shippingCostUsd = basicShippingRateUsdForZone({ format: f, size: s, zone });

  if (regularPriceUsd === null || salePriceUsd === null || productCostUsd === null) {
    throw new Error(`Pricing is not configured for ${f} ${s}`);
  }

  const customerShippingUsd = customerPaysShipping && shippingCostUsd !== null ? shippingCostUsd : 0;
  const totalCustomerRevenueUsd = Number((salePriceUsd + customerShippingUsd).toFixed(2));
  const totalFulfillmentCostBeforeTaxUsd = shippingCostUsd === null
    ? null
    : Number((productCostUsd + shippingCostUsd).toFixed(2));
  const profitBeforeTaxUsd = totalFulfillmentCostBeforeTaxUsd === null
    ? null
    : Number((totalCustomerRevenueUsd - totalFulfillmentCostBeforeTaxUsd).toFixed(2));
  const freeShippingProfitBeforeTaxUsd = totalFulfillmentCostBeforeTaxUsd === null
    ? null
    : Number((salePriceUsd - totalFulfillmentCostBeforeTaxUsd).toFixed(2));

  const sensariaTaxUsd = normalizedTaxRate === null || totalFulfillmentCostBeforeTaxUsd === null
    ? null
    : Number((totalFulfillmentCostBeforeTaxUsd * normalizedTaxRate).toFixed(2));
  const trueFulfillmentCostUsd = sensariaTaxUsd === null || totalFulfillmentCostBeforeTaxUsd === null
    ? null
    : Number((totalFulfillmentCostBeforeTaxUsd + sensariaTaxUsd).toFixed(2));
  const profitAfterTaxUsd = trueFulfillmentCostUsd === null
    ? null
    : Number((totalCustomerRevenueUsd - trueFulfillmentCostUsd).toFixed(2));
  const freeShippingProfitAfterTaxUsd = trueFulfillmentCostUsd === null
    ? null
    : Number((salePriceUsd - trueFulfillmentCostUsd).toFixed(2));

  return {
    format: f,
    size: s,
    zone,
    shippingGroup,
    regularPriceCad,
    salePriceCad,
    regularPriceUsd,
    saleDiscountPercent: SILVIA_SALE_DISCOUNT_PERCENT,
    salePriceUsd,
    productCostUsd,
    shippingCostUsd,
    customerShippingUsd,
    totalCustomerRevenueUsd,
    totalFulfillmentCostBeforeTaxUsd,
    profitBeforeTaxUsd,
    profitBeforeTaxMargin: profitBeforeTaxUsd === null ? null : Number((profitBeforeTaxUsd / salePriceUsd).toFixed(4)),
    taxRate: normalizedTaxRate,
    taxStatus,
    sensariaTaxUsd,
    trueFulfillmentCostUsd,
    profitAfterTaxUsd,
    profitAfterTaxMargin: profitAfterTaxUsd === null ? null : Number((profitAfterTaxUsd / salePriceUsd).toFixed(4)),
    freeShippingProfitBeforeTaxUsd,
    freeShippingProfitAfterTaxUsd,
    freeShippingAfterTaxMargin: freeShippingProfitAfterTaxUsd === null ? null : Number((freeShippingProfitAfterTaxUsd / salePriceUsd).toFixed(4)),
    totalFulfillmentCostUsd: totalFulfillmentCostBeforeTaxUsd,
    profitUsd: profitBeforeTaxUsd,
    profitMarginOnProductPrice: profitBeforeTaxUsd === null ? null : Number((profitBeforeTaxUsd / salePriceUsd).toFixed(4)),
    freeShippingProfitUsd: freeShippingProfitBeforeTaxUsd,
    freeShippingMargin: freeShippingProfitBeforeTaxUsd === null ? null : Number((freeShippingProfitBeforeTaxUsd / salePriceUsd).toFixed(4)),
    shippingPolicy: shipping.policy.customerShipping
  };
}

export function pricingForAddress({
  format,
  size,
  country,
  state = '',
  customerPaysShipping = false,
  taxRateOverride = null
}) {
  const zone = shippingZoneForAddress({ country, state });
  if (!zone) throw new Error(`No Sensaria shipping zone found for ${country}${state ? ` / ${state}` : ''}`);
  const tax = sensariaTaxRateForAddress({ country, state, taxRateOverride });
  return pricingForZone({
    format,
    size,
    zone,
    customerPaysShipping,
    taxRate: tax.rate,
    taxStatus: tax.status
  });
}

export function pricingCatalogForZone(
  zone = '2A',
  { taxRate = null, taxStatus = 'unverified', customerPaysShipping = false } = {}
) {
  const rows = [];
  for (const format of ['P','C','FC']) {
    for (const size of Object.keys(SILVIA_RETAIL_PRICE_LADDER_USD[format] || {})) {
      rows.push(pricingForZone({
        format,
        size,
        zone,
        customerPaysShipping,
        taxRate,
        taxStatus
      }));
    }
  }
  return rows;
}

export function profitabilityMarkets() {
  return (profitability.markets || []).map((market) => ({ ...market }));
}

export function profitabilityMarketForKey(key = 'CA') {
  const target = String(key || 'CA').trim().toUpperCase();
  return profitabilityMarkets().find((market) => String(market.key || '').toUpperCase() === target) || null;
}

export function pricingCatalogForMarket(key = 'CA') {
  const market = profitabilityMarketForKey(key);
  if (!market) throw new Error(`Unknown Silvia profitability market: ${key}`);
  return {
    market,
    rows: pricingCatalogForZone(market.zone, {
      taxRate: market.planningTaxRate,
      taxStatus: market.taxStatus,
      customerPaysShipping: false
    })
  };
}

export function publicShippingPricingConfig() {
  return {
    source: shipping.source,
    policy: shipping.policy,
    zones: shipping.zones,
    basicRatesUsd: shipping.basicRatesUsd,
    tax: {
      source: taxes.source,
      policy: taxes.policy,
      observedRates: taxes.observedRates
    },
    saleDiscountPercent: SILVIA_SALE_DISCOUNT_PERCENT,
    cadPerUsd: SILVIA_REFERENCE_CAD_PER_USD,
    profitability: {
      policy: profitability.policy,
      markets: profitabilityMarkets()
    }
  };
}
