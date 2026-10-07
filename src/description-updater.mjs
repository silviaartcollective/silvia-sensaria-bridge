import crypto from 'node:crypto';
import { getShopListings, updateListing } from './etsy.mjs';

export const OLD_THICKNESS = '(Thickness: 2 cm)';
export const NEW_THICKNESS = '(Thickness: 1.25" / 3.2 cm)';

// An exact phrase replacement: leave all other text, formatting and products alone.
export function reviseCanvasThickness(description) {
  const before = String(description ?? '');
  return before.replaceAll(OLD_THICKNESS, NEW_THICKNESS);
}
const fingerprint = value => crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 20);
function credentials(session) {
  return {
    shopId: session.shop.shop_id,
    keystring: session.keystring,
    sharedSecret: session.sharedSecret,
    accessToken: session.accessToken
  };
}
export async function activeListings(session) {
  const listings = [];
  for (let offset = 0; offset < 5000; offset += 100) {
    const page = await getShopListings({ ...credentials(session), state: 'active', limit: 100, offset });
    const rows = Array.isArray(page?.results) ? page.results : [];
    listings.push(...rows);
    if (rows.length < 100) break;
    if (offset >= 4900) throw new Error('More than 5000 listings found; scan limit reached.');
  }
  return listings;
}
export function proposedUpdate(listing) {
  const id = Number(listing?.listing_id);
  const oldText = String(listing?.description ?? '');
  const newText = reviseCanvasThickness(oldText);
  if (!Number.isSafeInteger(id) || id <= 0 || oldText === newText) return null;
  const start = oldText.indexOf(OLD_THICKNESS);
  return {
    listingId: id,
    title: String(listing.title || 'Untitled'),
    before: OLD_THICKNESS,
    after: NEW_THICKNESS,
    context: oldText.slice(Math.max(0, start - 85), Math.min(oldText.length, start + OLD_THICKNESS.length + 85)),
    hash: fingerprint(oldText),
    occurrenceCount: oldText.split(OLD_THICKNESS).length - 1
  };
}
export async function previewDescriptionUpdates(session) {
  const listings = await activeListings(session);
  return {
    scanned: listings.length,
    matches: listings.map(proposedUpdate).filter(Boolean),
    from: OLD_THICKNESS, to: NEW_THICKNESS,
    note: 'Read-only preview. Only the exact existing thickness phrase is replaced.'
  };
}
export async function applyDescriptionUpdates(session, selections) {
  if (!Array.isArray(selections) || !selections.length || selections.length > 500) {
    throw new Error('Select between 1 and 500 matching active listings.');
  }
  const requested = new Map();
  for (const row of selections) {
    const id = Number(row?.listingId), hash = String(row?.hash || '');
    if (!Number.isSafeInteger(id) || id <= 0 || !/^[a-f0-9]{20}$/.test(hash)) {
      throw new Error('Invalid listing selection. Refresh the preview.');
    }
    if (requested.has(id)) throw new Error('Duplicate listing selection.');
    requested.set(id, hash);
  }
  const current = await activeListings(session);
  const eligible = new Map(current.map(item => [Number(item.listing_id), item]));
  const results = [];
  let updated = 0;
  // Apply only the exact phrase to the selected listings; reject stale previews.
  for (const [id, hash] of requested.entries()) {
    const listing = eligible.get(id);
    const change = proposedUpdate(listing);
    if (!change || change.hash !== hash) {
      results.push({ listingId: id, ok: false, error: 'Listing changed or no longer matches. Refresh the preview.' });
      continue;
    }
    try {
      await updateListing({ ...credentials(session), listingId: id, listing: {
        description: reviseCanvasThickness(listing.description)
      } });
      updated += 1;
      results.push({ listingId: id, ok: true, title: change.title, occurrences: change.occurrenceCount });
    } catch (error) {
      results.push({ listingId: id, ok: false, error: String(error.message || error).slice(0, 300) });
    }
  }
  return { selected: requested.size, updated, failed: requested.size - updated, results };
}
