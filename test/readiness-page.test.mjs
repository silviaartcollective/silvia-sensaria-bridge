import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ADMIN_LINKS, decorateAdminHtml } from '../src/admin-sidebar.mjs';
import { renderReadinessPage } from '../src/readiness-page.mjs';
test('readiness page links to order tools and uses canonical navigation',()=>{
 const page=decorateAdminHtml(renderReadinessPage('Test Art Shop'));
 assert.ok(ADMIN_LINKS.some(x=>x.href==='/readiness'));
 assert.match(page,/href="\/readiness" aria-current="page"/);
 for(const path of ['/orders','/custom-orders','/test-order'])
   assert.ok(page.includes('href="'+path+'"'));
 for(const provider of ['Sensaria','Prodigi','Artelo','PrintShrimp','Printify','Gelato'])
   assert.ok(page.includes("'"+provider+"'"));
 assert.ok(page.includes('Live submission must remain off'));
});
test('readiness route stays behind administrator authentication',()=>{
 const code=readFileSync(new URL('../src/server.mjs',import.meta.url),'utf8');
 assert.match(code,/url\.pathname === '\/readiness'/);
 assert.match(code,/requireAdminPage\(req, res, '\/readiness'\)/);
});
