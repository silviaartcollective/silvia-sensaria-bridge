// Batch listings: up to 20 artworks become Etsy drafts in one go. For each one
// (its master already uploaded to R2 staging by the page): it gets its artwork
// ID, the chosen mockup preset's PSDs for its orientation render on the PC while ChatGPT
// writes the SEO, and the draft is created the way the Product Creator does it
// (preset photos, mockups, variants, the orientation's template). The drafts
// then wait for one "Publish all". The job is kept in R2, so the page can be
// closed and a stopped batch resumed: every step is skipped once it is done.

export const MAX_BATCH = 20;
const LANES = 3;                 // artworks worked on at the same time
const MOCKUP_POLL_MS = 5000;
const SETUP_POLL_MS = 3000;
const SETUP_WAIT_MS = 20 * 60 * 1000;

const now = () => new Date().toISOString();
let job = null;                  // the batch, while this server holds it
let control = null;              // { stop, lanes } while items are worked on
let publishing = false;
let saving = Promise.resolve();
let loading = null;              // the one read of the batch from R2
let adding = Promise.resolve();  // artworks are added one after another

export const batchRunning = () => Boolean(control) || publishing;
export function stopBatch() { if (control) control.stop = true; return Boolean(control); }

async function current(deps) {
  if (job) return job;
  if (!loading) loading = Promise.resolve(deps.loadJob()).then(found => { if (!job) job = found || null; return job; })
    .finally(() => { loading = null; });
  return loading;
}
// Saves run one after another, so an older copy never overwrites a newer one.
function save(deps) {
  if (!job) return saving;
  job.updatedAt = now();
  const copy = JSON.parse(JSON.stringify(job));
  saving = saving.catch(() => {}).then(() => deps.saveJob(copy));
  return saving;
}

// The batch as the page shows it; items being worked on with nothing running
// (e.g. after a restart) show as stopped.
export async function batchStatus(deps) {
  const batch = await current(deps);
  if (!batch) return null;
  const view = JSON.parse(JSON.stringify(batch));
  if (!control) for (const item of view.items) if (item.status === 'working') { item.status = 'waiting'; item.step = 'Stopped'; }
  return view;
}

// Uploads finishing together are added one after another, so none is lost.
export function addToBatch(deps, artwork) {
  const added = adding.catch(() => {}).then(() => addNow(deps, artwork));
  adding = added;
  return added;
}
async function addNow(deps, { stageId, filename, contentType, size, previewKey = '', preset = '' }) {
  if (!/^[0-9a-f-]{36}$/i.test(String(stageId || ''))) throw Error('Upload the artwork first.');
  let batch = await current(deps);
  if (!batch || batch.closed) {
    batch = job = { id: deps.newId(), createdAt: now(), updatedAt: now(), items: [], closed: false };
  }
  if (batch.items.length >= MAX_BATCH) throw Error('A batch holds ' + MAX_BATCH + ' artworks. Publish it and start a new one.');
  if (batch.items.some(item => item.stageId === stageId)) return batch;
  batch.items.push({ n: batch.items.length + 1, filename: String(filename || 'artwork').slice(0, 120), stageId,
    contentType: String(contentType || ''), size: Number(size) || 0, previewKey: String(previewKey || ''),
    preset: String(preset || '').slice(0, 120),
    status: 'waiting', step: 'Waiting', artworkId: '', orientation: '', mockupJobId: '', mockups: null,
    seo: null, mockupsAttached: false, listingId: null, publish: true, error: '' });
  await save(deps);
  run(deps);
  return batch;
}

// Starts (or tops up) the lanes that work on waiting items.
function run(deps) {
  if (!job) return;
  if (!control) control = { stop: false, lanes: 0 };
  const lanesWanted = Math.min(LANES, control.lanes + job.items.filter(item => item.status === 'waiting').length);
  while (control.lanes < lanesWanted) {
    control.lanes++;
    void lane(deps, control);
  }
  if (!control.lanes) control = null;
}
async function lane(deps, mine) {
  try {
    while (!mine.stop) {
      const item = job.items.find(entry => entry.status === 'waiting');
      if (!item) break;
      item.status = 'working'; item.error = '';
      await processItem(deps, item, mine);
      await save(deps);
    }
  } finally {
    mine.lanes--;
    if (!mine.lanes && control === mine) { control = null; await save(deps).catch(() => {}); }
  }
}

