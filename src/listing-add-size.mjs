// Add a size to a live Etsy listing by hand (Listings → editor → Add a size).
// The listing keeps every existing row; the new size gets one row per product
// style already on the listing (Etsy needs every size × style combination),
// switched on only for the styles chosen, each with its own price. A standard
// size uses the shop's own label, SKU and ladder price as a suggestion; any
// other size (a custom one) gets a "cm / inch" label and the price typed in.
//
// shop: { labels: {'24x36': '60x90 cm / 24x36″', …}, sku(artworkId, key),
//         price(key) → USD or null, productKey(sizeLabel, styleLabel), normalizeSize(label),
//         ladder: {P: {'24x36': USD, …}, C: {…}, FC: {…}} }
const MAX_PRODUCTS = 400;      // Etsy's limit on a listing's variation rows
const MAX_SIDE_INCHES = 99;  // whole inches, as the shop's SKUs and size labels use

const isSize = name => /size/i.test(String(name || ''));
const isStyle = name => /style/i.test(String(name || ''));

export function parseSizeInput(value) {
  const match = /^\s*(\d{1,2})\s*(?:x|×|by)\s*(\d{1,2})\s*(?:in|inch|inches|″|")?\s*$/i.exec(String(value || ''));
  if (!match) throw Error('Enter the size in whole inches, such as 24x36.');
  const width = Number(match[1]), height = Number(match[2]);
  if (!(width >= 4 && height >= 4 && width <= MAX_SIDE_INCHES && height <= MAX_SIDE_INCHES))
    throw Error('Each side must be 4 to ' + MAX_SIDE_INCHES + ' inches.');
  return { width, height, size: width + 'x' + height };
}

export function sizeLabel(shop, size) {
  if (shop.labels[size]) return shop.labels[size];
  const [w, h] = size.split('x').map(Number);
  return Math.round(w * 2.54) + 'x' + Math.round(h * 2.54) + ' cm / ' + size + '″';
}

function propertyOf(product, test) {
  return (product?.property_values || []).find(p => test(p.property_name));
}
const area = size => { const [w, h] = String(size || '').split('x').map(Number); return (w || 0) * (h || 0); };
const shape = size => { const [w, h] = String(size).split('x').map(Number), r = Math.max(w, h) / Math.min(w, h);
  return r <= 1.1 ? 'square' : r <= 1.7 ? 'standard' : 'panoramic'; };

// A size that is not on the price ladder is priced from it: same format and
// shape (standard, square or panoramic), by print area between the nearest
// smaller and larger ladder sizes (beyond the ends, at the end size's price per
// square inch).
export function ladderEstimate(ladder, format, size) {
  const all = Object.entries(ladder?.[format] || {}).filter(([, v]) => Number(v) > 0);
  const same = all.filter(([s]) => shape(s) === shape(size));
  const points = (same.length >= 2 ? same : all).map(([s, v]) => [area(s), Number(v)]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (!points.length) return null;
  const a = area(size);
  const lower = points.filter(p => p[0] <= a).at(-1), upper = points.find(p => p[0] >= a);
  let price;
  if (lower && upper) price = upper[0] === lower[0] ? (lower[1] + upper[1]) / 2 : lower[1] + (upper[1] - lower[1]) * (a - lower[0]) / (upper[0] - lower[0]);
  else { const end = lower || upper; price = end[1] * a / end[0]; }
  return Number(Math.max(0.2, price).toFixed(2));
}

// What adding this size would add, before anything is sent to Etsy.
export function planAddSize(shop, inventory, sizeText) {
  const products = inventory?.products || [];
  if (!products.length) throw Error('This listing has no variations to add a size to.');
  const first = products[0], sizeProp = propertyOf(first, isSize), styleProp = propertyOf(first, isStyle);
  if (!sizeProp || !styleProp || (first.property_values || []).length !== 2)
    throw Error('This listing\'s variations are not Size and Product - Style, so a size cannot be added here. Convert the listing first.');
  const { size } = parseSizeInput(sizeText);
  const existing = products.map(p => shop.normalizeSize(propertyOf(p, isSize)?.values?.[0]));
  if (existing.includes(size)) throw Error(size + ' is already on this listing. Switch it on in the table above instead.');
  const styles = [...new Set(products.map(p => String(propertyOf(p, isStyle)?.values?.[0] || '')).filter(Boolean))];
  const label = sizeLabel(shop, size);
  return {
    size, label, standard: Boolean(shop.labels[size]),
    styles: styles.map(style => {
      const key = shop.productKey(label, style);
      const price = key ? shop.price(key) : null;
      if (Number.isFinite(price) && price > 0) return { style, key, suggestedPrice: Number(price.toFixed(2)), estimated: false };
      const estimate = key ? ladderEstimate(shop.ladder, key.split('|')[0], size) : null;
      return { style, key, suggestedPrice: estimate, estimated: estimate != null };
    })
  };
}

// The listing's inventory with the size added. rows: [{style, enabled, price}].
export function addSizeToInventory(shop, inventory, { size: sizeText, rows, quantity = 999, artworkId = '' }) {
  const plan = planAddSize(shop, inventory, sizeText);
  if (!Array.isArray(rows)) throw Error('Choose the styles to offer in this size.');
  const qty = Number(quantity);
  if (!Number.isSafeInteger(qty) || qty < 1 || qty > 999) throw Error('Quantity must be 1–999.');
  const chosen = new Map();
  for (const row of rows) {
    const style = String(row?.style || '');
    if (!plan.styles.some(s => s.style === style)) throw Error('Unknown style: ' + style);
    if (chosen.has(style)) throw Error('Each style can be listed once.');
    if (row.enabled !== true) continue;
    const price = Number(row.price);
    if (!Number.isFinite(price) || price < 0.2 || price > 100000 || Math.abs(price * 100 - Math.round(price * 100)) > 1e-6)
      throw Error('Enter a price of $0.20–$100,000 for ' + style + '.');
    chosen.set(style, Number(price.toFixed(2)));
  }
  if (!chosen.size) throw Error('Switch on at least one style for ' + plan.size + '.');
  const cloned = JSON.parse(JSON.stringify(inventory));
  if (cloned.products.length + plan.styles.length > MAX_PRODUCTS)
    throw Error('Etsy allows up to ' + MAX_PRODUCTS + ' variations; this listing has no room for another size.');
  const sample = cloned.products[0];
  const readiness = cloned.products.flatMap(p => p.offerings || []).find(o => o?.readiness_state_id != null)?.readiness_state_id;
  const prices = cloned.products.flatMap(p => (p.offerings || []).filter(o => o.is_enabled)).map(o => {
    const v = o.price && typeof o.price === 'object' ? Number(o.price.amount) / Number(o.price.divisor || 100) : Number(o.price);
    return Number.isFinite(v) ? v : null;
  }).filter(v => v > 0);
  const offPrice = Number((prices.length ? Math.min(...prices) : Math.min(...chosen.values())).toFixed(2));
  const added = plan.styles.map(({ style, key }) => {
    const on = chosen.has(style);
    return {
      sku: on && key && artworkId ? shop.sku(artworkId, key) : '',
      property_values: sample.property_values.map(p => ({
        property_id: p.property_id, property_name: p.property_name, scale_id: null, value_ids: [],
        values: [isSize(p.property_name) ? plan.label : style]
      })),
      offerings: [{ price: on ? chosen.get(style) : offPrice, quantity: on ? qty : 0, is_enabled: on,
        ...(readiness != null ? { readiness_state_id: Number(readiness) } : {}) }]
    };
  });
  // Etsy shows sizes in the order they first appear: the new one goes before
  // the first larger size already on the listing.
  const at = cloned.products.findIndex(p => area(shop.normalizeSize(propertyOf(p, isSize)?.values?.[0])) > area(plan.size));
  cloned.products.splice(at < 0 ? cloned.products.length : at, 0, ...added);
  return { inventory: cloned, plan, added: added.filter(p => p.offerings[0].is_enabled).length };
}
