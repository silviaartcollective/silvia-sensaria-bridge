// Renew listings: the oldest active listings that never sold are posted again
// as new listings (new SEO from ChatGPT; the same photos and video; the variants,
// prices and profiles of the current draft template when the app made the
// listing, else copied), and each old listing is deleted once its new one is live. The copy,
// its checks and the delete are listing-reposter.mjs (prepare/finalize); this
// runs them for many listings. The job is kept in R2, so the page can be closed.

let running = null;
export const renewalRunning = () => Boolean(running);
export function stopRenewal() { if (running) running.stop = true; return Boolean(running); }

const now = () => new Date().toISOString();
const DAY = 86400;
const LANES = 2;          // listings renewed at the same time
const SALES_CHECKS = 5;   // sales looked up at the same time
export const MAX_RENEWALS = 50;

const born = item => Number(item?.original_creation_timestamp || item?.created_timestamp || item?.creation_timestamp || 0);
export function oldestFirst(listings) {
  return [...listings].sort((a, b) => (born(a) || Infinity) - (born(b) || Infinity) || Number(a.listing_id) - Number(b.listing_id));
}

export async function startRenewal(deps, { count }) {
  if (running) throw Error('Renewing is already running. Wait for it or stop it first.');
  const total = Math.round(Number(count));
  if (!(total >= 1 && total <= MAX_RENEWALS)) throw Error('Choose how many listings to renew (1 to ' + MAX_RENEWALS + ').');
  const job = { id: deps.newId(), status: 'finding', count: total, createdAt: now(), updatedAt: now(),
    progress: { checked: 0, listings: 0, done: 0, total }, results: [], error: '' };
  const control = { stop: false };
  running = control;
  const save = () => { job.updatedAt = now(); return deps.saveJob(job); };
  try { await save(); } catch (error) { running = null; throw error; }
  void (async () => {
    try {
      await findOldestUnsold(deps, job, control, save);
      if (!control.stop && job.results.length) {
        job.status = 'renewing'; await save();
        await renewAll(deps, job, control, save);
      }
      job.status = control.stop ? 'stopped' : 'done';
    } catch (error) {
      job.status = 'failed'; job.error = String(error?.message || error).slice(0, 300);
    } finally {
      await save().catch(() => {});
      running = null;
    }
  })();
  return job;
}

async function findOldestUnsold(deps, job, control, save) {
  const listings = oldestFirst(await deps.listActive());
  job.progress.listings = listings.length;
  for (let index = 0; index < listings.length && job.results.length < job.count; index += SALES_CHECKS) {
    if (control.stop) return;
    const group = listings.slice(index, index + SALES_CHECKS);
    const sales = await Promise.all(group.map(item => deps.salesCount(item.listing_id).catch(() => null)));
    group.forEach((item, at) => {
      job.progress.checked++;
      // Unknown sales (the check failed) count as sold: never risk deleting one that sold.
      if (sales[at] !== 0 || job.results.length >= job.count) return;
      const created = born(item);
      job.results.push({ listingId: Number(item.listing_id), title: String(item.title || '').slice(0, 140),
        createdAt: created ? new Date(created * 1000).toISOString() : null,
        ageDays: created ? Math.floor((Date.now() / 1000 - created) / DAY) : null,
        status: 'waiting', step: 'Waiting', newListingId: null, newTitle: '', error: '' });
    });
    await save();
  }
}

async function renewAll(deps, job, control, save) {
  let next = 0;
  const lane = async () => {
    while (!control.stop && next < job.results.length) {
      const row = job.results[next++];
      await renewOne(deps, row, save);
      job.progress.done++;
      await save();
    }
  };
  await Promise.all(Array.from({ length: Math.min(LANES, job.results.length) }, lane));
}

async function renewOne(deps, row, save) {
  const step = async text => { row.status = 'working'; row.step = text; await save(); };
  try {
    // A renewal stopped part-way goes on with the SEO it already used.
    const earlier = await deps.record(row.listingId);
    let seo = earlier && earlier.status !== 'completed' && earlier.seo?.title ? earlier.seo : null;
    if (!seo) {
      await step('Writing new SEO with ChatGPT');
      seo = await deps.newSeo(row.listingId);
      if (seo.descriptionKept) row.note = 'Description and variants kept: this listing was not made by the app.';
    }
    row.newTitle = seo.title;
    if (!earlier || earlier.status === 'building') {
      await step('Copying to a new listing');
      const { record } = await deps.prepare(row.listingId, { title: seo.title, description: seo.description, tags: seo.tags,
        style: seo.style, mockupMode: 'keep', artworkMode: 'keep' });
      if (record?.template) row.note = 'Sizes, prices and profiles from the current template.';
    }
    await step('Publishing, then deleting the old listing');
    const { record } = await deps.finalize(row.listingId);
    row.newListingId = Number(record.draftId) || null;
    row.status = 'done'; row.step = 'Renewed';
  } catch (error) {
    row.status = 'failed'; row.step = 'Failed';
    row.error = String(error?.message || error).slice(0, 300);
  }
}
