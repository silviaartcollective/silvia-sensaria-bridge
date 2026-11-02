// Supplier catalogs read ahead in the background, with fake suppliers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { warmSupplierCatalogs, GOOTEN_WARM_COUNTRIES } from '../src/supplier-catalog-warmup.mjs';

const fakes = ({ printful = true, lumaprints = false, gooten = true, failGooten = '' } = {}) => {
  const calls = [];
  return { calls, deps: {
    printfulConfigStatus: () => ({ ready: printful }), lumaprintsConfigStatus: () => ({ ready: lumaprints }), gootenConfigStatus: () => ({ ready: gooten }),
    loadPrintfulCatalog: async options => { calls.push(['printful', options]); },
    loadLumaprintsCatalog: async options => { calls.push(['lumaprints', options]); },
    loadGootenCatalog: async (country, options) => { calls.push(['gooten', country, options]); if (country === failGooten) throw new Error('Gooten API is unavailable (HTTP 503).'); }
  } };
};

test('each configured supplier\'s catalog is read again; one not configured is skipped', async () => {
  const f = fakes();
  const results = await warmSupplierCatalogs({ deps: f.deps });
  assert.deepEqual(f.calls, [['printful', { fresh: true }], ...GOOTEN_WARM_COUNTRIES.map(c => ['gooten', c, { fresh: true }])]);
  assert.deepEqual(results.map(r => [r.name, r.ok]), [['Printful', true], ['Gooten US', true], ['Gooten CA', true]]);
});

test('a supplier that fails is reported, never thrown, and the others still load', async () => {
  const f = fakes({ lumaprints: true, failGooten: 'US' });
  const results = await warmSupplierCatalogs({ deps: f.deps });
  assert.equal(results.find(r => r.name === 'Gooten US').ok, false);
  assert.match(results.find(r => r.name === 'Gooten US').error, /503/);
  assert.ok(results.filter(r => r.name !== 'Gooten US').every(r => r.ok));
  assert.equal(f.calls.length, 4);
});

test('the server starts the warm-up when it starts listening', () => {
  const server = readFileSync(new URL('../src/server.mjs', import.meta.url), 'utf8');
  const listen = server.indexOf("server.listen(port, '0.0.0.0', () => {");
  assert.ok(listen > 0 && server.indexOf('scheduleSupplierCatalogWarmup();', listen) > listen);
});
