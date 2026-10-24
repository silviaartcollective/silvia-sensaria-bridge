import test from 'node:test';
import assert from 'node:assert/strict';
import { addToBatch, batchStatus, batchRunning, stopBatch, resumeBatch, setPublish, publishBatch, closeBatch,
  resetBatchMemory, MAX_BATCH } from '../src/batch-poster.mjs';

const stage = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const tick = () => new Promise(resolve => setImmediate(resolve));

// A fake shop: artwork IDs, a PC that renders one mockup per poll, ChatGPT, Etsy drafts.
function fakeShop({ failAllMockupsFor = '', interruptOnce = '', holdMockups = false } = {}) {
  const log = [], saved = {}, renders = new Map(), drafts = new Map();
  let nextArtwork = 100, nextId = 0, nextListing = 5000, interrupted = false;
  const deps = {
    newId: () => 'batch-' + ++nextId,
    loadJob: async () => saved.job || null,
    saveJob: async job => { saved.job = job; },
    pause: () => tick(),
    reserveArtwork: async item => {
      log.push('reserve ' + item.filename);
      return { artworkId: 'SAC' + nextArtwork++, orientation: item.filename.includes('wide') ? 'landscape' : 'portrait' };
    },
    startMockups: async (artworkId, orientation) => {
      log.push('mockups ' + artworkId + ' ' + orientation);
      renders.set('job-' + artworkId, { artworkId, done: 0, total: 4 });
      return { jobId: 'job-' + artworkId, total: 4 };
    },
    mockupStatus: async jobId => {
      const render = renders.get(jobId);
      if (!holdMockups && render.done < render.total) render.done++;
      const failed = render.artworkId === failAllMockupsFor;
      const finished = render.done === render.total;
      return { total: render.total, done: failed ? 0 : render.done, failed: failed ? render.done : 0, finished,
        completedIds: failed ? [] : Array.from({ length: render.done }, (_, i) => 't' + (i + 1)) };
    },
    writeSeo: async item => {
      log.push('seo ' + item.artworkId + ' while ' + renders.get(item.mockupJobId).done + ' of 4 mockups made');
      return { title: 'Title ' + item.artworkId, description: 'About it', tags: ['a', 'b'], style: 'Minimalist' };
    },
    attachMockups: async (artworkId, jobId, ids) => { log.push('attach ' + artworkId + ' ' + ids.join(',')); },
    createDraft: async item => {
      log.push('draft ' + item.artworkId + ' "' + item.seo.title + '"');
      const listingId = drafts.get(item.artworkId)?.listingId || nextListing++;
      drafts.set(item.artworkId, { listingId, polls: 0 });
      return listingId;
    },
    draftSetup: async artworkId => {
      const draft = drafts.get(artworkId);
      if (artworkId === interruptOnce && !interrupted) { interrupted = true; return { status: 'interrupted' }; }
      return { status: ++draft.polls >= 2 ? 'completed' : 'running' };
    },
    publish: async listingId => {
      log.push('publish ' + listingId);
      if (listingId === 5001) throw Error('Etsy: missing shipping profile');
    }
  };
  return { deps, log, saved, renders };
}
async function idle() {
  for (let i = 0; i < 2000 && batchRunning(); i++) await tick();
  assert.equal(batchRunning(), false);
}

test('each artwork gets its ID, its orientation\'s mockups, ChatGPT SEO while they render, and a draft', async () => {
  resetBatchMemory();
  const shop = fakeShop({ failAllMockupsFor: 'SAC102' });
  await addToBatch(shop.deps, { stageId: stage(1), filename: 'sage tall.jpg', contentType: 'image/jpeg', size: 10, previewKey: 'p1' });
  await addToBatch(shop.deps, { stageId: stage(2), filename: 'sea wide.jpg', contentType: 'image/jpeg', size: 10 });
  await addToBatch(shop.deps, { stageId: stage(3), filename: 'broken.jpg', contentType: 'image/jpeg', size: 10 });
  await addToBatch(shop.deps, { stageId: stage(1), filename: 'sage tall.jpg' }); // the same upload twice
  await idle();
  const batch = await batchStatus(shop.deps);
  assert.deepEqual(batch.items.map(item => [item.filename, item.status]),
    [['sage tall.jpg', 'ready'], ['sea wide.jpg', 'ready'], ['broken.jpg', 'failed']]);
  assert.match(batch.items[2].error, /No mockup could be made/);
  assert.ok(shop.log.includes('mockups SAC100 portrait'));
  assert.ok(shop.log.includes('mockups SAC101 landscape'));
  // ChatGPT starts before the PC has finished the mockups.
  assert.ok(shop.log.some(line => /^seo SAC100 while [0-3] of 4/.test(line)), shop.log.join('\n'));
  assert.ok(shop.log.includes('attach SAC100 t1,t2,t3,t4'));
  assert.ok(shop.log.includes('draft SAC100 "Title SAC100"'));
  assert.equal(batch.items[0].listingId, 5000);
  assert.deepEqual(batch.items[0].mockups, { total: 4, done: 4, failed: 0 });
  assert.equal(shop.saved.job.items.length, 3);
});

