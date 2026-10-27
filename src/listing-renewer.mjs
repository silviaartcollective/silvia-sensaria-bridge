// Listing Reposter: active listings that never sold get a second chance in two
// steps, each in the days before the listing renews on Etsy:
//  - refresh (by default at 4 months): the same listing gets new SEO from
//    ChatGPT, new mockups from the chosen preset (made on the PC) in the
//    preset's arranged photo order, and the current template's variants and
//    profiles. It keeps its favourites, views and link, and costs nothing.
//  - repost (by default at 12 months, only once refreshed and still unsold):
//    posted again as a new listing like a Daily Listings draft, and the old one
//    is deactivated once the new one is live. Done just before a renewal, its
//    $0.20 listing fee takes the place of the renewal Etsy would charge. A
//    listing is reposted at most maxReposts times, counted across the
//    listings that replaced it; after that it is left as it is.
// Sales are checked when listings are picked and again just before one is
// changed: a listing that sold is never changed.
// A listing whose artwork is not in the app gets new SEO only when refreshed,
// and is copied with its own photos and video when reposted
// (listing-reposter.mjs prepare/finalize). The job is kept in R2, so the page
// can be closed, and a stopped run can be resumed.

let running = null;
export const renewalRunning = () => Boolean(running);
export function stopRenewal() { if (running) running.stop = true; return Boolean(running); }

const now = () => new Date().toISOString();
const DAY = 86400;
const MONTH = 30.44 * DAY;
const TOLERANCE = 5 * DAY; // Etsy's 4 months are calendar months
const LANES = 3;          // listings worked on at the same time (the PC makes mockups one artwork after another)
const SALES_CHECKS = 5;   // sales looked up at the same time
const MOCKUP_POLL_MS = 5000;
const SETUP_POLL_MS = 3000;
const SETUP_WAIT_MS = 20 * 60 * 1000;
export const MAX_RENEWALS = 50;
export const DEFAULT_RENEWALS = 20;
// maxReposts: how many times one listing (and the listings that replaced it)
// may be reposted; refreshTemplate: whether a refresh also applies the current
// template's sizes, prices and profiles.
export const DEFAULT_RULES = { refreshMonths: 4, repostMonths: 12, windowDays: 7, maxReposts: 1, refreshTemplate: true };

export function checkRules(input = {}) {
  const rules = { ...DEFAULT_RULES };
  for (const key of ['refreshMonths', 'repostMonths', 'windowDays', 'maxReposts'])
    if (input?.[key] !== undefined && input[key] !== '') rules[key] = Math.round(Number(input[key]));
  if (input?.refreshTemplate !== undefined) rules.refreshTemplate = ![false, 'false'].includes(input.refreshTemplate);
  if (!(rules.refreshMonths >= 1 && rules.refreshMonths <= 36)) throw Error('Refresh after 1 to 36 months without a sale.');
  if (!(rules.repostMonths > rules.refreshMonths && rules.repostMonths <= 48))
    throw Error('Repost after more months than the refresh (up to 48).');
  if (!(rules.windowDays >= 1 && rules.windowDays <= 120)) throw Error('Choose listings renewing within 1 to 120 days.');
  if (!(rules.maxReposts >= 0 && rules.maxReposts <= 5)) throw Error('Repost each listing 0 to 5 times.');
  return rules;
}

const born = item => Number(item?.original_creation_timestamp || item?.created_timestamp || item?.creation_timestamp || 0);
export function oldestFirst(listings) {
  return [...listings].sort((a, b) => (born(a) || Infinity) - (born(b) || Infinity) || Number(a.listing_id) - Number(b.listing_id));
}
// When Etsy next renews the listing (its expiry); without that, every 4 months
// from its creation. In seconds.
export function nextRenewal(item, at) {
  const ending = Number(item?.ending_timestamp || 0);
  if (ending) return ending;
  const created = born(item), period = 4 * MONTH;
  return created + Math.max(1, Math.ceil((at - created) / period)) * period;
}
// What an unsold listing is due for at its next renewal, if that is within the
// window: 'refresh' once it is refreshMonths old, 'repost' once it was
// refreshed, is repostMonths old and has had the months between since.
export function dueFor(item, refreshed, rules, at) {
  const created = born(item);
  if (!created) return '';
  const renews = nextRenewal(item, at);
  if (renews - at > rules.windowDays * DAY || renews < at - DAY) return '';
  const age = renews - created;
  if (refreshed?.at) {
    const since = renews - Date.parse(refreshed.at) / 1000;
    return age >= rules.repostMonths * MONTH - TOLERANCE && since >= (rules.repostMonths - rules.refreshMonths) * MONTH - TOLERANCE ? 'repost' : '';
  }
  return age >= rules.refreshMonths * MONTH - TOLERANCE ? 'refresh' : '';
}
const seconds = deps => Math.floor((deps.now ? deps.now() : Date.now()) / 1000);

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

