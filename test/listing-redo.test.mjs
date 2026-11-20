import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkRedoInput, createRedoRunner } from '../src/listing-redo.mjs';
import { renderListingsPage } from '../src/listings-page.mjs';

const CONFIRM = 'REDO SILVIA LISTING';
const tags = ['abstract art', 'neutral print', 'living room art'];
const good = (extra = {}) => ({ confirm: CONFIRM, mockupJobId: 'job_1', templateIds: ['a', 'b', 'a'], preset: 'Living rooms',
  seo: { title: '  Neutral   abstract print ', tags, description: 'A calm abstract.', sectionId: '12', style: 'Minimalist' }, ...extra });

test('a redo needs the confirmation, chosen mockups (or kept photos) and complete SEO', () => {
  const plan = checkRedoInput(good(), { confirm: CONFIRM });
  assert.deepEqual(plan.photos, { mockupJobId: 'job_1', templateIds: ['a', 'b'], preset: 'Living rooms' });
  assert.equal(plan.seo.title, 'Neutral abstract print');
  assert.equal(plan.seo.sectionId, '12');
  assert.equal(plan.template, true);
  assert.equal(checkRedoInput(good({ photos: false, mockupJobId: '', template: false }), { confirm: CONFIRM }).photos, null);
  assert.equal(checkRedoInput(good({ template: false }), { confirm: CONFIRM }).template, false);
  assert.throws(() => checkRedoInput(good({ confirm: 'yes' }), { confirm: CONFIRM }), /confirmation/);
  assert.throws(() => checkRedoInput(good({ mockupJobId: '' }), { confirm: CONFIRM }), /mockups/);
  assert.throws(() => checkRedoInput(good({ templateIds: [] }), { confirm: CONFIRM }), /at least one mockup/);
  assert.throws(() => checkRedoInput(good({ templateIds: Array.from({ length: 21 }, (_, i) => 't' + i) }), { confirm: CONFIRM }), /up to 20/);
  assert.equal(checkRedoInput(good({ preset: '' }), { confirm: CONFIRM }).photos.preset, '');
  assert.throws(() => checkRedoInput(good({ seo: { ...good().seo, title: 'x'.repeat(141) } }), { confirm: CONFIRM }), /title/);
  assert.throws(() => checkRedoInput(good({ seo: { ...good().seo, tags: [] } }), { confirm: CONFIRM }), /tag/);
  assert.throws(() => checkRedoInput(good({ seo: { ...good().seo, tags: ['a very long tag over twenty'] } }), { confirm: CONFIRM }), /20 characters/);
  assert.throws(() => checkRedoInput(good({ seo: { ...good().seo, description: ' ' } }), { confirm: CONFIRM }), /description/);
  assert.throws(() => checkRedoInput(good({ seo: { ...good().seo, sectionId: '-3' } }), { confirm: CONFIRM }), /section/);
});

test('the redo puts the photos on first, then the details, then records the refresh', async () => {
  const calls = [];
  const runner = createRedoRunner({
    replacePhotos: async args => { calls.push(['photos', args]); return { photos: 9 }; },
    updateDetails: async args => { calls.push(['details', args]); },
    markRefreshed: async (id, info) => { calls.push(['mark', id, info]); }
  });
  const plan = checkRedoInput(good(), { confirm: CONFIRM });
  const { run, done } = runner.start(55, { artworkId: 'SAC0012', orientation: 'portrait', plan });
  assert.equal(run.state, 'running');
  assert.equal(run.step, 'photos');
  assert.throws(() => runner.start(55, { artworkId: 'SAC0012', orientation: 'portrait', plan }), /already being redone/);
  await done;
  assert.deepEqual(calls.map(c => c[0]), ['photos', 'details', 'mark']);
  assert.deepEqual(calls[0][1], { listingId: 55, artworkId: 'SAC0012', orientation: 'portrait', mockupJobId: 'job_1', templateIds: ['a', 'b'], preset: 'Living rooms' });
  assert.equal(calls[1][1].template, true);
  assert.equal(calls[1][1].seo.title, 'Neutral abstract print');
  assert.equal(runner.status(55).state, 'done');
  assert.equal(runner.status(55).photos, 9);
  assert.equal(runner.status(1), null);
});

