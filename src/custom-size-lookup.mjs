import { readFileSync } from 'node:fs';
import { getSensariaComparison, validateProdigiOrderQuote } from './prodigi.mjs';
import { scanPrintifyComparisonRows } from './printify-comparison.mjs';
import { scanGelatoComparisonRows } from './gelato-comparison.mjs';
import { getPrintShrimpPricing, printShrimpPriceRow } from './printshrimp.mjs';
import { getGbpToUsdRate } from './supplier-comparison.mjs';
import { estimateSupplierLandedCost, landedCostPolicy } from './landed-cost.mjs';
import { profitScenarioPolicy } from './retail-margin.mjs';
import {
  suggestedCustomRetail, profitAtRetail, referenceRetailForSize,
  recommendedCustomShippingCharge
} from './custom-size-profit.mjs';
import {
  SILVIA_SALE_DISCOUNT_PERCENT,
  SILVIA_RETAIL_PRICE_LADDER_CAD,
  SILVIA_REFERENCE_CAD_PER_USD,
  SILVIA_POSTER_ETSY_CAD_PER_USD
} from './variants.mjs';
import { getArteloUnframedPosterCost } from './artelo.mjs';

const sensariaCatalog = JSON.parse(
  readFileSync(new URL('../config/sensaria-custom-catalog.json', import.meta.url), 'utf8')
);

function numeric(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n)
    ? Math.round((n + Number.EPSILON) * 100) / 100
    : null;
}

function normalizeSize(width, height) {
  const a = Number(width);
  const b = Number(height);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) {
    throw new Error('Width and height must be positive numbers in inches.');
  }
  if (a > 120 || b > 120) throw new Error('Custom size lookup is limited to 120 inches per side.');
  const low = Math.min(a, b);
  const high = Math.max(a, b);
  const fmt = value => Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
  return `${fmt(low)}x${fmt(high)}`;
}

function normalizeCountry(value) {
  const country = String(value || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) {
    throw new Error('Enter a two-letter country code such as CA, US, GB or IL.');
  }
  return country;
}

function normalizeProduct(value) {
  const product = String(value || '').trim().toUpperCase();
  if (!['P', 'C', 'FC'].includes(product)) throw new Error('Product must be Poster, Canvas or Framed Canvas.');
  return product;
}

function normalizeFrame(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return '';
  if (/black/.test(text)) return 'Black';
  if (/white/.test(text)) return 'White';
  if (/natural|oak/.test(text)) return 'Natural';
  if (/brown|dark|walnut/.test(text)) return 'Brown';
  throw new Error('Frame must be Black, White, Natural or Brown.');
}

function finishCode(frame) {
  if (frame === 'Black') return 'BLK';
  if (frame === 'White') return 'WHT';
  if (frame === 'Natural') return 'NAT';
  if (frame === 'Brown') return 'DWD';
  return 'NONE';
}

function providerRecord({
  provider,
  eligible = false,
  status = 'unavailable',
  totalUsd = null,
  productCost = null,
  shippingCost = null,
  currency = 'USD',
  originalTotal = null,
  reason = '',
  basis = '',
  meta = {}
} = {}) {
  return {
    provider,
    eligible: Boolean(eligible),
    status,
    totalUsd: round(totalUsd),
    originalTotal: round(originalTotal ?? totalUsd),
    productCost: round(productCost),
    shippingCost: round(shippingCost),
    currency,
    reason,
    basis,
    meta
  };
}

function sensariaItem(productCode, size, frame) {
  const rows = sensariaCatalog?.[productCode] || [];
  if (productCode === 'FC') {
    return rows.find(row =>
      String(row?.[0]) === size &&
      String(row?.[1]).toLowerCase() === String(frame || '').toLowerCase()
    ) || null;
  }
  return rows.find(row => String(row?.[0]) === size) || null;
}

