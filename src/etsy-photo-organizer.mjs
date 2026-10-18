// Etsy photo organizer: the order chosen in the Product Creator, applied to the
// listing's photos on Etsy.
//
// A photo is identified by a tile id:
//   key:<R2 key>              master, preset photo or mockup the app uploaded
//   generated:<templateId>    a selected PSD mockup not copied to the artwork yet
//   etsy:<listing_image_id>   a photo on Etsy the app does not manage
// The chosen order is saved with the artwork, so it survives until the draft and
// its photos exist, and is then applied by re-ranking the photos on Etsy.

export const ETSY_PHOTO_LIMIT = 20;

// Ranks a new draft gives its preset photos (see prepareMediaPlan).
const PRESET_RANKS = { 'choose-option': 2, 'choose-frame': 5, promotion: 15 };

// Order of a draft that does not exist yet: the master first, preset photos at
// their usual places, and the chosen mockups filling the other slots in order.
export function defaultPlannedOrder({ masterKey = '', presets = [], generated = [] }) {
  const slots = [], fill = [...generated];
  const placed = new Map(presets.filter(p => PRESET_RANKS[p.role]).map(p => [PRESET_RANKS[p.role], 'key:' + p.key]));
  if (masterKey) slots.push('key:' + masterKey);
  const total = slots.length + fill.length + placed.size;
  for (let rank = slots.length + 1; rank <= total && slots.length < ETSY_PHOTO_LIMIT; rank++) {
    if (placed.has(rank)) { slots.push(placed.get(rank)); placed.delete(rank); }
    else if (fill.length) slots.push(fill.shift());
  }
  // Presets whose usual place is past the end go last.
  for (const id of placed.values()) if (slots.length < ETSY_PHOTO_LIMIT) slots.push(id);
  return slots;
}

// The saved order, keeping only photos that still exist, then anything new in
// its current position order. Never more than Etsy's 20 photos.
export function mergeOrder(saved = [], available = []) {
  const present = new Set(available), seen = new Set(), order = [];
  for (const id of saved) if (present.has(id) && !seen.has(id)) { seen.add(id); order.push(id); }
  for (const id of available) if (!seen.has(id)) { seen.add(id); order.push(id); }
  return order.slice(0, ETSY_PHOTO_LIMIT);
}

// Listing image ids in the order wanted on Etsy. `liveImages` are the listing's
// photos sorted by rank; `receipts` map R2 keys to the listing image ids the app
// uploaded; `keyForGenerated` maps a template id to the R2 key it was copied to.
export function desiredImageOrder({ order = [], liveImages = [], receipts = [], keyForGenerated = () => '' }) {
  const live = liveImages.map(image => String(image.listing_image_id ?? image.listingImageId));
  const liveSet = new Set(live);
  const idByKey = new Map(receipts.filter(r => r?.key && r.listingImageId).map(r => [r.key, String(r.listingImageId)]));
  const resolve = tile => {
    const id = String(tile || '');
    if (id.startsWith('etsy:')) return id.slice(5);
    if (id.startsWith('key:')) return idByKey.get(id.slice(4)) || '';
    if (id.startsWith('generated:')) return idByKey.get(keyForGenerated(id.slice(10))) || '';
    return '';
  };
  const wanted = [], seen = new Set();
  for (const tile of order) {
    const id = resolve(tile);
    if (id && liveSet.has(id) && !seen.has(id)) { seen.add(id); wanted.push(id); }
  }
  // Photos not in the saved order keep their relative place after it.
  for (const id of live) if (!seen.has(id)) { seen.add(id); wanted.push(id); }
  return wanted;
}

// The fewest rank updates: from the first position that differs, each photo is
// set to its rank in turn (Etsy shifts the others along).
export function rankUpdates(current = [], desired = []) {
  let first = 0;
  while (first < desired.length && current[first] === desired[first]) first++;
  return desired.slice(first).map((listingImageId, index) => ({ listingImageId, rank: first + index + 1 }));
}
