import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const server = readFileSync(new URL('../src/server.mjs', import.meta.url), 'utf8');

test('locks the approved 15-image Silvia custom mockup remap', () => {
  assert.match(server, /SILVIA_CANONICAL_CUSTOM_REMAP_15\s*=\s*\[1, 10, 0, 11, 7, 9, 8, 6, 5, 3, 2, 4\]/);
  assert.match(server, /\[2, 'choose-option'\]/);
  assert.match(server, /\[5, 'choose-frame'\]/);
  assert.match(server, /\[15, 'promotion'\]/);
});

test('optimizes Etsy listing images without changing R2 originals', () => {
  assert.match(server, /width:\s*2400/);
  assert.match(server, /height:\s*2400/);
  assert.match(server, /quality:\s*92/);
  assert.match(server, /originalImageBytes/);
  assert.match(server, /uploadImageBytes/);
});

test('reports detailed draft timing for speed diagnostics', () => {
  assert.match(server, /mediaPrepMs/);
  assert.match(server, /inventoryMs/);
  assert.match(server, /attributesMs/);
  assert.match(server, /mediaUploadMs/);
});