function sensariaRecord({ productCode, size, frame, countryCode }) {
  const item = sensariaItem(productCode, size, frame);
  if (!item) {
    return providerRecord({
      provider: 'Sensaria',
      status: 'unsupported-size',
      reason: 'This exact product/size was not found in the captured full Sensaria catalog.'
    });
  }

  const price = productCode === 'FC' ? Number(item[3]) : Number(item[2]);
  const sku = productCode === 'FC' ? String(item[2]) : String(item[1]);
  const productId = productCode === 'FC' ? String(item[4]) : String(item[3]);
  const code = finishCode(frame);
  const configFinish = productCode === 'FC' && code === 'DWD' ? 'BRN' : code;
  const productKey = `${productCode}|${size}|${configFinish}`;
  const entry = {
    productCode,
    product: productCode === 'P' ? 'Poster' : productCode === 'C' ? 'Canvas' : 'Framed Canvas',
    size,
    finishCode: code,
    finish: frame || '—',
    sku: ''
  };
  const comparison = getSensariaComparison({
    countryCode,
    entry,
    sensariaProducts: {
      [productKey]: {
        costUsd: price,
        friendlySku: sku
      }
    }
  });

  const total = numeric(comparison?.totalBeforeTax);
  return providerRecord({
    provider: 'Sensaria',
    eligible: total != null,
    status: total != null ? 'available' : 'shipping-unavailable',
    totalUsd: total,
    productCost: price,
    shippingCost: comparison?.shippingCost,
    reason: total != null
      ? ''
      : 'Exact Sensaria product exists, but no captured Sensaria shipping zone/rate is available for this country.',
    basis: 'Captured Sensaria full catalog production price + captured Basic shipping zone.',
    meta: {
      sku,
      productId,
      shippingZone: comparison?.shippingZone || '',
      shippingGroup: comparison?.shippingGroup || '',
      catalogCapturedAt: sensariaCatalog?.capturedAt || ''
    }
  });
}

function prodigiSku(productCode, size) {
  const suffix = String(size).toUpperCase();
  if (productCode === 'P') return `GLOBAL-FAP-${suffix}`;
  if (productCode === 'C') return `GLOBAL-CAN-${suffix}`;
  return `GLOBAL-FRA-CAN-${suffix}`;
}

function prodigiAttributes(productCode, frame) {
  if (productCode === 'C') return { wrap: 'MirrorWrap' };
  if (productCode === 'FC') {
    return {
      frameColour: frame === 'Brown' ? 'Brown' : frame
    };
  }
  return {};
}

async function prodigiRecord({ productCode, size, frame, countryCode }) {
  const sku = prodigiSku(productCode, size);
  try {
    const quote = await validateProdigiOrderQuote({
      countryCode,
      items: [{
        sku,
        copies: 1,
        attributes: prodigiAttributes(productCode, frame)
      }],
      currencyCode: 'USD'
    });
    const total = numeric(quote?.totalBeforeTax);
    return providerRecord({
      provider: 'Prodigi',
      eligible: total != null,
      status: total != null ? 'available' : 'price-unavailable',
      totalUsd: total,
      productCost: quote?.productionCost,
      shippingCost: quote?.shippingCost,
      currency: quote?.currency || 'USD',
      reason: total == null ? 'Prodigi returned no complete product + shipping quote.' : '',
      basis: 'Live Prodigi Quote API for the exact SKU and destination country.',
      meta: {
        sku,
        shippingMethod: quote?.shippingMethod || '',
        availableMethods: quote?.availableMethods || [],
        resolvedItems: quote?.resolvedItems || []
      }
    });
  } catch (error) {
    return providerRecord({
      provider: 'Prodigi',
      status: /404|not found|no product/i.test(String(error?.message || ''))
        ? 'unsupported-size'
        : 'unavailable',
      reason: error?.message || String(error),
      meta: { sku }
    });
  }
}

async function printifyRecord(row, countryCode) {
  try {
    const records = await scanPrintifyComparisonRows({ rows: [row], countryCode, fresh: true });
    const record = [...records.values()][0];
    return record || providerRecord({
      provider: 'Printify',
      status: 'unavailable',
      reason: 'Printify returned no comparison record.'
    });
  } catch (error) {
    return providerRecord({
      provider: 'Printify',
      status: 'error',
      reason: error?.message || String(error)
    });
  }
}

async function gelatoRecord(row, countryCode) {
  try {
    const records = await scanGelatoComparisonRows({ rows: [row], countryCode, fresh: true });
    const record = [...records.values()][0];
    return record || providerRecord({
      provider: 'Gelato',
      status: 'unavailable',
      reason: 'Gelato returned no comparison record.'
    });
  } catch (error) {
    return providerRecord({
      provider: 'Gelato',
      status: 'error',
      reason: error?.message || String(error)
    });
  }
}

