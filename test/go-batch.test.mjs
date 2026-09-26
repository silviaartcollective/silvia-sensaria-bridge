import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SENSARIA_GO_BATCH_HEADERS, goRowsToCsv } from '../src/fulfillment.mjs';

const goProducts = JSON.parse(
  readFileSync(new URL('../config/go-products.json', import.meta.url), 'utf8')
);
const products = JSON.parse(
  readFileSync(new URL('../config/products.json', import.meta.url), 'utf8')
);
const fulfillmentSource = readFileSync(new URL('../src/fulfillment.mjs', import.meta.url), 'utf8');
const serverSource = readFileSync(new URL('../src/server.mjs', import.meta.url), 'utf8');

test('GO CSV headers exactly match Sensaria batch upload sample', () => {
  assert.deepEqual(SENSARIA_GO_BATCH_HEADERS, [
    'PO Number','URL','URL2','Product Code','Wrap Type','Wrap Color','Quantity','Shipping Type',
    'Branding Set Name','First Name','Last Name','Company Name','Country','Address line 1',
    'Address line 2','City','State','Zip','Email','Phone','Coupon Code'
  ]);
});

test('GO CSV serializes sample-shaped row in the official column order', () => {
  const csv = goRowsToCsv([{
    'PO Number': '1234',
    URL: 'https://example.com/art.jpg',
    URL2: '',
    'Product Code': '1350595',
    'Wrap Type': 'Mirror',
    'Wrap Color': '',
    Quantity: 1,
    'Shipping Type': 'Basic',
    'Branding Set Name': '',
    'First Name': 'Jane',
    'Last Name': 'Doe',
    'Company Name': '',
    Country: 'US',
    'Address line 1': '123 Main St',
    'Address line 2': '',
    City: 'Portland',
    State: 'OR',
    Zip: '97201',
    Email: 'jane@example.com',
    Phone: '1111111111',
    'Coupon Code': ''
  }]);
  const lines = csv.trim().split(/\r?\n/);
  assert.equal(lines[0], SENSARIA_GO_BATCH_HEADERS.join(','));
  assert.equal(lines[1].split(',')[3], '1350595');
  assert.equal(lines[1].split(',')[4], 'Mirror');
  assert.equal(lines[1].split(',')[7], 'Basic');
});

test('GO product mapping uses account product codes for key variants', () => {
  assert.equal(goProducts['P|8x10|NONE'].productCode, '1353075');
  assert.equal(goProducts['P|30x40|NONE'].productCode, '1353097');
  assert.equal(goProducts['C|24x36|NONE'].productCode, '1350595');
  assert.equal(goProducts['C|40x60|NONE'].productCode, '1350638');
  assert.equal(goProducts['FC|24x36|BLK'].productCode, '1350794');
  assert.equal(goProducts['FC|24x36|BRN'].productCode, '1352014');
  assert.equal(goProducts['FC|24x36|NAT'].productCode, '1354806');
  assert.equal(goProducts['FC|24x36|WHT'].productCode, '1352141');
});

test('every enabled Etsy manufacturing variant has a GO batch product code', () => {
  const missing = Object.keys(products).filter((key) => !goProducts[key]?.productCode);
  assert.deepEqual(missing, []);
});

test('canvas and framed canvas mappings use Mirror wrap and posters do not', () => {
  assert.equal(goProducts['P|24x36|NONE'].wrapType, '');
  assert.equal(goProducts['C|24x36|NONE'].wrapType, 'Mirror');
  assert.equal(goProducts['FC|24x36|NAT'].wrapType, 'Mirror');
});

test('dry-run shipping checks explicitly skip production rendering', () => {
  assert.match(fulfillmentSource, /renderProduction\s*=\s*true/);
  assert.match(fulfillmentSource, /if \(renderProduction\)/);
  assert.match(serverSource, /etsyReceiptToSensariaCsvFromR2\(receipt, \{ renderProduction: false \}\)/);
  assert.match(serverSource, /sourceKey:/);
});

test('Render keep-alive timeouts are tuned for proxy reuse', () => {
  assert.match(serverSource, /server\.keepAliveTimeout\s*=\s*120_000/);
  assert.match(serverSource, /server\.headersTimeout\s*=\s*120_000/);
});
