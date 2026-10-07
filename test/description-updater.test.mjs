import test from 'node:test';
import assert from 'node:assert/strict';
import { OLD_THICKNESS, NEW_THICKNESS, reviseCanvasThickness, proposedUpdate, replaceDescriptionText, normalizeReplacement } from '../src/description-updater.mjs';

test('updates only the original canvas thickness phrase', () => {
  const source = 'Choose your finish:\n• Canvas — Premium canvas stretched over a solid wood frame (Thickness: 2 cm)\n• Framed Canvas — Canvas with an added frame.';
  const updated = reviseCanvasThickness(source);
  assert.equal(updated, source.replace(OLD_THICKNESS, NEW_THICKNESS));
  assert.equal(updated.includes('(Thickness: 2 cm)'), false);
  assert.equal(updated.includes('1.25" / 3.2 cm'), true);
});
test('keeps other descriptions and unrelated thickness information unchanged', () => {
  for (const text of ['Thickness 2 cm', '(Thickness: 3 cm)', '2 cm canvas', 'No thickness information']) {
    assert.equal(reviseCanvasThickness(text), text);
  }
});
test('returns no update for listings without an exact match', () => {
  assert.equal(proposedUpdate({ listing_id: 7, title: 'Landscape', description: 'No canvas here' }), null);
});
test('generates a preview for each matching listing and counts occurrences', () => {
  const source = 'A ' + OLD_THICKNESS + ' and ' + OLD_THICKNESS;
  const result = proposedUpdate({ listing_id: 42, title: 'Neutral landscape', description: source });
  assert.equal(result.listingId, 42);
  assert.equal(result.occurrenceCount, 2);
  assert.equal(result.before, OLD_THICKNESS);
  assert.equal(result.after, NEW_THICKNESS);
  assert.match(result.hash, /^[a-f0-9]{20}$/);
});

test('general editor replaces arbitrary text and multiline passages', () => {
  const old = 'Premium paper\nSize 12x16\nAvailable worldwide.';
  const newer = replaceDescriptionText(old, { findText: 'Size 12x16', replaceText: 'Size 30x40' });
  assert.equal(newer, 'Premium paper\nSize 30x40\nAvailable worldwide.');
  assert.equal(replaceDescriptionText('one\nTWO\nthree', {
    findText: 'TWO\nthree', replaceText: 'SECOND\nTHIRD'
  }), 'one\nSECOND\nTHIRD');
});
test('replacement may be empty to remove text without removing unrelated content', () => {
  assert.equal(replaceDescriptionText('Hello — OLD — World', {
    findText: ' — OLD', replaceText: ''
  }), 'Hello — World');
});
test('preview binds the original description to the exact replacement', () => {
  const listing = { listing_id: 100, title: 'Art', description: 'Canvas 2 cm' };
  const before = proposedUpdate(listing, { findText: '2 cm', replaceText: '3.2 cm' });
  const different = proposedUpdate(listing, { findText: '2 cm', replaceText: '4 cm' });
  assert.notEqual(before.hash, different.hash);
  assert.equal(before.previewContext, 'Canvas 3.2 cm');
});
test('invalid searches are blocked before updating live listings', () => {
  assert.throws(() => normalizeReplacement({ findText: '', replaceText: 'A' }), /Find text/);
  assert.throws(() => normalizeReplacement({ findText: 'A', replaceText: 'A' }), /identical/);
});