export async function startRenewal(deps, { count, preset = '', rules = {} }) {
  if (running) throw Error('The reposter is already running. Wait for it or stop it first.');
  const total = Math.round(Number(count));
  if (!(total >= 1 && total <= MAX_RENEWALS)) throw Error('Choose how many listings to work on (1 to ' + MAX_RENEWALS + ').');
  const job = { id: deps.newId(), status: 'finding', count: total, preset: String(preset || ''), rules: checkRules(rules),
    createdAt: now(), updatedAt: now(), progress: { checked: 0, listings: 0, due: 0, done: 0, total }, results: [], error: '' };
  await deps.saveJob(job);
  launch(deps, job, (control, save) => findDue(deps, job, control, save));
  return job;
}

// Goes on with a stopped run (also after a restart): listings not finished are
// picked up where they were; retryFailed tries the failed ones again too.
export async function resumeRenewal(deps, { retryFailed = false } = {}) {
  if (running) throw Error('The reposter is already running.');
  const job = await deps.loadJob();
  if (!job?.results?.length) throw Error('There is no run to resume. Start a new one.');
  // A run of the earlier reposter only reposted: it is not resumed, so nothing
  // is reposted without the rules. Its listings are picked again when due.
  if (!job.rules) throw Error('This run was started by the earlier reposter, which only reposted. Start a new run: the listings it did not finish are picked again when they are due.');
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

// The listings due for a refresh or a repost at a renewal within the window,
// the soonest renewal first, that never sold.
async function findDue(deps, job, control, save) {
  const at = seconds(deps);
  const [listings, refreshed] = await Promise.all([deps.listActive(), deps.refreshedListings()]);
  const due = [];
  for (const item of listings) {
    const action = dueFor(item, refreshed[String(item.listing_id)], job.rules, at);
    if (action) due.push({ item, action, renews: nextRenewal(item, at) });
  }
  due.sort((a, b) => a.renews - b.renews || born(a.item) - born(b.item) || Number(a.item.listing_id) - Number(b.item.listing_id));
  job.progress.listings = listings.length;
  job.progress.due = due.length;
  for (let index = 0; index < due.length && job.results.length < job.count; index += SALES_CHECKS) {
    if (control.stop) return;
    const group = due.slice(index, index + SALES_CHECKS);
    const sales = await Promise.all(group.map(({ item }) => deps.salesCount(item.listing_id).catch(() => null)));
    const found = [];
    group.forEach(({ item, action, renews }, place) => {
      job.progress.checked++;
      // Unknown sales (the check failed) count as sold: never risk replacing one that sold.
      if (sales[place] !== 0 || job.results.length + found.length >= job.count) return;
      const created = born(item);
      found.push({ listingId: Number(item.listing_id), title: String(item.title || '').slice(0, 140), action,
        createdAt: created ? new Date(created * 1000).toISOString() : null,
        ageDays: created ? Math.floor((at - created) / DAY) : null,
        renewsAt: new Date(renews * 1000).toISOString(), refreshedAt: refreshed[String(item.listing_id)]?.at || null,
        status: 'waiting', step: 'Waiting', newListingId: null, newTitle: '', error: '' });
    });
    // Whether its artwork is in the app (new mockups) or not (new SEO only, or
    // its photos copied), and how many times it was reposted before.
    await Promise.all(found.map(async row => {
      const about = await deps.describe(row.listingId).catch(() => null);
      Object.assign(row, { artworkId: about?.artworkId || '', layout: about?.layout || '', photo: about?.photo || '',
        reposts: Number(about?.reposts) || 0 });
    }));
    // One reposted as often as allowed is not reposted again: it is left for
    // you to keep or retire, and counted.
    const kept = found.filter(row => row.action !== 'repost' || row.reposts < job.rules.maxReposts);
    job.progress.atLimit = (job.progress.atLimit || 0) + found.length - kept.length;
    job.results.push(...kept);
    await save();
  }
  if (job.results.some(row => row.artworkId) && !job.preset)
    throw Error('Choose a mockup preset first: the refreshed and reposted listings get their mockups from it.');
}

async function renewAll(deps, job, control, save) {
  const lane = async () => {
    for (;;) {
      if (control.stop) return;
      const row = job.results.find(entry => entry.status === 'waiting');
      if (!row) return;
      row.status = 'working'; row.error = '';
      // Runs started before refreshing existed only reposted.
      const work = (row.action || 'repost') === 'refresh' ? (row.artworkId ? refreshInPlace : refreshSeoOnly)
        : (row.artworkId ? repostWithMockups : repostCopy);
      await work(deps, job, row, control, save);
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
const halt = row => { row.status = 'waiting'; row.step = 'Stopped'; };
// Sales are checked again just before a listing is changed: one that sold
// while its mockups and SEO were made is left as it is.
async function stillUnsold(deps, row) {
  if (await deps.salesCount(row.listingId) !== 0) throw Error('It sold while it was being refreshed, so it was left as it is.');
}

// New mockups from the preset, made on the PC, while ChatGPT writes the SEO.
// Returns the mockups made, or null when stopped.
async function mockupsAndSeo(deps, job, row, control, save) {
  const step = async text => { row.step = text; await save(); };
  if (!row.mockupJobId) {
    await step('Starting the mockups');
    const started = await deps.startMockups({ artworkId: row.artworkId, orientation: row.layout, preset: job.preset });
    row.mockupJobId = started.jobId;
    await save();
  }
  const seo = row.seo ? Promise.resolve(row.seo) : deps.refreshSeo(row.listingId);
  seo.catch(() => {});
  let mockups;
  for (;;) {
    mockups = await deps.mockupStatus(row.mockupJobId);
    if (mockups.finished) break;
    if (control.stop) return null;
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
  return mockups;
}

// Refresh, artwork in the app: the same listing gets the new mockups (in the
// preset's arranged order, with the preset photos), the new SEO and the
// current template's variants and profiles.
async function refreshInPlace(deps, job, row, control, save) {
  const step = async text => { row.step = text; await save(); };
  try {
    const mockups = await mockupsAndSeo(deps, job, row, control, save);
    if (!mockups || control.stop) return halt(row);
    await stillUnsold(deps, row);
    if (!row.photosReplaced) {
      await step('Replacing the photos with the new mockups');
      await deps.replacePhotos({ listingId: row.listingId, artworkId: row.artworkId, orientation: row.layout, preset: job.preset,
        mockupJobId: row.mockupJobId, templateIds: mockups.completedIds });
      row.photosReplaced = true;
      await save();
    }
    if (control.stop) return halt(row);
    const template = job.rules?.refreshTemplate !== false;
    await step('Updating the title, tags and description' + (template ? ', and the variants from the template' : ''));
    await deps.updateDetails({ listingId: row.listingId, artworkId: row.artworkId, seo: row.seo, template });
    await deps.markRefreshed(row.listingId, { artworkId: row.artworkId, title: row.seo.title });
    row.status = 'done'; row.step = 'Refreshed';
  } catch (error) { failed(row, error); }
}

// Refresh, artwork not in the app: new title and tags from ChatGPT; its
// photos, description and variants stay.
async function refreshSeoOnly(deps, job, row, control, save) {
  const step = async text => { row.step = text; await save(); };
  try {
    if (!row.seo) {
      await step('Writing new SEO with ChatGPT');
      row.seo = await deps.newSeo(row.listingId);
      row.newTitle = row.seo.title;
      await save();
    }
    if (control.stop) return halt(row);
    await stillUnsold(deps, row);
    await step('Updating the title and tags');
    await deps.updateDetails({ listingId: row.listingId, artworkId: '', seo: row.seo, template: false });
    await deps.markRefreshed(row.listingId, { artworkId: '', title: row.seo.title });
    row.note = 'New title and tags; photos, description and variants kept: this listing\'s artwork is not in the app.';
    row.status = 'done'; row.step = 'Refreshed';
  } catch (error) { failed(row, error); }
}

// Repost, artwork in the app: new SEO and mockups, the current template,
// published; then the old one is deactivated. Each step is kept on the row, so
// a stopped or restarted run goes on from the step it reached.
async function repostWithMockups(deps, job, row, control, save) {
  const step = async text => { row.step = text; await save(); };
  try {
    const mockups = await mockupsAndSeo(deps, job, row, control, save);
    if (!mockups || control.stop) return halt(row);
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
    if (control.stop) return halt(row);
    for (let attempt = 1; ; attempt++) {
      if (!row.newListingId || attempt > 1) {
        await step('Creating the new listing');
        row.newListingId = await deps.createDraft({ artworkId: row.artworkId, orientation: row.layout, seo: row.seo });
        await save();
      }
      await step('Adding photos, video and variants');
      const setup = await waitForSetup(deps, row, control);
      if (setup === 'stopped') return halt(row);
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
    await deps.markReposted(row.listingId, row.newListingId, { artworkId: row.artworkId, count: (row.reposts || 0) + 1 }).catch(() => {});
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

// Repost, artwork not in the app: copied with its own photos and video, new
// SEO from ChatGPT; the old one is deactivated.
async function repostCopy(deps, job, row, control, save) {
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
    if (control.stop) return halt(row);
    if (!earlier || earlier.status === 'building') {
      await step('Copying to a new listing');
      const { record } = await deps.prepare(row.listingId, { title: seo.title, description: seo.description, tags: seo.tags,
        style: seo.style, mockupMode: 'keep', artworkMode: 'keep' });
      if (record?.template) row.note = 'Photos copied; sizes, prices and profiles from the current template.';
    }
    await step('Publishing, then deactivating the old listing');
    const { record } = await deps.finalize(row.listingId);
    row.newListingId = Number(record.draftId) || null;
    await deps.markReposted(row.listingId, row.newListingId, { artworkId: '', count: (row.reposts || 0) + 1 }).catch(() => {});
    row.status = 'done'; row.step = 'Reposted';
  } catch (error) { failed(row, error); }
}
