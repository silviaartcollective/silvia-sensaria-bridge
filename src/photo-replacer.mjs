// Batch photo replacer (Listings → Replace a photo): swap one photo, such as a
// preset, for a new one in every listing. Etsy keeps no file names, so the
// photo is found by how it looks: the photo chosen in one listing is compared
// with the photo in the same slot of every other listing (then the rest of
// that listing's photos), the matches are shown for review, and only the
// ticked ones are replaced, in place, with Etsy's overwrite at the same rank.
// One job at a time; it is saved after every listing, so a reload or a server
// restart loses nothing and "Continue" resumes it.
import sharp from 'sharp';

const SIZE = 256;
const ASPECT_TOLERANCE = 0.03;

// The photo shrunk to 256×256 grey (lightly blurred, so re-encoding and
// resizing do not count) plus an 8×8 colour thumbnail.
export async function photoFingerprint(input) {
  const prepared = sharp(input, { failOn: 'none' }).rotate().flatten({ background: '#ffffff' });
  const grey = await prepared.clone().grayscale().resize(SIZE, SIZE, { fit: 'fill' }).raw().toBuffer();
  const blurred = await sharp(grey, { raw: { width: SIZE, height: SIZE, channels: 1 } }).blur(1.2).raw().toBuffer();
  const colour = await prepared.clone().removeAlpha().resize(8, 8, { fit: 'fill' }).raw().toBuffer();
  return { grey: blurred, colour };
}

// same: the same photo, re-encoded or resized by Etsy (no pixel clearly
// different). similar: the same layout with small changes, e.g. an older
// version of a preset. Anything else is a different photo.
export function comparePhotos(a, b) {
  let total = 0, clearlyDifferent = 0;
  for (let i = 0; i < a.grey.length; i++) {
    const d = Math.abs(a.grey[i] - b.grey[i]);
    total += d;
    if (d > 30) clearlyDifferent++;
  }
  let colour = 0;
  for (let i = 0; i < a.colour.length; i++) colour += Math.abs(a.colour[i] - b.colour[i]);
  const mean = total / a.grey.length, share = clearlyDifferent / a.grey.length;
  colour /= a.colour.length;
  const kind = share <= 0.0005 && mean <= 3 && colour <= 5 ? 'same'
    : share <= 0.06 && mean <= 8 && colour <= 15 ? 'similar' : 'different';
  return { kind, mean: +mean.toFixed(2), share: +share.toFixed(4), colour: +colour.toFixed(2) };
}

const aspect = image => Number(image?.full_width) / Number(image?.full_height);
// Photos of another shape are not the same photo (skipped without a download).
export function sameShape(image, reference) {
  const a = aspect(image), b = Number(reference?.width) / Number(reference?.height);
  return !(a > 0 && b > 0) || Math.abs(a - b) / b <= ASPECT_TOLERANCE;
}
export const photoUrl = image => image?.url_570xN || image?.url_fullxfull || '';
const imageId = image => String(image?.listing_image_id ?? '');

// Finds the photo in one listing: the one in the chosen slot if it matches,
// else the best match among the others ("same" before "similar").
export async function findPhotoInListing(images, { slot, reference, fingerprintOf }) {
  const slotPhoto = images.find(image => Number(image.rank) === Number(slot)) || null;
  let target = null;
  const check = async image => comparePhotos(reference.fingerprint, await fingerprintOf(photoUrl(image)));
  if (slotPhoto) {
    const result = await check(slotPhoto);
    if (result.kind !== 'different') target = { image: slotPhoto, ...result, atSlot: true };
  }
  if (target?.kind !== 'same') {
    for (const image of images) {
      if (image === slotPhoto || !sameShape(image, reference)) continue;
      const result = await check(image);
      if (result.kind === 'same') { target = { image, ...result, atSlot: false }; break; }
      if (result.kind === 'similar' && !target) target = { image, ...result, atSlot: false };
    }
  }
  return { slotPhoto, target };
}

function describe(listing, images, { slotPhoto, target }, alreadyNew) {
  const row = {
    listingId: Number(listing.listingId), title: String(listing.title || '').slice(0, 140),
    state: listing.state || '', artworkId: listing.artworkId || null, photoCount: images.length,
    slotThumb: slotPhoto ? photoUrl(slotPhoto) : null, target: null, selected: false, outcome: null
  };
  if (alreadyNew) { row.outcome = { status: 'already' }; return row; }
  if (target) {
    row.target = { listingImageId: imageId(target.image), rank: Number(target.image.rank),
      thumb: photoUrl(target.image), kind: target.kind, atSlot: target.atSlot };
    // The same photo anywhere, or an older version in the usual slot, is ticked.
    row.selected = target.kind === 'same' || target.atSlot;
  }
  return row;
}

