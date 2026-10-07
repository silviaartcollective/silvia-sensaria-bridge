// Planning contingencies are NOT statutory tax rates or guaranteed landed costs.
const EU_MARKETS = new Set(['AT','BE','BG','HR','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT','LV','LT','LU','NL','PL','PT','RO','SK','SI','ES','SE']);

function percent(name, fallback) {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === '') return fallback / 100;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`Invalid ${name}: expected a percentage between 0 and 100`);
  }
  return value / 100;
}

function round(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function landedCostPolicy() {
  return {
    sensariaDomesticReserve: percent('SAC_SENSARIA_US_RESERVE_PERCENT', 10),
    sensariaCanadaReserve: percent('SAC_SENSARIA_CANADA_RESERVE_PERCENT', 20),
    sensariaInternationalReserve: percent('SAC_SENSARIA_INTERNATIONAL_RESERVE_PERCENT', 30),
    prodigiUsDomesticReserve: percent('SAC_PRODIGI_US_DOMESTIC_RESERVE_PERCENT', 10),
    prodigiDomesticReserve: percent('SAC_PRODIGI_DOMESTIC_RESERVE_PERCENT', 15),
    prodigiEuReserve: percent('SAC_PRODIGI_EU_RESERVE_PERCENT', 28),
    prodigiCrossBorderReserve: percent('SAC_PRODIGI_CROSS_BORDER_RESERVE_PERCENT', 30),
    arteloTaxReserve: percent('SAC_ARTELO_TAX_RESERVE_PERCENT', 20),
    arteloCanadaReserve: percent('SAC_ARTELO_CANADA_RESERVE_PERCENT', 18),
    arteloEuropeReserve: percent('SAC_ARTELO_EU_RESERVE_PERCENT', 28),
    arteloUsReserve: percent('SAC_ARTELO_US_RESERVE_PERCENT', 10),
    printifyReserve: percent('SAC_PRINTIFY_RESERVE_PERCENT', 20),
    gelatoReserve: percent('SAC_GELATO_RESERVE_PERCENT', 20),
    printShrimpGbpFxReserve: percent('SAC_PRINTSHRIMP_GBP_FX_RESERVE_PERCENT', 2)
  };
}

export function estimateSupplierLandedCost(record, { countryCode, policy = landedCostPolicy() } = {}) {
  if (!record || record.eligible !== true || !Number.isFinite(record.totalUsd)) {
    return { ...record, modeledLandedUsd: null, contingencyUsd: null, contingencyRate: null, costConfidence: 'unavailable' };
  }

  const destination = String(countryCode || '').toUpperCase();
  const provider = record.provider;
  let rate = 0;
  let confidence = 'supplier-quoted';
  let assumptions = '';

  if (provider === 'Sensaria') {
    rate = destination === 'US' ? policy.sensariaDomesticReserve :
      destination === 'CA' ? policy.sensariaCanadaReserve : policy.sensariaInternationalReserve;
    confidence = 'estimated';
    assumptions = 'Sales tax, possible import/brokerage and unverified fulfillment location: planning contingency, not confirmed charges.';
  } else if (provider === 'Prodigi') {
    const locations = record.meta?.fulfillmentLocations || [];
    const sameCountry = locations.length > 0 && locations.every(code => String(code).toUpperCase() === destination);
    rate = !sameCountry ? policy.prodigiCrossBorderReserve :
      destination === 'US' ? policy.prodigiUsDomesticReserve :
      EU_MARKETS.has(destination) ? policy.prodigiEuReserve : policy.prodigiDomesticReserve;
    confidence = 'estimated';
    assumptions = sameCountry
      ? 'Local production indicated; taxes estimated; verify final quote and invoice.'
      : 'Cross-border origin or unknown production location; tax/duties/brokerage contingency. Final charges remain unverified.';
  } else if (provider === 'Artelo') {
    rate = destination === 'US' ? policy.arteloUsReserve :
      destination === 'CA' ? policy.arteloCanadaReserve :
      EU_MARKETS.has(destination) ? policy.arteloEuropeReserve : policy.arteloTaxReserve;
    confidence = 'estimated';
    assumptions = 'Destination tax/import treatment remains unverified. No separate duty reserve is added beyond this planning contingency; verify with an address-specific price check.';
  } else if (provider === 'PrintShrimp') {
    rate = String(record.currency || '').toUpperCase() === 'GBP' ? policy.printShrimpGbpFxReserve : 0;
    confidence = 'supplier-quoted';
    assumptions = 'Supplier states rare import tariffs are covered. GBP quote has an FX/card-conversion contingency; separately assessed local sales tax remains unverified.';
  } else if (provider === 'Printify') {
    rate = policy.printifyReserve;
    confidence = 'estimated';
    assumptions = 'Catalog production + destination shipping are live supplier values. Taxes and final routing can vary by print provider, so a planning reserve is added.';
  } else if (provider === 'Gelato') {
    rate = policy.gelatoReserve;
    confidence = 'estimated';
    assumptions = 'Country-level product and shipment pricing is live supplier data. Final address routing, taxes and regional production can vary, so a planning reserve is added.';
  } else {
    return { ...record, modeledLandedUsd: null, contingencyUsd: null, contingencyRate: null, costConfidence: 'unknown-provider' };
  }

  const contingencyUsd = round(record.totalUsd * rate);
  return {
    ...record,
    contingencyRate: rate,
    contingencyUsd,
    modeledLandedUsd: round(record.totalUsd + contingencyUsd),
    costConfidence: confidence,
    costAssumptions: assumptions
  };
}
