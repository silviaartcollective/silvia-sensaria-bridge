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
  assert.throws(() => checkRedoInput(good({ preset: '' }), { confirm: CONFIRM }), /preset/);
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

test('the listing editor has a Redo listing tab with the Product Creator steps, wired to the redo routes', () => {
  const page = renderListingsPage();
  for (const id of ['edit-mode', 'redo-panel', 'redo-preset', 'redo-make', 'redo-mockups', 'redo-write', 'redo-title', 'redo-tags',
    'redo-description', 'redo-section', 'redo-template', 'redo-apply', 'redo-keep-photos'])
    assert.ok(page.includes('id="' + id + '"'), id);
  assert.match(page, /data-mode="redo"/);
  assert.match(page, /<script src="\/listing-redo-client.js" defer><\/script>/);
  const client = readFileSync(new URL('../src/listing-redo-client.js', import.meta.url), 'utf8');
  assert.match(client, /const CONFIRM='REDO SILVIA LISTING'/);
  for (const action of ['redo-mockups', 'redo-seo', 'redo-apply']) assert.ok(client.includes("'" + action + "'"), action);
  assert.match(readFileSync(new URL('../src/listings-client.js', import.meta.url), 'utf8'), /window\.listingRedo\?\.open\(id,data\.fields\)/);
  const server = readFileSync(new URL('../src/server.mjs', import.meta.url), 'utf8');
  assert.match(server, /details\|inventory\|options\|add-size\|redo\|redo-mockups\|redo-seo\|redo-apply/);
  assert.match(server, /checkRedoInput\(input,\{confirm:'REDO SILVIA LISTING'\}\)/);
  assert.match(server, /url\.pathname==='\/listing-redo-client\.js'/);
});
