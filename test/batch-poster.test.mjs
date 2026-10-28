import test from 'node:test';
import assert from 'node:assert/strict';
import { addToBatch, batchStatus, batchRunning, stopBatch, resumeBatch, retryItem, resumeAfterRestart, setPublish, publishBatch, closeBatch, startOver,
  layoutOfPixels, resetBatchMemory, MAX_BATCH } from '../src/batch-poster.mjs';

const stage = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const tick = () => new Promise(resolve => setImmediate(resolve));
// An artwork as the page adds it: its size comes from the browser's preview.
const art = (n, filename, extra = {}) => ({ stageId: stage(n), filename, contentType: 'image/jpeg', size: 10,
  width: filename.includes('wide') ? 1600 : 900, height: filename.includes('wide') ? 900 : 1200, ...extra });

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
      return { artworkId: 'SAC' + nextArtwork++, orientation: item.orientation || (item.filename.includes('wide') ? 'landscape' : 'portrait') };
    },
    startMockups: async item => {
      log.push('mockups ' + item.filename + ' ' + item.orientation + ' from ' + (item.artworkId || 'the upload'));
      renders.set('job-' + item.filename, { filename: item.filename, done: 0, total: 4 });
      return { jobId: 'job-' + item.filename, total: 4 };
    },
    mockupStatus: async jobId => {
      const render = renders.get(jobId);
      if (!holdMockups && render.done < render.total) render.done++;
      const failed = render.filename === failAllMockupsFor;
      const finished = render.done === render.total;
      return { total: render.total, done: failed ? 0 : render.done, failed: failed ? render.done : 0, finished,
        completedIds: failed ? [] : Array.from({ length: render.done }, (_, i) => 't' + (i + 1)) };
    },
    writeSeo: async item => {
      log.push('seo ' + item.filename + ' while ' + renders.get(item.mockupJobId).done + ' of 4 mockups made');
      return { title: 'Title ' + item.filename, description: 'About it', tags: ['a', 'b'], style: 'Minimalist' };
    },
    linkMockups: async item => { log.push('link ' + item.filename + ' ' + item.artworkId); },
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
    },
    discardUpload: async item => { log.push('discard ' + item.filename); }
  };
  return { deps, log, saved, renders };
}
async function idle() {
  for (let i = 0; i < 2000 && batchRunning(); i++) await tick();
  assert.equal(batchRunning(), false);
}

test('mockups and SEO come first; the artwork gets its ID (and R2 folder) only for its draft', async () => {
  resetBatchMemory();
  const shop = fakeShop({ failAllMockupsFor: 'broken.jpg' });
  await addToBatch(shop.deps, art(1, 'sage tall.jpg', { previewKey: 'p1' }));
  await addToBatch(shop.deps, art(2, 'sea wide.jpg'));
  await addToBatch(shop.deps, art(3, 'broken.jpg'));
  await addToBatch(shop.deps, art(1, 'sage tall.jpg')); // the same upload twice
  await idle();
  const batch = await batchStatus(shop.deps);
  assert.deepEqual(batch.items.map(item => [item.filename, item.status]),
    [['sage tall.jpg', 'ready'], ['sea wide.jpg', 'ready'], ['broken.jpg', 'failed']]);
  assert.match(batch.items[2].error, /No mockup could be made/);
  // The failed artwork never got an artwork ID.
  assert.equal(batch.items[2].artworkId, '');
  assert.ok(!shop.log.includes('reserve broken.jpg'));
  assert.ok(shop.log.includes('mockups sage tall.jpg portrait from the upload'));
  assert.ok(shop.log.includes('mockups sea wide.jpg landscape from the upload'));
  // ChatGPT starts before the PC has finished the mockups.
  assert.ok(shop.log.some(line => /^seo sage tall\.jpg while [0-3] of 4/.test(line)), shop.log.join('\n'));
  const order = name => shop.log.findIndex(line => line.startsWith(name));
  assert.ok(order('seo sage') < order('reserve sage') && order('reserve sage') < order('link sage tall.jpg SAC') &&
    order('link sage') < order('attach ' + batch.items[0].artworkId) && order('attach ' + batch.items[0].artworkId) < order('draft ' + batch.items[0].artworkId),
    shop.log.join('\n'));
  assert.ok(shop.log.includes('draft ' + batch.items[0].artworkId + ' "Title sage tall.jpg"'));
  assert.deepEqual(batch.items[0].mockups, { total: 4, done: 4, failed: 0 });
  assert.equal(shop.saved.job.items.length, 3);
});

