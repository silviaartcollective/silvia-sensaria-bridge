const SIZE_PROPERTY_ID = 513;
const STYLE_PROPERTY_ID = 514;

export const SILVIA_PANORAMIC_SIZES = Object.freeze(["8x16","10x20","12x24","16x32","18x36","20x40","24x48","30x60","8x24","10x30","12x36","16x48","20x60"]);

export const SILVIA_SQUARE_SIZES = Object.freeze(["5x5","8x8","10x10","12x12","16x16","18x18","20x20","24x24","30x30","36x36","40x40"]);

export const SILVIA_SIZES = [
  '5x7',
  '8x10',
  '8x12',
  '11x14',
  '12x16',
  '12x18',
  '16x20',
  '16x24',
  '18x24',
  '20x30',
  '24x36',
  '28x30',
  '30x40',
  '40x60'
];

export const SILVIA_SIZE_LABELS = {
  '5x7': '13x18 cm / 5x7″',
  '8x12': '20x30 cm / 8x12″',
  '28x30': '71x76 cm / 28x30″',
  '8x10': '20x25 cm / 8x10″',
  '11x14': '27x35 cm / 11x14″',
  '12x16': '30x40 cm / 12x16″',
  '12x18': '30x45 cm / 12x18″',
  '16x20': '40x50 cm / 16x20″',
  '16x24': '40x60 cm / 16x24″',
  '18x24': '45x60 cm / 18x24″',
  '5x5': '13x13 cm / 5x5″',
  '8x8': '20x20 cm / 8x8″',
  '10x10': '25x25 cm / 10x10″',
  '12x12': '30x30 cm / 12x12″',
  '16x16': '41x41 cm / 16x16″',
  '18x18': '46x46 cm / 18x18″',
  '20x20': '51x51 cm / 20x20″',
  '24x24': '61x61 cm / 24x24″',
  '30x30': '76x76 cm / 30x30″',
  '36x36': '91x91 cm / 36x36″',
  '40x40': '102x102 cm / 40x40″',
  '20x30': '51x76 cm / 20x30″',
  '8x16': '20x41 cm / 8x16″',
  '10x20': '25x51 cm / 10x20″',
  '12x24': '30x61 cm / 12x24″',
  '16x32': '41x81 cm / 16x32″',
  '18x36': '46x91 cm / 18x36″',
  '20x40': '51x102 cm / 20x40″',
  '24x48': '61x122 cm / 24x48″',
  '30x60': '76x152 cm / 30x60″',
  '8x24': '20x61 cm / 8x24″',
  '10x30': '25x76 cm / 10x30″',
  '12x36': '30x91 cm / 12x36″',
  '16x48': '41x122 cm / 16x48″',
  '20x60': '51x152 cm / 20x60″',
  '24x36': '60x90 cm / 24x36″',
  '30x40': '75x100 cm / 30x40″',
  '40x60': '100x150 cm / 40x60″'
};

export const SILVIA_STYLES = [
  { code: 'P', frame: 'NONE', label: 'Matte Paper Poster' },
  { code: 'C', frame: 'NONE', label: 'Canvas' },
  { code: 'FC', frame: 'NAT', label: 'Framed Canvas - Natural Oak' },
  { code: 'FC', frame: 'BRN', label: 'Framed Canvas - Dark Walnut' },
  { code: 'FC', frame: 'BLK', label: 'Framed Canvas - Matte Black' },
  { code: 'FC', frame: 'WHT', label: 'Framed Canvas - White' }
];