test('a failed redo says what failed, and that photos already went on', async () => {
  const runner = createRedoRunner({
    replacePhotos: async () => ({ photos: 4 }),
    updateDetails: async () => { throw Error('Etsy said no'); },
    markRefreshed: async () => { throw Error('not reached'); }
  });
  const { done } = runner.start(7, { artworkId: 'SAC0001', orientation: 'square', plan: checkRedoInput(good(), { confirm: CONFIRM }) });
  await done;
  const status = runner.status(7);
  assert.equal(status.state, 'failed');
  assert.match(status.error, /Etsy said no.*new photos are already on the listing/);
  // Kept photos: no photo step at all.
  const calls = [];
  const keep = createRedoRunner({ replacePhotos: async () => calls.push('photos'), updateDetails: async () => calls.push('details'), markRefreshed: async () => calls.push('mark') });
  await keep.start(8, { artworkId: 'SAC0001', orientation: 'square', plan: checkRedoInput(good({ photos: false }), { confirm: CONFIRM }) }).done;
  assert.deepEqual(calls, ['details', 'mark']);
  assert.throws(() => keep.start(9, { artworkId: '', orientation: 'square', plan: {} }), /not in the app/);
});

test('a redo can carry the Product Creator settings, checked', () => {
  const plan = checkRedoInput(good({ settings: { shipping_profile_id: '12', readiness_state_id: 5, return_policy_id: '', production_partner_id: '',
    who_made: 'i_did', when_made: 'made_to_order', is_supply: false, should_auto_renew: true, listing_style: 'Minimalist' } }), { confirm: CONFIRM });
  assert.deepEqual(plan.settings, { shipping_profile_id: 12, readiness_state_id: 5, production_partner_id: 0, who_made: 'i_did',
    when_made: 'made_to_order', is_supply: false, should_auto_renew: true, listing_style: 'Minimalist' });
  assert.equal(checkRedoInput(good(), { confirm: CONFIRM }).settings, null);
  assert.throws(() => checkRedoInput(good({ settings: { who_made: 'robot' } }), { confirm: CONFIRM }), /who made/);
  assert.throws(() => checkRedoInput(good({ settings: { shipping_profile_id: -1 } }), { confirm: CONFIRM }), /shipping profile/);
});

