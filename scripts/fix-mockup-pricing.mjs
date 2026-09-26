import fs from 'node:fs';

function replaceAny(text, candidates, to) {
  for (const from of candidates) {
    if (text.includes(from)) return text.replace(from, to);
  }
  return text;
}

{
  const path = 'src/server.mjs';
  let text = fs.readFileSync(path, 'utf8');
  text = replaceAny(
    text,
    [
      `          pricingLogic: '65% profit margin from Sensaria product cost',`,
      `          pricingLogic: 'Curated premium USD retail ladder designed around the normal 20% Etsy sale',`,
      `          pricingLogic: 'Arté Antica CAD regular retail ladder converted to USD at the planning rate 1 USD = 1.39 CAD',`
    ],
    `          pricingLogic: 'Arté Antica regular CAD ladder converted to USD at 1 USD = 1.39 CAD; 20% Etsy shop sale applied separately',`
  );
  fs.writeFileSync(path, text);
}

{
  const path = 'src/product-creator.mjs';
  let text = fs.readFileSync(path, 'utf8');
  text = replaceAny(
    text,
    [
      `Pricing follows the Arté Antica 65% profit-margin logic from the Sensaria product cost, and each valid variant gets a new SAC SKU.`,
      `Pricing uses the Arté Antica CAD regular retail ladder converted to USD, and each valid variant gets a new SAC SKU.`
    ],
    `Pricing uses the Arté Antica regular CAD ladder converted to USD at 1 USD = 1.39 CAD. The whole shop's 20% Etsy sale is applied separately, and each valid variant gets a new SAC SKU.`
  );
  text = replaceAny(
    text,
    [
      `        '<br>Variants: app-owned Size × Product - Style · Pricing: 65% margin from Sensaria cost'+`,
      `        '<br>Variants: app-owned Size × Product - Style · Pricing: curated premium USD ladder · 20% sale-ready'+`,
      `        '<br>Variants: app-owned Size × Product - Style · Pricing: Arté Antica CAD ladder converted to USD'+`
    ],
    `        '<br>Variants: app-owned Size × Product - Style · Pricing: Arté Antica CAD ladder → USD · whole-shop sale: 20%'+`
  );
  fs.writeFileSync(path, text);
}

console.log('CAD-converted USD pricing labels and 20% shop sale copy updated.');
