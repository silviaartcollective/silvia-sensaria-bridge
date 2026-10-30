// Matching a supplier's catalog to the app's own products (P poster / fine art
// print, C stretched canvas, FC framed canvas) and sizes, for the suppliers
// added after the first six. The sizes come from the comparison rows (the
// app's size ladder); this only reads a supplier's sizes to compare with them.

export const PRODUCT_LABELS = Object.freeze({ P: 'Poster / fine art print', C: 'Stretched canvas', FC: 'Framed canvas' });

const clean = value => String(value ?? '').toLowerCase()
  .replace(/[″”“]/g, '"').replace(/[′’‘]/g, "'").replace(/[×✕]/g, 'x').replace(/\s+/g, ' ').trim();

// "12x16", "12″×16″", '12" x 16"', "12 × 16 in", "30x40 cm", "16x12-inch" → inches.
// Returns { width, height } with width ≤ height, plus the order as written.
export function parseDimensions(value, defaultUnit = 'in') {
  const text = clean(value);
  const match = text.match(/(\d+(?:\.\d+)?)\s*(?:"|in(?:ch(?:es)?)?|cm|mm)?\s*x\s*(\d+(?:\.\d+)?)\s*("|in(?:ch(?:es)?)?\b|cm\b|mm\b)?/);
  if (!match) return null;
  const unitText = (match[3] || (/\d\s*(cm|mm)\s*x/.exec(text)?.[1]) || defaultUnit || 'in').replace('"', 'in');
  const unit = /^cm/.test(unitText) ? 'cm' : /^mm/.test(unitText) ? 'mm' : 'in';
  const factor = unit === 'cm' ? 1 / 2.54 : unit === 'mm' ? 1 / 25.4 : 1;
  const a = Number(match[1]) * factor, b = Number(match[2]) * factor;
  if (!(a > 0 && b > 0)) return null;
  return { width: Math.min(a, b), height: Math.max(a, b), first: a, second: b, unit };
}

// The same size, in either orientation (a 12x16 product prints a 16x12 artwork).
// Exact: a supplier's metric 30x40 cm is not the app's 12x16 in.
export function sameSize(a, b, tolerance = 0.05) {
  if (!a || !b) return false;
  return Math.abs(a.width - b.width) <= tolerance && Math.abs(a.height - b.height) <= tolerance;
}

export function sizeLabel(size) {
  if (!size) return '';
  const n = v => Number(v.toFixed(2));
  return `${n(size.width)}x${n(size.height)}`;
}

// The artwork's shape, for display: square, panoramic (2:1 or wider), or rectangular.
export function shapeOf(size) {
  if (!size) return '';
  const ratio = size.height / size.width;
  return Math.abs(ratio - 1) < 0.01 ? 'square' : ratio >= 2 ? 'panoramic' : 'rectangle';
}

export function finishFamily(value) {
  const text = clean(value);
  if (!text || text === '—' || text === '-' || /^(none|no frame|unframed)$/.test(text)) return 'none';
  if (/black/.test(text)) return 'black';
  if (/white/.test(text)) return 'white';
  if (/natural|oak|beech|birch|light wood|maple/.test(text)) return 'natural';
  if (/brown|dark wood|walnut|espresso|mahogany|chestnut/.test(text)) return 'brown';
  return text;
}

// A supplier product's family from its name/category. Framed canvas is never
// regular canvas; a framed poster, metal, acrylic or wood print is none of ours.
export function wallArtFamily(text) {
  const t = clean(text);
  if (!t) return '';
  if (/metal|alumin|acrylic|wood(en)? print|bamboo|peel|sticker|decal|foam|tapestry|blanket|pillow|puzzle|mug|shirt|tote|magnet|postcard|greeting|calendar|ornament|banner|flag|mouse|phone|towel|mat\b|rug/.test(t)) return '';
  const canvas = /canvas|gallery wrap|stretched/.test(t);
  const framed = /framed|float(ing)? frame|with frame|frame/.test(t);
  if (canvas) return framed && !/unframed|no frame|stretcher/.test(t.replace(/canvas frame/g, '')) ? 'FC' : 'C';
  if (/poster|fine art|art print|photo paper|paper print|giclee|matte paper|archival|print\b/.test(t)) return framed && !/unframed/.test(t) ? '' : 'P';
  return '';
}

