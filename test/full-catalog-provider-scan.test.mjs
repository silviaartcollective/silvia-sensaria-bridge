import test from 'node:test';
import assert from 'node:assert/strict';
import { scanGelatoComparisonRows } from '../src/gelato-comparison.mjs';
import { scanPrintifyComparisonRows } from '../src/printify-comparison.mjs';

const json = payload => ({
  ok: true, status: 200,
  text: async () => JSON.stringify(payload)
});

test('Gelato finds a 20x30 canvas by exact CanvasFormat and returns complete shipping', async () => {
  const beforeFetch = globalThis.fetch;
  const beforeKey = process.env.GELATO_API_KEY;
  process.env.GELATO_API_KEY = 'test-only-no-real-network';
  const uid = 'canvas_pf_508x762-mm-20x30-inch_wrapped_ver';
  const seen = [];
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url);
    seen.push(href);
    if (href.endsWith('/v3/catalogs')) return json([{ catalogUid: 'canvas', title: 'Canvas' }]);
    if (href.endsWith('/v3/catalogs/canvas')) return json({
      catalogUid: 'canvas', title: 'Canvas',
      productAttributes: [{
        productAttributeUid: 'CanvasFormat', title: 'Canvas Format',
        values: [
          { productAttributeValueUid: '508x762-mm', title: '20x30 inch' },
          { productAttributeValueUid: '300x400-mm', title: '12x16 inch' }
        ]
      }]
    });
    if (href.endsWith('/v3/catalogs/canvas/products:search')) {
      const body = JSON.parse(options.body);
      assert.deepEqual(body.attributeFilters, { CanvasFormat: ['508x762-mm'] });
      return json({ products: [{
        productUid: uid, attributes: { CanvasFormat: '508x762-mm' },
        dimensions: { Width: { value: 508, measureUnit: 'mm' },
          Height: { value: 762, measureUnit: 'mm' } },
        supportedCountries: ['CA', 'US']
      }] });
    }
    if (href.includes('/v3/products/') && href.includes('/prices')) {
      return json([{ productUid: uid, country: 'CA', quantity: 1,
        price: 34.20, currency: 'USD' }]);
    }
    if (href.endsWith('/v1/prices:search')) return json({
      prices: [{ productUid: uid, quantities: [{ quantity: 1,
        methods: [{ type: 'normal', minPrice: 10, avgPrice: 10,
          shipmentMethodUid: 'normal-CA' }] }] }]
    });
    throw new Error('Unexpected Gelato request ' + href);
  };
  try {
    const row = { productCode: 'C', size: '20x30', finish: '—' };
    const result = (await scanGelatoComparisonRows({ rows: [row],
      countryCode: 'CA', fresh: true })).get('C|20x30|none');
    assert.equal(result?.status, 'available');
    assert.equal(result?.eligible, true);
    assert.equal(result?.productCost, 34.2);
    assert.equal(result?.shippingCost, 10);
    assert.equal(result?.totalUsd, 44.2);
    assert.ok(seen.some(url => url.endsWith('products:search')));
  } finally {
    globalThis.fetch = beforeFetch;
    if (beforeKey === undefined) delete process.env.GELATO_API_KEY;
    else process.env.GELATO_API_KEY = beforeKey;
  }
});

test('Printify scans all canvas models and their print providers, not just Jondo', async () => {
  const beforeFetch = globalThis.fetch;
  const beforeToken = process.env.PRINTIFY_API_TOKEN;
  const beforeShop = process.env.PRINTIFY_SHOP_ID;
  process.env.PRINTIFY_API_TOKEN = 'test-only-no-real-network';
  process.env.PRINTIFY_SHOP_ID = '999';
  const providerList = {
    1159: [{ id: 1, title: 'Jondo', location: { country: 'US' } },
      { id: 2, title: 'Other Canvas Printer', location: { country: 'CA' } }],
    1160: [{ id: 3, title: 'Third Canvas Printer', location: { country: 'CA' } }]
  };
  const variantId = { '1159/1': 111, '1159/2': 112, '1160/3': 113 };
  const shipping = {
    111: 2059, 112: 1000, 113: 900
  };
  globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.endsWith('/catalog/blueprints.json')) return json([
      { id: 1159, title: 'Matte Canvas, Stretched, 1.25"', brand: 'Generic brand' },
      { id: 1160, title: 'Matte Canvas, Stretched, 0.75"', brand: 'Generic brand' },
      { id: 5000, title: 'Cotton Hoodie', brand: 'Other' }
    ]);
    if (href.includes('/shops/999/products.json')) return json({ last_page: 1, data: [
      { blueprint_id: 1159, print_provider_id: 1,
        variants: [{ id: 111, cost: 3000 }] },
      { blueprint_id: 1160, print_provider_id: 3,
        variants: [{ id: 113, cost: 5500 }] }
    ] });
    const parts = href.match(/\/catalog\/blueprints\/(\d+)\/print_providers(?:\/(\d+))?\/(variants|shipping)?/);
    if (parts) {
      const bp = Number(parts[1]);
      const provider = parts[2] ? Number(parts[2]) : null;
      if (provider == null) return json(providerList[bp] || []);
      const id = variantId[`${bp}/${provider}`];
      if (parts[3] === 'variants') return json({ variants: [{
        id, title: '20x30', options: { size: '20x30' }
      }] });
      if (parts[3] === 'shipping') return json({
        profiles: [{ variant_ids: [id], countries: ['CA'],
          first_item: { cost: shipping[id], currency: 'USD' } }]
      });
    }
    throw new Error('Unexpected Printify request ' + href);
  };
  try {
    const row = { productCode: 'C', size: '20x30', finish: '—' };
    const record = (await scanPrintifyComparisonRows({
      rows: [row], countryCode: 'CA', fresh: true
    })).get('C|20x30|none');
    assert.equal(record?.status, 'available');
    assert.equal(record?.productCost, 30);
    assert.equal(record?.shippingCost, 20.59);
    assert.equal(record?.totalUsd, 50.59);
    assert.equal(record?.meta?.scan?.wallArtBlueprints, 2);
    assert.equal(record?.meta?.scan?.blueprintProvidersScanned, 3);
    assert.equal(record?.meta?.offers?.length, 3);
    assert.ok(record.meta.offers.some(offer => offer.product === 'Matte Canvas, Stretched, 1.25"' &&
      offer.printProvider === 'Other Canvas Printer'));
    assert.ok(record.meta.offers.some(offer => offer.priceStatus === 'production-cost-missing'));
  } finally {
    globalThis.fetch = beforeFetch;
    if (beforeToken === undefined) delete process.env.PRINTIFY_API_TOKEN;
    else process.env.PRINTIFY_API_TOKEN = beforeToken;
    if (beforeShop === undefined) delete process.env.PRINTIFY_SHOP_ID;
    else process.env.PRINTIFY_SHOP_ID = beforeShop;
  }
});