test('a TIFF the browser cannot read gets its artwork ID first, which tells its shape', async () => {
  resetBatchMemory();
  const shop = fakeShop();
  await addToBatch(shop.deps, art(1, 'master.tif', { width: 0, height: 0 }));
  await idle();
  const [item] = (await batchStatus(shop.deps)).items;
  assert.equal(item.status, 'ready');
  assert.ok(shop.log.indexOf('reserve master.tif') < shop.log.findIndex(line => line.startsWith('mockups master.tif')));
  assert.ok(shop.log.includes('mockups master.tif portrait from SAC100'));
  assert.ok(!shop.log.some(line => line.startsWith('link')));
});

test('the shape is read like the server does: 1.85:1 or wider is panoramic', () => {
  assert.equal(layoutOfPixels(900, 1200), 'portrait');
  assert.equal(layoutOfPixels(1600, 900), 'landscape');
  assert.equal(layoutOfPixels(1850, 1000), 'panoramic');
  assert.equal(layoutOfPixels(1000, 1000), 'square');
  assert.equal(layoutOfPixels(0, 0), '');
});

test('Publish all publishes the ticked drafts that are ready, and says which could not be published', async () => {
  resetBatchMemory();
  const shop = fakeShop();
  for (let n = 1; n <= 3; n++) await addToBatch(shop.deps, art(n, 'art ' + n + '.jpg'));
  await idle();
  await setPublish(shop.deps, { n: 3, publish: false });
  await publishBatch(shop.deps);
  await idle();
  const batch = await batchStatus(shop.deps);
  assert.deepEqual(shop.log.filter(line => line.startsWith('publish')).sort(), ['publish 5000', 'publish 5001']);
  const failedOne = batch.items.find(item => item.listingId === 5001);
  assert.equal(failedOne.status, 'ready');
  assert.match(failedOne.error, /missing shipping profile/);
  assert.equal(batch.items.find(item => item.listingId === 5000).status, 'published');
  assert.equal(batch.items[2].status, 'ready');
  await setPublish(shop.deps, { n: failedOne.n, publish: false });
  await assert.rejects(publishBatch(shop.deps), /No ticked draft is ready/);
});

test('Stop stops: the steps under way end, and artworks added while stopped wait for Resume', async () => {
  resetBatchMemory();
  const shop = fakeShop({ holdMockups: true });
  await addToBatch(shop.deps, art(1, 'one.jpg'));
  await addToBatch(shop.deps, art(2, 'two.jpg'));
  for (let i = 0; i < 50; i++) await tick();
  await stopBatch(shop.deps);
  await idle();
  let batch = await batchStatus(shop.deps);
  assert.equal(batch.paused, true);
  assert.deepEqual(batch.items.map(item => [item.status, item.step]), [['waiting', 'Stopped'], ['waiting', 'Stopped']]);
  // An upload that finishes after Stop joins the batch but does not start it again.
  await addToBatch(shop.deps, art(3, 'three.jpg'));
  for (let i = 0; i < 50; i++) await tick();
  assert.equal(batchRunning(), false);
  assert.ok(!shop.log.some(line => line.startsWith('mockups three.jpg')));
  shop.deps.mockupStatus = async () => ({ total: 4, done: 4, failed: 0, finished: true, completedIds: ['t1', 't2'] });
  await resumeBatch(shop.deps);
  await idle();
  batch = await batchStatus(shop.deps);
  assert.equal(batch.paused, false);
  assert.deepEqual(batch.items.map(item => item.status), ['ready', 'ready', 'ready']);
  // Nothing was done twice.
  assert.equal(shop.log.filter(line => line.startsWith('mockups one.jpg')).length, 1);
  assert.equal(shop.log.filter(line => line.startsWith('reserve one.jpg')).length, 1);
});

