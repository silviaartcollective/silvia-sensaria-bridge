import { scanProdigiSilviaCatalog } from './prodigi.mjs';
import { estimateSupplierLandedCost, landedCostPolicy } from './landed-cost.mjs';
import { loadRetailCatalogLookup, withEstimatedMargin, profitScenarioPolicy } from './retail-margin.mjs';
import {
  getPrintShrimpPricing,
  PRINTSHRIMP_PRINT_SIZES,
  PRINTSHRIMP_PRINT_PAPER_TYPE,
  printShrimpPriceRow
} from './printshrimp.mjs';

const FX_TTL_MS = 6 * 60 * 60 * 1000;
let gbpUsdCache = null;

function numeric(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function roundMoney(value) {
  if (value === null || value === undefined || value === '') return null;
  return Number.isFinite(Number(value)) ? Math.round(Number(value) * 100) / 100 : null;
}

export async function getGbpToUsdRate() {
  const override = Number(process.env.PRINTSHRIMP_GBP_TO_USD || '');
  if (Number.isFinite(override) && override > 0) {
    return { rate: override, date: null, source: 'PRINTSHRIMP_GBP_TO_USD environment override' };
  }

  const now = Date.now();
  if (gbpUsdCache && now - gbpUsdCache.fetchedAt < FX_TTL_MS) return gbpUsdCache.value;

  const response = await fetch('https://api.frankfurter.dev/v2/rate/gbp/usd', {
    headers: { Accept: 'application/json' }
  });
  if (!response.ok) throw new Error(`FX API ${response.status}`);
  const data = await response.json();
  const rate = Number(data?.rate);
  if (!Number.isFinite(rate) || rate <= 0) throw new Error('FX API returned no valid GBP/USD rate');

  const value = { rate, date: data?.date || null, source: 'Frankfurter' };
  gbpUsdCache = { fetchedAt: now, value };
  return value;
}

function supplierRecord({
  provider, eligible, status, totalUsd = null, originalTotal = null,
  currency = 'USD', productCost = null, shippingCost = null,
  reason = '', basis = '', meta = {}
}) {
  return {
    provider,
    eligible: Boolean(eligible),
    status: status || (eligible ? 'available' : 'unavailable'),
    totalUsd: roundMoney(totalUsd),
    originalTotal: roundMoney(originalTotal),
    currency,
    productCost: roundMoney(productCost),
    shippingCost: roundMoney(shippingCost),
    reason,
    basis,
    meta
  };
}

function sensariaRecord(row) {
  const item = row?.sensaria || {};
  const total = numeric(item.totalBeforeTax);
  return supplierRecord({
    provider: 'Sensaria',
    eligible: total != null,
    status: total != null ? 'available' : 'unavailable',
    totalUsd: total,
    originalTotal: total,
    currency: 'USD',
    productCost: item.productionCost,
    shippingCost: item.shippingCost,
    reason: total != null ? '' : 'No Sensaria comparison cost is configured for this variant.',
    basis: 'Production + captured Basic shipping before tax/duties.',
    meta: {
      productKey: item.productKey || '',
      friendlySku: item.friendlySku || '',
      shippingGroup: item.shippingGroup || ''
    }
  });
}

function prodigiRecord(row) {
  const total = numeric(row?.totalBeforeTax);
  return supplierRecord({
    provider: 'Prodigi',
    eligible: !row?.error && total != null,
    status: row?.error ? 'error' : total != null ? 'available' : 'unavailable',
    totalUsd: total,
    originalTotal: total,
    currency: row?.currency || 'USD',
    productCost: row?.productionCost,
    shippingCost: row?.shippingCost,
    reason: row?.error || (total != null ? '' : 'No live Prodigi quote was returned.'),
    basis: 'Live Quote API product + shipping before tax.',
    meta: {
      sku: row?.sku || '',
      shippingMethod: row?.shippingMethod || '',
      fulfillmentLocations: row?.fulfillmentLocations || []
    }
  });
}

function arteloRecord() {
  return supplierRecord({
    provider: 'Artelo',
    eligible: false,
    status: 'not-offered',
    reason: 'Silvia currently sells Poster, Canvas and Framed Canvas. The current Artelo mapping is for framed posters, so it is intentionally not scored.'
  });
}

function printShrimpRecord(row, pricing, fx) {
  if (row?.productCode !== 'P') {
    return supplierRecord({
      provider: 'PrintShrimp',
      eligible: false,
      status: 'not-offered',
      reason: 'Current Silvia comparison maps PrintShrimp only to unframed posters.'
    });
  }

  if (!PRINTSHRIMP_PRINT_SIZES.includes(row.size)) {
    return supplierRecord({
      provider: 'PrintShrimp',
      eligible: false,
      status: 'unsupported-size',
      reason: 'Poster size is not in the current PrintShrimp API order-size mapping.'
    });
  }

  const priceRow = printShrimpPriceRow(pricing, row.size);
  const print = priceRow?.print;
  const product = numeric(print?.price);
  const shipping = numeric(print?.shipping);
  const currency = String(pricing?.currency || '').toUpperCase();
  const original = product != null && shipping != null ? product + shipping : null;
  const rate = numeric(fx?.rate);
  const totalUsd = original == null ? null :
    currency === 'USD' ? original :
    currency === 'GBP' && rate != null ? original * rate : null;

  return supplierRecord({
    provider: 'PrintShrimp',
    eligible: Boolean(print && totalUsd != null),
    status: !print || original == null ? 'unavailable' :
      !currency ? 'currency-unverified' :
      totalUsd == null ? 'fx-unavailable' : 'available',
    totalUsd,
    originalTotal: original,
    currency,
    productCost: product,
    shippingCost: shipping,
    reason: !print || original == null ? 'Live API print price or shipping is missing.' :
      !currency ? 'PrintShrimp API currency is missing.' :
      totalUsd == null ? 'GBP/USD conversion is unavailable.' : '',
    basis: 'Live country-specific PrintShrimp poster price + one-order shipping.',
    meta: {
      productType: 'Print',
      paperType: PRINTSHRIMP_PRINT_PAPER_TYPE,
      gbpToUsd: rate,
      fxDate: fx?.date || null,
      fxSource: fx?.source || '',
      shippingBasis: 'Single-item comparison; PrintShrimp documents shipping as charged once per order.'
    }
  });
}

export function mergeSupplierComparisonRows({
  prodigiRows = [], printShrimpPricing = null, gbpUsd = null, riskPolicy = null
} = {}) {
  return (prodigiRows || []).map(row => {
    const rawSuppliers = {
      sensaria: sensariaRecord(row),
      prodigi: prodigiRecord(row),
      artelo: arteloRecord(row),
      printshrimp: printShrimpRecord(row, printShrimpPricing, gbpUsd)
    };

    const suppliers = riskPolicy
      ? Object.fromEntries(Object.entries(rawSuppliers).map(([name, record]) => [
          name, estimateSupplierLandedCost(record, { countryCode: row.countryCode, policy: riskPolicy })
        ]))
      : rawSuppliers;

    const eligible = Object.values(suppliers)
      .filter(item => item.eligible && numeric(item.modeledLandedUsd ?? item.totalUsd) != null)
      .sort((a, b) => (a.modeledLandedUsd ?? a.totalUsd) - (b.modeledLandedUsd ?? b.totalUsd));

    const winner = eligible[0] || null;
    const runner = eligible[1] || null;
    const winnerCost = winner ? (winner.modeledLandedUsd ?? winner.totalUsd) : null;

    return {
      countryCode: row.countryCode,
      country: row.country,
      productCode: row.productCode,
      product: row.product,
      size: row.size,
      finishCode: row.finishCode,
      finish: row.finish,
      sku: row.sku,
      suppliers,
      winner: winner?.provider || '',
      winnerTotalUsd: winnerCost,
      winnerQuotedUsd: winner?.totalUsd ?? null,
      savingsVsNextBestUsd: winner && runner
        ? roundMoney((runner.modeledLandedUsd ?? runner.totalUsd) - winnerCost)
        : null,
      eligibleSupplierCount: eligible.length,
      comparisonStatus: eligible.length ? 'ready' : 'no-eligible-supplier'
    };
  });
}

export async function scanSupplierComparison({
  countryCodes = ['CA'],
  productCodes = ['P', 'C', 'FC'],
  copies = 1,
  shippingMethod,
  sensariaProducts = {}
} = {}) {
  const countries = [...new Set((countryCodes || [])
    .map(code => String(code || '').trim().toUpperCase()).filter(Boolean))];
  const products = [...new Set((productCodes || [])
    .map(code => String(code || '').trim().toUpperCase()).filter(Boolean))];

  const allowed = new Set(['P', 'C', 'FC']);
  for (const code of products) {
    if (!allowed.has(code)) throw new Error(`Unsupported Silvia comparison product code: ${code}`);
  }

  const rows = [];
  const countryMeta = [];
  const retailLookup = loadRetailCatalogLookup();
  const marginPolicy = profitScenarioPolicy();

  for (const countryCode of countries) {
    const needsPrintShrimp = products.includes('P');
    const [prodigiResult, printShrimpResult, fxResult] = await Promise.all([
      scanProdigiSilviaCatalog({
        countryCodes: [countryCode],
        productCodes: products,
        copies,
        shippingMethod,
        sensariaProducts
      }),
      needsPrintShrimp
        ? getPrintShrimpPricing(countryCode).catch(error => ({ error: error.message, sizes: [], currency: 'GBP' }))
        : Promise.resolve(null),
      needsPrintShrimp
        ? getGbpToUsdRate().catch(error => ({ error: error.message, rate: null, source: 'unavailable' }))
        : Promise.resolve(null)
    ]);

    const merged = mergeSupplierComparisonRows({
      prodigiRows: prodigiResult.rows || [],
      printShrimpPricing: printShrimpResult,
      gbpUsd: fxResult,
      riskPolicy: landedCostPolicy()
    });

    rows.push(...merged.map(row => withEstimatedMargin(row, retailLookup, marginPolicy)));
    countryMeta.push({
      countryCode,
      printShrimpError: printShrimpResult?.error || '',
      fxError: fxResult?.error || '',
      gbpToUsd: numeric(fxResult?.rate),
      fxDate: fxResult?.date || null,
      fxSource: fxResult?.source || null
    });
  }

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    configuration: {
      countries,
      products,
      copies,
      comparisonCurrency: 'USD',
      costBasis: 'quoted costs plus configured planning contingencies, not verified landed invoices',
      riskPolicy: landedCostPolicy(),
      marginPolicy,
      shippingMethod: shippingMethod || 'cheapest available'
    },
    note: 'Winner uses the lowest eligible risk-adjusted single-item supplier estimate in USD. Scans are planning-only and never submit an order or change live fulfillment.',
    countryMeta,
    rows
  };
}
