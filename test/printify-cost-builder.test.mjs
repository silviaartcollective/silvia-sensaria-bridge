import test from 'node:test';
import assert from 'node:assert/strict';
import { __test } from '../src/printify-cost-builder.mjs';

test('private pricing draft covers all provider variants and is explicitly unpublished', () => {
  const draft = __test.draftPayload(1159, 22, [
    { id: 1001, title: '20x30', placeholders: [{ position: 'front' }] },
    { id: 1002, title: '24x36', placeholders: [{ position: 'front' }] },
    { id: 1002, title: '24x36', placeholders: [{ position: 'front' }] }
  ], 'Jondo', 'Matte Canvas, Stretched, 1.25"');
  assert.match(draft.title, /PRIVATE PRICE CHECK/);
  assert.equal(draft.visible, false);
  assert.equal(draft.blueprint_id, 1159);
  assert.equal(draft.print_provider_id, 22);
  assert.equal(draft.variants.length, 2);
  assert.deepEqual(draft.variants.map(v => v.id), [1001, 1002]);
  assert.deepEqual(draft.print_areas, [{
    variant_ids: [1001, 1002],
    placeholders: [{ position: 'front', images: [] }]
  }]);
  assert.equal(draft.variants[0].is_enabled, true);
});

test('placeholder image fallback leaves draft non-published and adds only a neutral image reference', () => {
  const original = __test.draftPayload(22, 3, [
    { id: 40, placeholders: [{ position: 'front', decoration_method: 'dtg' }] }
  ], 'Test Provider', 'Canvas');
  const withImage = __test.imagePayload(original, 'safe-neutral-id');
  assert.deepEqual(withImage.print_areas[0].placeholders[0].images, [{
    id: 'safe-neutral-id', x: 0.5, y: 0.5, scale: 1, angle: 0
  }]);
  assert.deepEqual(original.print_areas[0].placeholders[0].images, []);
  assert.equal(withImage.visible, false);
});

test('pricing scan normalizes size without generating an Etsy product or order', () => {
  assert.equal(__test.safeSize(30, 20), '20x30');
  assert.throws(() => __test.safeSize(-1, 30), /between 1 and 120/);
});
