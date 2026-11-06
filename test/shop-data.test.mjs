import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fetchShopData, plainText, listingRow, COLUMNS, toCsv, summarize, auditPrompt, shopData, STATES } from '../src/shop-data.mjs';
import { renderShopDataPage } from '../src/shop-data-page.mjs';
import { ADMIN_LINKS } from '../src/admin-sidebar.mjs';
const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');

const session = { shop: { shop_id: 77, shop_name: 'SilviaArtCollective', title: 'Calm wall art for modern homes' }, keystring: 'k', sharedSecret: 's', accessToken: 't' };
const sections = [{ shop_section_id: 5, title: 'Abstract', active_listing_count: 12 }, { shop_section_id: 6, title: 'Botanical', active_listing_count: 0 }];
const listing = (id, extra = {}) => ({
  listing_id: id, title: 'Sage Green Abstract Print ' + id, state: 'active', url: 'https://www.etsy.com/listing/' + id + '/sage?utm_source=api',
  description: 'Soft sage shapes.\n\nPrinted on museum paper &amp; canvas.', shop_section_id: 5, quantity: 999, views: 120, num_favorers: 9,
  tags: ['sage green art', 'abstract print'], materials: ['paper'], style: ['Minimalist'], skus: ['SAC0042-P-12x16', ''],
  price: { amount: 2499, divisor: 100, currency_code: 'USD' }, has_variations: true, is_personalizable: false, who_made: 'i_did', when_made: 'made_to_order',
  should_auto_renew: true, processing_min: 2, processing_max: 4, original_creation_timestamp: 1759312800, last_modified_timestamp: 1759399200, ending_timestamp: 1769680800,
  images: [{ alt_text: '' }, { alt_text: 'Sage green abstract print above a sofa' }],
  ...extra
});

test('Shop Data: one row per Etsy listing, with its views, favourites and sales', () => {
  const row = listingRow(listing(42), { sections, sales: { 42: 3 } });
  assert.deepEqual(Object.keys(row), COLUMNS);
  assert.equal(row.SKUs, 'SAC0042-P-12x16');
  assert.equal(row['Listing URL'], 'https://www.etsy.com/listing/42/sage');
  assert.equal(row.Section, 'Abstract');
  assert.equal(row.Price, '24.99');
  assert.equal(row.Currency, 'USD');
  assert.equal(row.Views, 120);
  assert.equal(row.Favourites, 9);
  assert.equal(row.Sales, 3);
  assert.equal(row['Tag count'], 2);
  assert.equal(row.Description, 'Soft sage shapes. / Printed on museum paper & canvas.');
  assert.equal(row.Photos, 2);
  assert.equal(row['Photos without useful alt text'], 1);
  assert.equal(row['Example alt text'], 'Sage green abstract print above a sofa');
  assert.equal(row['Processing days'], '2–4');
  assert.equal(row.Created, '2025-10-01');
  assert.equal(row['Listing ID'], '42');
  // A draft has no URL and no sales; an uncounted listing's sales are blank.
  const draft = listingRow(listing(7, { state: 'draft', shop_section_id: null }), { sections, sales: {} });
  assert.equal(draft['Listing URL'], '');
  assert.equal(draft.Sales, '');
  assert.equal(draft.Section, '');
  assert.equal(listingRow(listing(8), { sections, sales: { 8: null } }).Sales, '');
  assert.equal(plainText('a\n\n  b   c\n'), 'a / b c');
});

test('Shop Data: the CSV opens in Excel with its accents and quoted cells', () => {
  assert.equal(toCsv([{ a: 'Café, "art"', b: 'x\ny' }, { a: 0 }], ['a', 'b']), '﻿a,b\r\n"Café, ""art""","x\ny"\r\n0,\r\n');
});

