import test from 'node:test';
import assert from 'node:assert/strict';
import { startRenewal, resumeRenewal, stopRenewal, renewalRunning, dueFor, checkRules, DEFAULT_RULES } from '../src/listing-renewer.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
async function finished() {
  for (let i = 0; i < 4000 && renewalRunning(); i++) await tick();
  assert.equal(renewalRunning(), false);
}
const DAY = 86400, MONTH = 30.44 * DAY, NOW = 1.8e9;
const iso = seconds => new Date(seconds * 1000).toISOString();
// A listing `months` old when it renews in `renewsIn` days.
const listing = (id, months, renewsIn) => ({ listing_id: id, title: 'Listing ' + id,
  original_creation_timestamp: Math.round(NOW + renewsIn * DAY - months * MONTH), ending_timestamp: NOW + renewsIn * DAY });

// The shop: listings 1, 2, 5, 6, 7, 8 and 9 have their artwork in the app, 3
// and 4 do not. 2, 4, 6 and 9 were refreshed before; 9 replaced a listing
// reposted earlier. A PC that makes one mockup per poll, ChatGPT, Etsy.
function shop({ holdMockups = false, soldDuring = 0, soldWhileMockups = 0, items, refreshed } = {}) {
  const log = [], saved = {}, renders = new Map();
  const listings = new Map([1, 2, 3, 4, 5, 6, 7, 8, 9].map(id => [id, 'active']));
  const store = { refreshed: refreshed || { 2: { at: iso(NOW - 8 * MONTH) }, 4: { at: iso(NOW - 8 * MONTH) }, 6: { at: iso(NOW - 2 * MONTH) },
    9: { at: iso(NOW - 8 * MONTH) } }, reposted: { 9: { count: 1, fromListingId: 99 } } };
  let nextListing = 500;
  const deps = {
    newId: () => 'run-1',
    now: () => NOW * 1000,
    loadJob: async () => structuredClone(saved.job || null),
    saveJob: async job => { saved.job = structuredClone(job); },
    pause: () => tick(),
    listActive: async () => items || [
      listing(1, 4, 3),     // 4 months at its renewal in 3 days: refresh
      listing(2, 12, 2),    // refreshed 8 months ago, 12 months at its renewal: repost
      listing(3, 8, 5),     // never refreshed, 8 months: refresh first
      listing(4, 12, 6),    // refreshed 8 months ago, not in the app: repost (copy)
      listing(5, 4, 20),    // renews in 20 days: not this week
      listing(6, 12, 2),    // refreshed only 2 months ago: not yet
      listing(7, 2, 3),     // 2 months old: too young
      listing(8, 4, 1),     // sold
      listing(9, 12, 4)     // already reposted once: left as it is
    ],
    refreshedListings: async () => structuredClone(store.refreshed),
    markRefreshed: async (id, info) => { log.push('marked ' + id + ' ' + info.artworkId); store.refreshed[id] = { ...info, at: iso(NOW) }; },
    markReposted: async (oldId, newId, info) => {
      log.push('reposted ' + oldId + ' as ' + newId + ', repost ' + info.count);
      delete store.refreshed[oldId]; store.reposted[newId] = { ...info, fromListingId: oldId };
    },
    salesCount: async id => (id === 8 || (id === soldDuring && log.some(line => line.startsWith('draft ' + id))) ||
      (id === soldWhileMockups && log.some(line => line.startsWith('seo ' + id))) ? 1 : 0),
    describe: async id => ({ ...([3, 4].includes(id) ? { artworkId: '', layout: '', photo: 'p' + id } : { artworkId: 'SAC' + id, layout: 'portrait', photo: 'p' + id }),
      reposts: store.reposted[id]?.count || 0 }),
    startMockups: async item => {
      log.push('mockups ' + item.artworkId + ' ' + item.orientation + ' ' + item.preset);
      renders.set('job-' + item.artworkId, 0);
      return { jobId: 'job-' + item.artworkId, total: 3 };
    },
    mockupStatus: async jobId => {
      if (!holdMockups) renders.set(jobId, Math.min(3, renders.get(jobId) + 1));
      const done = renders.get(jobId);
      return { total: 3, done, failed: 0, finished: done === 3, note: 'Rendering on PC', completedIds: Array.from({ length: done }, (_, i) => 't' + i) };
    },
    refreshSeo: async id => { log.push('seo ' + id); return { title: 'New title ' + id, tags: ['a'], style: 'Minimalist', description: 'New', sectionId: '7' }; },
    // Refresh: the same listing.
    replacePhotos: async item => { log.push('photos ' + item.listingId + ' ' + item.artworkId + ' ' + item.preset + ' ' + item.templateIds.join(',')); },
    updateDetails: async item => { log.push('details ' + item.listingId + ' ' + (item.artworkId || '-') + ' "' + item.seo.title + '"' + (item.template ? ' with template' : '')); },
    // Repost: a new listing.
    prepareArtwork: async row => { log.push('prepare ' + row.artworkId); },
    attachMockups: async (artworkId, jobId, ids) => { log.push('attach ' + artworkId + ' ' + ids.join(',')); },
    savePhotoOrder: async item => { log.push('order ' + item.artworkId + ' ' + item.preset + ' ' + item.orientation); },
    createDraft: async item => { const id = nextListing++; log.push('draft ' + item.artworkId.slice(3) + ' "' + item.seo.title + '"'); listings.set(id, 'draft'); return id; },
    draftSetup: async () => ({ status: 'completed' }),
    publish: async id => { log.push('publish ' + id); listings.set(id, 'active'); },
    deactivate: async (oldId, newId) => { log.push('deactivate ' + oldId + ' for ' + newId); listings.set(oldId, 'inactive'); },
    // Artwork not in the app.
    record: async () => null,
    newSeo: async id => { log.push('seo ' + id); return { title: 'Copied title ' + id, tags: ['b'], description: 'Old', descriptionKept: true }; },
    prepare: async id => { log.push('copy ' + id); return { record: { draftId: 900 + id } }; },
    finalize: async id => { log.push('publish copy of ' + id + ', deactivate ' + id); listings.set(id, 'inactive'); return { record: { draftId: 900 + id } }; }
  };
  return { deps, log, saved, listings, store };
}
const stepsOf = (log, id) => log.filter(line => line.split(' ')[1] === String(id) || line.split(' ')[1] === 'SAC' + id ||
  line.startsWith('draft ' + id + ' ') || line.startsWith('publish copy of ' + id)).map(line => line.split(' ')[0]);

