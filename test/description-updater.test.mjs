import test from 'node:test';
import assert from 'node:assert/strict';
import { OLD_THICKNESS, NEW_THICKNESS, reviseCanvasThickness, proposedUpdate } from '../src/description-updater.mjs';

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
