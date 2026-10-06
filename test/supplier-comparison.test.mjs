import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeSupplierComparisonRows } from '../src/supplier-comparison.mjs';

const base = {
  countryCode: 'CA', country: 'Canada', productCode: 'P', product: 'Poster',
  size: '12x16', finishCode: 'NONE', finish: '—', sku: 'GLOBAL-FAP-12X16',
  productionCost: 50, shippingCost: 0, totalBeforeTax: 50,
  fulfillmentLocations: ['CA'],
  sensaria: { productionCost: 20, shippingCost: 5, totalBeforeTax: 25, productKey: 'P|12x16|NONE' }
};

test('null supplier values are not treated as zero and cheapest adjusted supplier wins', () => {
  const rows = mergeSupplierComparisonRows({
    prodigiRows: [base],
    printShrimpPricing: { currency: 'GBP', sizes: [{ size: '30x40cm', print: { price: 10, shipping: 2 } }] },
    gbpUsd: { rate: 1.25 },
    riskPolicy: {
      sensariaDomesticReserve: .1, sensariaCanadaReserve: .2, sensariaInternationalReserve: .3,
      prodigiUsDomesticReserve: .1, prodigiDomesticReserve: .15, prodigiEuReserve: .28, prodigiCrossBorderReserve: .3,
      arteloTaxReserve: .2, arteloCanadaReserve: .18, arteloEuropeReserve: .28, arteloUsReserve: .1,
      printShrimpGbpFxReserve: .02
    }
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].suppliers.artelo.modeledLandedUsd, null);
  assert.equal(rows[0].winner, 'PrintShrimp');
  assert.equal(rows[0].suppliers.printshrimp.meta.paperType, 'Matte');
});

test('PrintShrimp is intentionally ineligible for canvas', () => {
  const row = { ...base, productCode: 'C', product: 'Canvas', size: '12x16', sku: 'GLOBAL-CAN-12X16' };
  const [merged] = mergeSupplierComparisonRows({ prodigiRows: [row], printShrimpPricing: null, gbpUsd: null });
  assert.equal(merged.suppliers.printshrimp.eligible, false);
  assert.equal(merged.suppliers.printshrimp.status, 'not-offered');
});


test('Sensaria comparison record includes the provisional delivery profile', () => {
  const input = typeof baseRow === 'function' ? baseRow({}) : base;
  const [row] = mergeSupplierComparisonRows({
    prodigiRows: [input],
    printShrimpPricing: null,
    gbpUsd: null
  });
  const estimate = row.suppliers.sensaria.meta.deliveryEstimate;
  assert.equal(estimate.destination, 'CA');
  assert.deepEqual(estimate.planningBusinessDays, [3, 5]);
  assert.equal(estimate.customerPromiseSafe, false);
});