test('Shop Data: the summary and the audit prompt carry the shop\'s own numbers', () => {
  const rows = [
    listingRow(listing(1), { sections, sales: { 1: 4 } }),
    listingRow(listing(2, { title: 'Sage Green Abstract Print 1', views: 0, num_favorers: 0, shop_section_id: null, images: [] }), { sections, sales: { 2: 0 } }),
    listingRow(listing(3, { state: 'expired' }), { sections, sales: {} })
  ];
  const summary = summarize(rows, sections);
  assert.deepEqual(summary, { listings: 3, byState: { active: 2, expired: 1 }, active: 2, views: 120, favourites: 9, sales: 4, salesUnknown: 1,
    noSales: 1, noViews: 1, under13Tags: 2, noSection: 1, fewPhotos: 2, altMissing: 1, duplicateTitles: 2, sections: 2, emptySections: 1 });
  const prompt = auditPrompt({ shop: session.shop, summary, sections, sells: 'wall art prints' });
  assert.match(prompt, /^You are an Etsy SEO and merchandising expert\. Audit my Etsy shop SilviaArtCollective \(etsy\.com\/shop\/SilviaArtCollective\), which sells wall art prints\.\nShop title: Calm wall art for modern homes\./);
  assert.match(prompt, /Shop facts: 3 listings \(2 active, 1 expired\)\. Active listings together have 120 views, 9 favourites and 4 sales\. Of the 2 active listings, 1 have never sold, 1 have no views, 2 use fewer than 13 tags, 1 are in no section, 2 have fewer than 5 photos and 1 have photos without useful alt text; 2 listings share a title with another\. Sales could not be counted for 1 listings/);
  assert.match(prompt, /Sections with active listings: Abstract \(12\)\.\nEmpty sections \(1\): Botanical\./);
  assert.match(prompt, /Refer to listings by their SKU \(or listing ID\) and title\./);
  assert.doesNotMatch(prompt, /\n\n\n/);
});

test('Shop Data: reads every state and page of listings with their photos, then counts sales a few at a time', async () => {
  const calls = [], progress = [];
  let tries = 0;
  const listings = async ({ state, offset, includes, shopId }) => {
    calls.push(state + '@' + offset);
    assert.equal(includes, 'Images');
    assert.equal(shopId, 77);
    if (state === 'active' && offset === 0) return { results: Array.from({ length: 100 }, (_, i) => listing(1000 + i)) };
    if (state === 'active') return { results: [listing(2000), listing(1000)] };
    if (state === 'draft') return { results: [listing(3000, { state: 'draft' })] };
    // Etsy's rate limit is waited out and tried again.
    if (state === 'expired' && tries++ === 0) throw Error('Etsy listings fetch failed (429): slow down');
    return { results: [] };
  };
  let busy = 0, most = 0;
  const sales = async (s, id) => {
    busy++; most = Math.max(most, busy); await new Promise(setImmediate); busy--;
    if (id === 1001) throw Error('Etsy API 500: broken');
    return id === 2000 ? 5 : 0;
  };
  const waits = [];
  const data = await fetchShopData(session, { listings, sections: async () => ({ results: sections }), sales, onProgress: p => progress.push(p), wait: async ms => { waits.push(ms); } });
  assert.deepEqual(calls, ['active@0', 'active@100', 'draft@0', 'inactive@0', 'sold_out@0', 'expired@0', 'expired@0']);
  assert.deepEqual(STATES, ['active', 'draft', 'inactive', 'sold_out', 'expired']);
  assert.deepEqual(waits, [1500]);
  assert.equal(data.listings.length, 102, 'a listing seen twice is kept once');
  assert.equal(data.sections.length, 2);
  assert.equal(data.sales[2000], 5);
  assert.equal(data.sales[1001], null);
  assert.equal(data.sales[3000], undefined, 'drafts are not counted');
  assert.equal(Object.keys(data.sales).length, 101);
  assert.equal(most, 3);
  assert.deepEqual(progress.at(-1), { step: 'sales', read: 101, total: 101 });
  assert.ok(progress.some(p => p.step === 'listings' && p.read === 100));
});

