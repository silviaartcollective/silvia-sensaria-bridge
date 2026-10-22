import test from 'node:test';
import assert from 'node:assert/strict';
import { __test } from '../src/printify-cost-builder.mjs';

test('private pricing draft covers all provider variants and is explicitly unpublished', () => {
  const draft = __test.draftPayload(1159, 22, [
    { id: 1001, title: '20x30', placeholders: [{ position: 'front' }] },
    { id: 1002, title: '24x36', placeholders: [{ position: 'front' }] },
    { id: 1002, title: '24x36', placeholders: [{ position: 'front' }] }
  ], 'Jondo', 'Matte Canvas, Stretched, 1.25"');
  assert.match(draft.title, /PRIVATE PRICE CHECK/);
  assert.equal(draft.visible, false);
  assert.equal(draft.blueprint_id, 1159);
  assert.equal(draft.print_provider_id, 22);
  assert.equal(draft.variants.length, 2);
  assert.deepEqual(draft.variants.map(v => v.id), [1001, 1002]);
  assert.deepEqual(draft.print_areas, [{
    variant_ids: [1001, 1002],
    placeholders: [{ position: 'front', images: [] }]
  }]);
  assert.equal(draft.variants[0].is_enabled, true);
});

test('placeholder image fallback leaves draft non-published and adds only a neutral image reference', () => {
  const original = __test.draftPayload(22, 3, [
    { id: 40, placeholders: [{ position: 'front', decoration_method: 'dtg' }] }
  ], 'Test Provider', 'Canvas');
  const withImage = __test.imagePayload(original, 'safe-neutral-id');
  assert.deepEqual(withImage.print_areas[0].placeholders[0].images, [{
    id: 'safe-neutral-id', x: 0.5, y: 0.5, scale: 1, angle: 0
  }]);
  assert.deepEqual(original.print_areas[0].placeholders[0].images, []);
  assert.equal(withImage.visible, false);
});

test('pricing scan normalizes size without generating an Etsy product or order', () => {
  assert.equal(__test.safeSize(30, 20), '20x30');
  assert.throws(() => __test.safeSize(-1, 30), /between 1 and 120/);
});

// The capture flow against a fake Printify shop (imports replaced by stubs).
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function fakePrintify({ listFails = false, seeShopCosts = true } = {}) {
  const products = [], calls = { created: 0, saved: [] };
  const pairs = [{ blueprintId: 1159, providerId: 22, product: 'Matte Canvas', printProvider: 'Jondo' },
    { blueprintId: 555, providerId: 7, product: 'Canvas', printProvider: 'Other' }];
  const hasProduct = pair => products.some(p => p.blueprint_id === pair.blueprintId && p.print_provider_id === pair.providerId);
  const stubs = {
    sharp: () => ({ png: () => ({ toBuffer: async () => Buffer.alloc(1) }) }),
    printifyConfigStatus: () => ({ ready: true }),
    // A pair has a cost once the shop has a product for it (as the real scan reads shop costs).
    scanPrintifyComparisonRows: async () => new Map([['k', { meta: { offers: pairs.map(pair => ({
      ...pair, productionUsd: seeShopCosts && hasProduct(pair) ? 30 : null })) } }]]),
    getPrintifyProducts: async () => { if (listFails) throw Error('Printify 403'); return structuredClone(products); },
    getPrintifyVariants: async () => ({ variants: [{ id: 1, placeholders: [] }, { id: 2, placeholders: [] }] }),
    createPrintifyPricingDraft: async payload => {
      await new Promise(resolve => setTimeout(resolve, 5));
      calls.created++;
      const product = { id: 'p' + calls.created, title: payload.title, blueprint_id: payload.blueprint_id,
        print_provider_id: payload.print_provider_id, variants: payload.variants.map(v => ({ id: v.id, cost: 2500 })) };
      products.push(product);
      return product;
    },
    getPrintifyPricingDraft: async id => products.find(p => p.id === id),
    uploadPrintifyPricingImage: async () => ({ id: 'img' }),
    invalidatePrintifyCatalogCache() {}, resetPrintifyCostLibraryCache() {},
    savePrintifyCostLibrary: async items => { calls.saved.push(...items); return {}; }
  };
  const source = readFileSync(new URL('../src/printify-cost-builder.mjs', import.meta.url), 'utf8')
    .replace(/^import[\s\S]*?from\s+['"][^'"]+['"];\s*$/gm, '').replace(/^export /gm, '');
  const sandbox = vm.createContext({ ...stubs, Buffer, setTimeout, structuredClone, console });
  vm.runInContext(source + ';globalThis.build=buildPrintifyCostsForRequest;', sandbox);
  const request = { countryCode: 'DE', productCode: 'C', width: 24, height: 36, maxDrafts: 4,
    confirm: 'CREATE_UNPUBLISHED_PRINTIFY_PRICING_DRAFTS' };
  return { build: () => sandbox.build(request), products, calls };
}

test('one private price-check product per Printify product and printer, kept and never created twice', async () => {
  const shop = fakePrintify();
  const first = await shop.build();
  assert.equal(shop.calls.created, 2);
  assert.equal(first.created.filter(item => item.createdProductId).length, 2);
  assert.equal(shop.products.length, 2, 'the products stay in Printify for reuse');
  assert.ok(shop.products.every(p => /PRIVATE PRICE CHECK/.test(p.title)));
  assert.equal(shop.calls.saved.length, 4, 'every variant cost is saved as well');
  const again = await shop.build();
  assert.equal(shop.calls.created, 2, 'a later lookup creates nothing');
  assert.equal(again.attempted, 0);
});

test('a product already in the shop is reused instead of creating another', async () => {
  const shop = fakePrintify({ seeShopCosts: false });
  await shop.build();
  assert.equal(shop.calls.created, 2);
  const again = await shop.build();
  assert.equal(shop.calls.created, 2);
  assert.deepEqual([...again.created.map(item => item.reusedProductId)], ['p1', 'p2']);
});

test('nothing is created when the shop\'s products cannot be read', async () => {
  const shop = fakePrintify({ listFails: true });
  await assert.rejects(shop.build(), /Printify 403/);
  assert.equal(shop.calls.created, 0);
});

test('two lookups at the same time create each product once', async () => {
  const shop = fakePrintify();
  const results = await Promise.all([shop.build(), shop.build(), shop.build()]);
  assert.equal(shop.calls.created, 2);
  assert.ok(results.every(result => result.ok));
});
