import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRoutingComparisonExport, buildRoutingProposal } from '../src/routing-proposal.mjs';

function row(country, productCode, size, finishCode='NONE') {
  return {
    countryCode: country,
    productCode,
    size,
    finishCode,
    winner: 'Sensaria',
    winnerTotalUsd: 10,
    marginStatus: 'estimated-pass',
    profitScenario: { qualified: true },
    suppliers: {
      sensaria: { provider: 'Sensaria', eligible: true, modeledLandedUsd: 10 },
      prodigi: { provider: 'Prodigi', eligible: true, modeledLandedUsd: 12 }
    }
  };
}

function completeCountry(country='CA') {
  const rows = [];
  for (const size of ['8x10','11x14','12x16','12x18','16x20','16x24','18x24','24x36','30x40']) rows.push(row(country,'P',size));
  for (const size of ['12x16','12x18','16x20','16x24','18x24','24x36','30x40','40x60']) rows.push(row(country,'C',size));
  for (const size of ['12x16','12x18','16x20','16x24','18x24','24x36','30x40','40x60']) {
    for (const finish of ['BLK','WHT','NAT','DWD']) rows.push(row(country,'FC',size,finish));
  }
  return rows;
}

test('complete 49-row market can produce an unapproved proposal', () => {
  const rows = completeCountry();
  const validation = validateRoutingComparisonExport(rows, ['CA']);
  assert.equal(validation.ok, true);
  assert.equal(validation.expectedRowCount, 49);
  const result = buildRoutingProposal({ rows, countryCodes: ['CA'] });
  assert.equal(result.ok, true);
  assert.equal(result.proposal.policy.approved, false);
});

test('winner mismatch blocks proposal', () => {
  const rows = completeCountry();
  rows[0].winner = 'Prodigi';
  const result = buildRoutingProposal({ rows, countryCodes: ['CA'] });
  assert.equal(result.ok, false);
  assert.match(result.validation.issues.join('\n'), /Winner mismatch/);
});

test('review margin blocks proposal', () => {
  const rows = completeCountry();
  rows[0].marginStatus = 'review';
  rows[0].profitScenario.qualified = false;
  assert.equal(buildRoutingProposal({ rows, countryCodes: ['CA'] }).ok, false);
});
