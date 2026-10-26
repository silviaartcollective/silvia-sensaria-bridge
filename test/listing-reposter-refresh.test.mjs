import test from 'node:test';
import assert from 'node:assert/strict';
import { startRenewal, resumeRenewal, stopRenewal, renewalRunning } from '../src/listing-renewer.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
async function finished() {
  for (let i = 0; i < 4000 && renewalRunning(); i++) await tick();
  assert.equal(renewalRunning(), false);
}
// Listings 1 and 2 have their artwork in the app; 3 does not. A PC that makes
// one mockup per poll, ChatGPT, Etsy drafts.
function shop({ holdMockups = false, soldDuring = 0 } = {}) {
  const log = [], saved = {}, renders = new Map(), listings = new Map([[1, 'active'], [2, 'active'], [3, 'active']]);
  let nextListing = 500;
  const deps = {
    newId: () => 'run-1',
    loadJob: async () => structuredClone(saved.job || null),
    saveJob: async job => { saved.job = structuredClone(job); },
    pause: () => tick(),
    listActive: async () => [1, 2, 3].map(id => ({ listing_id: id, title: 'Listing ' + id, original_creation_timestamp: 1e9 + id })),
    salesCount: async id => (id === soldDuring && log.some(line => line.startsWith('draft ' + id)) ? 1 : 0),
    describe: async id => (id === 3 ? { artworkId: '', layout: '', photo: 'p3' } : { artworkId: 'SAC' + id, layout: 'portrait', photo: 'p' + id }),
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
    prepareArtwork: async row => { log.push('prepare ' + row.artworkId); },
    attachMockups: async (artworkId, jobId, ids) => { log.push('attach ' + artworkId + ' ' + ids.join(',')); },
    savePhotoOrder: async (item, ids) => { log.push('order ' + item.artworkId + ' ' + item.preset + ' ' + item.orientation); },
    createDraft: async item => { const id = nextListing++; log.push('draft ' + item.artworkId.slice(3) + ' "' + item.seo.title + '"'); listings.set(id, 'draft'); return id; },
    draftSetup: async () => ({ status: 'completed' }),
    publish: async id => { log.push('publish ' + id); listings.set(id, 'active'); },
    deactivate: async (oldId, newId) => { log.push('deactivate ' + oldId + ' for ' + newId); listings.set(oldId, 'inactive'); },
    // Listing 3 (artwork not in the app) is copied.
    record: async () => null,
    newSeo: async id => ({ title: 'Copied title ' + id, tags: ['b'], description: 'Old', descriptionKept: true }),
    prepare: async id => { log.push('copy ' + id); return { record: { draftId: 900 + id } }; },
    finalize: async id => { log.push('publish copy of ' + id + ', deactivate ' + id); listings.set(id, 'inactive'); return { record: { draftId: 900 + id } }; }
  };
  return { deps, log, saved, listings };
}

test('a listing whose artwork is in the app gets new SEO, the preset\'s mockups and a new listing; the old one is deactivated', async () => {
  const { deps, log, saved, listings } = shop();
  await startRenewal(deps, { count: 3, preset: 'Preset 2' });
  await finished();
  const job = saved.job;
  assert.equal(job.status, 'done', job.error);
  assert.deepEqual(job.results.map(row => [row.listingId, row.status]), [[1, 'done'], [2, 'done'], [3, 'done']]);
  assert.deepEqual(job.results.map(row => row.newListingId).sort(), [500, 501, 903]);
  for (const id of [1, 2]) {
    const steps = log.filter(line => line.includes('SAC' + id) || line.startsWith('seo ' + id) || line.startsWith('draft ' + id));
    assert.deepEqual(steps.map(line => line.split(' ')[0]), ['mockups', 'seo', 'prepare', 'attach', 'order', 'draft']);
    assert.ok(steps[0].endsWith('portrait Preset 2'));
    assert.match(steps.find(line => line.startsWith('attach')), /t0,t1,t2$/);
    const row = job.results.find(entry => entry.listingId === id);
    assert.equal(row.newTitle, 'New title ' + id);
    // Published before the old one is deactivated.
    assert.ok(log.indexOf('publish ' + row.newListingId) < log.indexOf('deactivate ' + id + ' for ' + row.newListingId));
    assert.equal(listings.get(id), 'inactive');
  }
  assert.ok(log.includes('copy 3'));
  assert.equal(job.results[2].note, 'Photos, description and variants kept: this listing\'s artwork is not in the app.');
});

test('Stop, then Resume: a repost goes on from the step it reached', async () => {
  const s = shop({ holdMockups: true });
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
  assert.equal(s.log.filter(line => line.startsWith('draft')).length, 1);
  await assert.rejects(resumeRenewal(s.deps), /Every listing of this run is finished/);
});

test('without a mockup preset nothing is reposted', async () => {
  const { deps, log, saved } = shop();
  await startRenewal(deps, { count: 2 });
  await finished();
  assert.equal(saved.job.status, 'failed');
  assert.match(saved.job.error, /Choose a mockup preset first/);
  assert.equal(log.length, 0);
});

test('a listing that sells while it is reposted is kept and its new listing stays a draft', async () => {
  const { deps, log, saved, listings } = shop({ soldDuring: 1 });
  await startRenewal(deps, { count: 1, preset: 'Preset 1' });
  await finished();
  const row = saved.job.results[0];
  assert.equal(row.status, 'failed');
  assert.match(row.error, /sold while it was being reposted/);
  assert.equal(listings.get(1), 'active');
  assert.equal(listings.get(row.newListingId), 'draft');
  assert.ok(!log.some(line => line.startsWith('publish') || line.startsWith('deactivate')));
});
