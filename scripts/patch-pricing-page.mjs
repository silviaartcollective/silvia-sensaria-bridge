import { readFileSync, writeFileSync } from 'node:fs';

function patchFile(path, patcher) {
  const before = readFileSync(path, 'utf8');
  const after = patcher(before);
  if (after !== before) writeFileSync(path, after);
}

patchFile('src/server.mjs', (source) => {
  let out = source;

  if (!out.includes("import { renderPricingPage } from './pricing-page.mjs';")) {
    out = out.replace(
      "import { renderTestOrderPage } from './test-order-page.mjs';",
      "import { renderTestOrderPage } from './test-order-page.mjs';\nimport { renderPricingPage } from './pricing-page.mjs';\nimport { pricingCatalogForZone, publicShippingPricingConfig } from './pricing.mjs';"
    );
  }

  if (!out.includes("url.pathname === '/pricing'")) {
    const anchor = "  if (req.method === 'GET' && url.pathname === '/product-creator') {";
    const block = `  if (req.method === 'GET' && url.pathname === '/pricing') {\n    if (!requireAdminPage(req, res, '/pricing')) return;\n    return sendHtml(res, 200, renderPricingPage());\n  }\n\n  if (req.method === 'GET' && url.pathname === '/api/pricing') {\n    if (!requireAdminApi(req, res)) return;\n    try {\n      const zone = String(url.searchParams.get('zone') || '2A').trim().toUpperCase();\n      return sendJson(res, 200, {\n        ok: true,\n        zone,\n        rows: pricingCatalogForZone(zone),\n        config: publicShippingPricingConfig()\n      });\n    } catch (error) {\n      return sendJson(res, 400, { ok: false, error: error?.message || String(error) });\n    }\n  }\n\n`;
    if (!out.includes(anchor)) throw new Error('Could not find product creator route anchor');
    out = out.replace(anchor, block + anchor);
  }

  return out;
});

patchFile('src/dashboard.mjs', (source) => {
  if (source.includes('href="/pricing"')) return source;
  const anchor = '    <a class="nav" href="/product-creator">Product Creator</a>\n';
  if (!source.includes(anchor)) throw new Error('Could not find dashboard nav anchor');
  return source.replace(anchor, anchor + '    <a class="nav" href="/pricing">Pricing & Shipping</a>\n');
});

console.log('Pricing page patch applied.');
