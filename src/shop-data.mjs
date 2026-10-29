// Shop Data: every Etsy listing of the shop as one CSV row (with its views,
// favourites and sales count), and a ChatGPT prompt for auditing it (the
// shop's facts filled in), for /shop-data. Read-only; no customer or order
// details: sales are only counted.
import { getShopListings, getShopSections } from './etsy.mjs';
import { listingSalesCount } from './listing-reposter.mjs';

export const STATES = ['active', 'draft', 'inactive', 'sold_out', 'expired'];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const credentials = session => ({ shopId: session.shop.shop_id, keystring: session.keystring, sharedSecret: session.sharedSecret, accessToken: session.accessToken });

// The shop as read from Etsy: { shop, listings, sections, sales } (sales by
// listing ID; drafts have none). onProgress({ step, read, total }) as it goes.
export async function fetchShopData(session, { listings = getShopListings, sections = getShopSections, sales = listingSalesCount,
  onProgress = () => {}, wait = sleep, lanes = 3 } = {}) {
  const all = [], seen = new Set();
  for (const state of STATES) {
    for (let offset = 0; offset < 10000; offset += 100) {
      const page = await etsyCall(() => listings({ ...credentials(session), state, limit: 100, offset, includes: 'Images' }), wait);
      const rows = Array.isArray(page?.results) ? page.results : [];
      for (const row of rows) if (!seen.has(String(row.listing_id))) { seen.add(String(row.listing_id)); all.push(row); }
      onProgress({ step: 'listings', read: all.length, total: null });
      if (rows.length < 100) break;
    }
  }
  const shopSections = (await etsyCall(() => sections(credentials(session)), wait))?.results || [];
  // One transaction count per listing that can have sold, a few at a time.
  const counted = all.filter(listing => listing.state !== 'draft'), sold = {};
  let next = 0, done = 0;
  onProgress({ step: 'sales', read: 0, total: counted.length });
  await Promise.all(Array.from({ length: Math.min(lanes, counted.length) }, async () => {
    while (next < counted.length) {
      const listing = counted[next++];
      try { sold[listing.listing_id] = await etsyCall(() => sales(session, listing.listing_id), wait); }
      catch { sold[listing.listing_id] = null; }
      onProgress({ step: 'sales', read: ++done, total: counted.length });
    }
  }));
  return { shop: session.shop || {}, listings: all, sections: shopSections, sales: sold };
}
// Etsy allows a few requests a second; a 429 is waited out and tried again.
async function etsyCall(call, wait) {
  for (let attempt = 0; ; attempt++) {
    try { return await call(); }
    catch (error) {
      if (attempt >= 4 || !/\b429\b/.test(String(error?.message))) throw error;
      await wait(1500 * (attempt + 1));
    }
  }
}

// Plain text of a description, one line per paragraph joined by ' / '.
export function plainText(text) {
  return String(text || '').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .split('\n').map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' / ');
}
const emptyAlt = alt => !String(alt || '').trim() || /^[0-9a-f-]{20,}$/i.test(String(alt).trim()) || /\.(jpe?g|png|webp)$/i.test(String(alt).trim());
const day = seconds => seconds ? new Date(Number(seconds) * 1000).toISOString().slice(0, 10) : '';
const price = value => value?.divisor ? (Number(value.amount) / Number(value.divisor)).toFixed(2) : '';

export const COLUMNS = ['SKUs', 'Title', 'State', 'Listing URL', 'Section', 'Price', 'Currency', 'Quantity', 'Views', 'Favourites', 'Sales',
  'Tags', 'Tag count', 'Materials', 'Styles', 'Description', 'Photos', 'Photos without useful alt text', 'Example alt text',
  'Has variations', 'Personalisable', 'Who made', 'When made', 'Auto-renew', 'Processing days', 'Created', 'Updated', 'Expires', 'Listing ID'];

