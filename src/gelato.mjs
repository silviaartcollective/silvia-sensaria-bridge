const DEFAULT_PRODUCT_BASE = 'https://product.gelatoapis.com/v3';
const DEFAULT_SHIPMENT_BASE = 'https://shipment.gelatoapis.com/v1';

function cleanBase(value, fallback) {
  return String(value || fallback).trim().replace(/\/+$/, '');
}

function apiKey() {
  return String(process.env.GELATO_API_KEY || '').trim();
}

function productBase() {
  return cleanBase(process.env.GELATO_PRODUCT_API_URL, DEFAULT_PRODUCT_BASE);
}

function shipmentBase() {
  return cleanBase(process.env.GELATO_SHIPMENT_API_URL, DEFAULT_SHIPMENT_BASE);
}

export function gelatoConfigStatus() {
  return {
    ready: Boolean(apiKey()),
    apiKeyConfigured: Boolean(apiKey()),
    productApiBaseUrl: productBase(),
    shipmentApiBaseUrl: shipmentBase(),
    authentication: 'X-API-KEY',
    catalogReadEnabled: Boolean(apiKey()),
    liveSubmissionEnabled: false
  };
}

function cleanErrorBody(text) {
  const value = String(text || '').trim();
  if (!value) return '';
  try {
    const parsed = JSON.parse(value);
    return parsed?.message || parsed?.error || parsed?.detail || value.slice(0, 1000);
  } catch {
    return value.slice(0, 1000);
  }
}

async function gelatoRequest(url, { method = 'GET', body } = {}) {
  const key = apiKey();
  if (!key) throw new Error('GELATO_API_KEY is not configured');

  const response = await fetch(url, {
    method,
    headers: {
      'X-API-KEY': key,
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json;charset=utf-8' } : {})
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });

  const text = await response.text();
  if (!response.ok) {
    const detail = cleanErrorBody(text);
    throw new Error(`Gelato API ${response.status}${detail ? `: ${detail}` : ''}`);
  }
  if (!text) return null;
  return JSON.parse(text);
}

export async function listGelatoCatalogs() {
  const response = await gelatoRequest(`${productBase()}/catalogs`);
  const catalogs = Array.isArray(response) ? response :
    Array.isArray(response?.catalogs) ? response.catalogs :
    Array.isArray(response?.data) ? response.data : null;
  if (!catalogs) {
    throw new Error('Gelato catalog API returned an unexpected structure; cannot confirm product availability.');
  }
  return catalogs;
}

export async function getGelatoCatalog(catalogUid) {
  const id = String(catalogUid || '').trim();
  if (!id) throw new Error('Gelato catalog UID is required');
  return gelatoRequest(`${productBase()}/catalogs/${encodeURIComponent(id)}`);
}

export async function searchGelatoProducts(
  catalogUid,
  { attributeFilters = {}, limit = 100, offset = 0 } = {}
) {
  const id = String(catalogUid || '').trim();
  if (!id) throw new Error('Gelato catalog UID is required');

  return gelatoRequest(
    `${productBase()}/catalogs/${encodeURIComponent(id)}/products:search`,
    {
      method: 'POST',
      body: {
        attributeFilters,
        limit: Math.min(Math.max(Number(limit) || 100, 1), 100),
        offset: Math.max(Number(offset) || 0, 0)
      }
    }
  );
}

export async function getGelatoProductPrices(
  productUid,
  { country, currency = 'USD', pageCount } = {}
) {
  const uid = String(productUid || '').trim();
  if (!uid) throw new Error('Gelato product UID is required');

  const query = new URLSearchParams();
  if (country) query.set('country', String(country).trim().toUpperCase());
  if (currency) query.set('currency', String(currency).trim().toUpperCase());
  if (pageCount != null) query.set('pageCount', String(pageCount));

  const suffix = query.toString() ? `?${query}` : '';
  return gelatoRequest(
    `${productBase()}/products/${encodeURIComponent(uid)}/prices${suffix}`
  );
}

export async function getGelatoShipmentPrices({
  country,
  currency = 'USD',
  products = [],
  isBusiness = false,
  isPrivate = true,
  hasTracking
} = {}) {
  const countryCode = String(country || '').trim().toUpperCase();
  if (!countryCode) throw new Error('Gelato destination country is required');
  if (!Array.isArray(products) || !products.length) {
    throw new Error('At least one Gelato product is required');
  }

  const body = {
    currency: String(currency || 'USD').trim().toUpperCase(),
    country: countryCode,
    isBusiness: Boolean(isBusiness),
    isPrivate: Boolean(isPrivate),
    products: products.map((item) => ({
      productUid: String(item?.productUid || '').trim(),
      ...(item?.pageCount != null ? { pageCount: Number(item.pageCount) } : {}),
      quantities: Array.isArray(item?.quantities) && item.quantities.length
        ? item.quantities.map(value => Number(value)).filter(Number.isFinite)
        : [1]
    }))
  };

  if (hasTracking !== undefined) body.hasTracking = Boolean(hasTracking);
  if (body.products.some((item) => !item.productUid)) {
    throw new Error('Every Gelato shipment-price product needs a productUid');
  }

  return gelatoRequest(`${shipmentBase()}/prices:search`, {
    method: 'POST',
    body
  });
}

export async function getGelatoOrderTracking(orderId) {
  const id = String(orderId || '').trim();
  if (!/^[a-zA-Z0-9_-]{5,100}$/.test(id)) throw new Error('Valid Gelato order ID required');
  return gelatoRequest('https://order.gelatoapis.com/v4/orders/' + encodeURIComponent(id));
}

export async function testGelatoConnection() {
  const catalogs = await listGelatoCatalogs();
  return {
    ok: true,
    catalogCount: catalogs.length,
    catalogs: catalogs.map((item) => ({
      uid: item?.catalogUid || '',
      title: item?.title || ''
    }))
  };
}
