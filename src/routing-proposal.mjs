import { printShrimpCandidateCostBreakdown } from './printshrimp-basket-cost.mjs';

// Converts a COMPLETE fresh comparison export to a PROPOSAL.
// It never edits live fulfillment settings or submits supplier orders.
export const ROUTING_PROVIDER_CODES = Object.freeze({
  Sensaria: 'S', Prodigi: 'P', Artelo: 'A', PrintShrimp: 'R'
});

const PRODUCT_VARIANTS = Object.freeze({ P: 9, C: 8, FC: 32 });
const EXPECTED_ROWS_PER_COUNTRY = Object.values(PRODUCT_VARIANTS).reduce((sum, count) => sum + count, 0);

function cost(record) {
  const value = record?.modeledLandedUsd;
  return record?.eligible === true && typeof value === 'number' &&
    Number.isFinite(value) && value >= 0 ? value : null;
}

function round(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function validateRoutingComparisonExport(rows = [], expectedCountryCodes = []) {
  const issues = [];
  const seen = new Set();
  const counts = new Map();
  const expected = new Set(expectedCountryCodes.map(code => String(code).toUpperCase()));
  if (!expected.size) issues.push('Explicit expected launch country list is required.');

  for (const row of rows) {
    const country = String(row?.countryCode || '').toUpperCase();
    const product = String(row?.productCode || '').toUpperCase();
    const key = `${country}|${product}|${row?.size}|${row?.finishCode}`;
    if (!expected.has(country)) issues.push(`Unknown destination in scan: ${country || '(blank)'}`);
    if (!Object.hasOwn(PRODUCT_VARIANTS, product)) issues.push(`Unknown product format: ${key}`);
    if (seen.has(key)) issues.push(`Duplicate variant: ${key}`);
    seen.add(key);
    counts.set(`${country}|${product}`, (counts.get(`${country}|${product}`) || 0) + 1);

    const eligible = Object.values(row?.suppliers || {})
      .filter(record => cost(record) != null)
      .sort((a, b) => cost(a) - cost(b));

    if (!eligible.length) {
      issues.push(`No eligible adjusted supplier for ${key}`);
    } else {
      const cheapest = eligible[0];
      const expectedWinnerCost = round(cost(cheapest));
      const rowWinnerCost = Number(row?.winnerTotalUsd);
      if (row?.winner !== cheapest.provider) {
        issues.push(`Winner mismatch for ${key}: export says ${row?.winner || '(blank)'}, cheapest is ${cheapest.provider}`);
      }
      if (!Number.isFinite(rowWinnerCost) || Math.abs(round(rowWinnerCost) - expectedWinnerCost) > 0.01) {
        issues.push(`Winner cost mismatch for ${key}`);
      }
    }

    if (row?.marginStatus !== 'estimated-pass') issues.push(`Margin requires review or is unavailable for ${key}`);
    if (row?.profitScenario?.qualified !== true) issues.push(`No passing margin scenario for ${key}`);
  }

  for (const country of expected) {
    for (const [product, count] of Object.entries(PRODUCT_VARIANTS)) {
      const actual = counts.get(`${country}|${product}`) || 0;
      if (actual !== count) issues.push(`${country} ${product}: ${actual}/${count} rows`);
    }
  }

  const target = expected.size * EXPECTED_ROWS_PER_COUNTRY;
  if (rows.length !== target) issues.push(`Expected ${target} rows, received ${rows.length}`);

  return {
    ok: issues.length === 0,
    rowCount: rows.length,
    expectedRowCount: target,
    countryCount: expected.size,
    issueCount: issues.length,
    issues
  };
}

export function buildRoutingProposal({ rows = [], countryCodes = [], sourceFile = '' } = {}) {
  const validation = validateRoutingComparisonExport(rows, countryCodes);
  if (!validation.ok) return { ok: false, proposal: null, validation };

  const providers = Object.fromEntries(Object.entries(ROUTING_PROVIDER_CODES).map(([name, code]) => [code, name]));
  const countries = {};
  const winnerCounts = Object.fromEntries(Object.keys(ROUTING_PROVIDER_CODES).map(name => [name, 0]));
  let nearTieRows = 0;

  for (const row of rows) {
    const ordered = Object.values(row.suppliers || {})
      .filter(record => cost(record) != null)
      .sort((a, b) => cost(a) - cost(b));
    const winner = ordered[0];
    const runner = ordered[1] || null;
    const preferredTotal = round(cost(winner));
    const runnerTotal = runner ? round(cost(runner)) : null;
    const savings = runner ? round(runnerTotal - preferredTotal) : null;
    const threshold = round(Math.max(2, preferredTotal * 0.03));
    const nearTie = runner && savings < threshold ? 1 : 0;
    if (nearTie) nearTieRows++;
    winnerCounts[winner.provider]++;

    const country = String(row.countryCode).toUpperCase();
    const format = String(row.productCode).toUpperCase();
    countries[country] ||= {};
    countries[country][format] ||= {};
    countries[country][format][`${row.size}|${row.finishCode}`] = [
      ROUTING_PROVIDER_CODES[winner.provider],
      preferredTotal,
      runner ? ROUTING_PROVIDER_CODES[runner.provider] : null,
      runnerTotal,
      savings,
      threshold,
      nearTie,
      ordered.length,
      printShrimpCandidateCostBreakdown(winner),
      runner ? printShrimpCandidateCostBreakdown(runner) : null
    ];
  }

  return {
    ok: true,
    validation,
    proposal: {
      version: 1,
      generatedAt: new Date().toISOString(),
      sourceFile: String(sourceFile),
      rowCount: rows.length,
      policy: {
        comparisonCurrency: 'USD',
        costBasis: 'risk-adjusted planning estimates, not supplier-invoiced landed costs',
        switchThreshold: 'max(2 USD, 3% of preferred cost)',
        approved: false,
        note: 'PROPOSAL ONLY. This file does not change Etsy listings, supplier routing, or live submission settings. PrintShrimp winner/runner rows preserve USD product + shipping components so future basket routing can apply its documented once-per-order shipping correctly.'
      },
      providers,
      winnerCounts,
      nearTieRows,
      countries
    }
  };
}
