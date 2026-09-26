import { SILVIA_CURRENT_MARKETS } from './markets.mjs';

const ARTELO_API_BASE = 'https://www.artelo.com/api/open';

export const ARTELO_FRAMED_POSTER_SIZES = Object.freeze([
  { label: '8x10', apiSize: 'x8x10' },
  { label: '11x14', apiSize: 'x11x14' },
  { label: '12x16', apiSize: 'x12x16' },
  { label: '12x18', apiSize: 'x12x18' },
  { label: '16x20', apiSize: 'x16x20' },
  { label: '16x24', apiSize: 'x16x24' },
  { label: '18x24', apiSize: 'x18x24' },
  { label: '24x36', apiSize: 'x24x36' }
]);

export { SILVIA_CURRENT_MARKETS };

export const ARTELO_DESTINATIONS = Object.freeze([
  ...SILVIA_CURRENT_MARKETS,
  { code: 'GB', label: 'United Kingdom' },
  { code: 'JP', label: 'Japan' },
  { code: 'KR', label: 'South Korea' }
]);

function token() {
  return String(process.env.ARTELO_API_KEY || '').trim();
}

export function arteloConfigStatus() {
  return {
    ready: Boolean(token()),
    tokenConfigured: Boolean(token()),
    product: {
      catalogProductId: 'IndividualArtPrint',
      frameStyle: 'PremiumOak',
      frameColor: 'WalnutOak',
      paperType: 'MattePoster',
      readyToHang: true
    },
    destinations: ARTELO_DESTINATIONS,
    currentMarkets: SILVIA_CURRENT_MARKETS,
    sizes: ARTELO_FRAMED_POSTER_SIZES.map(item => item.label),
    taxPolicy: {
      mode: 'destination-price-check',
      catalogQuote: 'Production + shipping before tax',
      finalCostEndpoint: '/orders/price-check',
      finalCost: 'Destination-aware price check returns applicable tax fields and final supplier total',
      profitBasis: 'Use price-check total for final order profit; catalog scan remains a planning comparison'
    }
  };
}

function cleanErrorBody(text) {
  const value = String(text || '').trim();
  if (!value) return '';
  try {
    const parsed = JSON.parse(value);
    return parsed?.error_description || parsed?.error || parsed?.message || value;
  } catch {
    return value.slice(0, 800);
  }
}

async function arteloRequest(pathname, { method = 'GET', body } = {}) {
  const apiToken = token();
  if (!apiToken) throw new Error('ARTELO_API_KEY is not configured');

  const url = pathname.startsWith('http')
    ? pathname
    : `${ARTELO_API_BASE}${pathname.startsWith('/') ? '' : '/'}${pathname}`;

  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'User-Agent': 'Silvia-Art-Collective',
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json;charset=utf-8' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await response.text();
  if (!response.ok) {
    const detail = cleanErrorBody(text);
    throw new Error(`Artelo API ${response.status}${detail ? `: ${detail}` : ''}`);
  }
  if (!text) return null;
  return JSON.parse(text);
}

export async function testArteloConnection() {
  const result = await arteloRequest('/authentication/check');
  return { ok: Boolean(result?.success), result };
}

function destinationByCode(code) {
  return ARTELO_DESTINATIONS.find(item => item.code === code) || null;
}

function sizeByLabel(label) {
  return ARTELO_FRAMED_POSTER_SIZES.find(item => item.label === label) || null;
}

function costRequestBody({ countryCode, apiSize, quantity = 1 }) {
  return {
    catalogProductId: 'IndividualArtPrint',
    size: apiSize,
    frameStyle: 'PremiumOak',
    includeMats: false,
    includeFramingService: true,
    includeHangingPins: false,
    paperType: 'MattePoster',
    shippingDestination: countryCode,
    quantity
  };
}


function priceCheckProductInfo(apiSize) {
  return {
    canvasDesignedFor: null,
    canvasBorderStyle: null,
    catalogProductId: 'IndividualArtPrint',
    frameColor: 'WalnutOak',
    includeFramingService: true,
    includeHangingPins: false,
    includeMats: false,
    orientation: 'Vertical',
    paperType: 'MattePoster',
    size: apiSize,
    designs: []
  };
}

