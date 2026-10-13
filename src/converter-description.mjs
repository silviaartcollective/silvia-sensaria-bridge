// Etsy may normalize whitespace during listing updates. Compare the complete
// text, not byte-for-byte serialization; NEVER ignore missing words or URLs.
export function normalizeEtsyDescription(value) {
  return String(value ?? '')
    .normalize('NFC')
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]*\n[ \t]*/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}
export function sameEtsyDescription(actual, expected) {
  return normalizeEtsyDescription(actual) === normalizeEtsyDescription(expected);
}
export function listingSeoPreservation(listing, expectedDescription, originalShopSectionId) {
  const originalSection = Number(originalShopSectionId);
  const descriptionPreserved = sameEtsyDescription(listing?.description, expectedDescription);
  const sectionPreserved = !Number.isInteger(originalSection) || originalSection <= 0 ||
    Number(listing?.shop_section_id) === originalSection;
  return { ok: descriptionPreserved && sectionPreserved, descriptionPreserved, sectionPreserved };
}
