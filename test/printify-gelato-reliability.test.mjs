import test from 'node:test';
import assert from 'node:assert/strict';
import { __test as gelato } from '../src/gelato-comparison.mjs';
import { __test as printify } from '../src/printify-comparison.mjs';
import { estimateSupplierLandedCost, landedCostPolicy } from '../src/landed-cost.mjs';

test('Gelato canvas is classified without confusing stretched canvas with floater frames', () => {
  assert.equal(gelato.classifyCatalog({ catalogUid: 'canvas', title: 'Canvas' }), 'C');
  assert.equal(gelato.classifyCatalog({ catalogUid: 'framed-canvas', title: 'Framed Canvas' }), 'FC');
  assert.equal(gelato.productCodeForItem({
    productUid: 'canvas_pf_508x762-mm-20x30-inch_wrapped_ver',
    attributes: { CanvasFrame: 'wood-stretcher' }
  }, { catalogUid: 'canvas', title: 'Canvas' }), 'C');
});

test('Gelato recognizes 20x30 UID when inch unit has trailing underscore', () => {
  const product = { productUid: 'canvas_pf_508x762-mm-20x30-inch_wrapped_ver', attributes: {} };
  const candidates = gelato.productSizeCandidates(product);
  assert.ok(candidates.length > 0);
  assert.equal(gelato.sizeCompatible(product, gelato.parseTargetSize('20x30')), true);
});

test('Printify parses a genuine 20x30 variant', () => {
  assert.equal(printify.classifyBlueprint('Stretched Canvas'), 'C');
  assert.equal(printify.variantSize({ options: { size: '20x30' }, title: '20x30' }), '20x30');
});

test('Printify and Gelato have finite planning totals when a verified quote exists', () => {
  const policy = landedCostPolicy();
  assert.equal(policy.printifyReserve, 0.2);
  assert.equal(policy.gelatoReserve, 0.2);
  for (const provider of ['Printify','Gelato']) {
    const result = estimateSupplierLandedCost(
      { provider, eligible: true, totalUsd: 50, currency: 'USD' },
      { countryCode: 'CA', policy }
    );
    assert.equal(result.contingencyUsd, 10);
    assert.equal(result.modeledLandedUsd, 60);
  }
});

test('Missing verified costs remain unavailable rather than being treated as $0', () => {
  const result = estimateSupplierLandedCost(
    { provider: 'Printify', eligible: false, totalUsd: null },
    { countryCode: 'CA' }
  );
  assert.equal(result.modeledLandedUsd, null);
});
