// On-demand crop sizes share the Custom Size Lookup's 120-inch range.
// These assets do not imply that an Etsy/supplier product is available.
const MAX_SIZE_INCHES = 120;
function side(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1 || n > MAX_SIZE_INCHES || Math.abs(n * 100 - Math.round(n * 100)) > 0.000001) {
    throw Error('Crop sides must be 1–120 inches, with at most two decimal places.');
  }
  return Math.round(n * 100) / 100;
}
export function normalizeCropSize(input) {
  let dims;
  if (typeof input === 'string') {
    const match = input.trim().match(/^(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:in(?:ches)?|″|")?$/i);
    if (!match) throw Error('Enter a size such as 8x12 or 3.5x5 (inches).');
    dims = [side(match[1]), side(match[2])];
  } else if (input && typeof input === 'object') {
    dims = [side(input.width), side(input.height)];
  } else {
    throw Error('Provide a width and height in inches.');
  }
  const [low, high] = dims.sort((a,b) => a - b);
  return String(low) + 'x' + String(high);
}
export function sizeCropRatioKey(size) {
  return 'size-' + normalizeCropSize(size).replaceAll('.', 'p');
}
export function isSizeCropRatioKey(key) {
  return /^size-\d+(?:p\d+)?x\d+(?:p\d+)?$/.test(String(key || ''));
}
// Sensaria GO rejects RGB uploads whose longest side exceeds 17,500 px.
export const MAX_CROP_SIDE_PX = 17500;
export function sizeCropTarget(size, orientation = 'portrait') {
  const normalized = normalizeCropSize(size);
  const [small, large] = normalized.split('x').map(Number);
  let w = Math.round(small * 300), h = Math.round(large * 300);
  if (h > MAX_CROP_SIDE_PX) {
    w = Math.floor(w * MAX_CROP_SIDE_PX / h);
    h = MAX_CROP_SIDE_PX;
  }
  const direction = String(orientation).toLowerCase();
  if (!['portrait','landscape','square'].includes(direction)) throw Error('Invalid master artwork orientation.');
  return direction === 'landscape'
    ? {width:h,height:w}
    : {width:w,height:h};
}
export function sizeCropObjectKey(artworkId, size, prefix = 'SAC') {
  const id = String(artworkId || '').trim().toUpperCase();
  const regexp = new RegExp('^' + prefix + '\\d+$');
  if (!regexp.test(id)) throw Error('Invalid artwork ID: ' + artworkId);
  return 'artworks/' + id + '/fulfillment/by-size/' +
    normalizeCropSize(size).replaceAll('.', 'p') + '.jpg';
}
export function sizeCropForRatio(job, ratio) {
  return Boolean(job?.size && job?.ratios?.length === 1 &&
    String(ratio) === sizeCropRatioKey(job.size));
}
