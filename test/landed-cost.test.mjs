import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateSupplierLandedCost, landedCostPolicy } from '../src/landed-cost.mjs';

test('null or unavailable supplier cost never becomes zero', () => {
  const row = estimateSupplierLandedCost({ provider: 'Prodigi', eligible: false, totalUsd: null }, { countryCode: 'CA' });
  assert.equal(row.modeledLandedUsd, null);
  assert.equal(row.contingencyUsd, null);
});

test('PrintShrimp GBP quote gets only the configured FX reserve', () => {
  const policy = { ...landedCostPolicy(), printShrimpGbpFxReserve: 0.02 };
  const row = estimateSupplierLandedCost({ provider: 'PrintShrimp', eligible: true, totalUsd: 100, currency: 'GBP' }, { countryCode: 'CA', policy });
  assert.equal(row.contingencyUsd, 2);
  assert.equal(row.modeledLandedUsd, 102);
});
