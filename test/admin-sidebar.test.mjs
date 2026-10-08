import test from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN_LINKS, renderAdminSidebar, decorateAdminHtml, extractActiveAdminPath } from '../src/admin-sidebar.mjs';
import { renderTrackingPage } from '../src/tracking-page.mjs';

const expected = [
  'Dashboard','Product Creator','Gelato → Silvia Converter','Shipping Profile',
  'Pricing & Shipping','Supplier Comparison','Custom Size Lookup',
  'Description Updater','Order Tracking','Test Order','Orders',
  'Artwork Library','Product SKUs','Etsy Status','R2 Status','Log out'
];

test('shared Silvia navigation retains each existing link in dashboard order',()=>{
  assert.deepEqual(ADMIN_LINKS.map(x=>x.label),expected);
  assert.equal(new Set(ADMIN_LINKS.map(x=>x.href)).size,expected.length);
  assert.equal((renderAdminSidebar('/').match(/class="nav shared-nav-link/g)||[]).length,expected.length);
  assert.ok(!ADMIN_LINKS.some(x=>x.href==='/orders'||x.href==='/custom-orders'));
});
test('all admin pages replace short legacy sidebar consistently',()=>{
  const page='<html><head></head><body><div class="shell">'+
    '<aside><nav><a class="nav active" href="/pricing">Pricing &amp; Shipping</a></nav></aside>'+
    '<main id="page">Keep this content</main></div></body></html>';
  const html=decorateAdminHtml(page);
  assert.equal((html.match(/class="nav shared-nav-link/g)||[]).length,expected.length);
  assert.match(html,/href="\/pricing" aria-current="page"/);
  assert.match(html,/<main id="page">Keep this content<\/main>/);
  assert.match(html,/shared-sidebar-mobile-toggle/);
  assert.match(html,/shared-admin-sidebar-styles/);
});
test('tracking page highlights Order Tracking',()=>{
  const html=renderTrackingPage('Silvia Art Collective');
  assert.equal(extractActiveAdminPath(html),'/tracking');
  assert.match(decorateAdminHtml(html),/href="\/tracking" aria-current="page"/);
});
test('login and ordinary HTML without sidebars remain unchanged',()=>{
  const login='<html><head></head><body><main>Log in</main></body></html>';
  assert.equal(decorateAdminHtml(login),login);
});
