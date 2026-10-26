import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

// R2 stand-in for the renewal records (GET/HEAD/PUT/DELETE).
const objects = new Map();
const r2 = http.createServer(async (req, res) => {
  const key = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/[^/]+\/?/, '');
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  if (req.method === 'PUT') {
    let body = Buffer.concat(chunks);
    if (String(req.headers['content-encoding'] || '').includes('aws-chunked')) {
      const parts = []; let o = 0;
      while (o < body.length) { const e = body.indexOf('\r\n', o); const n = parseInt(body.subarray(o, e).toString().split(';')[0], 16); if (!n) break; parts.push(body.subarray(e + 2, e + 2 + n)); o = e + 2 + n + 2; }
      body = Buffer.concat(parts);
    }
    objects.set(key, { body, type: req.headers['content-type'] || 'application/octet-stream' });
    res.writeHead(200, { etag: '"x"' }); return res.end();
  }
  if (req.method === 'DELETE') { objects.delete(key); res.writeHead(204); return res.end(); }
  const o = objects.get(key);
  if (!o) { res.writeHead(404, { 'content-type': 'application/xml' }); return res.end(req.method === 'HEAD' ? undefined : '<Error><Code>NoSuchKey</Code></Error>'); }
  res.writeHead(200, { 'content-type': o.type, 'content-length': o.body.length });
  res.end(req.method === 'HEAD' ? undefined : o.body);
});
await new Promise(resolve => r2.listen(0, '127.0.0.1', resolve));
Object.assign(process.env, { R2_ACCOUNT_ID: 't', R2_ACCESS_KEY_ID: 't', R2_SECRET_ACCESS_KEY: 't', R2_BUCKET_NAME: 'renew-test',
  R2_ENDPOINT: 'http://127.0.0.1:' + r2.address().port, R2_REGION: 'auto' });
test.after(() => r2.close());

// Etsy stand-in: listings, inventory, photos, videos, sales, publish and delete.
const SHOP = 77;
// Every listing renews in 2 days and was refreshed long ago: each unsold one is due for a repost.
const NOW = 2e9;
const etsy = { listings: new Map(), inventory: new Map(), images: new Map(), videos: new Map(), sales: new Map(),
  forms: new Map(), nextId: 9000, nextImage: 50000, calls: [] };
