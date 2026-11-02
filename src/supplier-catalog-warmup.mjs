// Printful, Lumaprints and Gooten price an exact size from their whole
// catalog, read once and kept for 6 hours. Read on a lookup right after a
// restart, the catalog can take longer than the lookup's time limit (Gooten:
// "scan exceeded 24 seconds"). So the catalogs are read in the background
// shortly after the app starts and again before they expire.
import { printfulConfigStatus } from './printful.mjs';
import { lumaprintsConfigStatus } from './lumaprints.mjs';
import { gootenConfigStatus } from './gooten.mjs';
import { loadPrintfulCatalog } from './printful-comparison.mjs';
import { loadLumaprintsCatalog } from './lumaprints-comparison.mjs';
import { loadGootenCatalog } from './gooten-comparison.mjs';

export const WARM_AFTER_START_MS = 45 * 1000;
export const WARM_EVERY_MS = 5.5 * 60 * 60 * 1000;
// Gooten's catalog differs by country: the markets looked up most.
export const GOOTEN_WARM_COUNTRIES = Object.freeze(['US', 'CA']);

// One pass: each configured supplier's catalog read again. Never throws.
export async function warmSupplierCatalogs({ fresh = true, deps = {} } = {}) {
  const d = { printfulConfigStatus, lumaprintsConfigStatus, gootenConfigStatus,
    loadPrintfulCatalog, loadLumaprintsCatalog, loadGootenCatalog, ...deps };
  const jobs = [];
  if (d.printfulConfigStatus().ready) jobs.push(['Printful', () => d.loadPrintfulCatalog({ fresh })]);
  if (d.lumaprintsConfigStatus().ready) jobs.push(['Lumaprints', () => d.loadLumaprintsCatalog({ fresh })]);
  if (d.gootenConfigStatus().ready)
    for (const country of GOOTEN_WARM_COUNTRIES) jobs.push(['Gooten ' + country, () => d.loadGootenCatalog(country, { fresh })]);
  const results = await Promise.all(jobs.map(async ([name, load]) => {
    const started = Date.now();
    try { await load(); return { name, ok: true, ms: Date.now() - started }; }
    catch (error) { return { name, ok: false, ms: Date.now() - started, error: String(error?.message || error).slice(0, 200) }; }
  }));
  return results;
}

export function scheduleSupplierCatalogWarmup({ log = console, warm = warmSupplierCatalogs } = {}) {
  const run = () => void warm().then(results => {
    for (const r of results) (r.ok ? log.log : log.warn)('[supplier catalogs] ' + r.name + ': ' + (r.ok ? 'ready in ' + Math.round(r.ms / 1000) + ' s' : 'not read: ' + r.error));
  });
  setTimeout(run, WARM_AFTER_START_MS).unref?.();
  setInterval(run, WARM_EVERY_MS).unref?.();
}
