import { getJsonObject, putJsonObject } from './r2.mjs';
import { resolvePrintifyShopId } from './printify.mjs';

const CACHE_MS = 5 * 60 * 1000;
let cached = null;

function keyFor(shopId) {
  const id = String(shopId || '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!id) throw new Error('Valid Printify shop ID required for pricing library');
  return `pricing/printify-costs-${id}.json`;
}

function isMissing(error) {
  return ['NoSuchKey','NotFound','NoSuchObject'].includes(String(error?.name || error?.Code || '')) ||
    [404].includes(error?.$metadata?.httpStatusCode);
}

export async function loadPrintifyCostLibrary({ fresh = false } = {}) {
  const shopId = await resolvePrintifyShopId();
  if (!fresh && cached?.shopId === shopId &&
      Date.now() - cached.fetchedAt < CACHE_MS) return cached.document;
  let document;
  try {
    document = await getJsonObject(keyFor(shopId));
  } catch (error) {
    if (!isMissing(error)) throw error;
    document = { schema: 1, shopId, updatedAt: null, variants: {} };
  }
  if (!document || typeof document.variants !== 'object' || Array.isArray(document.variants)) {
    throw new Error('Printify saved pricing library is malformed');
  }
  cached = { shopId, document, fetchedAt: Date.now() };
  return document;
}

export async function savePrintifyCostLibrary(items = []) {
  const shopId = await resolvePrintifyShopId();
  const existing = await loadPrintifyCostLibrary({ fresh: true });
  const document = structuredClone(existing);
  document.schema = 1;
  document.shopId = shopId;
  document.updatedAt = new Date().toISOString();
  document.variants ||= {};
  for (const item of items) {
    const ids = [item.blueprintId, item.providerId, item.variantId];
    if (!ids.every(id => Number.isFinite(Number(id)))) continue;
    const costCents = Number(item.costCents);
    if (!Number.isSafeInteger(costCents) || costCents < 0) continue;
    document.variants[ids.join('|')] = {
      costCents,
      capturedAt: document.updatedAt,
      source: 'unpublished-printify-product'
    };
  }
  await putJsonObject(keyFor(shopId), document);
  cached = { shopId, document, fetchedAt: Date.now() };
  return { count: items.length, totalSaved: Object.keys(document.variants).length, updatedAt: document.updatedAt };
}

export function resetPrintifyCostLibraryCache() {
  cached = null;
}