async function printShrimpRecord({ productCode, size, countryCode }) {
  if (productCode !== 'P') {
    return providerRecord({
      provider: 'PrintShrimp',
      status: 'not-offered',
      reason: 'Current PrintShrimp integration is compatible with unframed poster prints, not Canvas or Framed Canvas.'
    });
  }

  try {
    const pricing = await getPrintShrimpPricing(countryCode);
    const row = printShrimpPriceRow(pricing, size);
    const item = row?.print;
    const product = numeric(item?.price);
    const shipping = numeric(item?.shipping);
    if (product == null || shipping == null) {
      return providerRecord({
        provider: 'PrintShrimp',
        status: 'unsupported-size',
        reason: 'PrintShrimp live country pricing did not return this exact poster size.'
      });
    }

    const currency = String(item?.currency || pricing?.currency || 'GBP').toUpperCase();
    let rate = 1;
    let fx = null;
    if (currency === 'GBP') {
      fx = await getGbpToUsdRate();
      rate = numeric(fx?.rate);
    }
    if (currency !== 'USD' && (!Number.isFinite(rate) || rate <= 0)) {
      return providerRecord({
        provider: 'PrintShrimp',
        status: 'fx-unavailable',
        currency,
        productCost: product,
        shippingCost: shipping,
        reason: 'Live PrintShrimp price was returned, but USD conversion is unavailable.'
      });
    }

    const originalTotal = product + shipping;
    const totalUsd = currency === 'USD' ? originalTotal : originalTotal * rate;
    return providerRecord({
      provider: 'PrintShrimp',
      eligible: true,
      status: 'available',
      totalUsd,
      originalTotal,
      productCost: product,
      shippingCost: shipping,
      currency,
      basis: 'Live PrintShrimp destination pricing for one Matte poster + one-order shipping.',
      meta: {
        size: row?.size || size,
        gbpToUsd: currency === 'GBP' ? rate : null,
        fxDate: fx?.date || null,
        vatRate: item?.vat_rate ?? null,
        vatAmount: item?.vat_amount ?? null
      }
    });
  } catch (error) {
    return providerRecord({
      provider: 'PrintShrimp',
      status: 'error',
      reason: error?.message || String(error)
    });
  }
}

async function arteloRecord({ productCode, size, countryCode }) {
  if (productCode !== 'P') {
    return providerRecord({
      provider: 'Artelo',
      status: 'not-offered',
      reason: 'Artelo is used here for unframed Matte Poster only; Canvas and Framed Canvas are not treated as compatible.'
    });
  }

  try {
    const quote = await getArteloUnframedPosterCost({
      countryCode,
      size,
      quantity: 1
    });
    const total = numeric(quote?.totalBeforeTax);
    return providerRecord({
      provider: 'Artelo',
      eligible: total != null,
      status: total != null ? 'available' : 'price-unavailable',
      totalUsd: total,
      originalTotal: total,
      currency: quote?.currency || 'USD',
      productCost: quote?.productionCost,
      shippingCost: quote?.shippingCost,
      reason: total != null ? '' : 'Artelo returned the poster route but no complete production + shipping total.',
      basis: 'Live Artelo catalog cost for IndividualArtPrint, MattePoster, Unframed.',
      meta: {
        apiSize: quote?.apiSize || '',
        productType: 'IndividualArtPrint',
        frameStyle: 'Unframed',
        paperType: 'MattePoster'
      }
    });
  } catch (error) {
    return providerRecord({
      provider: 'Artelo',
      status: /size|unsupported|invalid/i.test(String(error?.message || '')) ? 'unsupported-size' : 'unavailable',
      reason: error?.message || String(error)
    });
  }
}

function priceFloor(adjustedSupplierUsd, quotedSupplierUsd, policy, productCode, size, customerShippingUsd = 0) {
  const referenceRetail = referenceRetailForSize({
    productCode,
    size,
    ladderCad: SILVIA_RETAIL_PRICE_LADDER_CAD,
    cadPerUsd: SILVIA_REFERENCE_CAD_PER_USD,
    posterCadPerUsd: SILVIA_POSTER_ETSY_CAD_PER_USD
  });
  return suggestedCustomRetail({
    planningCostUsd: adjustedSupplierUsd,
    quotedCostUsd: quotedSupplierUsd,
    policy,
    storeDiscountPercent: SILVIA_SALE_DISCOUNT_PERCENT,
    referenceRetail,
    customerShippingUsd
  });
}

