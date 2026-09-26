import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sortCustomMockupsByReference,
  mapWithConcurrency
} from '../src/mockup-sorter.mjs';

test('mockup sorter keeps upload order when there is no usable reference', async () => {
  const customMedia = [
    { key: 'a.jpg', contentType: 'image/jpeg' },
    { key: 'b.jpg', contentType: 'image/jpeg' }
  ];

  const result = await sortCustomMockupsByReference({
    customMedia,
    referenceImages: [],
    getObject: async () => {
      throw new Error('should not fetch');
    }
  });

  assert.equal(result.applied, false);
  assert.deepEqual(result.items, customMedia);
});

test('concurrency mapper preserves input order', async () => {
  const result = await mapWithConcurrency([30, 5, 15, 1], 3, async (delay) => {
    await new Promise((resolve) => setTimeout(resolve, delay));
    return delay * 2;
  });

  assert.deepEqual(result, [60, 10, 30, 2]);
});
