import crypto from 'node:crypto';
import { getShopListings, updateListing } from './etsy.mjs';

export const OLD_THICKNESS = '(Thickness: 2 cm)';
export const NEW_THICKNESS = '(Thickness: 1.25" / 3.2 cm)';

export function normalizeReplacement(options = {}) {
  const findText = options.findText == null ? OLD_THICKNESS : String(options.findText);
  const replaceText = options.replaceText == null ? NEW_THICKNESS : String(options.replaceText);
  if (!findText.trim() || findText.length > 4000) {
    throw new Error('Find text must contain 1–4000 characters and cannot be blank.');
  }
  if (replaceText.length > 10000) {
    throw new Error('Replacement text must not exceed 10,000 characters.');
  }
  if (findText === replaceText) throw new Error('Find and replacement text are identical.');
  return { findText, replaceText };
}

// Literal, case-sensitive find/replace. Only the matching text changes.
export function replaceDescriptionText(description, options = {}) {
  const { findText, replaceText } = normalizeReplacement(options);
  return String(description ?? '').replaceAll(findText, replaceText);
}
export function reviseCanvasThickness(description) {
  return replaceDescriptionText(description);
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
export function proposedUpdate(listing, options = {}) {
  const { findText, replaceText } = normalizeReplacement(options);
  const id = Number(listing?.listing_id);
  const oldText = String(listing?.description ?? '');
  const start = oldText.indexOf(findText);
  if (!Number.isSafeInteger(id) || id <= 0 || start < 0) return null;
  const newText = oldText.replaceAll(findText, replaceText);
  if (!newText.trim()) return null;
  if (newText.length > 13000) return null;
  return {
    listingId: id,
    title: String(listing.title || 'Untitled'),
    before: findText,
    after: replaceText,
    context: oldText.slice(Math.max(0, start - 90), Math.min(oldText.length, start + findText.length + 90)),
    previewContext: newText.slice(Math.max(0, start - 90), Math.min(newText.length, start + replaceText.length + 90)),
    hash: fingerprint(oldText + '\u0000' + findText + '\u0000' + replaceText),
    occurrenceCount: oldText.split(findText).length - 1,
    currentLength: oldText.length,
    updatedLength: newText.length
  };
}
export async function previewDescriptionUpdates(session, options = {}) {
  const { findText, replaceText } = normalizeReplacement(options);
  const listings = await activeListings(session);
  const matches = [];
  const tooLong = [];
  for (const listing of listings) {
    const description = String(listing?.description ?? '');
    if (!description.includes(findText)) continue;
    if (description.replaceAll(findText, replaceText).length > 13000 ||
        !description.replaceAll(findText, replaceText).trim()) {
      tooLong.push({ listingId: listing.listing_id, title: String(listing.title || 'Untitled') });
      continue;
    }
    const change = proposedUpdate(listing, { findText, replaceText });
    if (change) matches.push(change);
  }
  return {
    scanned: listings.length,
    matches,
    skipped: tooLong,
    from: findText,
    to: replaceText,
    note: 'Read-only exact text preview. All other description content stays unchanged.'
  };
}
export async function applyDescriptionUpdates(session, selections, options = {}) {
  const { findText, replaceText } = normalizeReplacement(options);
  if (!Array.isArray(selections) || !selections.length || selections.length > 500) {
    throw new Error('Select between 1 and 500 matching active listings.');
  }
  const requested = new Map();
  for (const row of selections) {
    const id = Number(row?.listingId);
    const hash = String(row?.hash || '');
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
  for (const [id, hash] of requested.entries()) {
    const listing = eligible.get(id);
    const change = proposedUpdate(listing, { findText, replaceText });
    if (!change || change.hash !== hash) {
      results.push({ listingId: id, ok: false, error: 'Listing or replacement text changed after preview. Scan again.' });
      continue;
    }
    try {
      await updateListing({ ...credentials(session), listingId: id, listing: {
        description: replaceDescriptionText(listing.description, { findText, replaceText })
      } });
      updated += 1;
      results.push({ listingId: id, ok: true, title: change.title, occurrences: change.occurrenceCount });
    } catch (error) {
      results.push({ listingId: id, ok: false, error: String(error.message || error).slice(0, 300) });
    }
  }
  return { selected: requested.size, updated, failed: requested.size - updated, results };
}