export async function resumeBatch(deps, { retryFailed = false } = {}) {
  if (!await current(deps)) throw Error('There is no batch to resume.');
  if (control?.stop) throw Error('The batch is still stopping; try again in a moment.');
  for (const item of job.items) {
    if (item.status === 'working' && !control) item.status = 'waiting';
    if (retryFailed && item.status === 'failed') { item.status = 'waiting'; item.error = ''; item.step = 'Waiting'; }
  }
  run(deps);
  return job;
}

async function processItem(deps, item, mine) {
  const step = async text => { item.step = text; await save(deps); };
  try {
    if (!item.artworkId) {
      await step('Saving the artwork');
      Object.assign(item, await deps.reserveArtwork(item));
      await save(deps);
    }
    if (!item.mockupJobId) {
      await step('Starting the mockups');
      const started = await deps.startMockups(item.artworkId, item.orientation, item.preset);
      item.mockupJobId = started.jobId;
      item.mockups = { total: started.total, done: 0, failed: 0 };
      await save(deps);
    }
    // ChatGPT writes the SEO while the PC renders the mockups.
    const seo = item.seo ? Promise.resolve(item.seo) : deps.writeSeo(item);
    seo.catch(() => {});
    let mockups;
    for (;;) {
      mockups = await deps.mockupStatus(item.mockupJobId);
      item.mockups = { total: mockups.total, done: mockups.done, failed: mockups.failed };
      if (mockups.finished) break;
      if (mine.stop) { item.status = 'waiting'; item.step = 'Stopped'; return; }
      await step('Mockups: ' + mockups.done + ' of ' + mockups.total + ' made on the PC');
      await deps.pause(MOCKUP_POLL_MS);
    }
    if (!mockups.completedIds.length) throw Error('No mockup could be made for this artwork on the PC.');
    if (!item.seo) {
      await step('Writing the SEO with ChatGPT');
      item.seo = await seo;
      await save(deps);
    }
    if (!item.mockupsAttached) {
      await deps.attachMockups(item.artworkId, item.mockupJobId, mockups.completedIds);
      item.mockupsAttached = true;
    }
    // A draft whose setup was cut short (a restart) is set up again; Etsy keeps the one draft.
    for (let attempt = 1; ; attempt++) {
      if (!item.listingId || attempt > 1) {
        await step('Creating the Etsy draft');
        item.listingId = await deps.createDraft(item);
        await save(deps);
      }
      await step('Adding photos, video and variants to the draft');
      const setup = await waitForSetup(deps, item, mine);
      if (setup === 'stopped') { item.status = 'waiting'; item.step = 'Stopped'; return; }
      if (setup === 'completed') break;
      if (setup !== 'interrupted' || attempt >= 2) throw Error('The draft setup did not finish: ' + setup);
    }
    item.status = 'ready'; item.step = 'Draft ready';
  } catch (error) {
    item.status = 'failed'; item.step = 'Failed';
    item.error = String(error?.message || error).slice(0, 400);
  }
}
async function waitForSetup(deps, item, mine) {
  const until = Date.now() + SETUP_WAIT_MS;
  for (;;) {
    const setup = await deps.draftSetup(item.artworkId);
    if (setup.status === 'completed') return 'completed';
    if (setup.status === 'failed') return setup.error || 'failed';
    if (setup.status === 'interrupted') return 'interrupted';
    if (mine.stop) return 'stopped';
    if (Date.now() > until) return 'still running after 20 minutes';
    await deps.pause(SETUP_POLL_MS);
  }
}

// Ticks a draft in or out of "Publish all".
export async function setPublish(deps, { n, publish }) {
  const batch = await current(deps);
  const item = batch?.items.find(entry => entry.n === Number(n));
  if (!item) throw Error('That artwork is not in the batch.');
  item.publish = Boolean(publish);
  await save(deps);
  return batch;
}

