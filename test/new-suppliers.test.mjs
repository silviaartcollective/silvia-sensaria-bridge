// Printful, Lumaprints and Gooten with mocked APIs: no request leaves the test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { providerRequest, ProviderApiError, redact, statusForError } from '../src/provider-http.mjs';
import { parseDimensions, sameSize, wallArtFamily, finishFamily, shapeOf, toUsd, rowKey } from '../src/supplier-catalog-match.mjs';
import { referenceAddress } from '../src/quote-destinations.mjs';
import { testPrintfulConnection, createPrintfulDraftOrder, printfulShipments, getPrintfulShippingRates } from '../src/printful.mjs';
import { scanPrintfulComparisonRows, clearPrintfulCaches, __test as printfulTest } from '../src/printful-comparison.mjs';
import { testLumaprintsConnection, submitLumaprintsOrder, lumaprintsShipments, getLumaprintsShippingPrice } from '../src/lumaprints.mjs';
import { scanLumaprintsComparisonRows, clearLumaprintsCaches, lumaprintsShippingMethods, fitsLimits, flattenOptions } from '../src/lumaprints-comparison.mjs';
import { testGootenConnection, submitGootenOrder, gootenShipments, listGootenProducts } from '../src/gooten.mjs';
import { scanGootenComparisonRows, clearGootenCaches, pickGootenOption, gootenVariantFacts } from '../src/gooten-comparison.mjs';
import { mergeSupplierComparisonRows } from '../src/supplier-comparison.mjs';
import { estimateSupplierLandedCost, landedCostPolicy } from '../src/landed-cost.mjs';
import { withSupplierProfits } from '../src/retail-margin.mjs';

const SECRETS = { PRINTFUL_API_TOKEN: 'pf-secret-token-123', LUMAPRINTS_API_KEY: 'luma-key-abc', LUMAPRINTS_API_SECRET: 'luma-secret-xyz',
  GOOTEN_RECIPE_ID: 'recipe-0001', GOOTEN_PARTNER_BILLING_KEY: 'billing/key+secret==' };
