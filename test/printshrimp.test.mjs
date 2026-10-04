import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PRINTSHRIMP_PRINT_PAPER_TYPE,
  PRINTSHRIMP_PAPER_TYPES,
  PRINTSHRIMP_FRAMED_SIZES,
  printShrimpPriceRow
} from '../src/printshrimp.mjs';

test('authenticated PrintShrimp defaults are represented', () => {
  assert.equal(PRINTSHRIMP_PRINT_PAPER_TYPE, 'Matte');
  assert.deepEqual(PRINTSHRIMP_PAPER_TYPES, ['Matte','Satin','Gloss']);
  assert.ok(PRINTSHRIMP_FRAMED_SIZES.includes('12x16'));
});

test('12x16 resolves the documented 30x40cm API alias', () => {
  const row = printShrimpPriceRow({ sizes: [{ size: '30x40cm', print: { price: 1 } }] }, '12x16');
  assert.equal(row.size, '30x40cm');
});