function addListing(id, { title, created, sales = 0, photos = 20, video = true }) {
  etsy.listings.set(id, { listing_id: id, shop_id: SHOP, state: 'active', title, tags: ['old tag one', 'old tag two'],
    description: 'Old description', price: { amount: 3000, divisor: 100 }, quantity: 999, taxonomy_id: 2078,
    shipping_profile_id: 5, readiness_state_id: 6, return_policy_id: 7, shop_section_id: 111, who_made: 'i_did',
    when_made: 'made_to_order', is_supply: false, should_auto_renew: true, original_creation_timestamp: created,
    ending_timestamp: NOW + 2 * 86400 });
  etsy.inventory.set(id, { products: [
    { sku: 'SAC' + id + '-P-1218', offerings: [{ price: { amount: 3000, divisor: 100 }, quantity: 999, is_enabled: true }],
      property_values: [{ property_id: 513, property_name: 'Size', value_ids: [1], values: ['12x18'] }] },
    { sku: 'SAC' + id + '-C-2436', offerings: [{ price: { amount: 9000, divisor: 100 }, quantity: 999, is_enabled: true }],
      property_values: [{ property_id: 513, property_name: 'Size', value_ids: [2], values: ['24x36'] }] }
  ], price_on_property: [513], quantity_on_property: [], sku_on_property: [513] });
  etsy.images.set(id, Array.from({ length: photos }, (_, i) => ({ listing_image_id: id * 100 + i, rank: i + 1,
    url_fullxfull: 'https://i.etsystatic.com/x/' + id + '-' + (i + 1) + '.jpg', alt_text: 'photo ' + (i + 1) })));
  etsy.videos.set(id, video ? [{ video_id: 700 + id }] : []);
  etsy.sales.set(id, sales);
}
const json = (body, status = 200) => new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(String(input));
  if (url.hostname === 'i.etsystatic.com') return new Response(Buffer.from('jpeg:' + url.pathname));
  if (url.hostname !== 'api.etsy.com') return realFetch(input, options);
  const method = options.method || 'GET', path = url.pathname.replace('/v3/application', '');
  etsy.calls.push(method + ' ' + path);
  let m;
  if ((m = path.match(/^\/listings\/(\d+)$/))) {
    const id = Number(m[1]);
    if (method === 'DELETE') { etsy.listings.delete(id); return json(null, 204); }
    return etsy.listings.has(id) ? json(etsy.listings.get(id)) : json({ error: 'not found' }, 404);
  }
  if ((m = path.match(/^\/shops\/77\/listings\/(\d+)\/transactions$/))) return json({ count: etsy.sales.get(Number(m[1])) || 0, results: [] });
  if ((m = path.match(/^\/listings\/(\d+)\/inventory$/))) {
    const id = Number(m[1]);
    // Etsy gives each option value an ID.
    if (method === 'PUT') etsy.inventory.set(id, { ...JSON.parse(options.body), products: JSON.parse(options.body).products.map(product => ({
      ...product, property_values: product.property_values.map(v => ({ ...v, value_ids: v.values.map((_, i) => 9000 + i) })) })) });
    return json(etsy.inventory.get(id));
  }
  if ((m = path.match(/^\/shops\/77\/listings\/(\d+)\/properties$/))) return json({ results: [{ property_id: 200, value_ids: [1], values: ['Minimalist'] }] });
  if (path.match(/^\/shops\/77\/listings\/(\d+)\/properties\/\d+$/)) return json({});
  if ((m = path.match(/^\/listings\/(\d+)\/images$/))) return json({ results: etsy.images.get(Number(m[1])) || [] });
  if ((m = path.match(/^\/listings\/(\d+)\/videos$/))) return json({ results: etsy.videos.get(Number(m[1])) || [] });
  if (path.match(/^\/shops\/77\/listings\/\d+\/variation-images$/)) return json({ results: [] });
  if (path === '/shops/77/listings' && method === 'POST') {
    const form = new URLSearchParams(String(options.body));
    const id = ++etsy.nextId;
    etsy.forms.set(id, Object.fromEntries(form));
    etsy.listings.set(id, { listing_id: id, shop_id: SHOP, state: 'draft', title: form.get('title'),
      tags: String(form.get('tags') || '').split(','), description: form.get('description'),
      shop_section_id: Number(form.get('shop_section_id')), original_creation_timestamp: 2e9 });
    etsy.images.set(id, []); etsy.videos.set(id, []); etsy.sales.set(id, 0);
    return json({ listing_id: id, state: 'draft' }, 201);
  }
  if ((m = path.match(/^\/shops\/77\/listings\/(\d+)\/images$/)) && method === 'POST') {
    const id = Number(m[1]), image = { listing_image_id: ++etsy.nextImage, rank: Number(options.body.get('rank')),
      url_fullxfull: 'https://i.etsystatic.com/new/' + etsy.nextImage + '.jpg', alt_text: options.body.get('alt_text') || '' };
    etsy.images.get(id).push(image);
    return json(image, 201);
  }
  if ((m = path.match(/^\/shops\/77\/listings\/(\d+)\/videos$/)) && method === 'POST') {
    etsy.videos.get(Number(m[1])).push({ video_id: Number(options.body.get('video_id')) });
    return json({}, 201);
  }
  if ((m = path.match(/^\/shops\/77\/listings\/(\d+)$/)) && method === 'PATCH') {
    const listing = etsy.listings.get(Number(m[1]));
    for (const [k, v] of new URLSearchParams(String(options.body))) listing[k] = v;
    return json(listing);
  }
  return json({ error: 'unexpected ' + method + ' ' + path }, 500);
};
test.after(() => { globalThis.fetch = realFetch; });

const { startRenewal, renewalRunning, oldestFirst } = await import('../src/listing-renewer.mjs');
const reposter = await import('../src/listing-reposter.mjs');
const { getJsonObject } = await import('../src/r2.mjs');
const session = { shop: { shop_id: SHOP, shop_name: 'TestShop' }, keystring: 'k', sharedSecret: 's', accessToken: 'a' };

