import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FULFILLMENT_RATIOS,
  fulfillmentRatioForSize,
  fulfillmentRatioObjectKey
} from '../src/artwork-ratios.mjs';

test('Silvia size families map to the expected fulfillment ratios', () => {
  assert.equal(fulfillmentRatioForSize('8x10'), '4x5');
  assert.equal(fulfillmentRatioForSize('11x14'), '11x14');
  assert.equal(fulfillmentRatioForSize('12x16'), '3x4');
  assert.equal(fulfillmentRatioForSize('12x18'), '2x3');
  assert.equal(fulfillmentRatioForSize('16x20'), '4x5');
  assert.equal(fulfillmentRatioForSize('16x24'), '2x3');
  assert.equal(fulfillmentRatioForSize('18x24'), '3x4');
  assert.equal(fulfillmentRatioForSize('24x36'), '2x3');
  assert.equal(fulfillmentRatioForSize('30x40'), '3x4');
  assert.equal(fulfillmentRatioForSize('40x60'), '2x3');
});

test('ratio assets use Silvia R2 fulfillment paths', () => {
  assert.deepEqual(FULFILLMENT_RATIOS, ['2x3','3x4','4x5','11x14']);
  assert.equal(
    fulfillmentRatioObjectKey('SAC42', '3x4'),
    'artworks/SAC42/fulfillment/3x4.jpg'
  );
});