export async function getArteloPriceCheck({
  countryCode,
  size,
  quantity = 1,
  address
}) {
  const destination = destinationByCode(String(countryCode || '').toUpperCase());
  if (!destination) throw new Error('Unsupported Artelo price-check destination');

  const sizeConfig = sizeByLabel(String(size || ''));
  if (!sizeConfig) throw new Error('Unsupported Artelo framed-poster size');

  const customerAddress = {
    city: String(address?.city || '').trim(),
    country: destination.code,
    phone: String(address?.phone || '+15555550100').trim(),
    name: String(address?.name || 'Silvia Art Collective Price Check').trim(),
    state: String(address?.state || '').trim(),
    street1: String(address?.street1 || '').trim(),
    zipcode: String(address?.zipcode || '').trim()
  };
  if (!customerAddress.city || !customerAddress.state || !customerAddress.street1 || !customerAddress.zipcode) {
    throw new Error('Artelo tax-aware price check requires city, state/region, street1, and zipcode');
  }

  const raw = await arteloRequest('/orders/price-check', {
    method: 'POST',
    body: {
      orderId: 'silvia-price-check',
      currency: 'USD',
      customerAddress,
      items: [{
        orderItemId: 'framed-poster-price-check',
        productInfo: priceCheckProductInfo(sizeConfig.apiSize),
        quantity,
        unitPrice: 0
      }]
    }
  });

  const costs = raw?.orderCosts || {};
  const productionCost = Number(costs.productionCost);
  const shippingCost = Number(costs.arteloShipping);
  const gst = Number(costs.gst || 0);
  const hst = Number(costs.hst || 0);
  const pst = Number(costs.pst || 0);
  const usSalesTax = Number(costs.usSalesTax || 0);
  const branding = Number(costs.branding || 0);
  const holidayFees = Number(costs.holidayFees || 0);
  const customPricingAdjustment = Number(costs.customPricingAdjustment || 0);
  const wholesaleDiscount = Number(costs.wholesaleDiscount || 0);
  const total = Number(costs.total);

  return {
    ok: true,
    countryCode: destination.code,
    country: destination.label,
    size: sizeConfig.label,
    quantity,
    currency: 'USD',
    productionCost: Number.isFinite(productionCost) ? productionCost : null,
    shippingCost: Number.isFinite(shippingCost) ? shippingCost : null,
    gst: Number.isFinite(gst) ? gst : 0,
    hst: Number.isFinite(hst) ? hst : 0,
    pst: Number.isFinite(pst) ? pst : 0,
    usSalesTax: Number.isFinite(usSalesTax) ? usSalesTax : 0,
    branding: Number.isFinite(branding) ? branding : 0,
    holidayFees: Number.isFinite(holidayFees) ? holidayFees : 0,
    customPricingAdjustment: Number.isFinite(customPricingAdjustment) ? customPricingAdjustment : 0,
    wholesaleDiscount: Number.isFinite(wholesaleDiscount) ? wholesaleDiscount : 0,
    total: Number.isFinite(total) ? total : null,
    raw
  };
}

export async function createArteloOrder(payload = {}) {
  const customerAddress = payload?.customerAddress || {};
  const items = Array.isArray(payload?.items) ? payload.items : [];

  if (!payload?.orderId) throw new Error('Artelo order requires orderId');
  if (!payload?.createdAt) throw new Error('Artelo order requires createdAt');
  if (!payload?.currency) throw new Error('Artelo order requires currency');
  if (!customerAddress?.city || !customerAddress?.country || !customerAddress?.name ||
      !customerAddress?.state || !customerAddress?.street1 || !customerAddress?.zipcode) {
    throw new Error('Artelo order requires a complete customer address');
  }
  if (!items.length) throw new Error('Artelo order requires at least one item');
  if (!Number.isFinite(Number(payload?.total))) throw new Error('Artelo order requires total');

  return arteloRequest('/orders/create', {
    method: 'POST',
    body: payload
  });
}

export async function cancelArteloOrder(id) {
  const orderId = String(id || '').trim();
  if (!orderId) throw new Error('Artelo cancel requires order id');
  return arteloRequest(`/orders/cancel?id=${encodeURIComponent(orderId)}`, {
    method: 'DELETE'
  });
}