test('due this week: unsold listings at 4 months are refreshed in place, refreshed ones still unsold at 12 months are reposted', async () => {
  const { deps, log, saved, listings, store } = shop();
  await startRenewal(deps, { count: 20, preset: 'Preset 2', rules: DEFAULT_RULES });
  await finished();
  const job = saved.job;
  assert.equal(job.status, 'done', job.error);
  // The soonest renewal first; 5 (next month), 6 (refreshed lately), 7 (too young), 8 (sold) and 9
  // (reposted once already) are left alone.
  assert.deepEqual(job.results.map(row => [row.listingId, row.action, row.status]),
    [[2, 'repost', 'done'], [1, 'refresh', 'done'], [3, 'refresh', 'done'], [4, 'repost', 'done']]);
  assert.equal(job.progress.due, 6);
  assert.equal(job.progress.atLimit, 1);
  assert.equal(job.results[1].renewsAt, iso(NOW + 3 * DAY));
  assert.equal(job.results[0].refreshedAt, iso(NOW - 8 * MONTH));
  for (const id of [5, 6, 7, 8, 9]) assert.deepEqual(stepsOf(log, id), [], 'listing ' + id);

  // Refreshed: the same listing gets the preset's mockups, new SEO and the template; nothing is published or deactivated.
  assert.deepEqual(stepsOf(log, 1), ['mockups', 'seo', 'photos', 'details', 'marked']);
  assert.ok(log.includes('mockups SAC1 portrait Preset 2'));
  assert.ok(log.includes('photos 1 SAC1 Preset 2 t0,t1,t2'));
  assert.ok(log.includes('details 1 SAC1 "New title 1" with template'));
  assert.equal(listings.get(1), 'active');
  assert.equal(job.results[1].step, 'Refreshed');
  assert.equal(job.results[1].newListingId, null);
  // Not in the app: new title and tags only.
  assert.deepEqual(stepsOf(log, 3), ['seo', 'details', 'marked']);
  assert.ok(log.includes('details 3 - "Copied title 3"'));
  assert.match(job.results[2].note, /New title and tags; photos, description and variants kept/);

  // Reposted: a new listing, published before the old one is deactivated.
  assert.deepEqual(stepsOf(log, 2), ['mockups', 'seo', 'prepare', 'attach', 'order', 'draft', 'deactivate', 'reposted']);
  const row = job.results[0];
  assert.equal(row.step, 'Reposted');
  assert.ok(log.indexOf('publish ' + row.newListingId) < log.indexOf('deactivate 2 for ' + row.newListingId));
  assert.equal(listings.get(2), 'inactive');
  assert.deepEqual(stepsOf(log, 4), ['seo', 'copy', 'publish', 'reposted']);
  assert.equal(job.results[3].newListingId, 904);

  // The record: 1 and 3 refreshed now; 2 and 4 are gone; 6 is still waiting for its repost.
  assert.deepEqual(Object.keys(store.refreshed).sort(), ['1', '3', '6', '9']);
  assert.equal(store.refreshed[1].artworkId, 'SAC1');
  // The new listings carry the count on: with the default of one repost, they are not reposted again.
  assert.ok(log.includes('reposted 2 as ' + row.newListingId + ', repost 1'));
  assert.deepEqual(store.reposted[row.newListingId], { artworkId: 'SAC2', count: 1, fromListingId: 2 });
  assert.equal(store.reposted[904].count, 1);
});

