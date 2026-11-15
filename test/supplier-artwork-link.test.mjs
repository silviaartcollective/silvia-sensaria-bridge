// The app's own expiring link to one production crop, for suppliers that check
// an artwork URL with HEAD (PrintShrimp): a GET-signed R2 link answers HEAD with 403.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { supplierArtworkLink, verifySupplierArtworkPath, isSupplierArtworkPath } from '../src/supplier-artwork-link.mjs';

const env = { ADMIN_PASSWORD: 'test-password-123' }, now = Date.UTC(2026, 10, 15);
const KEY = 'artworks/SAC0021/fulfillment/3x4.jpg';

test('a link names one crop, expires, and cannot be altered or used without the secret', () => {
  const link = supplierArtworkLink({ key: KEY, base: 'https://silvia.example.com', now, env });
  const path = new URL(link).pathname;
  assert.ok(isSupplierArtworkPath(path)); assert.ok(path.endsWith('/3x4.jpg'));
  assert.equal(verifySupplierArtworkPath(path, { now, env }), KEY);
  assert.throws(() => verifySupplierArtworkPath(path, { now: now + 8 * 86400e3, env }), /expired/);
  assert.throws(() => verifySupplierArtworkPath(path, { now, env: { ADMIN_PASSWORD: 'other' } }), /Not an artwork link/);
  const parts = path.split('/');
  parts[3] = String(Number(parts[3]) + 999999);
  assert.throws(() => verifySupplierArtworkPath(parts.join('/'), { now, env }), /Not an artwork link/, 'a longer expiry is refused');
  const other = path.replace(parts[2], Buffer.from('artworks/SAC0022/fulfillment/3x4.jpg').toString('base64url'));
  assert.throws(() => verifySupplierArtworkPath(other, { now, env }), /Not an artwork link/, 'another file is refused');
});

test('only production crops: never a master, and only over HTTPS', () => {
  for (const key of ['artworks/SAC0021/fulfillment/by-size/12x16.jpg', 'artworks/SAC0021/revisions/0b6ef3a2-1c2d-4e5f-8a9b-0c1d2e3f4a5b/fulfillment/3x4.jpg'])
    assert.ok(supplierArtworkLink({ key, base: 'https://a.example', now, env }));
  for (const key of ['artworks/SAC0021/master.jpg', 'state/crop-jobs.json', 'artworks/SAC0021/fulfillment/../master.jpg'])
    assert.throws(() => supplierArtworkLink({ key, base: 'https://a.example', now, env }), /Only production crops/);
  assert.throws(() => supplierArtworkLink({ key: KEY, base: 'http://a.example', now, env }), /not HTTPS/);
});

test('the server serves it before sign-in, to HEAD and GET, and PrintShrimp orders use it', () => {
  const server = readFileSync(new URL('../src/server.mjs', import.meta.url), 'utf8');
  const route = server.indexOf("(req.method === 'GET' || req.method === 'HEAD') && isSupplierArtworkPath(url.pathname)");
  assert.ok(route > 0 && route < server.indexOf("url.pathname === '/login'"));
  assert.match(server, /if \(req\.method === 'HEAD'\) \{ res\.writeHead\(200, headers\); return res\.end\(\); \}/);
  assert.match(server, /publicArtworkUrl:key=>supplierArtworkLink\(\{key,base:appOrigin\}\)/);
});
