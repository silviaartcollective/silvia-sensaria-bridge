import fs from 'node:fs';

function replaceAllInFile(path, replacements) {
  let text = fs.readFileSync(path, 'utf8');
  for (const [from, to] of replacements) text = text.replaceAll(from, to);
  fs.writeFileSync(path, text);
}

{
  const path = 'src/server.mjs';
  let text = fs.readFileSync(path, 'utf8');

  // Force the app to learn a fresh template after the matcher upgrade instead
  // of reusing the earlier auto-selected listing forever.
  text = text.replace(
    "const MOCKUP_ORDER_TEMPLATE_KEY = 'presets/mockup-order-template.json';",
    "const MOCKUP_ORDER_TEMPLATE_KEY = 'presets/mockup-order-template-v2.json';"
  );

  // Etsy's top-level `materials` field is surfaced as Material tags. The user
  // wants the taxonomy Materials attribute instead, so do not send legacy
  // material tags during create/resume.
  text = text.replace(
    "      body.materials = [...(listingDefaults.materials || [])];\n",
    ''
  );
  text = text.replaceAll(
    "              materials: body.materials || [],\n",
    ''
  );
  text = text.replaceAll(
    "        materials: listingDefaults.materials || [],",
    "        materials: listingDefaults.fixedAttributes?.Materials || [],"
  );

  fs.writeFileSync(path, text);
}

replaceAllInFile('src/product-creator.mjs', [
  [
    '    const materials=fixed.materials||[];',
    '    const materials=fixed.fixedAttributes?.Materials||[];'
  ]
]);

console.log('Materials now use the taxonomy attribute and mockup template v2 is enabled.');