test('the run takes at most the number asked for, the soonest renewals first', async () => {
  const { deps, saved } = shop();
  await startRenewal(deps, { count: 2, preset: 'Preset 1' });
  await finished();
  assert.deepEqual(saved.job.results.map(row => row.listingId), [2, 1]);
});

test('when a listing is due: its age at its next renewal, within the window', () => {
  const rules = { refreshMonths: 4, repostMonths: 12, windowDays: 7 };
  // Etsy's 4 months are calendar months: Jan 10 → May 10 is 120 days.
  const jan10 = Date.UTC(2027, 0, 10) / 1000, may10 = Date.UTC(2027, 4, 10) / 1000;
  const item = { listing_id: 1, original_creation_timestamp: jan10, ending_timestamp: may10 };
  assert.equal(dueFor(item, null, rules, may10 - 6 * DAY), 'refresh');
  assert.equal(dueFor(item, null, rules, may10 - 8 * DAY), '');
  assert.equal(dueFor(item, null, { ...rules, windowDays: 10 }, may10 - 8 * DAY), 'refresh');
  assert.equal(dueFor(item, null, { ...rules, refreshMonths: 5 }, may10 - 6 * DAY), '');
  // Refreshed at its first renewal: reposted just before its third, 8 months later; not at its second.
  const sep10 = Date.UTC(2027, 8, 10) / 1000, jan10next = Date.UTC(2028, 0, 10) / 1000;
  const refreshed = { at: iso(may10 - 5 * DAY) };
  assert.equal(dueFor({ ...item, ending_timestamp: sep10 }, refreshed, rules, sep10 - 3 * DAY), '');
  assert.equal(dueFor({ ...item, ending_timestamp: jan10next }, refreshed, rules, jan10next - 3 * DAY), 'repost');
  // A listing older than the refresh age that was never refreshed is refreshed first, whatever its age.
  assert.equal(dueFor({ ...item, ending_timestamp: jan10next }, null, rules, jan10next - 3 * DAY), 'refresh');
  // Refreshed late (at 14 months): reposted only 8 months after that.
  const old = { listing_id: 2, original_creation_timestamp: jan10 - 14 * MONTH, ending_timestamp: may10 };
  assert.equal(dueFor(old, { at: iso(may10 - 4 * MONTH) }, rules, may10 - DAY), '');
  assert.equal(dueFor(old, { at: iso(may10 - 8 * MONTH) }, rules, may10 - DAY), 'repost');
  // Without Etsy's renewal date: every 4 months from its creation.
  assert.equal(dueFor({ listing_id: 3, original_creation_timestamp: jan10 }, null, rules, jan10 + 4 * MONTH - 2 * DAY), 'refresh');
});

test('the rules: refresh before repost, sensible numbers', () => {
  assert.deepEqual(checkRules({}), { refreshMonths: 4, repostMonths: 12, windowDays: 7, maxReposts: 1, refreshTemplate: true });
  assert.deepEqual(checkRules({ refreshMonths: '4', repostMonths: '8', windowDays: '14', maxReposts: '0', refreshTemplate: false }),
    { refreshMonths: 4, repostMonths: 8, windowDays: 14, maxReposts: 0, refreshTemplate: false });
  assert.throws(() => checkRules({ maxReposts: 6 }), /0 to 5 times/);
  assert.throws(() => checkRules({ refreshMonths: 8, repostMonths: 8 }), /more months than the refresh/);
  assert.throws(() => checkRules({ refreshMonths: 0 }), /1 to 36 months/);
  assert.throws(() => checkRules({ windowDays: 0 }), /1 to 120 days/);
});