export function listingRow(listing, { sections = [], sales = {} } = {}) {
  const section = sections.find(s => String(s.shop_section_id) === String(listing.shop_section_id));
  const alts = (listing.images || []).map(image => image?.alt_text || '');
  const tags = listing.tags || [];
  const sold = sales[listing.listing_id];
  const processing = [listing.processing_min, listing.processing_max].filter(n => n != null);
  return {
    'SKUs': (listing.skus || []).filter(Boolean).join(', '),
    'Title': listing.title || '',
    'State': listing.state || '',
    'Listing URL': listing.state === 'active' ? String(listing.url || '').split('?')[0] : '',
    'Section': section?.title || '',
    'Price': price(listing.price),
    'Currency': listing.price?.currency_code || '',
    'Quantity': listing.quantity ?? '',
    'Views': listing.views ?? '',
    'Favourites': listing.num_favorers ?? '',
    'Sales': listing.state === 'draft' ? '' : sold ?? '',
    'Tags': tags.join(', '),
    'Tag count': tags.length,
    'Materials': (listing.materials || []).join(', '),
    'Styles': (listing.style || []).join(', '),
    'Description': plainText(listing.description).slice(0, 3000),
    'Photos': alts.length,
    'Photos without useful alt text': alts.filter(emptyAlt).length,
    'Example alt text': alts.find(alt => !emptyAlt(alt)) || '',
    'Has variations': listing.has_variations ? 'yes' : 'no',
    'Personalisable': listing.is_personalizable ? 'yes' : 'no',
    'Who made': listing.who_made || '',
    'When made': listing.when_made || '',
    'Auto-renew': listing.should_auto_renew ? 'yes' : 'no',
    'Processing days': [...new Set(processing)].join('–'),
    'Created': day(listing.original_creation_timestamp || listing.created_timestamp || listing.creation_timestamp),
    'Updated': day(listing.last_modified_timestamp || listing.updated_timestamp),
    'Expires': day(listing.ending_timestamp),
    'Listing ID': String(listing.listing_id || '')
  };
}

