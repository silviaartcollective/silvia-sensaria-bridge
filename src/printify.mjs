const PRINTIFY_API_BASE = 'https://api.printify.com/v1';

function token() {
  return String(process.env.PRINTIFY_API_TOKEN || '').trim();
}

export function printifyConfigStatus() {
  return {
    ready: Boolean(token()),
    tokenConfigured: Boolean(token()),
    apiBaseUrl: PRINTIFY_API_BASE,
    authentication: 'Bearer personal access token'
  };
}

function cleanErrorBody(text) {
  const value = String(text || '').trim();
  if (!value) return '';
  try {
    const parsed = JSON.parse(value);
    return parsed?.message || parsed?.error || value.slice(0, 1000);
  } catch {
    return value.slice(0, 1000);
  }
}

async function printifyRequest(pathname, { method = 'GET', body } = {}) {
  const apiToken = token();
  if (!apiToken) throw new Error('PRINTIFY_API_TOKEN is not configured');

  const url = pathname.startsWith('http')
    ? pathname
    : `${PRINTIFY_API_BASE}${pathname.startsWith('/') ? '' : '/'}${pathname}`;

  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${apiToken}`,
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json;charset=utf-8' } : {})
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });

  const text = await response.text();
  if (!response.ok) {
    const detail = cleanErrorBody(text);
    throw new Error(`Printify API ${response.status}${detail ? `: ${detail}` : ''}`);
  }
  if (!text) return null;
  return JSON.parse(text);
}

export async function getPrintifyShops() {
  const shops = await printifyRequest('/shops.json');
  return Array.isArray(shops) ? shops : [];
}

export async function testPrintifyConnection() {
  const shops = await getPrintifyShops();
  return {
    ok: true,
    shopCount: shops.length,
    shops: shops.map(shop => ({
      id: shop?.id,
      title: shop?.title || '',
      salesChannel: shop?.sales_channel || ''
    }))
  };
}

export async function getPrintifyOrders(shopId, { page = 1, limit = 10 } = {}) {
  const id = String(shopId || '').trim();
  if (!id) throw new Error('Printify shop ID is required');
  const query = new URLSearchParams({ page: String(page), limit: String(limit) });
  return printifyRequest(`/shops/${encodeURIComponent(id)}/orders.json?${query}`);
}

export async function createPrintifyOrder(shopId, payload = {}) {
  const id = String(shopId || '').trim();
  if (!id) throw new Error('Printify shop ID is required');
  return printifyRequest(`/shops/${encodeURIComponent(id)}/orders.json`, {
    method: 'POST',
    body: payload
  });
}
