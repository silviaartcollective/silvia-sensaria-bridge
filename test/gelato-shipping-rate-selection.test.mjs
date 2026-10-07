import test from 'node:test';
import assert from 'node:assert/strict';
import { __test as gelato } from '../src/gelato-comparison.mjs';

test('Gelato shipping uses country average rather than cheapest-zone minimum', () => {
  const quote=gelato.parseShipmentPrice({
    prices: [{
      productUid: 'sample-canvas-20x30',
      quantities: [{
        quantity: 1,
        methods: [
          { shipmentMethodUid:'express', type:'express', minPrice:90, avgPrice:110 },
          { shipmentMethodUid:'dhl_global_parcel', type:'normal', minPrice:59.43, avgPrice:63.79,
            hasFlatRate:false }
        ]
      }]
    }]
  }, 'sample-canvas-20x30');
  assert.equal(quote.price, 63.79);
  assert.equal(quote.minimumPrice, 59.43);
  assert.equal(quote.averagePrice, 63.79);
  assert.equal(quote.methodUid, 'dhl_global_parcel');
  assert.equal(Math.round((61.64 + quote.price) * 100)/100, 125.43);
});

test('country-level Gelato pricing does not silently invent missing rates', () => {
  const result=gelato.parseShipmentPrice({
    prices:[{productUid:'item',quantities:[{quantity:1,methods:[]}]}]
  }, 'item');
  assert.equal(result, null);
});