export async function publishBatch(deps) {
  const batch = await current(deps);
  if (!batch) throw Error('There is no batch to publish.');
  if (publishing) throw Error('Publishing is already running.');
  const items = batch.items.filter(item => item.status === 'ready' && item.publish);
  if (!items.length) throw Error('No ticked draft is ready to publish.');
  publishing = true;
  void (async () => {
    try {
      for (const item of items) {
        item.step = 'Publishing'; await save(deps);
        try { await deps.publish(item.listingId); item.status = 'published'; item.step = 'Published'; }
        catch (error) { item.step = 'Not published'; item.error = String(error?.message || error).slice(0, 400); }
        await save(deps);
      }
    } finally { publishing = false; await save(deps).catch(() => {}); }
  })();
  return batch;
}

// Closes the batch; the next artwork added starts a new one. Drafts not
// published stay on Etsy as drafts.
export async function closeBatch(deps) {
  if (batchRunning()) throw Error('Wait for the batch to finish or stop it first.');
  const batch = await current(deps);
  if (batch) { batch.closed = true; await save(deps); }
  return batch;
}

// For tests: forget the batch held in memory.
export function resetBatchMemory() { job = null; control = null; publishing = false; saving = Promise.resolve(); loading = null; adding = Promise.resolve(); }

// The draft the Product Creator would send for this artwork: the shop's usual
// settings, then the orientation's template (Listings → Templates; 0 means
// "none"), with ChatGPT's SEO (title, description, tags, style, section) on top.
export function batchDraftBody({ artworkId, layout, seo, preset = {}, template = {} }) {
  const pick = field => template[field] === undefined ? preset[field] : template[field] === 0 ? '' : template[field];
  const id = value => (value === '' || value == null || !Number(value) ? null : Number(value));
  const sectionId = seo.sectionId ? Number(seo.sectionId) : id(pick('shop_section_id'));
  return {
    artwork_id: artworkId,
    orientation: layout,
    title: seo.title,
    seo_description: seo.description,
    seo_section_name: seo.sectionId ? seo.sectionName || '' : '',
    seo_section_url: seo.sectionId ? seo.sectionUrl || '' : '',
    homestyle: '',
    listing_style: seo.style || String(pick('listing_style') || ''),
    tags: seo.tags?.length ? seo.tags : (template.tags || []),
    taxonomy_id: 1027,
    shipping_profile_id: id(pick('shipping_profile_id')),
    readiness_state_id: id(pick('readiness_state_id')),
    shop_section_id: sectionId,
    return_policy_id: id(pick('return_policy_id')),
    production_partner_ids: id(pick('production_partner_id')) ? [id(pick('production_partner_id'))] : [],
    who_made: String(pick('who_made') || 'i_did'),
    when_made: String(pick('when_made') || 'made_to_order'),
    is_supply: String(pick('is_supply')) === 'true',
    should_auto_renew: String(pick('should_auto_renew')) !== 'false'
  };
}

// Mockup presets are the folders named "Preset …" in the PC mockup folder, at
// any depth ("Preset 1/Vertical/mockup 1.psd" or "Vertical/Preset 1/…"): a
// preset is every PSD inside its folders, in name order. PSDs outside such a
// folder belong to no preset.
const PRESET_FOLDER = /\bpreset/i;
const naturalOrder = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
export const presetKey = name => String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();
export function mockupPresets(templates) {
  const presets = new Map();
  for (const template of templates) {
    if (template.status && template.status !== 'ready') continue;
    const folder = String(template.localPath || '').split('/').slice(0, -1).find(name => PRESET_FOLDER.test(name));
    if (!folder) continue;
    const key = presetKey(folder);
    if (!presets.has(key)) presets.set(key, { name: folder.trim().replace(/\s+/g, ' '), templates: [] });
    presets.get(key).templates.push(template);
  }
  return [...presets.values()].sort((a, b) => naturalOrder(a.name, b.name))
    .map(preset => ({ ...preset, templates: preset.templates.sort((a, b) => naturalOrder(a.localPath, b.localPath)) }));
}
// A template suits an artwork like in the Product Creator: the same
// orientation, or a square artwork in a template marked square-compatible.
export const templateSuits = (template, layout) => String(template?.orientation || '') === layout ||
  (layout === 'square' && template?.squareCompatible === true);
