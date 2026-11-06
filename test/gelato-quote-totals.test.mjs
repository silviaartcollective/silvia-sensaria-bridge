// Gelato's price for a matched product: converted when not in US$, and what is missing said plainly.
import test from 'node:test';
import assert from 'node:assert/strict';
import { gelatoQuoteTotals } from '../src/gelato-comparison.mjs';

const rate = async currency => ({ EUR: { rate: 1.08 }, CAD: { rate: 0.72 } })[currency] || Promise.reject(new Error('FX API 404'));

test('a US$ price and shipping make the total', async () => {
  assert.deepEqual(await gelatoQuoteTotals({ productPrice: { price: 21.07, currency: 'USD' }, shipping: { price: 6.97 } }, { rate }),
    { productCost: 21.07, shippingCost: 6.97, totalUsd: 28.04, missing: '', productCurrency: 'USD' });
});

test('a price Gelato gives in another currency is converted, not dropped', async () => {
  const q = await gelatoQuoteTotals({ productPrice: { price: 50, currency: 'EUR' }, shipping: { price: 12 } }, { rate });
  assert.equal(q.productCost, 54);
  assert.equal(q.totalUsd, 66);
  assert.equal(q.missing, '');
});

test('what is missing is said: no shipping to the destination, no price, or no exchange rate', async () => {
  assert.equal((await gelatoQuoteTotals({ productPrice: { price: 80, currency: 'USD' }, shipping: null }, { rate })).missing, 'no shipping method to the destination');
  assert.equal((await gelatoQuoteTotals({ productPrice: null, shipping: { price: 9 } }, { rate })).missing, 'no product price');
  const noRate = await gelatoQuoteTotals({ productPrice: { price: 80, currency: 'XYZ' }, shipping: { price: 9 } }, { rate });
  assert.equal(noRate.missing, 'product price in XYZ with no exchange rate');
  assert.equal(noRate.totalUsd, null);
});

test('up to 16 matching versions are tried, 4 at a time, until one ships to the country', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../src/gelato-comparison.mjs', import.meta.url), 'utf8');
  assert.match(source, /\.sort\(\(a, b\) => b\.score - a\.score\)\s*\/\/[^\n]*\n[^\n]*\n\s*\.slice\(0, 16\);/);
  assert.match(source, /for \(let start = 0; start < candidates\.length; start \+= 4\)/);
  assert.match(source, /if \(totaled\.some\(item => item\.totalUsd != null\)\) break;/);
});

test('a size written in mm then inches ("600x900-mm-24x36-inch") matches 24x36, so geo-simplified products are found', async () => {
  const { _test } = await import('../src/gelato-comparison.mjs');
  const target = { width: 24, height: 36 };
  // The format filter: the value Gelato lists for the product that shipped to the US.
  const catalog = { productAttributes: [{ productAttributeUid: 'CanvasFormat', values: [
    { productAttributeValueUid: '600x900-mm-24x36-inch', title: '60x90cm / 24x36″' },
    { productAttributeValueUid: '24x36-inch', title: '24x36″' },
    { productAttributeValueUid: '500x700-mm-20x28-inch', title: '50x70cm / 20x28″' }] }] };
  assert.deepEqual(_test.matchingGelatoFormatAttributes(catalog, target),
    [{ key: 'CanvasFormat', values: ['600x900-mm-24x36-inch', '24x36-inch'] }]);
  // The product itself (from the order) is the requested size and is preferred.
  const geo = { productUid: 'framed_canvas_geo_simplified_600x900-mm-24x36-inch_dark-wood_652x952-mm-26x38-inch_wood-fsc-slim_ver_wood_w14xt42-mm_canvas_4-0',
    attributes: { CanvasFormat: '600x900-mm-24x36-inch' } };
  const plain = { productUid: 'framed_canvas_wood_w14xt42-mm_24x36-inch_ver_dark-wood_26x38-inch_wood-fsc-3-cm_canvas_4-0_canvas-mounting' };
  assert.equal(_test.sizeCompatible(geo, target), true);
  const fc = { productCode: 'FC' }, cat = { catalogUid: 'framed-canvas', title: 'Framed Canvas' };
  assert.ok(_test.compatibilityScore(fc, geo, cat) > _test.compatibilityScore(fc, plain, cat));
  assert.deepEqual(_test.pairsFromText('60x90cm / 24x36″').map(p => [Math.round(p.width * 10) / 10, Math.round(p.height * 10) / 10]), [[23.6, 35.4], [24, 36]]);
});
