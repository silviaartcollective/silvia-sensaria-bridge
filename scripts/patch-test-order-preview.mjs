import fs from 'node:fs';

const path = 'src/server.mjs';
let text = fs.readFileSync(path, 'utf8');

const oldBlock = `      const result = await etsyReceiptToSensariaCsvFromR2(receipt);\n      const refreshedManifest = await loadArtworkManifest(meta.artworkId);\n      const productionEntry = refreshedManifest?.production?.[\`${'${meta.format}'}|${'${meta.size}'}|${'${meta.orientation}'}\`];\n      const spec = productionEntry?.spec || {};\n      const output = spec.output || null;\n      const row = result.rows?.[0] || {};`;

const newBlock = `      // Dry-run is for validating GO mappings and checkout/shipping costs.\n      // Do not render the enormous production canvas inside the web request;\n      // use the existing master-artwork URL and keep the production spec visible.\n      const result = await etsyReceiptToSensariaCsvFromR2(receipt, { renderProduction: false });\n      const source = result.sources?.[0] || {};\n      const spec = source.spec || {};\n      const output = spec.output || null;\n      const row = result.rows?.[0] || {};`;

if (!text.includes(oldBlock)) {
  throw new Error('Expected test-order render block was not found in src/server.mjs');
}
text = text.replace(oldBlock, newBlock);

text = text.replace(
  `        productionKey: productionEntry?.key || null,`,
  `        productionKey: source.rendered ? (source.key || null) : null,\n        sourceKey: source.key || manifest.master.key || null,`
);

text = text.replace(
  `          template: spec.template || null\n        },`,
  `          template: spec.template || null,\n          rendered: Boolean(source.rendered)\n        },`
);

const listenNeedle = `server.listen(port, '0.0.0.0', () => {`;
if (text.includes(listenNeedle) && !text.includes('server.keepAliveTimeout = 120_000')) {
  text = text.replace(
    listenNeedle,
    `// Keep Render's edge proxy from reusing a connection Node has already closed.\nserver.keepAliveTimeout = 120_000;\nserver.headersTimeout = 120_000;\n\n${listenNeedle}`
  );
}

fs.writeFileSync(path, text);
console.log('Patched dry-run to skip heavy production rendering and tuned Render keep-alive timeouts.');
