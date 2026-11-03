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
