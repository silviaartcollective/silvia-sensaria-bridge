import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildRoutingProposal } from '../src/routing-proposal.mjs';
import { SILVIA_CURRENT_MARKETS } from '../src/markets.mjs';

const input = process.argv[2];
const output = process.argv[3] || 'silvia-routing-proposal.json';
if (!input) {
  console.error('Usage: node scripts/build-routing-proposal.mjs scan.json [proposal.json]');
  process.exit(2);
}

const sourcePath = resolve(input);
const data = JSON.parse(readFileSync(sourcePath, 'utf8'));
if (Array.isArray(data.failedCountries) && data.failedCountries.length) {
  console.error('Refusing proposal: scan contains failed countries:', data.failedCountries.join(' | '));
  process.exit(1);
}

const countryCodes = SILVIA_CURRENT_MARKETS.map(item => item.code);
const result = buildRoutingProposal({
  rows: Array.isArray(data.rows) ? data.rows : [],
  countryCodes,
  sourceFile: sourcePath
});

if (!result.ok) {
  console.error('Refusing proposal:', result.validation.issues.join('\n'));
  process.exit(1);
}

writeFileSync(resolve(output), JSON.stringify(result.proposal, null, 2) + '\n');
console.log(`Wrote unapproved proposal to ${resolve(output)}`);
