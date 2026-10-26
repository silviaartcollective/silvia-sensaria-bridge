// Listing Reposter: the oldest active listings that never sold are posted again
// as new listings, and each old listing is deactivated once its new one is live.
// A listing whose artwork is in the app is rebuilt like a Daily Listings draft:
// new SEO from ChatGPT, new mockups from the chosen preset (made on the PC) in
// the preset's arranged photo order, and the current template's variants,
// profiles and attributes. Any other listing is copied with its own photos and
// video (listing-reposter.mjs prepare/finalize). The job is kept in R2, so the
// page can be closed, and a stopped run can be resumed.

let running = null;
export const renewalRunning = () => Boolean(running);
export function stopRenewal() { if (running) running.stop = true; return Boolean(running); }

const now = () => new Date().toISOString();
const DAY = 86400;
const LANES = 3;          // listings reposted at the same time (the PC makes mockups one artwork after another)
const SALES_CHECKS = 5;   // sales looked up at the same time
const MOCKUP_POLL_MS = 5000;
const SETUP_POLL_MS = 3000;
const SETUP_WAIT_MS = 20 * 60 * 1000;
export const MAX_RENEWALS = 50;
export const DEFAULT_RENEWALS = 20;

const born = item => Number(item?.original_creation_timestamp || item?.created_timestamp || item?.creation_timestamp || 0);
export function oldestFirst(listings) {
  return [...listings].sort((a, b) => (born(a) || Infinity) - (born(b) || Infinity) || Number(a.listing_id) - Number(b.listing_id));
}