function deps({ saved, onPrepared = () => {}, template = null } = {}) {
  let n = 0;
  return {
    newId: () => 'job-' + ++n,
    now: () => NOW * 1000,
    saveJob: async job => { saved.job = structuredClone(job); },
    refreshedListings: async () => Object.fromEntries([...etsy.listings.keys()].map(id => [id, { at: '2001-01-01T00:00:00.000Z' }])),
    forgetRefreshed: async () => {},
    listActive: async () => [...etsy.listings.values()].filter(item => item.state === 'active'),
    // These listings' artworks are not in the app: they are copied.
    describe: async () => null,
    salesCount: id => reposter.listingSalesCount(session, id),
    record: async id => { try { return await getJsonObject('reposter/' + SHOP + '/' + id + '/replacement.json'); } catch { return null; } },
    newSeo: async id => ({ title: 'New Title For ' + id, description: 'New description ' + id,
      tags: ['new tag a', 'new tag b', 'new tag c'] }),
    prepare: async (id, input) => { const out = await reposter.prepareReplacement(session, id, input, { automatic: true, template }); onPrepared(id); return out; },
    finalize: id => reposter.finalizeReplacement(session, id, 'PUBLISH AND DELETE OLD', { deleteOld: true })
  };
}
async function finished() {
  for (let i = 0; i < 400 && renewalRunning(); i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(renewalRunning(), false);
}

test('oldest first, by when the listing was first created', () => {
  assert.deepEqual(oldestFirst([{ listing_id: 3, original_creation_timestamp: 30 }, { listing_id: 1 },
    { listing_id: 2, original_creation_timestamp: 10 }]).map(item => item.listing_id), [2, 3, 1]);
});

test('Renew 2: the two oldest unsold listings are posted again with new SEO, then deleted', async () => {
  addListing(101, { title: 'Oldest unsold', created: 1.0e9 });
  addListing(102, { title: 'Old but sold', created: 1.1e9, sales: 3 });
  addListing(103, { title: 'Second oldest unsold', created: 1.2e9, photos: 7, video: false });
  addListing(104, { title: 'Newest', created: 1.9e9 });
  const saved = {};
  await startRenewal(deps({ saved }), { count: 2 });
  await assert.rejects(startRenewal(deps({ saved }), { count: 1 }), /already running/);
  await finished();
  const job = saved.job;
  assert.equal(job.status, 'done', job.error);
  assert.deepEqual(job.results.map(row => [row.listingId, row.status]), [[101, 'done'], [103, 'done']], JSON.stringify(job.results));
  // The old listings are gone; the sold one and the newest one are untouched.
  assert.equal(etsy.listings.has(101), false);
  assert.equal(etsy.listings.has(103), false);
  assert.equal(etsy.listings.get(102).state, 'active');
  assert.equal(etsy.listings.get(104).state, 'active');
  for (const [row, photos, videos] of [[job.results[0], 20, 1], [job.results[1], 7, 0]]) {
    const fresh = etsy.listings.get(row.newListingId);
    assert.equal(fresh.state, 'active');
    assert.equal(fresh.title, 'New Title For ' + row.listingId);
    assert.deepEqual(fresh.tags, ['new tag a', 'new tag b', 'new tag c']);
    assert.equal(fresh.shop_section_id, 111);
    const images = etsy.images.get(row.newListingId);
    assert.equal(images.length, photos);
    assert.deepEqual(images.map(image => image.rank), Array.from({ length: photos }, (_, i) => i + 1));
    assert.equal(images[0].alt_text, 'photo 1');
    assert.equal(etsy.videos.get(row.newListingId).length, videos);
    assert.equal(etsy.inventory.get(row.newListingId).products.length, 2);
  }
  assert.deepEqual(etsy.videos.get(job.results[0].newListingId), [{ video_id: 801 }]);
  const record = await getJsonObject('reposter/77/101/replacement.json');
  assert.equal(record.status, 'completed');
  assert.equal(record.oldDeleted, true);
  // Published before the old one was deleted.
  const publish = etsy.calls.lastIndexOf('PATCH /shops/77/listings/' + job.results[0].newListingId);
  assert.ok(publish >= 0 && publish < etsy.calls.indexOf('DELETE /listings/101'));
});

test('a listing that sells while it is being copied is kept, and its copy is not published', async () => {
  addListing(201, { title: 'Sells during copy', created: 0.5e9, photos: 3 });
  const saved = {};
  await startRenewal(deps({ saved, onPrepared: id => etsy.sales.set(id, 1) }), { count: 1 });
  await finished();
  const row = saved.job.results[0];
  assert.equal(row.listingId, 201);
  assert.equal(row.status, 'failed');
  assert.match(row.error, /has sales since preparation/);
  assert.equal(etsy.listings.get(201).state, 'active');
  const record = await getJsonObject('reposter/77/201/replacement.json');
  assert.equal(etsy.listings.get(record.draftId).state, 'draft');
});

test('when the sales check fails, the listing is treated as sold and skipped', async () => {
  for (const id of [...etsy.listings.keys()]) etsy.listings.get(id).state = 'inactive';
  addListing(301, { title: 'Sales unknown', created: 0.1e9, photos: 2 });
  addListing(302, { title: 'Unsold', created: 0.2e9, photos: 2 });
  const saved = {};
  const d = deps({ saved });
  const salesCount = d.salesCount;
  d.salesCount = id => (Number(id) === 301 ? Promise.reject(Error('Etsy down')) : salesCount(id));
  await startRenewal(d, { count: 5 });
  await finished();
  assert.deepEqual(saved.job.results.map(row => row.listingId), [302]);
  assert.equal(etsy.listings.get(301).state, 'active');
  assert.equal(saved.job.status, 'done');
});

// What the server's repostTemplate gives an app-made listing: today's sizes and prices.
const currentTemplate = attributes => async ({ listing }) => ({
  listing: { price: 45, quantity: 999, shipping_profile_id: 55, readiness_state_id: 66, return_policy_id: 77 },
  inventory: { products: [
    { sku: 'SAC' + listing.listing_id + '-P-1624', offerings: [{ price: 45, quantity: 999, is_enabled: true }],
      property_values: [{ property_id: 513, property_name: 'Size', value_ids: [], values: ['16x24'] }] },
    { sku: 'SAC' + listing.listing_id + '-P-2030', offerings: [{ price: 65, quantity: 999, is_enabled: true }],
      property_values: [{ property_id: 513, property_name: 'Size', value_ids: [], values: ['20x30'] }] },
    { sku: 'SAC' + listing.listing_id + '-C-3045', offerings: [{ price: 140, quantity: 999, is_enabled: true }],
      property_values: [{ property_id: 513, property_name: 'Size', value_ids: [], values: ['30x45'] }] }
  ], price_on_property: [513], quantity_on_property: [], sku_on_property: [513], minimumPrice: 45 },
  applyAttributes: async listingId => attributes.push(listingId)
});

test('an app-made listing is renewed with the current template: today\'s sizes, prices and profiles, not its old ones', async () => {
  for (const id of [...etsy.listings.keys()]) if (etsy.listings.get(id).state === 'active') etsy.listings.get(id).state = 'inactive';
  addListing(401, { title: 'Old sizes', created: 0.05e9, photos: 4 });
  const saved = {}, attributes = [];
  await startRenewal(deps({ saved, template: currentTemplate(attributes) }), { count: 1 });
  await finished();
  const row = saved.job.results[0];
  assert.equal(row.status, 'done', row.error);
  assert.equal(row.note, 'Photos copied; sizes, prices and profiles from the current template.');
  assert.equal(etsy.listings.has(401), false);
  const sizes = etsy.inventory.get(row.newListingId).products.map(p => p.property_values[0].values[0] + ' ' + p.offerings[0].price);
  assert.deepEqual(sizes, ['16x24 45', '20x30 65', '30x45 140']);
  const form = etsy.forms.get(row.newListingId);
  assert.deepEqual([form.price, form.shipping_profile_id, form.readiness_state_id, form.return_policy_id, form.shop_section_id],
    ['45', '55', '66', '77', '111']);
  assert.deepEqual(attributes, [row.newListingId]);
  assert.equal(etsy.images.get(row.newListingId).length, 4);
  const record = await getJsonObject('reposter/77/401/replacement.json');
  assert.equal(record.template.signature.length, 3);
});

test('a renewed listing whose variants changed before publishing is not published', async () => {
  for (const id of [...etsy.listings.keys()]) if (etsy.listings.get(id).state === 'active') etsy.listings.get(id).state = 'inactive';
  addListing(501, { title: 'Edited meanwhile', created: 0.04e9, photos: 2 });
  const { record } = await reposter.prepareReplacement(session, 501, { title: 'New', description: 'New', tags: ['a'],
    mockupMode: 'keep', artworkMode: 'keep' }, { automatic: true, template: currentTemplate([]) });
  etsy.inventory.get(record.draftId).products[0].offerings[0].price = 30;
  await assert.rejects(reposter.finalizeReplacement(session, 501, 'PUBLISH AND DELETE OLD', { deleteOld: true }),
    /differ from the current template/);
  assert.equal(etsy.listings.get(501).state, 'active');
  assert.equal(etsy.listings.get(record.draftId).state, 'draft');
});
