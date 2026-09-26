import test from 'node:test';
import assert from 'node:assert/strict';
import { productionSpecFor } from '../src/production.mjs';

test('24x36 poster uses exact 300 DPI no-bleed dimensions', () => {
  const spec = productionSpecFor({ format: 'P', size: '24x36', orientation: 'portrait' });
  assert.equal(spec.dpi, 300);
  assert.deepEqual(spec.output, { width: 7200, height: 10800 });
  assert.equal(spec.template, 'nobleed-24x36-portrait.psd');
});

test('24x36 canvas keeps finished face plus 1.5 inch mirrored bleed on every side', () => {
  const spec = productionSpecFor({ format: 'C', size: '24x36', orientation: 'portrait' });
  assert.equal(spec.dpi, 300);
  assert.deepEqual(spec.face, { width: 7200, height: 10800 });
  assert.deepEqual(spec.output, { width: 8100, height: 11700 });
  assert.equal(spec.mirrorBleedPx, 450);
  assert.equal(spec.safeInsetPx, 150);
  assert.equal(spec.template, 'canvas-1.25bar-24x36-portrait.psd');
});

test('landscape production specs swap face and full-production dimensions', () => {
  const spec = productionSpecFor({ format: 'C', size: '24x36', orientation: 'landscape' });
  assert.deepEqual(spec.face, { width: 10800, height: 7200 });
  assert.deepEqual(spec.output, { width: 11700, height: 8100 });
  assert.equal(spec.mirrorBleedPx, 450);
  assert.equal(spec.safeInsetPx, 150);
});

test('framed canvas uses the same production geometry as unframed canvas', () => {
  const canvas = productionSpecFor({ format: 'C', size: '30x40', orientation: 'portrait' });
  const framed = productionSpecFor({ format: 'FC', size: '30x40', orientation: 'portrait' });
  assert.deepEqual(framed.face, canvas.face);
  assert.deepEqual(framed.output, canvas.output);
  assert.equal(framed.mirrorBleedPx, canvas.mirrorBleedPx);
  assert.equal(framed.safeInsetPx, canvas.safeInsetPx);
  assert.equal(framed.template, 'canvas-1.25bar-framed-30x40-portrait.psd');
});

test('40x60 canvas production dimensions include mirrored wrap area', () => {
  const spec = productionSpecFor({ format: 'C', size: '40x60', orientation: 'portrait' });
  assert.deepEqual(spec.face, { width: 12000, height: 18000 });
  assert.deepEqual(spec.output, { width: 12900, height: 18900 });
});

test('12x18 poster is generated exactly at 300 DPI even without a source PSD', () => {
  const spec = productionSpecFor({ format: 'P', size: '12x18', orientation: 'portrait' });
  assert.deepEqual(spec.output, { width: 3600, height: 5400 });
  assert.equal(spec.template, null);
  assert.match(spec.note || '', /No 12x18 file is present/i);
});
