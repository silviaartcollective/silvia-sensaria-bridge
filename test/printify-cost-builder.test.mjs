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

function fakePrintify({ noCosts = false, saveFails = false, deleteFails = false } = {}) {
  const products = [], saved = new Set(), calls = { created: 0, deleted: 0 };
  const pairs = [{ blueprintId: 1159, providerId: 22, product: 'Matte Canvas', printProvider: 'Jondo' },
    { blueprintId: 555, providerId: 7, product: 'Canvas', printProvider: 'Other' }];
  const stubs = {
    sharp: () => ({ png: () => ({ toBuffer: async () => Buffer.alloc(1) }) }),
    printifyConfigStatus: () => ({ ready: true }),
    // A pair has a cost once its prices are saved (as the real scan reads the saved library).
    scanPrintifyComparisonRows: async () => new Map([['k', { meta: { offers: pairs.map(pair => ({
      ...pair, productionUsd: saved.has(pair.blueprintId + '|' + pair.providerId) ? 30 : null })) } }]]),
    getPrintifyVariants: async () => ({ variants: [{ id: 1, placeholders: [] }, { id: 2, placeholders: [] }] }),
    createPrintifyPricingDraft: async payload => {
      await new Promise(resolve => setTimeout(resolve, 5));
      calls.created++;
      const product = { id: 'p' + calls.created, title: payload.title, visible: payload.visible,
        variants: payload.variants.map(v => ({ id: v.id, cost: noCosts ? null : 2500 })) };
      products.push(product);
      return product;
    },
    getPrintifyPricingDraft: async id => products.find(p => p.id === id),
    deletePrintifyPricingDraft: async id => {
      if (deleteFails) throw Error('Printify 500');
      calls.deleted++;
      products.splice(products.findIndex(p => p.id === id), 1);
    },
    uploadPrintifyPricingImage: async () => ({ id: 'img' }),
    invalidatePrintifyCatalogCache() {}, resetPrintifyCostLibraryCache() {},
    savePrintifyCostLibrary: async items => {
      if (saveFails) throw Error('R2 down');
      for (const item of items) saved.add(item.blueprintId + '|' + item.providerId);
      return {};
    }
  };
  const source = readFileSync(new URL('../src/printify-cost-builder.mjs', import.meta.url), 'utf8')
    .replace(/^import[\s\S]*?from\s+['"][^'"]+['"];\s*$/gm, '').replace(/^export /gm, '');
  const sandbox = vm.createContext({ ...stubs, Buffer, setTimeout, console });
  vm.runInContext(source + ';globalThis.build=buildPrintifyCostsForRequest;', sandbox);
  const request = { countryCode: 'DE', productCode: 'C', width: 24, height: 36, maxDrafts: 4,
    confirm: 'CREATE_UNPUBLISHED_PRINTIFY_PRICING_DRAFTS' };
  return { build: () => sandbox.build(request), products, calls };
}

test('each test product is deleted right after its prices are read, and never needed again', async () => {
  const shop = fakePrintify();
  const first = await shop.build();
  assert.equal(shop.calls.created, 2);
  assert.equal(shop.calls.deleted, 2);
  assert.equal(shop.products.length, 0, 'nothing is left in Printify');
  assert.equal(first.captured, 4);
  assert.ok(first.created.every(item => item.temporaryDraftDeleted && item.savedInR2));
  const again = await shop.build();
  assert.equal(shop.calls.created, 2, 'saved prices: a later lookup creates nothing');
  assert.equal(again.attempted, 0);
});

test('the test product is deleted even when its prices cannot be read or saved', async () => {
  const unread = fakePrintify({ noCosts: true });
  const a = await unread.build();
  assert.equal(unread.products.length, 0);
  assert.equal(a.errors.length, 2);
  assert.ok(a.errors.every(item => item.temporaryDraftDeleted));
  const unsaved = fakePrintify({ saveFails: true });
  const b = await unsaved.build();
  assert.equal(unsaved.products.length, 0);
  assert.ok(b.created.every(item => !item.savedInR2 && item.temporaryDraftDeleted && /R2 down/.test(item.warning)));
});

test('a test product that cannot be deleted is reported', async () => {
  const shop = fakePrintify({ deleteFails: true });
  const result = await shop.build();
  assert.ok(result.created.every(item => item.temporaryDraftDeleted === false && /could not be deleted.*Delete it in Printify/.test(item.warning)));
});

test('two lookups at the same time make each test product once', async () => {
  const shop = fakePrintify();
  const results = await Promise.all([shop.build(), shop.build(), shop.build()]);
  assert.equal(shop.calls.created, 2);
  assert.equal(shop.products.length, 0);
  assert.ok(results.every(result => result.ok));
});