test('after a restart, resume picks the batch up from R2 and finishes it once', async () => {
  resetBatchMemory();
  const shop = fakeShop({ holdMockups: true });
  await addToBatch(shop.deps, art(1, 'one.jpg'));
  for (let i = 0; i < 50; i++) await tick();
  await stopBatch(shop.deps);
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

// The server stops mid-batch (a deploy, Render moving it): its lanes are gone and
// R2 still has the artworks it was working on as "working".
async function restartMidBatch(shop, artworks) {
  resetBatchMemory();
  for (const artwork of artworks) await addToBatch(shop.deps, artwork);
  for (let i = 0; i < 50; i++) await tick();
  const inR2 = JSON.parse(JSON.stringify(shop.saved.job));
  assert.ok(inR2.items.some(item => item.status === 'working'));
  shop.deps.pause = shop.deps.mockupStatus = () => new Promise(() => {}); // the old process is gone
  resetBatchMemory();
  const after = fakeShop();
  after.saved.job = inR2;
  after.deps.mockupStatus = async () => ({ total: 4, done: 4, failed: 0, finished: true, completedIds: ['t1', 't2', 't3', 't4'] });
  after.deps.writeSeo = async item => ({ title: 'Title ' + item.filename, description: 'About it', tags: ['a'], style: 'Minimalist' });
  return after;
}

test('after a restart a batch that was not stopped goes on by itself', async () => {
  const after = await restartMidBatch(fakeShop({ holdMockups: true }), [art(1, 'one.jpg'), art(2, 'two.jpg')]);
  assert.deepEqual((await batchStatus(after.deps)).items.map(item => item.status), ['waiting', 'waiting']);
  assert.equal(await resumeAfterRestart(after.deps), true);
  await idle();
  const items = (await batchStatus(after.deps)).items;
  assert.deepEqual(items.map(item => item.status + (item.error ? ': ' + item.error : '')), ['ready', 'ready']);
});

test('after a restart, an artwork added before Resume does not leave the earlier ones looking busy for ever', async () => {
  const after = await restartMidBatch(fakeShop({ holdMockups: true }), [art(1, 'one.jpg'), art(2, 'two.jpg')]);
  await addToBatch(after.deps, art(3, 'three.jpg'));
  await idle();
  assert.deepEqual((await batchStatus(after.deps)).items.map(item => item.status), ['ready', 'ready', 'ready']);
});

test('a stopped batch stays stopped after a restart', async () => {
  resetBatchMemory();
  const shop = fakeShop({ holdMockups: true });
  await addToBatch(shop.deps, art(1, 'one.jpg'));
  for (let i = 0; i < 50; i++) await tick();
  await stopBatch(shop.deps);
  await idle();
  resetBatchMemory();
  assert.equal(await resumeAfterRestart(shop.deps), false);
  assert.equal(batchRunning(), false);
  assert.equal((await batchStatus(shop.deps)).items[0].status, 'waiting');
});

test('while the mockups are made, the artwork says what the PC is doing', async () => {
  resetBatchMemory();
  const shop = fakeShop({ holdMockups: true });
  const status = shop.deps.mockupStatus;
  shop.deps.mockupStatus = async jobId => ({ ...await status(jobId), note: 'Preparing master artwork on PC' });
  await addToBatch(shop.deps, art(1, 'one.jpg'));
  for (let i = 0; i < 50; i++) await tick();
  assert.equal((await batchStatus(shop.deps)).items[0].step, 'Mockups: 0 of 4 made on the PC · Preparing master artwork on PC');
  await stopBatch(shop.deps);
  await idle();
});

test('Start over empties the batch, stops what is under way and removes uploads that have no artwork ID', async () => {
  resetBatchMemory();
  const shop = fakeShop({ holdMockups: true });
  await addToBatch(shop.deps, art(1, 'one.jpg'));
  await addToBatch(shop.deps, art(2, 'two.jpg'));
  for (let i = 0; i < 50; i++) await tick();
  assert.equal(batchRunning(), true);
  await startOver(shop.deps);
  assert.equal(batchRunning(), false);
  assert.equal(await batchStatus(shop.deps), null);
  assert.equal(shop.saved.job, null);
  assert.deepEqual(shop.log.filter(line => line.startsWith('discard')).sort(), ['discard one.jpg', 'discard two.jpg']);
  // The next artwork starts a new batch, which runs.
  shop.deps.mockupStatus = async () => ({ total: 4, done: 4, failed: 0, finished: true, completedIds: ['t1'] });
  const fresh = await addToBatch(shop.deps, art(3, 'fresh.jpg'));
  assert.equal(fresh.items.length, 1);
  await idle();
  assert.equal((await batchStatus(shop.deps)).items[0].status, 'ready');
});

test('a draft setup cut short by a restart is set up again on the same draft', async () => {
  resetBatchMemory();
  const shop = fakeShop({ interruptOnce: 'SAC100' });
  await addToBatch(shop.deps, art(1, 'one.jpg'));
  await idle();
  const batch = await batchStatus(shop.deps);
  assert.equal(batch.items[0].status, 'ready');
  assert.equal(shop.log.filter(line => line.startsWith('draft')).length, 2);
  assert.equal(batch.items[0].listingId, 5000);
});

test('failed artworks can be tried again; a batch holds 20; a closed batch makes way for a new one', async () => {
  resetBatchMemory();
  const shop = fakeShop({ failAllMockupsFor: 'one.jpg' });
  await addToBatch(shop.deps, art(1, 'one.jpg'));
  await idle();
  assert.equal((await batchStatus(shop.deps)).items[0].status, 'failed');
  shop.deps.mockupStatus = async () => ({ total: 4, done: 4, failed: 0, finished: true, completedIds: ['t1'] });
  await resumeBatch(shop.deps, { retryFailed: true });
  await idle();
  assert.equal((await batchStatus(shop.deps)).items[0].status, 'ready');
  assert.equal(shop.log.filter(line => line.startsWith('mockups one.jpg')).length, 1);
  for (let n = 2; n <= MAX_BATCH; n++) await addToBatch(shop.deps, art(n, n + '.jpg'));
  await assert.rejects(addToBatch(shop.deps, art(99, 'too many.jpg')), /holds 20 artworks/);
  await idle();
  await closeBatch(shop.deps);
  const next = await addToBatch(shop.deps, art(99, 'new day.jpg'));
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
  for (let n = 1; n <= 4; n++) await addToBatch(shop.deps, art(n, n + '.jpg'));
  for (let i = 0; i < 50; i++) await tick();
  const batch = await batchStatus(shop.deps);
  assert.deepEqual(batch.items.map(item => item.status), ['working', 'working', 'working', 'waiting']);
  await stopBatch(shop.deps);
  await idle();
});

test('artworks whose uploads finish at the same moment all join the same batch', async () => {
  resetBatchMemory();
  const shop = fakeShop({ holdMockups: true });
  const slowLoad = shop.deps.loadJob;
  shop.deps.loadJob = async () => { await tick(); await tick(); return slowLoad(); };
  await Promise.all([1, 2, 3].map(n => addToBatch(shop.deps, art(n, n + '.jpg'))));
  const batch = await batchStatus(shop.deps);
  assert.deepEqual(batch.items.map(item => item.filename), ['1.jpg', '2.jpg', '3.jpg']);
  assert.equal(shop.saved.job.id, batch.id);
  await stopBatch(shop.deps);
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
  shop.deps.startMockups = item => { seen.push(item.preset); return start(item); };
  await addToBatch(shop.deps, art(1, 'one.jpg', { preset: 'Preset 2' }));
  await addToBatch(shop.deps, art(2, 'two.jpg', { preset: 'Preset 1' }));
  await idle();
  assert.deepEqual(seen.sort(), ['Preset 1', 'Preset 2']);
  assert.deepEqual((await batchStatus(shop.deps)).items.map(item => item.preset), ['Preset 2', 'Preset 1']);
});

test('an arranged photo order is kept for each artwork: its own photos, in that order', async () => {
  const { orderForArtwork, photoOrderKey } = await import('../src/batch-poster.mjs');
  const saved = ['generated:t3', 'key:presets/option.jpg', 'generated:t1', 'generated:gone', 'key:presets/frame.png', 'generated:t2'];
  // t2 was not made for this artwork; t4 is new since the order was saved.
  assert.deepEqual(orderForArtwork(saved, { templateIds: ['t1', 't3', 't4'], presetKeys: ['presets/option.jpg', 'presets/frame.png'] }),
    ['generated:t3', 'key:presets/option.jpg', 'generated:t1', 'key:presets/frame.png', 'generated:t4']);
  assert.equal(photoOrderKey(' Preset  1 ', 'portrait'), photoOrderKey('preset 1', 'portrait'));
  assert.notEqual(photoOrderKey('Preset 1', 'portrait'), photoOrderKey('Preset 1', 'landscape'));
});

test('the photo order goes on the artwork after its mockups and before its draft', async () => {
  resetBatchMemory();
  const shop = fakeShop();
  shop.deps.savePhotoOrder = async (item, ids) => { shop.log.push('order ' + item.artworkId + ' ' + item.preset + ' ' + item.orientation + ' ' + ids.length); };
  await addToBatch(shop.deps, art(1, 'one.jpg', { preset: 'Preset 1' }));
  await idle();
  const [item] = (await batchStatus(shop.deps)).items;
  assert.equal(item.status, 'ready');
  const at = prefix => shop.log.findIndex(line => line.startsWith(prefix));
  assert.ok(at('attach') < at('order ' + item.artworkId + ' Preset 1 portrait 4') && at('order') < at('draft'), shop.log.join('\n'));
});

test('one failed artwork is tried again on its own, while the others are worked on, from the step it reached', async () => {
  resetBatchMemory();
  const shop = fakeShop();
  let seoFails = true, releaseTwo = false;
  const { writeSeo, mockupStatus } = shop.deps;
  shop.deps.writeSeo = async item => {
    if (item.filename === 'one.jpg' && seoFails) { seoFails = false; throw Error('ChatGPT is busy'); }
    return writeSeo(item);
  };
  shop.deps.mockupStatus = async jobId => (jobId === 'job-two.jpg' && !releaseTwo
    ? { total: 4, done: 0, failed: 0, finished: false, completedIds: [] } : mockupStatus(jobId));
  await addToBatch(shop.deps, art(1, 'one.jpg'));
  await addToBatch(shop.deps, art(2, 'two.jpg'));
  const until = async check => { for (let i = 0; i < 4000 && !check(await batchStatus(shop.deps)); i++) await tick(); };
  await until(batch => batch.items[0].status === 'failed');
  let batch = await batchStatus(shop.deps);
  assert.match(batch.items[0].error, /ChatGPT is busy/);
  assert.equal(batch.items[1].status, 'working');
  await assert.rejects(retryItem(shop.deps, 2), /has not failed/);
  await retryItem(shop.deps, 1);
  await until(batch => batch.items[0].status === 'ready');
  batch = await batchStatus(shop.deps);
  assert.equal(batch.items[0].status, 'ready', batch.items[0].error);
  assert.equal(batch.items[1].status, 'working');
  // Its mockups were not made again.
  assert.equal(shop.log.filter(line => line.startsWith('mockups one.jpg')).length, 1);
  releaseTwo = true;
  await idle();
  assert.deepEqual((await batchStatus(shop.deps)).items.map(item => item.status), ['ready', 'ready']);
});

test('the page offers Try again on each failed artwork, and Try the failed ones again also while the batch runs', async () => {
  const { readFileSync } = await import('node:fs');
  const client = readFileSync(new URL('../src/daily-batch-client.js', import.meta.url), 'utf8');
  assert.match(client, /if\(item\.status==='failed'&&!job\.stopping\)\{\n   const again=make\('button','','Try again'\)/);
  assert.match(client, /request\('\/api\/batch\/retry',\{n:item\.n\}\)/);
  assert.match(client, /el\('bt-retry'\)\.classList\.toggle\('hidden',!failed\|\|Boolean\(job\.stopping\)\);/);
  const server = readFileSync(new URL('../src/server.mjs', import.meta.url), 'utf8');
  assert.match(server, /if\(action==='\/retry'\)\{\n        await retryItem\(deps,body\.n\);/);
});