function withEnv(values, fn) {
  return async () => {
    const before = {};
    for (const [k, v] of Object.entries(values)) { before[k] = process.env[k]; if (v == null) delete process.env[k]; else process.env[k] = v; }
    try { await fn(); } finally { for (const [k, v] of Object.entries(before)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
  };
}
const json = (status, body, headers = {}) => ({ ok: status >= 200 && status < 300, status, headers: { get: k => headers[k.toLowerCase()] ?? null },
  text: async () => typeof body === 'string' ? body : JSON.stringify(body) });
const noWait = async () => {};
const rate = async currency => ({ rate: { USD: 1, EUR: 1.1, GBP: 1.25, CAD: 0.73 }[currency], date: '2026-10-30', source: 'test' });

// ---------- shared HTTP ----------

test('requests time out, retry 429 and 5xx with backoff, and never echo a credential', async () => {
  let calls = 0;
  const flaky = async () => (++calls < 3 ? json(429, { error: 'slow down' }, { 'retry-after': '0' }) : json(200, { data: [1] }));
  assert.deepEqual(await providerRequest('https://x/a', { provider: 'Printful', fetchImpl: flaky, wait: noWait }), { data: [1] });
  assert.equal(calls, 3);

  const limited = async () => json(429, { error: 'Too many requests' });
  const error = await providerRequest('https://x/a', { provider: 'Gooten', fetchImpl: limited, wait: noWait }).catch(e => e);
  assert.equal(error.kind, 'rate-limited');
  assert.equal(statusForError(error), 'rate-limited');

  const hang = (url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  const timeout = await providerRequest('https://x/a', { provider: 'Lumaprints', fetchImpl: hang, timeoutMs: 20, retries: 0 }).catch(e => e);
  assert.equal(timeout.kind, 'timeout');
  assert.equal(statusForError(timeout), 'timed-out');

  const denied = async () => json(401, { message: 'Invalid token pf-secret-token-123' });
  const auth = await providerRequest('https://x/a', { provider: 'Printful', fetchImpl: denied, secrets: [SECRETS.PRINTFUL_API_TOKEN] }).catch(e => e);
  assert.equal(auth.kind, 'invalid-credentials');
  assert.doesNotMatch(auth.message, /pf-secret-token-123/);
  assert.match(redact('Authorization: Bearer abc.def token=zzz', []), /\[redacted\]/);

  let posts = 0;
  const down = async () => { posts++; return json(503, 'down'); };
  const order = await providerRequest('https://x/orders', { provider: 'Printful', method: 'POST', body: {}, fetchImpl: down, wait: noWait }).catch(e => e);
  assert.equal(order.kind, 'api-unavailable');
  assert.equal(posts, 1, 'a POST (order) is never retried');

  const broken = await providerRequest('https://x/a', { provider: 'Gooten', fetchImpl: async () => json(200, '<html>'), wait: noWait }).catch(e => e);
  assert.equal(broken.kind, 'malformed-response');
});

// ---------- matching ----------

test('sizes match exactly in either orientation, whatever the formatting', () => {
  for (const text of ['12x16', '12″×16″', '12" x 16"', '12 × 16 in', '16x12', '16 x 12 inch'])
    assert.ok(sameSize(parseDimensions(text), parseDimensions('12x16')), text);
  assert.ok(!sameSize(parseDimensions('30x40 cm'), parseDimensions('12x16')), 'metric 30x40 cm is not 12x16 in');
  assert.ok(!sameSize(parseDimensions('11x14'), parseDimensions('12x16')), 'a similar size is not the same size');
  assert.equal(shapeOf(parseDimensions('20x20')), 'square');
  assert.equal(shapeOf(parseDimensions('12x36')), 'panoramic');
  assert.equal(wallArtFamily('Framed Canvas'), 'FC');
  assert.equal(wallArtFamily('Canvas (in)'), 'C');
  assert.equal(wallArtFamily('0.75in Stretched Canvas'), 'C');
  assert.equal(wallArtFamily('Enhanced Matte Paper Poster (in)'), 'P');
  assert.equal(wallArtFamily('Enhanced Matte Paper Framed Poster (in)'), '', 'a framed poster is not one of our products');
  assert.equal(wallArtFamily('Metal Print'), '');
  assert.equal(finishFamily('Oak'), 'natural');
  assert.equal(finishFamily('Walnut'), 'brown');
  assert.equal(rowKey({ productCode: 'FC', size: '24x36', finish: 'Black' }), 'FC|24x36|black');
  assert.equal(referenceAddress('US').state, 'MO');
});

test('currency: converted to USD, and a missing rate gives no price rather than zero', async () => {
  const eur = await toUsd({ product: 20, productCurrency: 'EUR', shipping: 10, shippingCurrency: 'USD' }, { rate });
  assert.equal(Math.round(eur.totalUsd * 100) / 100, 32);
  assert.equal(eur.fx.productRate, 1.1);
  await assert.rejects(toUsd({ product: 20, productCurrency: 'XYZ', shipping: 1, shippingCurrency: 'USD' },
    { rate: async c => { if (c !== 'USD') throw new Error('FX API 404'); return { rate: 1 }; } }), /FX API/);
});

// ---------- Printful ----------

const pfRows = [
  { countryCode: 'CA', productCode: 'FC', size: '30x40', finish: 'Black' },
  { countryCode: 'CA', productCode: 'FC', size: '30x40', finish: 'Brown' },
  { countryCode: 'CA', productCode: 'C', size: '16x12', finish: '—' },
  { countryCode: 'CA', productCode: 'P', size: '20x20', finish: '—' },
  { countryCode: 'CA', productCode: 'P', size: '13x19', finish: '—' },
  { countryCode: 'CA', productCode: 'C', size: '12x36', finish: '—' }
];
function printfulDeps({ shipping } = {}) {
  const calls = { shipping: [] };
  return { calls, deps: {
    listPrintfulCategories: async () => [{ id: 21, title: 'Posters' }, { id: 22, title: 'Canvas prints' }, { id: 9, title: 'T-shirts' }],
    listPrintfulProducts: async ({ categoryIds }) => { assert.deepEqual(categoryIds, [21, 22]); return [
      { id: 1, name: 'Enhanced Matte Paper Poster (in)', type: 'POSTER' },
      { id: 3, name: 'Canvas (in)', type: 'CANVAS' },
      { id: 614, name: 'Framed Canvas', type: 'CANVAS' },
      { id: 2, name: 'Enhanced Matte Paper Framed Poster (in)', type: 'FRAMED POSTER' }] },
    listPrintfulVariants: async id => ({
      1: [{ id: 101, size: '20″×20″', name: 'Poster 20″×20″' }, { id: 102, size: '18″×24″' }],
      3: [{ id: 301, size: '12″×16″' }, { id: 302, size: '12″×36″' }],
      614: [{ id: 6141, size: '30″×40″', color: 'Black' }, { id: 6142, size: '30″×40″', color: 'White' }],
      2: [{ id: 201, size: '30″×40″', color: 'Black' }] })[id],
    getPrintfulProductPrices: async id => ({ currency: 'USD', variants: [
      { id: 101, techniques: [{ technique_key: 'digital', price: '14.00', discounted_price: '12.50' }] },
      { id: 301, techniques: [{ technique_key: 'digital', price: '29.00' }] },
      { id: 302, techniques: [{ technique_key: 'digital', price: '45.00' }] },
      { id: 6141, techniques: [{ technique_key: 'digital', price: '118.00' }] }].filter(v => String(v.id).startsWith(String(id))) }),
    getPrintfulShippingRates: async ({ recipient, items }) => {
      calls.shipping.push({ recipient, items });
      if (shipping) return shipping(recipient, items);
      return [{ shipping: 'EXPRESS', rate: '40.00', currency: 'USD', min_delivery_days: 2, max_delivery_days: 3 },
        { shipping: 'STANDARD', shipping_method_name: 'Flat Rate', rate: '24.95', currency: 'USD', min_delivery_days: 5, max_delivery_days: 9 }];
    },
    usdRate: rate
  } };
}

test('Printful: authenticated connection test, and bad credentials reported plainly', withEnv({ PRINTFUL_API_TOKEN: SECRETS.PRINTFUL_API_TOKEN, PRINTFUL_STORE_ID: null }, async () => {
  let seen;
  const ok = await testPrintfulConnection({ fetchImpl: async (url, init) => { seen = { url, init }; return json(200, { data: [{ id: 1 }, { id: 2 }] }); } });
  assert.equal(seen.url, 'https://api.printful.com/v2/stores');
  assert.equal(seen.init.headers.Authorization, 'Bearer ' + SECRETS.PRINTFUL_API_TOKEN);
  assert.deepEqual([ok.ok, ok.storeCount, ok.needsStoreId], [true, 2, true]);
  const bad = await testPrintfulConnection({ fetchImpl: async () => json(401, { error: { message: 'Malformed token' } }) }).catch(e => e);
  assert.equal(bad.kind, 'invalid-credentials');
  assert.doesNotMatch(bad.message, new RegExp(SECRETS.PRINTFUL_API_TOKEN));
}));

test('Printful: catalog matched by exact size, orientation, shape and frame colour; framed canvas never as canvas', withEnv({ PRINTFUL_API_TOKEN: 'x' }, async () => {
  clearPrintfulCaches();
  const { deps, calls } = printfulDeps();
  const records = await scanPrintfulComparisonRows({ rows: pfRows, countryCode: 'CA', fresh: true, deps });
  const fc = records.get('FC|30x40|black');
  assert.equal(fc.status, 'available');
  assert.equal(fc.productCost, 118);
  assert.equal(fc.shippingCost, 24.95, 'the STANDARD rate, not the cheapest-looking express');
  assert.equal(fc.totalUsd, 142.95);
  assert.equal(fc.meta.variantId, 6141);
  assert.equal(fc.meta.productName, 'Framed Canvas');
  assert.deepEqual(fc.meta.deliveryDays, { min: 5, max: 9 });
  assert.equal(records.get('FC|30x40|brown').status, 'finish-no-match');
  const canvas = records.get('C|12x16|none');
  assert.equal(canvas.status, 'available', 'a 16x12 artwork uses the 12x16 canvas');
  assert.equal(canvas.meta.productName, 'Canvas (in)');
  assert.equal(records.get('P|20x20|none').productCost, 12.5, 'square poster at its discounted price');
  assert.equal(records.get('P|13x19|none').status, 'unsupported-size');
  assert.equal(records.get('C|12x36|none').meta.shape, 'panoramic');
  const shipped = calls.shipping.find(c => c.items[0].catalog_variant_id === 6141);
  assert.deepEqual(shipped.recipient, { country_code: 'CA', state_code: 'ON', zip: 'M5H 2N2', city: 'Toronto', address1: '100 Queen St W' });
}));

test('Printful: unsupported country, failed price lookup and catalog outage are told apart', withEnv({ PRINTFUL_API_TOKEN: 'x' }, async () => {
  clearPrintfulCaches();
  const { deps } = printfulDeps({ shipping: () => [] });
  const none = await scanPrintfulComparisonRows({ rows: [pfRows[0]], countryCode: 'KP', fresh: true, deps });
  assert.equal(none.get('FC|30x40|black').status, 'destination-unsupported');
  assert.equal(none.get('FC|30x40|black').eligible, false);
  assert.equal(none.get('FC|30x40|black').totalUsd, null, 'never $0');
  clearPrintfulCaches();
  const priced = await scanPrintfulComparisonRows({ rows: [pfRows[0]], countryCode: 'CA', fresh: true,
    deps: { ...printfulDeps().deps, getPrintfulProductPrices: async () => { throw new ProviderApiError('Printful', 'api-unavailable', 'Printful API is unavailable (HTTP 503).'); } } });
  assert.equal(priced.get('FC|30x40|black').status, 'api-unavailable');
  clearPrintfulCaches();
  const down = await scanPrintfulComparisonRows({ rows: pfRows.slice(0, 2), countryCode: 'CA', fresh: true,
    deps: { ...printfulDeps().deps, listPrintfulCategories: async () => { throw new ProviderApiError('Printful', 'invalid-credentials', 'Printful rejected the API credentials (HTTP 401).'); } } });
  assert.equal(down.get('FC|30x40|black').status, 'invalid-credentials', 'an outage is not "not offered"');
  assert.equal(printfulTest.pickPrintfulRate([{ shipping: 'X', rate: 'oops', currency: 'USD' }]), null);
}));

test('Printful: draft orders are refused while disabled and never duplicated', withEnv({ PRINTFUL_API_TOKEN: 'x', FULFILLMENT_LIVE_SUBMISSION_ENABLED: null, PRINTFUL_FULFILLMENT_ENABLED: null }, async () => {
  await assert.rejects(createPrintfulDraftOrder({ externalId: 'etsy-1', recipient: {}, items: [] }), /disabled/);
  process.env.FULFILLMENT_LIVE_SUBMISSION_ENABLED = 'true';
  process.env.PRINTFUL_FULFILLMENT_ENABLED = 'true';
  const requests = [];
  const fetchImpl = async (url, init) => { requests.push([init.method, url]); return json(200, { data: { id: 77, external_id: 'etsy-1', status: 'draft' } }); };
  const result = await createPrintfulDraftOrder({ externalId: 'etsy-1', fetchImpl,
    recipient: { name: 'A', address1: '1 St', country_code: 'US' }, items: [{ source: 'catalog', catalog_variant_id: 1, quantity: 1 }] });
  assert.equal(result.duplicate, true);
  assert.deepEqual(requests, [['GET', 'https://api.printful.com/v2/orders/@etsy-1']], 'the existing order is returned; nothing is POSTed');
  const created = [];
  const fresh = await createPrintfulDraftOrder({ externalId: 'etsy-2', recipient: { name: 'A', address1: '1 St', country_code: 'US' },
    items: [{ source: 'catalog', catalog_variant_id: 1, quantity: 1 }],
    fetchImpl: async (url, init) => { created.push(init.method); return init.method === 'GET' ? json(404, { error: 'Not found' }) : json(200, { data: { id: 78 } }); } });
  assert.deepEqual([fresh.duplicate, fresh.order.id, created], [false, 78, ['GET', 'POST']]);
}));

test('Printful: tracking only from shipped packages with a tracking number', () => {
  const parsed = printfulShipments({ order: { status: 'fulfilled' }, shipments: [
    { id: 5, carrier: 'USPS', shipment_status: 'shipped', tracking_number: '9400', tracking_url: 'https://t/9400', delivery_status: 'in_transit' },
    { id: 6, shipment_status: 'pending', tracking_number: null }] });
  assert.equal(parsed.status, 'fulfilled');
  assert.deepEqual(parsed.shipments.map(s => [s.trackingNumber, s.carrier, s.trackingUrl]), [['9400', 'USPS', 'https://t/9400']]);
});

// ---------- Lumaprints ----------

const lumaCatalog = {
  listLumaprintsCategories: async () => [{ id: 101, name: 'Canvas' }, { id: 102, name: 'Framed Canvas' }, { id: 103, name: 'Fine Art Paper' }, { id: 104, name: 'Metal' }],
  listLumaprintsSubcategories: async id => ({
    101: [{ subcategoryId: 101001, name: '0.75in Stretched Canvas', minWidth: 8, maxWidth: 40, minHeight: 8, maxHeight: 60 },
      { subcategoryId: 101002, name: '1.25in Stretched Canvas', minWidth: 8, maxWidth: 40, minHeight: 8, maxHeight: 60 }],
    102: [{ subcategoryId: 102001, name: '0.75in Framed Canvas', minWidth: 8, maxWidth: 40, minHeight: 8, maxHeight: 50 }],
    103: [{ subcategoryId: 103001, name: 'Archival Matte Fine Art Paper', minWidth: 4, maxWidth: 44, minHeight: 4, maxHeight: 96 }],
    104: [{ subcategoryId: 104001, name: 'Metal Print', minWidth: 4, maxWidth: 40, minHeight: 4, maxHeight: 40 }] })[id],
  listLumaprintsOptions: async id => (String(id).startsWith('102') ? [
    { name: 'Canvas Border', options: [{ optionId: 1, name: 'Image Wrap' }, { optionId: 2, name: 'Mirror Wrap' }] },
    { name: 'Frame Color', options: [{ optionId: 21, name: 'Black Frame' }, { optionId: 22, name: 'White Frame' }, { optionId: 23, name: 'Oak Frame' }] }]
    : String(id).startsWith('101') ? [{ name: 'Canvas Border', options: [{ optionId: 1, name: 'Image Wrap' }] }] : []),
  usdRate: rate
};

test('Lumaprints: Basic-auth connection test against the stores endpoint', withEnv({ LUMAPRINTS_API_KEY: SECRETS.LUMAPRINTS_API_KEY, LUMAPRINTS_API_SECRET: SECRETS.LUMAPRINTS_API_SECRET, LUMAPRINTS_SANDBOX: 'true', LUMAPRINTS_API_URL: null }, async () => {
  let seen;
  const ok = await testLumaprintsConnection({ fetchImpl: async (url, init) => { seen = { url, init }; return json(200, [{ storeId: 9, storeName: 'Silvia' }]); } });
  assert.equal(seen.url, 'https://us.api-sandbox.lumaprints.com/api/v1/stores');
  assert.equal(seen.init.headers.Authorization, 'Basic ' + Buffer.from(`${SECRETS.LUMAPRINTS_API_KEY}:${SECRETS.LUMAPRINTS_API_SECRET}`).toString('base64'));
  assert.deepEqual([ok.storeCount, ok.sandbox], [1, true]);
  const bad = await testLumaprintsConnection({ fetchImpl: async () => json(403, { message: 'Forbidden' }) }).catch(e => e);
  assert.equal(bad.kind, 'invalid-credentials');
  const gone = await getLumaprintsShippingPrice({ recipient: { country: 'KP' }, subcategoryId: 101001, width: 12, height: 16,
    fetchImpl: async () => json(406, { message: 'No shipping method available' }) }).catch(e => e);
  assert.equal(statusForError(gone), 'destination-unsupported');
}));

test('Lumaprints: any size within limits is priced exactly; framed canvas needs its frame colour', withEnv({ LUMAPRINTS_API_KEY: 'k', LUMAPRINTS_API_SECRET: 's' }, async () => {
  clearLumaprintsCaches();
  const priced = [];
  const deps = { ...lumaCatalog,
    getLumaprintsProductPrice: async args => { priced.push(args); return { price: args.subcategoryId === 101002 ? 61.2 : args.subcategoryId === 102001 ? 132.4 : 48.9, options: [{ name: 'Image Wrap', price: 0 }] }; },
    getLumaprintsShippingPrice: async () => [{ shippingMethod: 'Freight', cost: 9.0, status: 'Freight' }, { shippingMethod: 'UPS Ground', cost: 18.35, status: 'Success' }, { shippingMethod: 'FedEx 2Day', cost: 32.15, status: 'Success' }] };
  const rows = [{ productCode: 'FC', size: '30x40', finish: 'Black' }, { productCode: 'FC', size: '30x40', finish: 'Brown' },
    { productCode: 'C', size: '20x60', finish: '—' }, { productCode: 'C', size: '24x24', finish: '—' }, { productCode: 'C', size: '50x70', finish: '—' }];
  const records = await scanLumaprintsComparisonRows({ rows, countryCode: 'US', fresh: true, deps });
  const fc = records.get('FC|30x40|black');
  assert.equal(fc.status, 'available');
  assert.deepEqual([fc.productCost, fc.shippingCost, fc.totalUsd], [132.4, 18.35, 150.75], 'freight is not a usable quote');
  assert.deepEqual(fc.meta.options, ['Canvas Border: Image Wrap', 'Frame Color: Black Frame']);
  assert.match(fc.meta.currencySource, /LUMAPRINTS_PRICE_CURRENCY/);
  assert.equal(records.get('FC|30x40|brown').status, 'finish-no-match', 'no walnut/brown frame option');
  const pano = records.get('C|20x60|none');
  assert.equal(pano.status, 'available');
  assert.equal(pano.meta.canvasThicknessInches, 0.75, 'the cheaper of 0.75" and 1.25" canvas, its depth shown');
  assert.equal(pano.meta.alternatives[0].productName, '1.25in Stretched Canvas');
  assert.equal(records.get('C|24x24|none').meta.shape, 'square');
  assert.equal(records.get('C|50x70|none').status, 'unsupported-size');
  assert.ok(priced.every(p => p.width <= p.height));
  assert.equal(fitsLimits({ minWidth: 8, maxWidth: 40, minHeight: 8, maxHeight: 60 }, parseDimensions('60x20')), true, 'rotated to fit');
  assert.deepEqual(flattenOptions([{ optionId: 5, name: 'Hanging Wire', groupName: 'Hardware' }]), [{ id: 5, name: 'Hanging Wire', group: 'Hardware' }]);
  assert.deepEqual(lumaprintsShippingMethods({ shippingMethods: [{ method: 'Ground', price: '12.10' }] }).map(m => m.cost), [12.1]);
}));

test('Lumaprints: orders refused while disabled, checked for an existing external ID, never retried; tracking parsed', withEnv({ LUMAPRINTS_API_KEY: 'k', LUMAPRINTS_API_SECRET: 's', LUMAPRINTS_STORE_ID: '9', FULFILLMENT_LIVE_SUBMISSION_ENABLED: null, LUMAPRINTS_FULFILLMENT_ENABLED: null }, async () => {
  await assert.rejects(submitLumaprintsOrder({ externalId: 'etsy-5', recipient: {}, items: [] }), /disabled/);
  process.env.FULFILLMENT_LIVE_SUBMISSION_ENABLED = 'true';
  process.env.LUMAPRINTS_FULFILLMENT_ENABLED = 'true';
  const methods = [];
  const dup = await submitLumaprintsOrder({ externalId: 'etsy-5', recipient: {}, items: [{}],
    fetchImpl: async (url, init) => { methods.push(init.method); return json(200, [{ orderNumber: 'LP-1', externalId: 'etsy-5' }]); } });
  assert.deepEqual([dup.duplicate, methods], [true, ['GET']]);
  const hooked = await submitLumaprintsOrder({ externalId: 'etsy-6', alreadySubmitted: async () => true, recipient: {}, items: [{}], fetchImpl: async () => { throw new Error('no request expected'); } });
  assert.equal(hooked.duplicate, true);
  const parsed = lumaprintsShipments({ order: { orderStatus: 'Shipped' }, shipments: [{ id: 3, trackingNumber: '1Z999', carrier: 'UPS', trackingUrl: 'https://ups/1Z999' }, { id: 4, trackingNumber: '' }] });
  assert.deepEqual([parsed.status, parsed.shipments.length, parsed.shipments[0].carrier], ['shipped', 1, 'UPS']);
}));

// ---------- Gooten ----------

const gootenVariants = {
  43: [{ Sku: 'CanvsWrp-ImgWrp-12x16', PriceInfo: { Price: 27.5, CurrencyCode: 'USD' }, Options: [{ Name: 'Canvas Size', Value: '12x16 inch' }, { Name: 'Wrap Type', Value: 'Image Wrap' }] },
    { Sku: 'CanvsWrp-BlkWrp-12x16', PriceInfo: { Price: 26.0, CurrencyCode: 'USD' }, Options: [{ Name: 'Canvas Size', Value: '12x16 inch' }, { Name: 'Wrap Type', Value: 'Black Wrap' }] },
    { Sku: 'CanvsWrp-ImgWrp-20x20', PriceInfo: { Price: 39, CurrencyCode: 'USD' }, Options: [{ Name: 'Canvas Size', Value: '20x20 inch' }, { Name: 'Wrap Type', Value: 'Image Wrap' }] }],
  77: [{ Sku: 'FrmCanvas-Blk-24x36', PriceInfo: { Price: 96.1, CurrencyCode: 'EUR' }, Options: [{ Name: 'Size', Value: '24x36' }, { Name: 'Frame Color', Value: 'Black' }] }],
  41: [{ Sku: 'Framed_24x36_Black_Lustre', PriceInfo: { Price: 70, CurrencyCode: 'USD' }, Options: [{ Name: 'Size', Value: '24x36' }, { Name: 'Frame Color', Value: 'Black' }] }]
};
const gootenDeps = (shipping) => ({
  listGootenProducts: async () => [{ Id: 43, Name: 'Canvas Wraps' }, { Id: 77, Name: 'Framed Canvas' }, { Id: 41, Name: 'Framed Prints' }, { Id: 9, Name: 'Posters', IsComingSoon: true }],
  listGootenVariants: async id => gootenVariants[id] || [],
  getGootenShippingOptions: shipping || (async ({ items }) => [{ SKUs: [items[0].SKU], ShipOptions: [
    { Name: 'Expedited', MethodType: 'Expedited', Price: { Price: 30.2, CurrencyCode: 'USD' }, Id: 2, EstBusinessDaysTilDelivery: 4 },
    { Name: 'Standard', MethodType: 'Standard', Price: { Price: 14.98, CurrencyCode: 'USD' }, Id: 1, EstBusinessDaysTilDelivery: 9 }] }]),
  usdRate: rate
});

test('Gooten: RecipeID and PartnerBillingKey verified without an order; errors are reported', withEnv({ GOOTEN_RECIPE_ID: SECRETS.GOOTEN_RECIPE_ID, GOOTEN_PARTNER_BILLING_KEY: SECRETS.GOOTEN_PARTNER_BILLING_KEY, GOOTEN_API_URL: null }, async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push([init.method, url.split('?')[0], init.body ? JSON.parse(init.body) : null]);
    if (url.includes('/products/')) return json(200, { Products: [{ Id: 43, Name: 'Canvas Wraps' }] });
    if (url.includes('/productvariants/')) return json(200, { ProductVariants: [{ Sku: 'CanvsWrp-ImgWrp-12x16', PriceInfo: { Price: 27.5 } }] });
    if (url.includes('/priceestimate/')) return json(200, { Items: { Price: 27.5, CurrencyCode: 'USD' }, Shipping: { Price: 9.1 }, HadError: false });
    return json(404, {});
  };
  const ok = await testGootenConnection({ fetchImpl });
  assert.deepEqual([ok.ok, ok.productCount, ok.partnerBillingKeyVerified], [true, 1, true]);
  assert.ok(seen.every(([, url]) => url.startsWith('https://api.print.io/api/v/5/source/api/')));
  assert.ok(!seen.some(([, url]) => url.endsWith('/orders/')), 'no order is created');
  assert.equal(seen.find(([, url]) => url.endsWith('/priceestimate/'))[2].Payment.PartnerBillingKey, SECRETS.GOOTEN_PARTNER_BILLING_KEY);
  const bad = await listGootenProducts({ fetchImpl: async () => json(200, { HadError: true, Errors: [{ ErrorMessage: 'Invalid recipeId recipe-0001' }] }) }).catch(e => e);
  assert.equal(bad.kind, 'invalid-credentials');
  assert.doesNotMatch(bad.message, /recipe-0001/);
}));

test('Gooten: regional SKUs matched exactly, priced in their currency and shipped to the reference address', withEnv({ GOOTEN_RECIPE_ID: 'r' }, async () => {
  clearGootenCaches();
  const rows = [{ productCode: 'C', size: '16x12', finish: '—' }, { productCode: 'C', size: '20x20', finish: '—' },
    { productCode: 'FC', size: '24x36', finish: 'Black' }, { productCode: 'FC', size: '24x36', finish: 'White' },
    { productCode: 'P', size: '18x24', finish: '—' }, { productCode: 'C', size: '11x14', finish: '—' }];
  const records = await scanGootenComparisonRows({ rows, countryCode: 'DE', fresh: true, deps: gootenDeps() });
  const canvas = records.get('C|12x16|none');
  assert.equal(canvas.meta.sku, 'CanvsWrp-ImgWrp-12x16', 'image wrap preferred over the cheaper black wrap');
  assert.deepEqual([canvas.productCost, canvas.shippingCost], [27.5, 14.98]);
  assert.deepEqual(canvas.meta.deliveryDays, { min: 9, max: 9, businessDays: true });
  const fc = records.get('FC|24x36|black');
  assert.equal(fc.meta.productName, 'Framed Canvas', 'never the framed poster');
  assert.equal(fc.productCost, 105.71, 'EUR converted to USD');
  assert.equal(fc.currency, 'mixed');
  assert.equal(records.get('FC|24x36|white').status, 'finish-no-match');
  assert.equal(records.get('P|18x24|none').status, 'not-offered', 'posters are coming soon, so not offered');
  assert.equal(records.get('C|11x14|none').status, 'unsupported-size');
  assert.equal(records.get('C|20x20|none').meta.shape, 'square');
  clearGootenCaches();
  const nowhere = await scanGootenComparisonRows({ rows: rows.slice(0, 1), countryCode: 'KP', fresh: true, deps: gootenDeps(async () => [{ SKUs: [], ShipOptions: [] }]) });
  assert.equal(nowhere.get('C|12x16|none').status, 'destination-unsupported');
  assert.equal(pickGootenOption([{ SKUs: ['A'], ShipOptions: [{ Name: 'Overnight', Price: { Price: 9, CurrencyCode: 'USD' } }] }], 'A').name, 'Overnight');
  assert.deepEqual(gootenVariantFacts({ Sku: 'X', Options: [{ Name: 'Size', Value: '30 x 40 cm' }] }).size.unit, 'cm');
}));

test('Gooten: orders need the duplicate check, default to test mode, and are never retried; tracking parsed', withEnv({ GOOTEN_RECIPE_ID: 'r', GOOTEN_PARTNER_BILLING_KEY: 'b', FULFILLMENT_LIVE_SUBMISSION_ENABLED: 'true', GOOTEN_FULFILLMENT_ENABLED: 'true', GOOTEN_LIVE_ORDERS: null }, async () => {
  await assert.rejects(submitGootenOrder({ sourceId: 'etsy-9', shipTo: {}, items: [] }), /duplicate-order check/);
  const dup = await submitGootenOrder({ sourceId: 'etsy-9', alreadySubmitted: async () => true, shipTo: {}, items: [], fetchImpl: async () => { throw new Error('no request expected'); } });
  assert.equal(dup.duplicate, true);
  let body, posts = 0;
  const sent = await submitGootenOrder({ sourceId: 'etsy-10', alreadySubmitted: async () => false, shipTo: { countryCode: 'US' }, items: [{ SKU: 'A' }],
    fetchImpl: async (url, init) => { posts++; body = JSON.parse(init.body); return json(200, { Id: '7-abc' }); } });
  assert.deepEqual([sent.order.Id, sent.testMode, body.IsInTestMode, body.SourceId, posts], ['7-abc', true, true, 'etsy-10', 1]);
  const failed = await submitGootenOrder({ sourceId: 'etsy-11', alreadySubmitted: async () => false, shipTo: {}, items: [{}],
    fetchImpl: async () => { posts++; return json(500, 'boom'); } }).catch(e => e);
  assert.equal(failed.kind, 'api-unavailable');
  assert.equal(posts, 2, 'the failed order POST was sent once');
  const tracking = gootenShipments({ Items: [{ Status: 'Shipped', Shipments: [{ TrackingNumber: '9405', CarrierName: 'USPS', TrackingUrl: 'https://usps/9405' }] },
    { Status: 'Shipped', Shipments: [{ TrackingNumber: '9405' }] }, { Status: 'In Production', Shipments: [] }] });
  assert.equal(tracking.shipments.length, 1);
  assert.match(tracking.status, /shipped/);
}));

// ---------- the comparison as a whole ----------

test('one supplier failing leaves the others; the winner is only "cheapest verified" until all are checked', () => {
  const row = { countryCode: 'CA', country: 'Canada', productCode: 'FC', product: 'Framed Canvas', size: '30x40', finish: 'Black', finishCode: 'BLK',
    sku: 'X', totalBeforeTax: 150, productionCost: 120, shippingCost: 30, sensaria: { totalBeforeTax: 160 } };
  const key = 'FC|30x40|black';
  const record = (provider, total, status = 'available') => ({ provider, eligible: status === 'available', status, totalUsd: total, productCost: total ? total - 20 : null, shippingCost: total ? 20 : null, currency: 'USD', reason: status === 'available' ? '' : status, basis: '', meta: {} });
  const [merged] = mergeSupplierComparisonRows({ prodigiRows: [row], riskPolicy: landedCostPolicy(),
    printfulRows: new Map([[key, record('Printful', 140)]]),
    lumaprintsRows: new Map([[key, record('Lumaprints', 130)]]),
    gootenRows: new Map([[key, record('Gooten', null, 'api-unavailable')]]) });
  assert.equal(merged.winner, 'Lumaprints');
  assert.equal(merged.comparisonStatus, 'partial');
  assert.equal(merged.winnerIsOverallCheapest, false);
  assert.ok(merged.missingProviders.includes('Gooten'));
  assert.equal(merged.suppliers.printful.status, 'available');
  assert.equal(merged.suppliers.gooten.totalUsd, null);
  const landed = estimateSupplierLandedCost(record('Printful', 100), { countryCode: 'CA' });
  assert.equal(landed.modeledLandedUsd, 120, 'a planning reserve like Printify and Gelato');
  const profits = withSupplierProfits(merged, new Map([['FC|30x40', 300]]), { saleDiscountPercent: 20, etsyFeeReservePercent: 10, customerShippingUsd: 0 });
  // 300 × 0.8 = 240 collected; 24 Etsy fee reserve; 0.20 listing fee; Lumaprints 130 + 20% reserve = 156.
  assert.equal(profits.suppliers.lumaprints.estimatedProfit.contributionUsd, 59.8);
  assert.equal(profits.suppliers.gooten.estimatedProfit, undefined);
});
