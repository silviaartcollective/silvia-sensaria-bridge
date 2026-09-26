import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSilviaSku, resolveSensariaSku, rowsToCsv } from '../src/core.mjs';

test('parses Silvia print SKU', () => {
  assert.deepEqual(parseSilviaSku('SAC0042-P-1218'), {
    artworkId: 'SAC0042',
    format: 'P',
    size: '12x18',
    frame: 'NONE'
  });
});

test('normalizes dark wood framed canvas to Sensaria Brown', () => {
  assert.deepEqual(parseSilviaSku('SAC0042-FC-2436-DWD'), {
    artworkId: 'SAC0042',
    format: 'FC',
    size: '24x36',
    frame: 'BRN'
  });
});

test('parses and resolves 40x60 canvas', () => {
  const parsed = parseSilviaSku('SAC0042-C-4060');
  assert.equal(parsed.size, '40x60');
  assert.equal(resolveSensariaSku(parsed, {
    'C|40x60|NONE': { friendlySku: '19000200027' }
  }), '19000200027');
});

test('parses and resolves 40x60 framed canvas', () => {
  const parsed = parseSilviaSku('SAC0042-FC-4060-WHT');
  assert.equal(parsed.size, '40x60');
  assert.equal(resolveSensariaSku(parsed, {
    'FC|40x60|WHT': { friendlySku: '19010400012' }
  }), '19010400012');
});

test('rejects unresolved manufacturing mapping instead of substituting a size', () => {
  assert.throws(
    () => resolveSensariaSku(parseSilviaSku('SAC0042-P-0812'), {}),
    /No Sensaria FriendlySKU/
  );
});

test('writes Sensaria header order', () => {
  const csv = rowsToCsv([]);
  assert.ok(csv.startsWith('ReferenceOrderNumber,ReferenceOrderItemNumber,ShippingMethod,'));
});