// RFC 4180 CSV, with a byte-order mark so Excel reads accents.
export function toCsv(rows, columns = COLUMNS) {
  const cell = value => {
    const text = String(value ?? '');
    return /[",\n\r]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  };
  return '﻿' + [columns.map(cell).join(','), ...rows.map(row => columns.map(column => cell(row[column])).join(','))].join('\r\n') + '\r\n';
}

// The facts the prompt and the page show.
export function summarize(rows, sections = []) {
  const active = rows.filter(row => row.State === 'active');
  const count = (list, test) => list.filter(test).length;
  const sum = key => active.reduce((total, row) => total + (Number(row[key]) || 0), 0);
  const titles = new Map();
  for (const row of rows) { const key = row.Title.trim().toLowerCase(); titles.set(key, (titles.get(key) || 0) + 1); }
  const byState = {};
  for (const row of rows) byState[row.State] = (byState[row.State] || 0) + 1;
  return {
    listings: rows.length, byState, active: active.length,
    views: sum('Views'), favourites: sum('Favourites'), sales: sum('Sales'),
    salesUnknown: count(rows, row => row.State !== 'draft' && row.Sales === ''),
    noSales: count(active, row => row.Sales === 0), noViews: count(active, row => Number(row.Views) === 0),
    under13Tags: count(active, row => row['Tag count'] < 13), noSection: count(active, row => !row.Section),
    fewPhotos: count(active, row => row.Photos < 5), altMissing: count(active, row => row['Photos without useful alt text'] > 0),
    duplicateTitles: [...titles.values()].filter(n => n > 1).reduce((total, n) => total + n, 0),
    sections: sections.length, emptySections: sections.filter(s => !Number(s.active_listing_count)).length
  };
}

export function auditPrompt({ shop = {}, summary, sections = [], sells = 'wall art prints in many sizes and formats' }) {
  const state = Object.entries(summary.byState).map(([name, n]) => n + ' ' + name.replace('_', ' ')).join(', ');
  const used = sections.filter(s => Number(s.active_listing_count)).map(s => s.title + ' (' + s.active_listing_count + ')');
  const empty = sections.filter(s => !Number(s.active_listing_count)).map(s => s.title);
  const name = shop.shop_name || '';
  return [
    'You are an Etsy SEO and merchandising expert. Audit my Etsy shop ' + name + (name ? ' (etsy.com/shop/' + name + ')' : '') + ', which sells ' + sells + '.',
    shop.title ? 'Shop title: ' + shop.title + '.' : '',
    '',
    'The attached CSV has one row per listing: its SKUs, title, state (active, draft, inactive, sold out or expired), URL, section, price, quantity, views, favourites, number of sales (counted from Etsy transactions over the listing\'s life), tags and tag count, materials, styles, description, photo count, how many photos lack useful alt text, variations, who and when made, auto-renew, processing time and dates. Views and favourites are Etsy\'s lifetime numbers for the listing.',
    '',
    'Shop facts: ' + summary.listings + ' listings (' + state + '). Active listings together have ' + summary.views + ' views, ' + summary.favourites + ' favourites and ' + summary.sales + ' sales. ' +
      'Of the ' + summary.active + ' active listings, ' + summary.noSales + ' have never sold, ' + summary.noViews + ' have no views, ' + summary.under13Tags + ' use fewer than 13 tags, ' +
      summary.noSection + ' are in no section, ' + summary.fewPhotos + ' have fewer than 5 photos and ' + summary.altMissing + ' have photos without useful alt text' +
      (summary.duplicateTitles ? '; ' + summary.duplicateTitles + ' listings share a title with another' : '') + '.' +
      (summary.salesUnknown ? ' Sales could not be counted for ' + summary.salesUnknown + ' listings (blank in the CSV).' : ''),
    'Sections with active listings: ' + (used.join(', ') || 'none') + '.',
    empty.length ? 'Empty sections (' + empty.length + '): ' + empty.join(', ') + '.' : '',
    '',
    'Please give me:',
    '1. The 10 most important problems across the shop, most valuable to fix first, each with how many listings it affects.',
    '2. Conversion: listings with many views or favourites but few or no sales, and what to change on each (price, photos, title, description).',
    '3. Visibility: active listings with few views, and why Etsy search may not be showing them.',
    '4. Titles: rewrite the 15 weakest (clear and descriptive, the most important search phrase first, no repetition or keyword stuffing).',
    '5. Tags: listings not using all 13 tags, weak or duplicate tags, and long-tail tag phrases buyers search for that I should add.',
    '6. Descriptions: whether the first lines describe the artwork and answer buyers\' questions; propose a reusable structure.',
    '7. Photos: listings with too few photos or without alt text, and an alt-text pattern to use.',
    '8. Sections and attributes: listings in the wrong or no section, sections to merge or fill, and missing styles or materials.',
    '9. Pricing and state: price inconsistencies between similar listings, and inactive or expired listings worth renewing.',
    'Refer to listings by their SKU (or listing ID) and title. Be specific and practical; put the fixes in a table where it helps.'
  ].join('\n').replace(/\n{3,}/g, '\n\n');
}

const slug = text => String(text || 'shop').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'shop';

// The /shop-data page and its API. The shop is read in the background (a few
// hundred listings take a minute or two: each one's sales are counted) and
// kept for maxAge; the page polls GET /api/shop-data until it is ready.
export function shopData({ session, read = fetchShopData, now = Date.now, maxAge = 60 * 60 * 1000, sells, renderPage } = {}) {
  let snapshot = null, reading = null, progress = { step: 'listings', read: 0, total: null }, failure = null;
  function start() {
    if (reading) return reading;
    progress = { step: 'listings', read: 0, total: null }; failure = null;
    reading = Promise.resolve().then(async () => {
      try {
        const data = await read(await session(), { onProgress: step => { progress = step; } });
        const rows = data.listings.map(listing => listingRow(listing, data));
        const summary = summarize(rows, data.sections);
        snapshot = { shop: data.shop, rows, summary, prompt: auditPrompt({ shop: data.shop, summary, sections: data.sections, sells }), readAt: now() };
      } catch (error) {
        failure = error?.message || String(error);
      } finally { reading = null; }
    });
    return reading;
  }
  const fresh = () => snapshot && now() - snapshot.readAt < maxAge;
  const view = snap => snap && ({ shop: { name: snap.shop.shop_name || '' }, summary: snap.summary, prompt: snap.prompt, readAt: new Date(snap.readAt).toISOString() });
  // The last reading stays shown while a new one runs or after one fails.
  function state() {
    const state = reading ? 'reading' : failure ? 'failed' : snapshot ? 'ready' : 'idle';
    return { ok: true, state, progress, error: failure || '', snapshot: view(snapshot) };
  }
  async function handle(req, res, url, { sendJson, sendHtml }) {
    if (req.method === 'GET' && url.pathname === '/shop-data') return sendHtml(res, 200, renderPage()), true;
    if (req.method === 'GET' && url.pathname === '/api/shop-data') {
      // ?again=1 reads the shop again; otherwise a reading older than maxAge is
      // renewed, but a failed one waits for ?again=1.
      if (url.searchParams.get('again') === '1' || (!fresh() && !failure)) start();
      return sendJson(res, 200, state()), true;
    }
    if (req.method === 'GET' && url.pathname === '/api/shop-data/export.csv') {
      if (!snapshot) { if (!failure) start(); return sendJson(res, 409, { ok: false, error: 'The shop is still being read. Try again in a minute.' }), true; }
      const body = Buffer.from(toCsv(snapshot.rows));
      const date = new Date(snapshot.readAt).toISOString().slice(0, 10);
      res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-length': body.length, 'cache-control': 'private, no-store',
        'content-disposition': `attachment; filename="${slug(snapshot.shop.shop_name)}-shop-data-${date}.csv"`, 'x-content-type-options': 'nosniff' });
      res.end(body);
      return true;
    }
    return false;
  }
  return { handle, start, state };
}
