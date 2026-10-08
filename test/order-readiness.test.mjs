import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ADMIN_LINKS, decorateAdminHtml } from '../src/admin-sidebar.mjs';
import { renderOrdersPage } from '../src/orders-page.mjs';
import { renderCustomOrdersPage } from '../src/custom-orders-page.mjs';
const server = readFileSync(new URL('../src/server.mjs', import.meta.url), 'utf8');
test('paid-order and human-reviewed custom-order tools exist on all admin pages', () => {
  const links = ADMIN_LINKS.map(x => x.href);
  assert.ok(links.includes('/orders'));
  assert.ok(links.includes('/custom-orders'));
  for (const html of [renderOrdersPage(), renderCustomOrdersPage()]) {
    const decorated = decorateAdminHtml(html);
    assert.match(decorated, /shared-admin-sidebar/);
    for (const path of ['/orders', '/custom-orders', '/tracking', '/test-order'])
      assert.ok(decorated.includes('href="' + path + '"'));
  }
});
test('order workflow API routes require authentication and only allow manual supplier order recording', () => {
  for (const route of ['/api/orders','/api/custom-orders','/api/custom-orders/import','/api/custom-orders/sync'])
    assert.ok(server.includes(route), route + ' route missing');
  assert.match(server, /if \(!requireAdminApi\(req, res\)\) return;/);
  assert.ok(server.includes("action === 'approve'"));
  assert.ok(server.includes("action === 'mark-ordered'"));
  assert.ok(!server.includes("action === 'submit-supplier-order'"));
});