function fakeRes() {
  return { code: 0, headers: {}, body: null, writeHead(code, headers) { this.code = code; this.headers = headers; }, end(body) { this.body = body; } };
}
const helpers = { sendJson: (res, code, obj) => { res.code = code; res.body = obj; }, sendHtml: (res, code, page) => { res.code = code; res.body = page; } };
const ask = async (store, path) => { const res = fakeRes(); const handled = await store.handle({ method: 'GET' }, res, new URL('http://x' + path), helpers); return { handled, res }; };

test('Shop Data: the shop is read in the background, kept for an hour and downloaded as a CSV', async () => {
  let clock = Date.parse('2026-10-29T12:00:00Z'), reads = 0, release;
  const read = async (s, { onProgress }) => {
    assert.equal(s, session);
    reads++; onProgress({ step: 'sales', read: 1, total: 2 });
    await new Promise(resolve => { release = resolve; });
    return { shop: s.shop, listings: [listing(1), listing(2)], sections, sales: { 1: 2, 2: 0 } };
  };
  const store = shopData({ session: async () => session, read, now: () => clock, renderPage: () => '<page>' });
  assert.equal((await ask(store, '/shop-data')).res.body, '<page>');
  assert.equal((await ask(store, '/api/other')).handled, false);
  assert.equal((await ask(store, '/api/shop-data/export.csv')).res.code, 409);
  await new Promise(setImmediate);
  let state = (await ask(store, '/api/shop-data')).res.body;
  assert.equal(state.state, 'reading');
  assert.deepEqual(state.progress, { step: 'sales', read: 1, total: 2 });
  assert.equal(reads, 1);
  release(); await new Promise(setImmediate);
  state = (await ask(store, '/api/shop-data')).res.body;
  assert.equal(state.state, 'ready');
  assert.equal(state.snapshot.shop.name, 'SilviaArtCollective');
  assert.equal(state.snapshot.summary.sales, 2);
  const csv = (await ask(store, '/api/shop-data/export.csv')).res;
  assert.equal(csv.code, 200);
  assert.equal(csv.headers['content-disposition'], 'attachment; filename="silviaartcollective-shop-data-2026-10-29.csv"');
  assert.equal(csv.body.toString().split('\r\n').length, 4);
  clock += 59 * 60 * 1000;
  await ask(store, '/api/shop-data');
  assert.equal(reads, 1);
  await ask(store, '/api/shop-data?again=1'); await new Promise(setImmediate);
  assert.equal(reads, 2);
  release(); await new Promise(setImmediate);
});

test('Shop Data: a failed reading is shown and waits to be asked again', async () => {
  let reads = 0;
  const store = shopData({ session: async () => { reads++; throw Error('ETSY_REFRESH_TOKEN must be configured in Render.'); }, renderPage: () => '' });
  await ask(store, '/api/shop-data'); await new Promise(setImmediate);
  const state = (await ask(store, '/api/shop-data')).res.body;
  assert.equal(state.state, 'failed');
  assert.match(state.error, /ETSY_REFRESH_TOKEN/);
  assert.equal(reads, 1);
  await ask(store, '/api/shop-data?again=1'); await new Promise(setImmediate);
  assert.equal(reads, 2);
});

test('Shop Data: the page, its script, its admin-only routes and its place in the sidebar', () => {
  const page = renderShopDataPage(), server = read('src/server.mjs');
  assert.match(page, /<a class="button primary" id="sd-download" href="\/api\/shop-data\/export\.csv" aria-disabled="true">Download shop data \(\.csv\)<\/a>/);
  assert.match(page, /<script src="\/shop-data-client\.js" defer><\/script>/);
  assert.match(server, /if \(url\.pathname === '\/shop-data' \? !requireAdminPage\(req,res,'\/shop-data'\) : !requireAdminApi\(req,res\)\) return;\n    if \(await shopDataStore\.handle\(req,res,url,\{sendJson,sendHtml\}\)\) return;/);
  assert.match(server, /'\/shop-data-client\.js'\]\.includes\(url\.pathname\)/);
  assert.ok(ADMIN_LINKS.some(link => link.href === '/shop-data' && link.label === 'Shop Data'));
  assert.doesNotThrow(() => new Function(read('src/shop-data-client.js')));
});