// Only Poster, Canvas and Framed Canvas are used for this Etsy shop.
// Silvia's approved regular retail ladder is maintained in CAD and converted
// to Etsy USD at the planning rate 1 USD = 1.39 CAD. Etsy applies the whole-shop
// 25% promotion separately, so the inventory payload keeps regular/base USD prices.
export const SILVIA_REFERENCE_CAD_PER_USD = 1.39;
// Poster listings are sold by Etsy in USD and then shown to Canadian buyers in CAD.
// Calibrated from the current Etsy display shown on 2026-10-06 (~CA$1.486 per US$1).
export const SILVIA_POSTER_ETSY_CAD_PER_USD = 1.486;
export const SILVIA_SALE_DISCOUNT_PERCENT = 25;
export const SILVIA_RETAIL_PRICE_LADDER_CAD = {
  P: {
    '8x16': 64.95,
    '10x20': 74.95,
    '20x40': 114.95,
    '24x48': 139.95,
    '12x36': 99.95,
    // Poster prices step upward by size rather than reusing equal adjacent tiers.
    '5x7': 52.95,
    '5x5': 52.95,
    '8x8': 53.95,
    '10x10': 55.95,
    '12x12': 59.95,
    '16x16': 69.95,
    '18x18': 75.95,
    '20x20': 82.95,
    '24x24': 105.95,
    '30x30': 122.95,
    '20x30': 95.95,
    '8x12': 57.95,
    '8x10': 54.95,
    '11x14': 59.95,
    '12x16': 62.95,
    '12x18': 65.95,
    '16x20': 72.95,
    '16x24': 80.95,
    '18x24': 87.95,
    '24x36': 102.95,
    '30x40': 122.95
  },
  C: {
    '8x16': 139.95,
    '10x20': 169.95,
    '12x24': 199.95,
    '16x32': 259.95,
    '18x36': 299.95,
    '20x40': 359.95,
    '24x48': 449.95,
    '30x60': 749.95,
    '8x24': 179.95,
    '10x30': 239.95,
    '12x36': 279.95,
    '16x48': 379.95,
    '20x60': 799.95,
    '12x16': 139.95,
    '8x8': 109.95,
    '10x10': 119.95,
    '12x12': 129.95,
    '16x16': 159.95,
    '18x18': 189.95,
    '20x20': 219.95,
    '24x24': 269.95,
    '30x30': 379.95,
    '36x36': 499.95,
    '40x40': 669.95,
    '20x30': 239.95,
    '12x18': 149.95,
    '16x20': 169.95,
    '16x24': 189.95,
    '18x24': 209.95,
    '24x36': 269.95,
    '30x40': 379.95,
    '40x60': 669.95
  },
  FC: {
    '8x16': 189.95,
    '10x20': 229.95,
    '12x24': 279.95,
    '16x32': 369.95,
    '18x36': 419.95,
    '20x40': 479.95,
    '24x48': 599.95,
    '30x60': 899.95,
    '8x24': 249.95,
    '10x30': 319.95,
    '12x36': 389.95,
    '16x48': 499.95,
    '20x60': 949.95,
    '12x16': 189.95,
    '8x8': 159.95,
    '10x10': 169.95,
    '12x12': 179.95,
    '16x16': 209.95,
    '18x18': 239.95,
    '20x20': 269.95,
    '24x24': 349.95,
    '30x30': 459.95,
    '36x36': 649.95,
    '40x40': 799.95,
    '20x30': 299.95,
    '12x18': 199.95,
    '16x20': 219.95,
    '16x24': 239.95,
    '18x24': 259.95,
    '24x36': 349.95,
    '30x40': 459.95,
    '40x60': 799.95
  }
};

function cadRetailToUsd(value, format) {
  const rate = format === 'P'
    ? SILVIA_POSTER_ETSY_CAD_PER_USD
    : SILVIA_REFERENCE_CAD_PER_USD;
  return Number((Number(value) / rate).toFixed(2));
}

export const SILVIA_RETAIL_PRICE_LADDER_USD = Object.fromEntries(
  Object.entries(SILVIA_RETAIL_PRICE_LADDER_CAD).map(([format, ladder]) => [
    format,
    Object.fromEntries(
      Object.entries(ladder).map(([size, cadPrice]) => [size, cadRetailToUsd(cadPrice, format)])
    )
  ])
);

function firstValue(property) {
  return String(property?.values?.[0] ?? '').trim();
}