test('Publish all publishes the ticked drafts that are ready, and says which could not be published', async () => {
  resetBatchMemory();
  const shop = fakeShop();
  for (let n = 1; n <= 3; n++) await addToBatch(shop.deps, { stageId: stage(n), filename: 'art ' + n + '.jpg' });
  await idle();
  await setPublish(shop.deps, { n: 3, publish: false });
  await publishBatch(shop.deps);
  await idle();
  const batch = await batchStatus(shop.deps);
  assert.deepEqual(shop.log.filter(line => line.startsWith('publish')), ['publish 5000', 'publish 5001']);
  assert.deepEqual(batch.items.map(item => item.status), ['published', 'ready', 'ready']);
  assert.match(batch.items[1].error, /missing shipping profile/);
  await setPublish(shop.deps, { n: 2, publish: false });
  await assert.rejects(publishBatch(shop.deps), /No ticked draft is ready/);
});

test('after a restart, resume picks the batch up from R2 and finishes it once', async () => {
  resetBatchMemory();
  const shop = fakeShop({ holdMockups: true });
  await addToBatch(shop.deps, { stageId: stage(1), filename: 'one.jpg' });
  for (let i = 0; i < 50; i++) await tick();
  stopBatch();
  await idle();
  resetBatchMemory(); // the server restarted
  shop.deps.mockupStatus = async () => ({ total: 4, done: 4, failed: 0, finished: true, completedIds: ['t1', 't2', 't3', 't4'] });
  assert.equal((await batchStatus(shop.deps)).items[0].status, 'waiting');
  await resumeBatch(shop.deps);
  await idle();
  const batch = await batchStatus(shop.deps);
  assert.equal(batch.items[0].status, 'ready');
  assert.equal(shop.log.filter(line => line.startsWith('reserve')).length, 1);
  assert.equal(shop.log.filter(line => line.startsWith('mockups')).length, 1);
  assert.equal(shop.log.filter(line => line.startsWith('draft')).length, 1);
});

test('a draft setup cut short by a restart is set up again on the same draft', async () => {
  resetBatchMemory();
  const shop = fakeShop({ interruptOnce: 'SAC100' });
  await addToBatch(shop.deps, { stageId: stage(1), filename: 'one.jpg' });
  await idle();
  const batch = await batchStatus(shop.deps);
  assert.equal(batch.items[0].status, 'ready');
  assert.equal(shop.log.filter(line => line.startsWith('draft')).length, 2);
  assert.equal(batch.items[0].listingId, 5000);
});

test('failed artworks can be tried again; a batch holds 20; a closed batch makes way for a new one', async () => {
  resetBatchMemory();
  const shop = fakeShop({ failAllMockupsFor: 'SAC100' });
  await addToBatch(shop.deps, { stageId: stage(1), filename: 'one.jpg' });
  await idle();
  assert.equal((await batchStatus(shop.deps)).items[0].status, 'failed');
  shop.deps.mockupStatus = async () => ({ total: 4, done: 4, failed: 0, finished: true, completedIds: ['t1'] });
  await resumeBatch(shop.deps, { retryFailed: true });
  await idle();
  assert.equal((await batchStatus(shop.deps)).items[0].status, 'ready');
  assert.equal(shop.log.filter(line => line.startsWith('reserve')).length, 1);
  for (let n = 2; n <= MAX_BATCH; n++) await addToBatch(shop.deps, { stageId: stage(n), filename: n + '.jpg' });
  await assert.rejects(addToBatch(shop.deps, { stageId: stage(99), filename: 'too many.jpg' }), /holds 20 artworks/);
  await idle();
  await closeBatch(shop.deps);
  const next = await addToBatch(shop.deps, { stageId: stage(99), filename: 'new day.jpg' });
  assert.equal(next.items.length, 1);
  assert.equal(next.id, 'batch-2');
  await idle();
  await assert.rejects(addToBatch(shop.deps, { stageId: 'not-a-stage', filename: 'x.jpg' }), /Upload the artwork first/);
});