// A row's own size and finish.
export function rowTarget(row) {
  return { size: parseDimensions(row?.size), finish: finishFamily(row?.finish), productCode: String(row?.productCode || '') };
}

export function rowKey(row) {
  const size = parseDimensions(row?.size);
  return `${row?.productCode || ''}|${size ? `${Number(size.width.toFixed(2))}x${Number(size.height.toFixed(2))}` : ''}|${finishFamily(row?.finish)}`;
}

export const round2 = value => value == null || !Number.isFinite(Number(value)) ? null : Math.round(Number(value) * 100) / 100;
// A money amount from a number or a string like "12.50" or "$12.50"; anything
// without digits is no amount (null), never zero.
export const amount = value => {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  if (typeof value === 'string' && !/\d/.test(value)) return null;
  const n = Number(typeof value === 'string' ? value.replace(/[^0-9.\-]/g, '') : value);
  return Number.isFinite(n) ? n : null;
};

// USD per one unit of a currency, from the same public rates service the
// comparison already uses for GBP (Frankfurter), cached for six hours.
const FX_TTL_MS = 6 * 60 * 60 * 1000;
const fxCache = new Map();
export async function usdRate(currency, { fetchImpl = globalThis.fetch } = {}) {
  const code = String(currency || '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) throw new Error('Unknown currency' + (code ? ' ' + code : '') + '.');
  if (code === 'USD') return { rate: 1, source: 'identity', date: null };
  const cached = fxCache.get(code);
  if (cached && Date.now() - cached.at < FX_TTL_MS) return cached.value;
  const response = await fetchImpl(`https://api.frankfurter.dev/v2/rate/${code.toLowerCase()}/usd`, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`FX API ${response.status}`);
  const data = await response.json();
  const rate = Number(data?.rate);
  if (!Number.isFinite(rate) || rate <= 0) throw new Error(`FX API returned no valid ${code}/USD rate`);
  const value = { rate, date: data?.date || null, source: 'Frankfurter' };
  fxCache.set(code, { at: Date.now(), value });
  return value;
}
export function clearFxCache() { fxCache.clear(); }

// A comparison record in the same shape as the first six suppliers'.
export function quoteRecord({ provider, eligible = false, status, totalUsd = null, originalTotal = null, currency = 'USD',
  productCost = null, shippingCost = null, reason = '', basis = '', meta = {} }) {
  return { provider, eligible: Boolean(eligible), status: status || (eligible ? 'available' : 'unavailable'),
    totalUsd: round2(totalUsd), originalTotal: round2(originalTotal), currency, productCost: round2(productCost),
    shippingCost: round2(shippingCost), reason, basis, meta };
}

// Supplier costs converted to USD (product and shipping can be in different
// currencies). Returns null amounts, never zero, when a price or rate is missing.
export async function toUsd({ product, productCurrency, shipping, shippingCurrency }, { rate = usdRate } = {}) {
  const convert = async (value, currency) => {
    if (value == null) return { usd: null, rate: null };
    const fx = await rate(currency);
    return { usd: value * fx.rate, rate: fx.rate, fxDate: fx.date, fxSource: fx.source };
  };
  const [p, s] = await Promise.all([convert(product, productCurrency), convert(shipping, shippingCurrency)]);
  return { productUsd: p.usd, shippingUsd: s.usd,
    totalUsd: p.usd != null && s.usd != null ? p.usd + s.usd : null,
    fx: [productCurrency, shippingCurrency].some(c => String(c).toUpperCase() !== 'USD')
      ? { productRate: p.rate, shippingRate: s.rate, date: p.fxDate || s.fxDate || null, source: p.fxSource || s.fxSource || '' } : null };
}