// Runs the job's waiting listings in the background; the job is saved as it goes.
function launch(deps, job, work) {
  const control = { stop: false };
  running = control;
  const save = () => { job.updatedAt = now(); return deps.saveJob(job); };
  void (async () => {
    try {
      await work(control, save);
      if (!control.stop && job.results.some(row => row.status === 'waiting')) {
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
  return control;
}

export async function startRenewal(deps, { count, preset = '' }) {
  if (running) throw Error('Reposting is already running. Wait for it or stop it first.');
  const total = Math.round(Number(count));
  if (!(total >= 1 && total <= MAX_RENEWALS)) throw Error('Choose how many listings to repost (1 to ' + MAX_RENEWALS + ').');
  const job = { id: deps.newId(), status: 'finding', count: total, preset: String(preset || ''), createdAt: now(), updatedAt: now(),
    progress: { checked: 0, listings: 0, done: 0, total }, results: [], error: '' };
  await deps.saveJob(job);
  launch(deps, job, (control, save) => findOldestUnsold(deps, job, control, save));
  return job;
}

// Goes on with a stopped run (also after a restart): listings not finished are
// picked up where they were; retryFailed tries the failed ones again too.
export async function resumeRenewal(deps, { retryFailed = false } = {}) {
  if (running) throw Error('Reposting is already running.');
  const job = await deps.loadJob();
  if (!job?.results?.length) throw Error('There is no run to resume. Start a new one.');
  for (const row of job.results) {
    if (row.status === 'working' || (retryFailed && row.status === 'failed')) { row.status = 'waiting'; row.step = 'Waiting'; row.error = ''; }
  }
  if (!job.results.some(row => row.status === 'waiting')) throw Error('Every listing of this run is finished. Start a new one.');
  job.status = 'renewing'; job.error = '';
  job.progress.done = job.results.filter(row => ['done', 'failed'].includes(row.status)).length;
  await deps.saveJob(job);
  launch(deps, job, async () => {});
  return job;
}

async function findOldestUnsold(deps, job, control, save) {
  const listings = oldestFirst(await deps.listActive());
  job.progress.listings = listings.length;
  for (let index = 0; index < listings.length && job.results.length < job.count; index += SALES_CHECKS) {
    if (control.stop) return;
    const group = listings.slice(index, index + SALES_CHECKS);
    const sales = await Promise.all(group.map(item => deps.salesCount(item.listing_id).catch(() => null)));
    const found = [];
    group.forEach((item, at) => {
      job.progress.checked++;
      // Unknown sales (the check failed) count as sold: never risk replacing one that sold.
      if (sales[at] !== 0 || job.results.length + found.length >= job.count) return;
      const created = born(item);
      found.push({ listingId: Number(item.listing_id), title: String(item.title || '').slice(0, 140),
        createdAt: created ? new Date(created * 1000).toISOString() : null,
        ageDays: created ? Math.floor((Date.now() / 1000 - created) / DAY) : null,
        status: 'waiting', step: 'Waiting', newListingId: null, newTitle: '', error: '' });
    });
    // Whether its artwork is in the app (new mockups) or not (its photos are copied).
    await Promise.all(found.map(async row => {
      const about = await deps.describe(row.listingId).catch(() => null);
      Object.assign(row, { artworkId: about?.artworkId || '', layout: about?.layout || '', photo: about?.photo || '' });
    }));
    job.results.push(...found);
    await save();
  }
  if (job.results.some(row => row.artworkId) && !job.preset)
    throw Error('Choose a mockup preset first: the new listings get their mockups from it.');
}

async function renewAll(deps, job, control, save) {
  const lane = async () => {
    for (;;) {
      if (control.stop) return;
      const row = job.results.find(entry => entry.status === 'waiting');
      if (!row) return;
      row.status = 'working'; row.error = '';
      if (row.artworkId) await refreshOne(deps, job, row, control, save);
      else await copyOne(deps, row, control, save);
      if (['done', 'failed'].includes(row.status)) job.progress.done++;
      await save();
    }
  };
  await Promise.all(Array.from({ length: Math.min(LANES, job.results.length) }, lane));
}

const failed = (row, error) => {
  row.status = 'failed'; row.step = 'Failed';
  row.error = String(error?.message || error).slice(0, 300);
};

// A listing whose artwork is in the app: new SEO and mockups, the current
// template, published; then the old one is deactivated. Each step is kept on
// the row, so a stopped or restarted run goes on from the step it reached.
async function refreshOne(deps, job, row, control, save) {
  const step = async text => { row.step = text; await save(); };
  const stopped = () => { if (!control.stop) return false; row.status = 'waiting'; row.step = 'Stopped'; return true; };
  try {
    if (!row.mockupJobId) {
      await step('Starting the mockups');
      const started = await deps.startMockups({ artworkId: row.artworkId, orientation: row.layout, preset: job.preset });
      row.mockupJobId = started.jobId;
      await save();
    }
    // ChatGPT writes the SEO while the PC makes the mockups.
    const seo = row.seo ? Promise.resolve(row.seo) : deps.refreshSeo(row.listingId);
    seo.catch(() => {});
    let mockups;
    for (;;) {
      mockups = await deps.mockupStatus(row.mockupJobId);
      if (mockups.finished) break;
      if (stopped()) return;
      await step('Mockups: ' + mockups.done + ' of ' + mockups.total + ' made on the PC' + (mockups.note ? ' · ' + mockups.note : ''));
      await deps.pause(MOCKUP_POLL_MS);
    }
    if (!mockups.completedIds.length) throw Error('No mockup could be made for this artwork on the PC.');
    if (!row.seo) {
      await step('Writing the SEO with ChatGPT');
      row.seo = await seo;
      row.newTitle = row.seo.title;
      await save();
    }
    if (stopped()) return;
    if (!row.prepared) {
      // The artwork lets go of its old listing and mockups; the new listing gets this run's, in the arranged order.
      await step('Getting the artwork ready for its new listing');
      await deps.prepareArtwork(row);
      await deps.attachMockups(row.artworkId, row.mockupJobId, mockups.completedIds);
      await deps.savePhotoOrder({ artworkId: row.artworkId, preset: job.preset, orientation: row.layout, mockupJobId: row.mockupJobId },
        mockups.completedIds);
      row.prepared = true;
      await save();
    }
    if (stopped()) return;
    for (let attempt = 1; ; attempt++) {
      if (!row.newListingId || attempt > 1) {
        await step('Creating the new listing');
        row.newListingId = await deps.createDraft({ artworkId: row.artworkId, orientation: row.layout, seo: row.seo });
        await save();
      }
      await step('Adding photos, video and variants');
      const setup = await waitForSetup(deps, row, control);
      if (setup === 'stopped') { row.status = 'waiting'; row.step = 'Stopped'; return; }
      if (setup === 'completed') break;
      if (setup !== 'interrupted' || attempt >= 2) throw Error('The new listing\'s setup did not finish: ' + setup);
    }
    // One that sold meanwhile is kept, and its new listing stays a draft.
    if (await deps.salesCount(row.listingId) !== 0)
      throw Error('It sold while it was being reposted: it was kept, and its new listing was left as a draft.');
    if (!row.published) {
      await step('Publishing the new listing');
      await deps.publish(row.newListingId);
      row.published = true;
      await save();
    }
    await step('Deactivating the old listing');
    await deps.deactivate(row.listingId, row.newListingId);
    row.status = 'done'; row.step = 'Reposted';
  } catch (error) { failed(row, error); }
}
async function waitForSetup(deps, row, control) {
  const until = Date.now() + SETUP_WAIT_MS;
  for (;;) {
    const setup = await deps.draftSetup(row.artworkId);
    if (setup.status === 'completed') return 'completed';
    if (setup.status === 'failed') return setup.error || 'failed';
    if (setup.status === 'interrupted') return 'interrupted';
    if (control.stop) return 'stopped';
    if (Date.now() > until) return 'still running after 20 minutes';
    await deps.pause(SETUP_POLL_MS);
  }
}

// A listing whose artwork is not in the app: copied with its own photos and
// video, new SEO from ChatGPT; the old one is deactivated.
async function copyOne(deps, row, control, save) {
  const step = async text => { row.step = text; await save(); };
  try {
    // A copy stopped part-way goes on with the SEO it already used.
    const earlier = await deps.record(row.listingId);
    let seo = earlier && earlier.status !== 'completed' && earlier.seo?.title ? earlier.seo : null;
    if (!seo) {
      await step('Writing new SEO with ChatGPT');
      seo = await deps.newSeo(row.listingId);
      if (seo.descriptionKept) row.note = 'Photos, description and variants kept: this listing\'s artwork is not in the app.';
    }
    row.newTitle = seo.title;
    if (control.stop) { row.status = 'waiting'; row.step = 'Stopped'; return; }
    if (!earlier || earlier.status === 'building') {
      await step('Copying to a new listing');
      const { record } = await deps.prepare(row.listingId, { title: seo.title, description: seo.description, tags: seo.tags,
        style: seo.style, mockupMode: 'keep', artworkMode: 'keep' });
      if (record?.template) row.note = 'Photos copied; sizes, prices and profiles from the current template.';
    }
    await step('Publishing, then deactivating the old listing');
    const { record } = await deps.finalize(row.listingId);
    row.newListingId = Number(record.draftId) || null;
    row.status = 'done'; row.step = 'Reposted';
  } catch (error) { failed(row, error); }
}
