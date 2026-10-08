import test from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN_LINKS, renderAdminSidebar, decorateAdminHtml, extractActiveAdminPath } from '../src/admin-sidebar.mjs';
import { renderTrackingPage } from '../src/tracking-page.mjs';
import { renderOrdersPage } from '../src/orders-page.mjs';
import { renderCustomOrdersPage } from '../src/custom-orders-page.mjs';

const expected = [
  'Dashboard', 'Product Creator', 'Gelato → Silvia Converter', 'Shipping Profile',
  'Pricing & Shipping', 'Supplier Comparison', 'Custom Size Lookup', 'Custom Orders',
  'Description Updater', 'Order Tracking', 'Test Order', 'All Orders',
  'Artwork Library', 'Product SKUs', 'Etsy Status', 'R2 Status', 'Log out'
];

test('canonical sidebar contains all dashboard links in one permanent order', () => {
  assert.deepEqual(ADMIN_LINKS.map(link=>link.label),expected);
  assert.equal(new Set(ADMIN_LINKS.map(link=>link.href)).size,expected.length);
  assert.equal((renderAdminSidebar('/').match(/shared-nav-link/g)||[]).length,expected.length);
});
test('replaces a short legacy sidebar rather than leaving missing page links', () => {
  const old='<html><head></head><body><div class="shell"><aside><div>Old</div>'+
    '<nav><a class="nav active" href="/custom-orders">Custom Orders</a></nav></aside>'+
    '<main id="content">Custom order form</main></div></body></html>';
  const result=decorateAdminHtml(old);
  assert.equal((result.match(/class="nav shared-nav-link/g)||[]).length,expected.length);
  assert.equal(result.match(/aria-current="page"/g)?.length,1);
  assert.match(result,/href="\/custom-orders" aria-current="page"/);
  assert.match(result,/<main id="content">Custom order form<\/main>/);
  assert.match(result,/shared-sidebar-mobile-toggle/);
  assert.match(result,/shared-admin-sidebar-styles/);
});
test('correct active section on new full-page admin tools',()=>{
  for(const [html,expectedPath] of [
    [renderTrackingPage('Silvia Art Collective'),'/tracking'],
    [renderOrdersPage(),'/orders'],
    [renderCustomOrdersPage(),'/custom-orders']
  ]) {
    assert.equal(extractActiveAdminPath(html),expectedPath);
    const result=decorateAdminHtml(html);
    assert.equal((result.match(/class="nav shared-nav-link/g)||[]).length,expected.length);
    assert.ok(result.includes('href="'+expectedPath+'" aria-current="page"'));
  }
});
test('pages without an admin sidebar are not modified',()=>{
  const login='<!doctype html><html><head></head><body><main>Sign in</main></body></html>';
  assert.equal(decorateAdminHtml(login),login);
});
