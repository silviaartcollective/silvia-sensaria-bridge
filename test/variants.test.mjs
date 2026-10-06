import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SILVIA_REFERENCE_CAD_PER_USD,
  SILVIA_RETAIL_PRICE_LADDER_CAD,
  SILVIA_RETAIL_PRICE_LADDER_USD,
  SILVIA_SALE_DISCOUNT_PERCENT,
  SILVIA_SIZE_LABELS,
  SILVIA_STYLES,
  buildOwnSilviaInventory
} from '../src/variants.mjs';

const catalog = {
  'P|8x10|NONE': { friendlySku: '42010000001', costUsd: 14.78 },
  'P|11x14|NONE': { friendlySku: '42010000006', costUsd: 14.27 },
  'C|12x16|NONE': { friendlySku: '19000200032', costUsd: 20.50 },
  'C|24x36|NONE': { friendlySku: '19000200002', costUsd: 42.06 },
  'FC|12x16|NAT': { friendlySku: '19010901004', costUsd: 36.82 },
  'FC|12x16|BLK': { friendlySku: '19010200030', costUsd: 36.82 }
};

test('uses buyer-friendly metric + inch size labels', () => {
  assert.equal(SILVIA_SIZE_LABELS['8x10'], '20x25 cm / 8x10″');
  assert.equal(SILVIA_SIZE_LABELS['24x36'], '60x90 cm / 24x36″');
  assert.equal(SILVIA_SIZE_LABELS['40x60'], '100x150 cm / 40x60″');
});

test('uses Matte Paper Poster product style name', () => {
  assert.equal(SILVIA_STYLES[0].label, 'Matte Paper Poster');
});

test('keeps the approved CAD-to-USD planning rate and 25% shop sale explicit', () => {
  assert.equal(SILVIA_REFERENCE_CAD_PER_USD, 1.39);
  assert.equal(SILVIA_SALE_DISCOUNT_PERCENT, 25);
});

test('includes mapped 8x10 poster with exact converted USD retail price', () => {
  const inventory = buildOwnSilviaInventory({
    artworkId: 'SAC0042',
    catalog,
    readinessStateId: 123,
    defaultQuantity: 999
  });

  const eightByTen = inventory.products.find((product) =>
    product.property_values?.[0]?.values?.[0] === '20x25 cm / 8x10″' &&
    product.property_values?.[1]?.values?.[0] === 'Matte Paper Poster'
  );

  assert.ok(eightByTen);
  assert.equal(eightByTen.sku, 'SAC0042-P-810');
  assert.equal(eightByTen.offerings[0].is_enabled, true);
  assert.equal(eightByTen.offerings[0].quantity, 999);
  assert.equal(eightByTen.offerings[0].price, 39.53);
});

test('poster prices rise with size despite supplier cost anomalies', () => {
  assert.equal(SILVIA_RETAIL_PRICE_LADDER_CAD.P['8x10'], 54.95);
  assert.equal(SILVIA_RETAIL_PRICE_LADDER_USD.P['8x10'], 39.53);
  assert.equal(SILVIA_RETAIL_PRICE_LADDER_USD.P['11x14'], 43.13);
  assert.ok(
    SILVIA_RETAIL_PRICE_LADDER_USD.P['11x14'] >
    SILVIA_RETAIL_PRICE_LADDER_USD.P['8x10']
  );
});

test('24x36 canvas uses the approved Silvia CAD-equivalent USD retail price', () => {
  const inventory = buildOwnSilviaInventory({
    artworkId: 'SAC0042',
    catalog,
    readinessStateId: 123
  });
  const product = inventory.products.find((item) =>
    item.property_values?.[0]?.values?.[0] === '60x90 cm / 24x36″' &&
    item.property_values?.[1]?.values?.[0] === 'Canvas'
  );
  assert.ok(product);
  assert.equal(product.offerings[0].price, 194.21);
});

test('framed canvas colours share one exact converted USD customer price per size', () => {
  const inventory = buildOwnSilviaInventory({
    artworkId: 'SAC0042',
    catalog,
    readinessStateId: 123
  });
  const natural = inventory.products.find((item) =>
    item.property_values?.[0]?.values?.[0] === '30x40 cm / 12x16″' &&
    item.property_values?.[1]?.values?.[0] === 'Framed Canvas - Natural Oak'
  );
  const black = inventory.products.find((item) =>
    item.property_values?.[0]?.values?.[0] === '30x40 cm / 12x16″' &&
    item.property_values?.[1]?.values?.[0] === 'Framed Canvas - Matte Black'
  );
  assert.equal(natural.offerings[0].price, 136.65);
  assert.equal(black.offerings[0].price, 136.65);
});
