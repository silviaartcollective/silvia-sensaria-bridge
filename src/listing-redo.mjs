// Redo listing (Listings → editor → Redo listing): set a published listing up
// again as if it were new, step by step as in the Product Creator — new
// mockups from a preset, new SEO, the current template's sizes, prices and
// profiles — and put it all on the same Etsy listing, so it keeps its URL,
// reviews, favourites and sales.
//
// The redo runs in the background (photo uploads take a minute or two); the
// page polls its progress. One redo per listing at a time.
import { masterListingTags } from './master-listings.mjs';

const JOB_ID = /^[A-Za-z0-9_-]{1,80}$/;
const MAX_PHOTOS = 20;

// What the page sends to apply the redo, checked before anything is changed.
export function checkRedoInput(input, { confirm }) {
  if (!input || typeof input !== 'object') throw Error('The redo is missing.');
  if (input.confirm !== confirm) throw Error('Explicit confirmation is required to redo this listing.');
  let photos = null;
  if (input.photos !== false) {
    const jobId = String(input.mockupJobId || '');
    if (!JOB_ID.test(jobId)) throw Error('Make the mockups first, or keep the listing\'s photos.');
    const ids = Array.isArray(input.templateIds) ? [...new Set(input.templateIds.map(String))] : [];
    if (!ids.length) throw Error('Choose at least one mockup for the listing.');
    if (ids.length > MAX_PHOTOS || ids.some(id => !JOB_ID.test(id))) throw Error('Choose up to ' + MAX_PHOTOS + ' mockups.');
    const preset = String(input.preset || '').trim();
    if (!preset || preset.length > 200) throw Error('Choose the mockup preset.');
    photos = { mockupJobId: jobId, templateIds: ids, preset };
  }
  const raw = input.seo && typeof input.seo === 'object' ? input.seo : {};
  const title = String(raw.title ?? '').replace(/\s+/g, ' ').trim();
  if (!title || title.length > 140) throw Error('The title must be 1–140 characters.');
  const tags = masterListingTags(raw.tags);
  if (!tags.length) throw Error('Add at least one tag.');
  const description = String(raw.description ?? '').trim();
  if (!description || description.length > 10000) throw Error('The description must be 1–10,000 characters.');
  const sectionId = Number(raw.sectionId || 0);
  if (!Number.isSafeInteger(sectionId) || sectionId < 0) throw Error('Choose a valid shop section.');
  const style = String(raw.style || '').trim().slice(0, 80);
  return { photos, seo: { title, tags, description, sectionId: sectionId ? String(sectionId) : '', style }, template: input.template !== false };
}

// deps: { replacePhotos({listingId,artworkId,orientation,preset,mockupJobId,templateIds}),
//         updateDetails({listingId,artworkId,seo,template}), markRefreshed(listingId,info),
//         now() }
export function createRedoRunner(deps) {
  const runs = new Map();
  const now = () => new Date(deps.now ? deps.now() : Date.now()).toISOString();
  function status(listingId) {
    const run = runs.get(String(listingId));
    return run ? { ...run } : null;
  }
  function start(listingId, { artworkId, orientation, plan }) {
    const key = String(listingId);
    if (runs.get(key)?.state === 'running') throw Error('This listing is already being redone. Wait for it to finish.');
    if (!artworkId) throw Error('This listing\'s artwork is not in the app, so it cannot be redone here.');
    const run = { state: 'running', step: plan.photos ? 'photos' : 'details', startedAt: now(), finishedAt: null, error: '', photos: null };
    runs.set(key, run);
    const done = (async () => {
      try {
        if (plan.photos) {
          const placed = await deps.replacePhotos({ listingId: Number(listingId), artworkId, orientation, ...plan.photos });
          run.photos = Number(placed?.photos) || 0;
        }
        run.step = 'details';
        await deps.updateDetails({ listingId: Number(listingId), artworkId, seo: plan.seo, template: plan.template });
        run.step = 'saving';
        await deps.markRefreshed(listingId, { artworkId, by: 'redo', photos: run.photos ?? 0, template: plan.template });
        run.state = 'done'; run.step = 'done';
      } catch (error) {
        run.state = 'failed';
        run.error = String(error?.message || error) +
          (run.step === 'details' && plan.photos ? ' (the new photos are already on the listing)' : '');
      } finally { run.finishedAt = now(); }
    })();
    return { run: { ...run }, done };
  }
  return { start, status };
}