export async function validateArteloOrderPriceCheck(payload = {}) {
  const orderId = String(payload?.orderId || '').trim();
  const currency = String(payload?.currency || 'USD').trim().toUpperCase();
  const customerAddress = payload?.customerAddress || {};
  const items = Array.isArray(payload?.items) ? payload.items : [];

  if (!orderId) throw new Error('Artelo validation requires orderId');
  if (!customerAddress?.city || !customerAddress?.country || !customerAddress?.street1 || !customerAddress?.zipcode) {
    throw new Error('Artelo validation requires city, country, street1, and zipcode');
  }
  if (!items.length) throw new Error('Artelo validation requires at least one item');

  // Price validation only needs the product configuration and destination.
  // Do not send artwork source URLs here: Artelo may attempt to process/fetch
  // the design during price-check, which is unnecessary for cost validation
  // and can fail on temporary TEST-only signed artwork URLs.
  const priceCheckItems = items.map(item => ({
    ...item,
    productInfo: item?.productInfo
      ? {
          ...item.productInfo,
          designs: []
        }
      : item?.productInfo
  }));

  const raw = await arteloRequest('/orders/price-check', {
    method: 'POST',
    body: {
      orderId,
      currency,
      customerAddress,
      items: priceCheckItems
    }
  });

  const costs = raw?.orderCosts || {};
  const number = value => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  return {
    ok: true,
    currency,
    productionCost: number(costs.productionCost),
    shippingCost: number(costs.arteloShipping),
    gst: number(costs.gst) || 0,
    hst: number(costs.hst) || 0,
    pst: number(costs.pst) || 0,
    qst: number(costs.qst) || 0,
    usSalesTax: number(costs.usSalesTax) || 0,
    branding: number(costs.branding) || 0,
    holidayFees: number(costs.holidayFees) || 0,
    customPricingAdjustment: number(costs.customPricingAdjustment) || 0,
    wholesaleDiscount: number(costs.wholesaleDiscount) || 0,
    total: number(costs.total),
    raw
  };
}

export async function getArteloCatalogCost({ countryCode, size, quantity = 1 }) {
  const destination = destinationByCode(String(countryCode || '').toUpperCase());
  if (!destination) throw new Error('Unsupported Artelo scan destination');

  const sizeConfig = sizeByLabel(String(size || ''));
  if (!sizeConfig) throw new Error('Unsupported Artelo framed-poster size');

  const raw = await arteloRequest('/catalog/get-costs', {
    method: 'POST',
    body: costRequestBody({
      countryCode: destination.code,
      apiSize: sizeConfig.apiSize,
      quantity
    })
  });

  const productionCost = Number(raw?.productionCost);
  const shippingCost = Number(raw?.shippingCost);

  return {
    countryCode: destination.code,
    country: destination.label,
    size: sizeConfig.label,
    quantity,
    currency: 'USD',
    productionCost: Number.isFinite(productionCost) ? productionCost : null,
    shippingCost: Number.isFinite(shippingCost) ? shippingCost : null,
    totalBeforeTax:
      Number.isFinite(productionCost) && Number.isFinite(shippingCost)
        ? productionCost + shippingCost
        : null,
    raw
  };
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function scanArteloFramedPosters({
  countryCodes = SILVIA_CURRENT_MARKETS.map(item => item.code),
  quantity = 1
} = {}) {
  const wanted = [...new Set(countryCodes.map(code => String(code || '').toUpperCase()).filter(Boolean))];
  const destinations = wanted.map(code => {
    const match = destinationByCode(code);
    if (!match) throw new Error(`Unsupported Artelo scan destination: ${code}`);
    return match;
  });

  const rows = [];
  let requestCount = 0;

  for (const destination of destinations) {
    const countryRows = await Promise.all(
      ARTELO_FRAMED_POSTER_SIZES.map(async size => {
        try {
          return await getArteloCatalogCost({
            countryCode: destination.code,
            size: size.label,
            quantity
          });
        } catch (error) {
          return {
            countryCode: destination.code,
            country: destination.label,
            size: size.label,
            quantity,
            currency: 'USD',
            productionCost: null,
            shippingCost: null,
            totalBeforeTax: null,
            error: error.message
          };
        }
      })
    );

    rows.push(...countryRows);
    requestCount += ARTELO_FRAMED_POSTER_SIZES.length;

    // Artelo permits 50 requests per 10-second fixed window.
    // Pause before crossing that boundary so a full 9-country scan is reliable.
    if (requestCount >= 40 && destination !== destinations[destinations.length - 1]) {
      await wait(10_250);
      requestCount = 0;
    }
  }

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    configuration: {
      catalogProductId: 'IndividualArtPrint',
      frameStyle: 'PremiumOak',
      frameColor: 'WalnutOak',
      paperType: 'MattePoster',
      includeFramingService: true,
      includeMats: false,
      includeHangingPins: false
    },
    note: 'Catalog pricing does not accept frame color; Walnut Oak is assumed to use the same Premium Oak cost. Taxes are not included in /catalog/get-costs. Use /orders/price-check through getArteloPriceCheck for destination-address tax fields.',
    rows
  };
}