test('Redo listing is its own page, laid out like the Product Creator, with a back button', async () => {
  const { renderListingRedoPage } = await import('../src/listing-redo-page.mjs');
  const page = renderListingRedoPage();
  for (const id of ['redo-back', 'artwork_id', 'redo-preset', 'redo-make', 'redo-keep-photos', 'seo_generator_output', 'apply-seo-btn', 'ai-seo-btn',
    'title', 'seo_description', 'listing_style', 'tags', 'redo-template', 'shipping_profile_id', 'readiness_state_id', 'shop_section_id',
    'return_policy_id', 'production_partner_id', 'who_made', 'when_made', 'is_supply', 'should_auto_renew', 'mg-preview-list', 'redo-update'])
    assert.ok(page.includes('id="' + id + '"'), id);
  // The Product Creator's own styles and SEO paste reader.
  assert.match(page, /\.creator-editor-scroll/);
  assert.match(page, /window\.parseSeoPaste=/);
  assert.match(page, /<script src="\/listing-redo-client.js" defer><\/script>/);
  const client = readFileSync(new URL('../src/listing-redo-client.js', import.meta.url), 'utf8');
  assert.match(client, /const CONFIRM='REDO SILVIA LISTING'/);
  assert.match(client, /location\.href='\/listings'\+\(listingId\?'\?listing='\+listingId:''\)/);
  for (const path of ["'redo-mockups'", "'redo-apply'", "'redo?job='", "'/api/ai-seo/generate'", "'/etsy/listing-options'"]) assert.ok(client.includes(path), path);
  // The editor opens it, and opens the listing again on the way back.
  assert.match(renderListingsPage(), /id=\"redo-listing\"|id="redo-listing"/);
  const listings = readFileSync(new URL('../src/listings-client.js', import.meta.url), 'utf8');
  assert.match(listings, /el\('redo-listing'\)\.href='\/listings\/redo\?listing='/);
  assert.match(listings, /chooseListing\(reopen,''\)/);
  const server = readFileSync(new URL('../src/server.mjs', import.meta.url), 'utf8');
  assert.match(server, /url\.pathname==='\/listings\/redo'/);
  assert.match(server, /details\|inventory\|options\|add-size\|redo\|redo-mockups\|redo-apply/);
  assert.match(server, /checkRedoInput\(input,\{confirm:'REDO SILVIA LISTING'\}\)/);
  assert.match(server, /const art=await redoArtwork\(id,fresh\)/);
});

test('a new master artwork can be uploaded on the Redo listing page, through the Production artwork steps', async () => {
  const { renderListingRedoPage } = await import('../src/listing-redo-page.mjs');
  const page = renderListingRedoPage();
  for (const id of ['master_file', 'redo-replace', 'redo-replace-status', 'redo-replace-progress']) assert.ok(page.includes('id="' + id + '"'), id);
  const client = readFileSync(new URL('../src/listing-redo-client.js', import.meta.url), 'utf8');
  for (const step of ['/api/listing-converter/reconvert/reserve', '/api/listing-converter/reconvert/crop',
    '/api/listing-converter/reconvert/statuses?listingIds=', '/api/listing-converter/reconvert/activate'])
    assert.ok(client.includes("'" + step + "'"), step);
  assert.match(client, /confirm:'REPLACE SILVIA ARTWORK'/);
  // Mockups of the old artwork are dropped once it is replaced; nothing goes to Etsy meanwhile.
  assert.match(client, /jobId='';finished=false;mockups\.clear\(\);order\.length=0;/);
  assert.match(client, /for\(const id of \['redo-replace','master_file','redo-make','redo-update'\]\)/);
});

test('mockups tagged vertical or horizontal suit portrait or landscape artwork, as in the mockup library', async () => {
  const { templateSuits } = await import('../src/batch-poster.mjs');
  assert.equal(templateSuits({ orientation: 'portrait' }, 'portrait'), true);
  assert.equal(templateSuits({ orientation: 'Vertical' }, 'portrait'), true);
  assert.equal(templateSuits({ orientation: 'horizontal' }, 'landscape'), true);
  assert.equal(templateSuits({ orientation: 'panorama' }, 'panoramic'), true);
  assert.equal(templateSuits({ orientation: 'landscape' }, 'portrait'), false);
  assert.equal(templateSuits({ orientation: 'unclassified' }, 'portrait'), false);
  assert.equal(templateSuits({ orientation: 'portrait', squareCompatible: true }, 'square'), true);
  const server = readFileSync(new URL('../src/server.mjs', import.meta.url), 'utf8');
  assert.match(server, /const ids=presetMockupIds\(p,art\.layout,\{media,orders\}\);return \{name:p\.name,count:ids\.length,templateIds:ids\}/);
  assert.match(server, /const ids=presetMockupIds\(preset,layout,\{media,orders\}\);/);
});

test('the Redo page picks mockups from the saved PSD library, like the Product Creator', async () => {
  const { renderListingRedoPage } = await import('../src/listing-redo-page.mjs');
  const page = renderListingRedoPage();
  for (const id of ['redo-library', 'redo-lib-first', 'redo-lib-none', 'redo-lib-count', 'redo-preset', 'redo-make']) assert.ok(page.includes('id="' + id + '"'), id);
  const client = readFileSync(new URL('../src/listing-redo-client.js', import.meta.url), 'utf8');
  assert.match(client, /request\(base\+'redo-mockups',\{templateIds:ids,preset:name\}\)/);
  const server = readFileSync(new URL('../src/server.mjs', import.meta.url), 'utf8');
  // Only ready templates of the artwork's shape, checked again when the mockups start.
  assert.match(server, /templates\.filter\(t=>t\.status==='ready'&&templateMatchesArtwork\(t,shape\)\)/);
  assert.match(server, /const odd=ids\.find\(id=>!usable\.has\(id\)\);/);
  assert.match(server, /mockupJobFromArtwork\(\{artworkId:art\.artworkId,templateIds:ids\}\)/);
});