const now = () => new Date().toISOString();
let running = null;
export const photoJobRunning = () => Boolean(running);

async function run(deps, task) {
  if (running) throw Error('The photo replacer is already working. Wait for it or stop it first.');
  running = { stop: false };
  const control = running;
  try { await task(control); }
  finally { if (running === control) running = null; }
}
export function stopPhotoJob() { if (running) running.stop = true; return Boolean(running); }

// deps: listListings, getImages, fetchImage, loadJob, saveJob, pause, and for
// replacing uploadPhoto, deletePhoto, setRank, newImage, onReplaced.
export async function scanForPhoto(deps, { reference, slot, newImage, presetRole = null }) {
  if (running) throw Error('The photo replacer is already working. Wait for it or stop it first.');
  const job = {
    id: deps.newId(), status: 'scanning', createdAt: now(), updatedAt: now(),
    reference: { listingId: Number(reference.listingId), listingImageId: String(reference.listingImageId),
      rank: Number(reference.rank), url: reference.url, width: reference.width || null, height: reference.height || null },
    slot: Number(slot), newImage, presetRole, updatePreset: Boolean(presetRole),
    progress: { done: 0, total: 0 }, results: [], error: ''
  };
  await deps.saveJob(job);
  void run(deps, async control => {
    try {
      const cache = new Map();
      const fingerprintOf = url => {
        if (!cache.has(url)) cache.set(url, deps.fetchImage(url).then(photoFingerprint));
        return cache.get(url);
      };
      const ref = { ...job.reference, fingerprint: await fingerprintOf(job.reference.url) };
      const fresh = await photoFingerprint((await deps.newImage()).buffer);
      const listings = await deps.listListings();
      job.progress.total = listings.length;
      for (const listing of listings) {
        if (control.stop) { job.status = 'stopped'; break; }
        try {
          const images = await deps.getImages(listing.listingId);
          const found = await findPhotoInListing(images, { slot: job.slot, reference: ref, fingerprintOf });
          // A listing whose slot already shows the new photo needs nothing.
          const alreadyNew = found.slotPhoto && comparePhotos(fresh, await fingerprintOf(photoUrl(found.slotPhoto))).kind === 'same';
          job.results.push(describe(listing, images, found, alreadyNew));
        } catch (error) {
          job.results.push({ listingId: Number(listing.listingId), title: String(listing.title || '').slice(0, 140),
            state: listing.state || '', target: null, selected: false, outcome: { status: 'failed', error: String(error?.message || error).slice(0, 200) } });
        }
        // Thumbnails of photos already checked are not kept.
        if (cache.size > 400) cache.clear();
        job.progress.done++;
        job.updatedAt = now();
        if (job.progress.done % 5 === 0 || job.progress.done === job.progress.total) await deps.saveJob(job);
        await deps.pause(150);
      }
      if (job.status === 'scanning') job.status = 'scanned';
    } catch (error) {
      job.status = 'failed'; job.error = String(error?.message || error).slice(0, 300);
    }
    job.updatedAt = now();
    await deps.saveJob(job);
  }).catch(async error => { job.status = 'failed'; job.error = String(error?.message || error); await deps.saveJob(job); });
  return job;
}

// Replaces the ticked photos, one listing at a time. Listings already
// replaced (or skipped) keep their outcome, so this also resumes a stopped job.
export async function replacePhotos(deps, { listingIds }) {
  if (running) throw Error('The photo replacer is already working. Wait for it or stop it first.');
  const job = await deps.loadJob();
  if (!job || !['scanned', 'stopped', 'done'].includes(job.status)) throw Error('Find the photo in your listings first.');
  const wanted = new Set((listingIds || []).map(Number));
  for (const row of job.results) row.selected = wanted.has(row.listingId) && Boolean(row.target);
  const queue = job.results.filter(row => row.selected && row.outcome?.status !== 'replaced');
  if (!queue.length) throw Error('Tick at least one listing to replace its photo.');
  job.status = 'replacing'; job.progress = { done: 0, total: queue.length }; job.updatedAt = now();
  await deps.saveJob(job);
  void run(deps, async control => {
    try {
      const fresh = await deps.newImage();
      const freshPrint = await photoFingerprint(fresh.buffer);
      if (job.updatePreset && job.presetRole && deps.updatePreset) await deps.updatePreset(job.presetRole);
      for (const row of queue) {
        if (control.stop) { job.status = 'stopped'; break; }
        try {
          row.outcome = await replaceInListing(deps, row, fresh, freshPrint);
        } catch (error) {
          row.outcome = { status: 'failed', error: String(error?.message || error).slice(0, 240) };
        }
        job.progress.done++; job.updatedAt = now();
        await deps.saveJob(job);
        await deps.pause(250);
      }
      if (job.status === 'replacing') job.status = 'done';
    } catch (error) {
      job.status = 'failed'; job.error = String(error?.message || error).slice(0, 300);
    }
    job.updatedAt = now();
    await deps.saveJob(job);
  }).catch(async error => { job.status = 'failed'; job.error = String(error?.message || error); await deps.saveJob(job); });
  return job;
}