export function normalizeSize(value) {
  const text = String(value || '').trim();

  const imperialPatterns = [
    /(\d{1,2})\s*(?:x|×|by)\s*(\d{1,2})\s*(?:in(?:ches)?|inch|″|")/ig,
    /(?:in(?:ches)?|inch)\s*(\d{1,2})\s*(?:x|×|by)\s*(\d{1,2})/ig
  ];
  for (const pattern of imperialPatterns) {
    const match = pattern.exec(text);
    if (match) return `${Number(match[1])}x${Number(match[2])}`;
  }

  const pairs = [];
  const pairPattern = /(\d{1,2})\s*(?:x|×|by)\s*(\d{1,2})(?:\s*(cm|in(?:ches)?|inch|″|"))?/ig;
  let match;
  while ((match = pairPattern.exec(text))) {
    pairs.push({
      size: `${Number(match[1])}x${Number(match[2])}`,
      unit: String(match[3] || '').toLowerCase()
    });
  }
  const explicitImperial = pairs.find((pair) => pair.unit && pair.unit !== 'cm');
  if (explicitImperial) return explicitImperial.size;
  const nonMetric = pairs.find((pair) => pair.unit !== 'cm');
  if (nonMetric) return nonMetric.size;
  if (pairs.length > 1 && pairs[0].unit === 'cm') return pairs[1].size;
  return pairs[0]?.size || null;
}

function frameCode(style) {
  const value = String(style || '').toLowerCase();
  if (/black/.test(value)) return 'BLK';
  if (/white/.test(value)) return 'WHT';
  if (/natural|oak/.test(value)) return 'NAT';
  if (/brown|walnut|dark\s*wood|dark\s*walnut/.test(value)) return 'BRN';
  return null;
}

export function productKeyFromVariationValues(sizeValue, styleValue) {
  const size = normalizeSize(sizeValue);
  if (!size) return null;
  const style = String(styleValue || '').toLowerCase();

  if (/framed\s*canvas/.test(style)) {
    const frame = frameCode(style);
    return frame ? `FC|${size}|${frame}` : null;
  }
  if (/canvas/.test(style)) return `C|${size}|NONE`;
  if (/poster|paper|print/.test(style)) return `P|${size}|NONE`;
  return null;
}

function skuSize(size) {
  return String(size).replace(/x/i, '');
}

export function silviaVariantSku(artworkId, productKey) {
  const [format, size, frame] = String(productKey).split('|');
  const base = `${String(artworkId).toUpperCase()}-${format}-${skuSize(size)}`;
  return format === 'FC' ? `${base}-${frame}` : base;
}

function decimalPrice(value) {
  if (value && typeof value === 'object' && Number.isFinite(Number(value.amount))) {
    const divisor = Number(value.divisor || 100);
    return Number(value.amount) / divisor;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function findVariation(product, matcher) {
  return (product?.property_values || []).find((property) =>
    matcher(String(property?.property_name || '').trim().toLowerCase())
  );
}

export function inventoryHasSilviaVariations(inventory) {
  const products = inventory?.products || [];
  if (!products.length) return false;
  return products.some((product) => {
    const size = findVariation(product, (name) => name === 'size' || name.includes('size'));
    const style = findVariation(product, (name) => name === 'product - style' || name.includes('style'));
    return Boolean(size && style);
  });
}

function styleKey(size, style) {
  return `${style.code}|${size}|${style.frame}`;
}

export function retailPriceForProductKey(productKey) {
  const [format, size] = String(productKey || '').split('|');
  const price = SILVIA_RETAIL_PRICE_LADDER_USD[format]?.[size];
  return Number.isFinite(Number(price)) ? Number(price) : null;
}

export function buildOwnSilviaInventory({
  artworkId,
  catalog,
  readinessStateId,
  defaultQuantity = 999,
  orientation = 'portrait'
}) {
  const requestedOrientation=String(orientation||'portrait').toLowerCase();
  if(!['portrait','landscape','square','panoramic'].includes(requestedOrientation))throw Error('Artwork orientation must be portrait, landscape or square.');
  const sizes=requestedOrientation==='square'?SILVIA_SQUARE_SIZES:
    requestedOrientation==='panoramic'?SILVIA_PANORAMIC_SIZES:SILVIA_SIZES;
  const enabledSizeSet=new Set(sizes);
  const validKeys=Object.keys(catalog).filter(key=>enabledSizeSet.has(String(key).split('|')[1]));
  const prices = {};
  const missingPriceKeys = [];

  for (const key of validKeys) {
    const price = retailPriceForProductKey(key);
    if (!(price > 0)) {
      missingPriceKeys.push(key);
      continue;
    }
    prices[key] = Number(price.toFixed(2));
  }

  if (missingPriceKeys.length) {
    throw new Error(`Missing curated USD retail price for: ${missingPriceKeys.join(', ')}`);
  }

  const enabledPrices = validKeys.map((key) => Number(prices[key]));
  const fallbackPrice = Math.min(...enabledPrices);
  const products = [];

  for (const size of sizes) {
    for (const style of SILVIA_STYLES) {
      const key = styleKey(size, style);
      const mapped = Boolean(catalog[key]);
      const price = mapped ? Number(prices[key]) : fallbackPrice;

      products.push({
        sku: mapped ? silviaVariantSku(artworkId, key) : '',
        property_values: [
          {
            property_id: SIZE_PROPERTY_ID,
            property_name: 'Size',
            scale_id: null,
            value_ids: [],
            values: [SILVIA_SIZE_LABELS[size] || size]
          },
          {
            property_id: STYLE_PROPERTY_ID,
            property_name: 'Product - Style',
            scale_id: null,
            value_ids: [],
            values: [style.label]
          }
        ],
        offerings: [
          {
            price: Number(price.toFixed(2)),
            quantity: mapped ? defaultQuantity : 0,
            is_enabled: mapped,
            readiness_state_id: Number(readinessStateId)
          }
        ]
      });
    }
  }

  return {
    products,
    price_on_property: [SIZE_PROPERTY_ID, STYLE_PROPERTY_ID],
    quantity_on_property: [SIZE_PROPERTY_ID, STYLE_PROPERTY_ID],
    sku_on_property: [SIZE_PROPERTY_ID, STYLE_PROPERTY_ID],
    readiness_state_on_property: [],
    minimumPrice: Math.min(...enabledPrices),
    maximumPrice: Math.max(...enabledPrices),
    enabledCount: validKeys.length,
    disabledCount: products.length - validKeys.length,
    pricing: {
      currency: 'USD',
      saleDiscountPercent: SILVIA_SALE_DISCOUNT_PERCENT,
      basis: 'Silvia approved CAD regular retail ladder converted to Etsy USD',
      referenceCadPerUsd: SILVIA_REFERENCE_CAD_PER_USD,
      posterEtsyCadPerUsd: SILVIA_POSTER_ETSY_CAD_PER_USD,
      costBasis: 'Sensaria USD product cost',
      framePricing: 'All framed-canvas colours use the same retail price per size'
    }
  };
}

export const SILVIA_VARIATION_PROPERTIES = {
  size: SIZE_PROPERTY_ID,
  productStyle: STYLE_PROPERTY_ID
};
