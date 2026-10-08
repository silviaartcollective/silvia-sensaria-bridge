// Read-only Etsy Open API receipt helpers for the manual Silvia order inbox.
// All credentials are passed from the existing authorized Etsy session.
function headers(session) {
  return {
    'x-api-key': String(session.keystring) + ':' + String(session.sharedSecret),
    authorization: 'Bearer ' + String(session.accessToken)
  };
}
const root = 'https://api.etsy.com/v3/application/shops/';
export async function receiptTransactions(session, receiptId) {
  const shopId = Number(session.shop.shop_id);
  const id = String(receiptId);
  const url = root + encodeURIComponent(shopId) + '/receipts/' +
    encodeURIComponent(id) + '/transactions?legacy=false';
  const response = await fetch(url, { headers: headers(session) });
  if (!response.ok) throw new Error('Etsy transactions fetch failed (HTTP ' + response.status + ').');
  const value = await response.json();
  return Array.isArray(value?.results) ? value.results : [];
}
export async function recentPaidReceipts(session, limit = 25) {
  const shopId = Number(session.shop.shop_id);
  const params = new URLSearchParams({
    was_paid: 'true', limit: String(Math.min(50, Math.max(1, Number(limit) || 25))),
    sort_on: 'created', sort_order: 'desc'
  });
  const url = root + encodeURIComponent(shopId) + '/receipts?' + params;
  const response = await fetch(url, { headers: headers(session) });
  if (!response.ok) throw new Error('Etsy receipts fetch failed (HTTP ' + response.status + ').');
  const value = await response.json();
  return Array.isArray(value?.results) ? value.results : [];
}