async function replaceInListing(deps, row, fresh, freshPrint) {
  const images = await deps.getImages(row.listingId);
  const old = images.find(image => imageId(image) === row.target.listingImageId);
  if (!old) {
    // Done before (e.g. a stopped run), or the listing changed since the scan.
    const slot = images.find(image => Number(image.rank) === row.target.rank);
    if (slot && comparePhotos(freshPrint, await photoFingerprint(await deps.fetchImage(photoUrl(slot)))).kind === 'same')
      return { status: 'already' };
    return { status: 'failed', error: 'That photo is no longer on this listing. Find the photo again.' };
  }
  const rank = Number(old.rank);
  // Etsy's overwrite puts the new photo in place of the one at this rank.
  const uploaded = await deps.uploadPhoto({ listingId: row.listingId, rank, overwrite: true,
    buffer: fresh.buffer, filename: fresh.filename, contentType: fresh.contentType });
  const newImageId = String(uploaded?.listing_image_id || '');
  if (!newImageId) throw Error('Etsy returned no photo ID; check this listing on Etsy.');
  let after = await deps.getImages(row.listingId);
  if (after.some(image => imageId(image) === row.target.listingImageId)) {
    await deps.deletePhoto({ listingId: row.listingId, listingImageId: row.target.listingImageId });
    after = await deps.getImages(row.listingId);
  }
  const placed = after.find(image => imageId(image) === newImageId);
  if (!placed) throw Error('Etsy did not keep the new photo; check this listing on Etsy.');
  if (Number(placed.rank) !== rank) await deps.setRank({ listingId: row.listingId, listingImageId: newImageId, rank });
  if (deps.onReplaced) await deps.onReplaced({ ...row, oldImageId: row.target.listingImageId, newImageId }).catch(() => {});
  return { status: 'replaced', newImageId, rank };
}

// Puts one photo at a slot of a listing (the converter's "choose your frame"
// at #5): it replaces the photo there, or is added last when the listing has
// fewer photos. Nothing changes when the slot already shows it, and another
// copy of it elsewhere in the listing is removed.
export async function placePhotoAtSlot(deps, { listingId, slot, photo }) {
  const print = await photoFingerprint(photo.buffer);
  const images = await deps.getImages(listingId);
  const copies = [];
  for (const image of images) {
    if (comparePhotos(print, await photoFingerprint(await deps.fetchImage(photoUrl(image)))).kind === 'same') copies.push(image);
  }
  if (copies.some(image => Number(image.rank) === Number(slot))) {
    for (const extra of copies.filter(image => Number(image.rank) !== Number(slot)))
      await deps.deletePhoto({ listingId, listingImageId: imageId(extra) });
    return { status: 'already', rank: Number(slot), removedCopies: copies.length - 1 };
  }
  const replacing = images.find(image => Number(image.rank) === Number(slot)) || null;
  const rank = replacing ? Number(slot) : images.length + 1;
  const uploaded = await deps.uploadPhoto({ listingId, rank, overwrite: Boolean(replacing),
    buffer: photo.buffer, filename: photo.filename, contentType: photo.contentType });
  const newImageId = String(uploaded?.listing_image_id || '');
  if (!newImageId) throw Error('Etsy returned no photo ID.');
  const stale = [...copies, ...(replacing ? [replacing] : [])];
  let after = await deps.getImages(listingId);
  for (const image of stale) {
    if (after.some(item => imageId(item) === imageId(image)))
      await deps.deletePhoto({ listingId, listingImageId: imageId(image) });
  }
  if (stale.length) after = await deps.getImages(listingId);
  const placed = after.find(image => imageId(image) === newImageId);
  if (!placed) throw Error('Etsy did not keep the new photo.');
  const wanted = Math.min(rank, after.length);
  if (Number(placed.rank) !== wanted) await deps.setRank({ listingId, listingImageId: newImageId, rank: wanted });
  return { status: 'placed', rank: wanted, listingImageId: newImageId, replaced: replacing ? imageId(replacing) : null,
    removedCopies: copies.length };
}