test('the draft is filled like the Product Creator: shop settings, then the template, then ChatGPT\'s SEO', async () => {
  const { batchDraftBody } = await import('../src/batch-poster.mjs');
  const preset = { shipping_profile_id: 11, readiness_state_id: 22, return_policy_id: 33, shop_section_id: 44,
    production_partner_id: 55, who_made: 'collective', when_made: 'made_to_order', is_supply: false, should_auto_renew: true };
  const seo = { title: 'Sage Wall Art', description: 'Calm.', tags: ['sage art'], style: 'Minimalist',
    sectionId: '111', sectionName: 'Abstract Art', sectionUrl: 'https://www.etsy.com/shop/S?section_id=111' };
  const body = batchDraftBody({ artworkId: 'SAC7', layout: 'landscape', seo, preset,
    template: { shipping_profile_id: 99, production_partner_id: 0, should_auto_renew: false, listing_style: 'Coastal & tropical', tags: ['template tag'] } });
  assert.equal(body.shipping_profile_id, 99);          // the template wins over the shop's usual
  assert.equal(body.readiness_state_id, 22);           // left on Automatic: the shop's usual
  assert.deepEqual(body.production_partner_ids, []);   // template says none
  assert.equal(body.should_auto_renew, false);
  assert.equal(body.listing_style, 'Minimalist');      // ChatGPT's style wins
  assert.deepEqual(body.tags, ['sage art']);
  assert.equal(body.shop_section_id, 111);
  assert.equal(body.seo_section_url, seo.sectionUrl);
  assert.equal(body.who_made, 'collective');
  const plain = batchDraftBody({ artworkId: 'SAC8', layout: 'portrait', preset,
    seo: { title: 'T', description: 'D', tags: [], style: '', sectionId: '' }, template: { tags: ['template tag'], listing_style: 'Gothic' } });
  assert.equal(plain.shop_section_id, 44);
  assert.equal(plain.seo_section_url, '');
  assert.equal(plain.listing_style, 'Gothic');
  assert.deepEqual(plain.tags, ['template tag']);
  assert.deepEqual(plain.production_partner_ids, [55]);
});

test('artworks added one by one are worked on three at a time', async () => {
  resetBatchMemory();
  const shop = fakeShop({ holdMockups: true });
  for (let n = 1; n <= 4; n++) await addToBatch(shop.deps, { stageId: stage(n), filename: n + '.jpg' });
  for (let i = 0; i < 50; i++) await tick();
  const batch = await batchStatus(shop.deps);
  assert.deepEqual(batch.items.map(item => item.status), ['working', 'working', 'working', 'waiting']);
  stopBatch();
  await idle();
});

test('artworks whose uploads finish at the same moment all join the same batch', async () => {
  resetBatchMemory();
  const shop = fakeShop({ holdMockups: true });
  const slowLoad = shop.deps.loadJob;
  shop.deps.loadJob = async () => { await tick(); await tick(); return slowLoad(); };
  await Promise.all([1, 2, 3].map(n => addToBatch(shop.deps, { stageId: stage(n), filename: n + '.jpg' })));
  const batch = await batchStatus(shop.deps);
  assert.deepEqual(batch.items.map(item => item.filename), ['1.jpg', '2.jpg', '3.jpg']);
  assert.equal(shop.saved.job.id, batch.id);
  stopBatch();
  await idle();
});

test('mockup presets are the "Preset …" folders in the PC mockup folder, at any depth', async () => {
  const { mockupPresets, templateSuits, presetKey } = await import('../src/batch-poster.mjs');
  const t = (id, localPath, orientation = 'portrait', extra = {}) => ({ id, name: localPath.split('/').pop(), localPath, orientation, status: 'ready', ...extra });
  const presets = mockupPresets([
    t('a', 'Preset 2/Vertical/mockup 10.psd'), t('b', 'Preset 2/Vertical/mockup 2.psd'),
    t('c', 'Preset 1/Horizontal/wide.psd', 'landscape'), t('d', 'Vertical/Preset 1/tall.psd'),
    t('e', 'preset 1/Square room.psd', 'square'), t('f', 'Loose/mockup 1.psd'), t('g', 'mockup 3.psd'),
    t('h', 'Preset10/x.psd'), t('i', 'Preset 1/old.psd', 'portrait', { status: 'deleted' }), t('j', 'Preset 3/edge.psd', 'landscape')
  ]);
  assert.deepEqual(presets.map(p => p.name), ['Preset 1', 'Preset 2', 'Preset 3', 'Preset10']);
  // "Vertical/Preset 1" and "preset 1" are the same preset; deleted ones are left out.
  assert.deepEqual(presets[0].templates.map(x => x.id).sort(), ['c', 'd', 'e']);
  // Name order counts numbers: mockup 2 before mockup 10.
  assert.deepEqual(presets[1].templates.map(x => x.id), ['b', 'a']);
  assert.ok(templateSuits({ orientation: 'portrait' }, 'portrait'));
  assert.ok(!templateSuits({ orientation: 'landscape' }, 'portrait'));
  assert.ok(templateSuits({ orientation: 'portrait', squareCompatible: true }, 'square'));
  assert.equal(presetKey('  Preset   1 '), presetKey('preset 1'));
});

test('each artwork keeps the preset it was added with', async () => {
  resetBatchMemory();
  const shop = fakeShop();
  const seen = [];
  const start = shop.deps.startMockups;
  shop.deps.startMockups = (artworkId, layout, preset) => { seen.push(preset); return start(artworkId, layout); };
  await addToBatch(shop.deps, { stageId: stage(1), filename: 'one.jpg', preset: 'Preset 2' });
  await addToBatch(shop.deps, { stageId: stage(2), filename: 'two.jpg', preset: 'Preset 1' });
  await idle();
  assert.deepEqual(seen.sort(), ['Preset 1', 'Preset 2']);
  assert.deepEqual((await batchStatus(shop.deps)).items.map(item => item.preset), ['Preset 2', 'Preset 1']);
});