// Etsy private custom orders have separate Price and Shipping price fields.
// These are suggested amounts only; this lookup never creates an Etsy listing.
// Some supplier product/shipping breakdowns (e.g. PrintShrimp in GBP) are not
// denominated in USD even when the quoted total is converted to USD.
function supplierShippingUsd(record) {
  const rawShipping = numeric(record?.shippingCost);
  const total = numeric(record?.totalUsd);
  if (rawShipping == null || total == null) return null;
  if (String(record?.currency || 'USD').toUpperCase() === 'USD') return rawShipping;
  const originalTotal = numeric(record?.originalTotal);
  return originalTotal != null && originalTotal > 0
    ? round(rawShipping * (total / originalTotal)) : null;
}

function customShippingThresholdUsd() {
  const raw = process.env.SAC_CUSTOM_SHIPPING_THRESHOLD_USD;
  if (raw == null || String(raw).trim() === '') return 25;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error('Invalid SAC_CUSTOM_SHIPPING_THRESHOLD_USD; enter a nonnegative USD amount');
  }
  return value;
}

function customShippingMethod(value) {
  const result = String(value || 'auto').trim().toLowerCase();
  if (!['auto','included','separate'].includes(result)) {
    throw new Error('Shipping method must be auto, included or separate.');
  }
  return result;
}

