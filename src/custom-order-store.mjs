import { ListObjectsV2Command } from '@aws-sdk/client-s3';
import { r2Config, r2Client, getJsonObject, putJsonObject } from './r2.mjs';

const base = 'orders/etsy/';
export function validReceiptId(value) {
  const id = String(value || '').trim();
  if (!/^[1-9]\d{0,19}$/.test(id)) throw new Error('Valid numeric Etsy receipt ID required.');
  return id;
}
export const receiptKey = id => base + validReceiptId(id) + '/receipt.json';
export const reviewKey = id => base + validReceiptId(id) + '/review.json';

function missing(e) { return e?.$metadata?.httpStatusCode === 404 || ['NoSuchKey', 'NotFound'].includes(e?.name); }
export async function optionalJson(key) {
  try { return await getJsonObject(key); }
  catch (e) { if (missing(e)) return null; throw e; }
}
export function paidReceipt(receipt, source) {
  if (receipt?.was_canceled || receipt?.is_canceled || receipt?.is_cancelled ||
      /cancel(?:ed|led)/i.test(String(receipt?.status || ''))) return false;
  if (receipt?.was_paid === false || receipt?.is_paid === false) return false;
  return receipt?.was_paid === true || receipt?.is_paid === true || source === 'etsy-webhook';
}
export function money(value) {
  if (!value || typeof value !== 'object') return null;
  const amount = Number(value.amount), divisor = Number(value.divisor || 100);
  if (!Number.isFinite(amount) || !Number.isFinite(divisor) || divisor <= 0) return null;
  return { amount: Math.round(amount / divisor * 100) / 100, currency: String(value.currency_code || '').toUpperCase() };
}
export function inferOrder(receipt) {
  const items = Array.isArray(receipt?.transactions) ? receipt.transactions : [];
  const text = items.map(item => [
    item.title, item.sku, item.personalization,
    ...(Array.isArray(item.variations) ? item.variations.map(v => v.formatted_value || v.value || '') : [])
  ].join(' ')).join(' ');
  const match = text.match(/(\d{1,3}(?:\.\d+)?)\s*(?:x|×|by)\s*(\d{1,3}(?:\.\d+)?)\s*(cm|centimeters?|centimetres?|inches?|in\b)?/i);
  const size = match ? {
    width: Number(match[1]), height: Number(match[2]),
    units: match[3] ? (/^cm|centim/i.test(match[3]) ? 'cm' : 'in') : 'unknown'
  } : null;
  const type = /framed\s*canvas|float(?:ing)?\s*frame/i.test(text) ? 'FC'
    : /canvas/i.test(text) ? 'C'
    : /poster|paper\s*print/i.test(text) ? 'P' : '';
  const custom = /\bcustom\b|\bprivate\s*(?:order|listing|print)\b|\bbespoke\b|\bmade\s+to\s+size\b/i.test(text);
  const privateFlag = items.some(t => t?.is_private === true || t?.listing?.is_private === true);
  return { size, productCode: type, categoryHint: custom || privateFlag ? 'possible_custom' : 'needs_review',
    evidence: privateFlag ? 'Private listing field' : custom ? 'Custom wording in item details' : 'Verify in Etsy' };
}
export function summarizeOrder(record, review = null) {
  const r = record.receipt || {};
  const items = Array.isArray(r.transactions) ? r.transactions : [];
  return {
    receiptId: validReceiptId(r.receipt_id || r.id),
    buyer: String(r.name || 'Buyer'), country: String(r.country_iso || ''),
    receivedAt: record.receivedAt, paid: paidReceipt(r, record.source),
    shipped: r.is_shipped === true || r.was_shipped === true || (Array.isArray(r.shipments) && r.shipments.length > 0),
    items: items.map(t => ({ title: t.title || '', sku: t.sku || '', quantity: Number(t.quantity || 1) })),
    itemCount: items.reduce((n, t) => n + Number(t.quantity || 1), 0),
    merchandise: money(r.total_price), shipping: money(r.total_shipping_cost),
    classification: review?.classification || 'unclassified',
    status: review?.status || 'needs_review',
    supplier: review?.plan?.supplier || '',
    inference: inferOrder(r), updatedAt: review?.updatedAt || record.receivedAt
  };
}
export async function readOrder(id) {
  const [staged, review] = await Promise.all([getJsonObject(receiptKey(id)), optionalJson(reviewKey(id))]);
  return { staged, review, summary: summarizeOrder(staged, review) };
}
export async function listOrders() {
  const client = r2Client(), bucket = r2Config().bucket, keys = [];
  let cursor;
  do {
    const out = await client.send(new ListObjectsV2Command({
      Bucket: bucket, Prefix: base, ContinuationToken: cursor
    }));
    for (const item of out.Contents || []) {
      if (/^orders\/etsy\/\d+\/receipt\.json$/.test(item.Key || '')) keys.push(item.Key);
    }
    cursor = out.IsTruncated ? out.NextContinuationToken : undefined;
  } while (cursor && keys.length < 3000);
  keys.sort((a, b) => Number(b.split('/')[2]) - Number(a.split('/')[2]));
  const result = [];
  for (let i = 0; i < Math.min(keys.length, 120); i += 8) {
    const group = await Promise.all(keys.slice(i, i + 8).map(async key => {
      const id = key.split('/')[2];
      try {
        const [staged, review] = await Promise.all([getJsonObject(key), optionalJson(reviewKey(id))]);
        return summarizeOrder(staged, review);
      } catch (e) { return { receiptId: id, error: String(e.message || e) }; }
    }));
    result.push(...group);
  }
  return { orders: result, count: result.length, truncated: keys.length > 120 };
}
export async function recordImportedReceipt(receipt, shopId) {
  if (!paidReceipt(receipt, 'manual-etsy-import')) throw new Error('Etsy receipt is not verified as paid.');
  if (receipt.shop_id && Number(receipt.shop_id) !== Number(shopId)) throw new Error('Wrong Etsy shop.');
  const id = validReceiptId(receipt.receipt_id);
  await putJsonObject(receiptKey(id), {
    receipt, receivedAt: new Date().toISOString(), source: 'manual-etsy-import',
    eventType: 'order.paid', processingStatus: 'received'
  });
  return (await readOrder(id)).summary;
}
export async function saveReview(id, review) {
  await putJsonObject(reviewKey(id), review);
  return review;
}