test('Stop, then Resume: a refresh goes on from the step it reached', async () => {
  const s = shop({ holdMockups: true, items: [listing(1, 4, 3)] });
  await startRenewal(s.deps, { count: 1, preset: 'Preset 1' });
  for (let i = 0; i < 200; i++) await tick();
  assert.match(s.saved.job.results[0].step, /^Mockups: 0 of 3 made on the PC · Rendering on PC$/);
  stopRenewal();
  await finished();
  assert.equal(s.saved.job.status, 'stopped');
  assert.equal(s.saved.job.results[0].status, 'waiting');
  s.deps.mockupStatus = async () => ({ total: 3, done: 3, failed: 0, finished: true, completedIds: ['t0', 't1', 't2'] });
  await resumeRenewal(s.deps);
  await finished();
  assert.equal(s.saved.job.results[0].status, 'done', s.saved.job.results[0].error);
  assert.equal(s.log.filter(line => line.startsWith('mockups')).length, 1);
  assert.equal(s.log.filter(line => line.startsWith('photos')).length, 1);
  assert.equal(s.log.filter(line => line.startsWith('details')).length, 1);
  await assert.rejects(resumeRenewal(s.deps), /Every listing of this run is finished/);
});

test('a refresh whose photos are on Etsy goes on with the details when tried again', async () => {
  const s = shop({ items: [listing(1, 4, 3)] });
  s.deps.updateDetails = async () => { throw Error('Etsy is down'); };
  await startRenewal(s.deps, { count: 1, preset: 'Preset 1' });
  await finished();
  assert.equal(s.saved.job.results[0].status, 'failed');
  assert.match(s.saved.job.results[0].error, /Etsy is down/);
  assert.equal(s.store.refreshed[1], undefined);
  s.deps.updateDetails = async item => { s.log.push('details ' + item.listingId); };
  await resumeRenewal(s.deps, { retryFailed: true });
  await finished();
  assert.equal(s.saved.job.results[0].status, 'done');
  assert.equal(s.log.filter(line => line.startsWith('photos')).length, 1);
  assert.ok(s.store.refreshed[1]);
});

test('without a mockup preset nothing is changed', async () => {
  const { deps, log, saved } = shop();
  await startRenewal(deps, { count: 2 });
  await finished();
  assert.equal(saved.job.status, 'failed');
  assert.match(saved.job.error, /Choose a mockup preset first/);
  assert.equal(log.length, 0);
});

test('a listing that sells while it is reposted is kept and its new listing stays a draft', async () => {
  const { deps, log, saved, listings, store } = shop({ soldDuring: 2, items: [listing(2, 12, 2)] });
  await startRenewal(deps, { count: 1, preset: 'Preset 1' });
  await finished();
  const row = saved.job.results[0];
  assert.equal(row.status, 'failed');
  assert.match(row.error, /sold while it was being reposted/);
  assert.equal(listings.get(2), 'active');
  assert.equal(listings.get(row.newListingId), 'draft');
  assert.ok(!log.some(line => line.startsWith('publish') || line.startsWith('deactivate')));
  assert.ok(store.refreshed[2]);
});

test('a run of the earlier reposter is not resumed, so nothing is reposted without the rules', async () => {
  const { deps, log, saved } = shop();
  saved.job = { id: 'old', status: 'stopped', count: 1, preset: 'Preset 1', progress: { done: 0, total: 1 },
    results: [{ listingId: 1, title: 'Listing 1', status: 'waiting', step: 'Stopped', artworkId: 'SAC1', layout: 'portrait' }] };
  await assert.rejects(resumeRenewal(deps), /started by the earlier reposter, which only reposted\. Start a new run/);
  assert.equal(renewalRunning(), false);
  assert.deepEqual(log, []);
});

test('sales are checked again just before a listing is changed: one that sold while its mockups were made is left as it is', async () => {
  const { deps, log, saved } = shop({ soldWhileMockups: 1, items: [listing(1, 4, 3)] });
  await startRenewal(deps, { count: 1, preset: 'Preset 1' });
  await finished();
  const row = saved.job.results[0];
  assert.equal(row.status, 'failed');
  assert.match(row.error, /sold while it was being refreshed, so it was left as it is/);
  assert.ok(!log.some(line => /^(photos|details|marked)/.test(line)), log.join('\n'));
});

test('the template is applied on refresh only when chosen; with no reposts allowed, nothing is reposted', async () => {
  const { deps, log, saved } = shop();
  await startRenewal(deps, { count: 20, preset: 'Preset 1', rules: { refreshTemplate: false, maxReposts: 0 } });
  await finished();
  assert.deepEqual(saved.job.results.map(row => [row.listingId, row.action]), [[1, 'refresh'], [3, 'refresh']]);
  assert.equal(saved.job.progress.atLimit, 3);
  assert.ok(log.includes('details 1 SAC1 "New title 1"'));
  assert.ok(!log.some(line => /^(draft|copy|deactivate)/.test(line)));
});