export async function lookupCustomSize({
  countryCode,
  productCode,
  width,
  height,
  frame,
  shippingMode = 'auto'
} = {}) {
  const country = normalizeCountry(countryCode);
  const requestedShippingMode = customShippingMethod(shippingMode);
  const product = normalizeProduct(productCode);
  const size = normalizeSize(width, height);
  const resolvedFrame = product === 'FC' ? normalizeFrame(frame) : '';
  if (product === 'FC' && !resolvedFrame) {
    throw new Error('Choose a frame colour for Framed Canvas.');
  }

  const row = {
    countryCode: country,
    productCode: product,
    product: product === 'P' ? 'Poster' : product === 'C' ? 'Canvas' : 'Framed Canvas',
    size,
    finishCode: finishCode(resolvedFrame),
    finish: resolvedFrame || '—',
    sku: ''
  };

  const sensaria = sensariaRecord({
    productCode: product,
    size,
    frame: resolvedFrame,
    countryCode: country
  });

  const [prodigi, printify, gelato, printshrimp, artelo] = await Promise.all([
    prodigiRecord({ productCode: product, size, frame: resolvedFrame, countryCode: country }),
    printifyRecord(row, country),
    gelatoRecord(row, country),
    printShrimpRecord({ productCode: product, size, countryCode: country }),
    arteloRecord({ productCode: product, size, countryCode: country })
  ]);

  const raw = {
    sensaria,
    prodigi,
    printshrimp,
    printify,
    gelato,
    artelo
  };

  const policy = landedCostPolicy();
  const suppliers = Object.fromEntries(
    Object.entries(raw).map(([key, record]) => [
      key,
      estimateSupplierLandedCost(record, { countryCode: country, policy })
    ])
  );

  const ranked = Object.values(suppliers)
    .filter(item => item?.eligible && numeric(item?.modeledLandedUsd ?? item?.totalUsd) != null)
    .sort((a, b) =>
      Number(a.modeledLandedUsd ?? a.totalUsd) - Number(b.modeledLandedUsd ?? b.totalUsd)
    );

  const winner = ranked[0] || null;
  const next = ranked[1] || null;
  const winnerCost = winner ? Number(winner.modeledLandedUsd ?? winner.totalUsd) : null;
  const retailPolicy = profitScenarioPolicy();
  const supplierShipping = winner ? supplierShippingUsd(winner) : null;
  const feePercent = retailPolicy.etsyFeeReservePercent;
  const shippingThresholdUsd = customShippingThresholdUsd();
  const suggestedShippingChargeUsd = supplierShipping == null
    ? null : recommendedCustomShippingCharge(supplierShipping, feePercent);

  // Automatic choice is a SUGGESTION only, not a change to Etsy settings:
  // free shipping for low supplier shipping, separately charged for high.
  const recommendedShippingMode = supplierShipping != null &&
    supplierShipping >= shippingThresholdUsd ? 'separate' : 'included';
  const selectedShippingMode = requestedShippingMode === 'auto'
    ? recommendedShippingMode : requestedShippingMode;

  const makeOption = mode => {
    const shippingCharged = mode === 'separate' ? suggestedShippingChargeUsd : 0;
    const pricing = winner && shippingCharged != null
      ? priceFloor(winnerCost, winner.totalUsd, retailPolicy, product, size, shippingCharged)
      : null;
    const providerProfits = Object.fromEntries(
      Object.entries(suppliers).map(([key, record]) => [
        key,
        pricing && record.eligible && numeric(record.totalUsd) !== null
          ? profitAtRetail({
              quotedCostUsd: record.totalUsd,
              planningCostUsd: record.modeledLandedUsd ?? record.totalUsd,
              salePriceUsd: pricing.salePriceAfterDiscountUsd,
              customerShippingUsd: shippingCharged,
              etsyFeePercent: pricing.etsyFeeReservePercent,
              cadPerUsd: pricing.assumedCadPerUsd
            })
          : null
      ])
    );
    return {
      mode,
      available: Boolean(pricing),
      shippingChargedSeparately: mode === 'separate',
      customerShippingUsd: shippingCharged,
      quotedSupplierShippingUsd: supplierShipping,
      pricing,
      providerProfits,
      label: mode === 'separate' ? 'Customer pays shipping' : 'Free shipping included',
      note: mode === 'separate'
        ? 'Enter this estimated fixed charge in the Shipping price field of Etsy's private custom order. No shipping profile is needed. Verify exact destination costs where possible; standard listings are unchanged.'
        : 'The customer pays no separate delivery charge. All supplier shipping and contingency costs are covered by the artwork price.',
      warning: mode === 'separate' && !pricing
        ? 'A separate customer shipping price cannot be calculated because this supplier has no complete shipping-cost breakdown.'
        : winner?.provider === 'Gelato' && mode === 'separate'
          ? 'Gelato shipping is a country-level estimate. Check the destination postcode before setting the custom Etsy delivery charge.'
          : null
    };
  };

  const shippingOptions = {
    included: makeOption('included'),
    separate: makeOption('separate')
  };
  const currentOption = shippingOptions[selectedShippingMode];
  const pricing = currentOption.pricing;
  const providerProfits = currentOption.providerProfits;

  // All Printify printers are evaluated at the SAME buyer selling price and
  // shipping charge for each scenario, so supplier margins are comparable.
  const printifyOffers = suppliers.printify?.meta?.offers;
  if (Array.isArray(printifyOffers)) {
    for (const offer of printifyOffers) {
      const offeredTotal = numeric(offer.quotedTotalUsd);
      offer.profitByShippingMode = {};
      for (const [mode, option] of Object.entries(shippingOptions)) {
        const p = option.pricing;
        if (offeredTotal == null || !p) {
          offer.profitByShippingMode[mode] = null;
          continue;
        }
        const modeledOffer = estimateSupplierLandedCost({
          provider: 'Printify', eligible: true, currency: 'USD',
          totalUsd: offeredTotal
        }, { countryCode: country, policy });
        offer.profitByShippingMode[mode] = profitAtRetail({
          quotedCostUsd: offeredTotal,
          planningCostUsd: modeledOffer.modeledLandedUsd,
          salePriceUsd: p.salePriceAfterDiscountUsd,
          customerShippingUsd: p.customerShippingUsd,
          etsyFeePercent: p.etsyFeeReservePercent,
          cadPerUsd: p.assumedCadPerUsd
        });
      }
      offer.profit = offer.profitByShippingMode[selectedShippingMode];
    }
  }

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    request: {
      countryCode: country,
      productCode: product,
      product: row.product,
      size,
      frame: resolvedFrame || null
    },
    suppliers,
    ranking: ranked.map((item, index) => ({
      rank: index + 1,
      provider: item.provider,
      modeledLandedUsd: round(item.modeledLandedUsd ?? item.totalUsd),
      quotedTotalUsd: round(item.totalUsd)
    })),
    winner: winner ? {
      provider: winner.provider,
      modeledLandedUsd: round(winnerCost),
      quotedTotalUsd: round(winner.totalUsd),
      savingsVsNextBestUsd: next
        ? round(Number(next.modeledLandedUsd ?? next.totalUsd) - winnerCost)
        : null
    } : null,
    pricing,
    providerProfits,
    requestedShippingMode,
    shippingMode: selectedShippingMode,
    recommendedShippingMode,
    shippingThresholdUsd,
    shippingOptions,
    note: 'Custom lookup is read-only. API providers are queried for this exact size/product/country. Sensaria uses the captured full catalog and captured shipping zones because no equivalent live catalog/quote API is configured. No supplier order is created. These are draft custom-order selling and shipping suggestions; for a private Etsy custom order, enter the intended artwork charge under Price and any delivery charge under Shipping price (US$0 if free). No shipping profile is needed. Check the buyer's final checkout for extra sale or coupon discounts; standard listing shipping remains unchanged.'
  };
}
