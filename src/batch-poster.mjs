// Batch listings: up to 20 artworks become Etsy drafts in one go. For each one
// (its master already uploaded to R2 staging by the page): the chosen mockup
// preset's PSDs for its shape render on the PC from the staged master while
// ChatGPT writes the SEO; then, as in the Product Creator, it gets its artwork
// ID and R2 folder and the draft is created (preset photos, mockups, variants,
// the orientation's template). The drafts then wait for one "Publish all".
// The job is kept in R2, so the page can be closed and a stopped batch
// resumed: every step is skipped once it is done.

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

// The listing layout from the artwork's pixels (as src/panoramic-layout.mjs:
// 1.85:1 or wider is panoramic).
export function layoutOfPixels(width, height) {
  const w = Number(width), h = Number(height);
  if (!(w > 0 && h > 0)) return '';
  return w === h ? 'square' : h > w ? 'portrait' : w / h >= 1.85 ? 'panoramic' : 'landscape';
}

// Stop: nothing new starts, artworks added meanwhile wait too, and the steps
// under way end at their next check. Resume goes on from there.
export async function stopBatch(deps) {
  const batch = await current(deps);
  if (batch) { batch.paused = true; await save(deps); }
  if (control) control.stop = true;
  return Boolean(batch);
}

async function current(deps) {
  if (job) return job;
  if (!loading) loading = Promise.resolve(deps.loadJob()).then(found => {
    if (!job) {
      job = found || null;
      // Read after a restart: nothing works on its items any more, so they wait
      // (and are picked up again) instead of looking busy for ever.
      for (const item of job?.items || []) if (item.status === 'working') { item.status = 'waiting'; item.step = 'Stopped'; }
    }
    return job;
  }).finally(() => { loading = null; });
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
  view.stopping = Boolean(control?.stop);
  if (!control) for (const item of view.items) if (item.status === 'working') { item.status = 'waiting'; item.step = 'Stopped'; }
  return view;
}

// Uploads finishing together are added one after another, so none is lost.
export function addToBatch(deps, artwork) {
  const added = adding.catch(() => {}).then(() => addNow(deps, artwork));
  adding = added;
  return added;
}
async function addNow(deps, { stageId, filename, contentType, size, previewKey = '', preset = '', width = 0, height = 0 }) {
  if (!/^[0-9a-f-]{36}$/i.test(String(stageId || ''))) throw Error('Upload the artwork first.');
  let batch = await current(deps);
  if (!batch || batch.closed) {
    batch = job = { id: deps.newId(), createdAt: now(), updatedAt: now(), items: [], closed: false };
  }
  if (batch.items.length >= MAX_BATCH) throw Error('A batch holds ' + MAX_BATCH + ' artworks. Publish it and start a new one.');
  if (batch.items.some(item => item.stageId === stageId)) return batch;
  batch.items.push({ n: batch.items.length + 1, filename: String(filename || 'artwork').slice(0, 120), stageId,
    contentType: String(contentType || ''), size: Number(size) || 0, previewKey: String(previewKey || ''),
    preset: String(preset || '').slice(0, 120), width: Number(width) || 0, height: Number(height) || 0,
    status: 'waiting', step: 'Waiting', artworkId: '', orientation: '', mockupJobId: '', mockups: null,
    seo: null, mockupsAttached: false, listingId: null, publish: true, error: '' });
  await save(deps);
  run(deps);
  return batch;
}

// Starts (or tops up) the lanes that work on waiting items.
function run(deps) {
  if (!job || job.paused) return;
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

// After a restart (a deploy, or Render moving the service) a batch that was
// not stopped goes on by itself.
export async function resumeAfterRestart(deps) {
  const batch = await current(deps);
  if (batch && !batch.paused && !batch.closed && batch.items.some(item => item.status === 'waiting')) run(deps);
  return Boolean(control);
}

// One failed artwork is tried again from the step it reached, also while the
// others are being worked on (it joins them).
export async function retryItem(deps, n) {
  if (!await current(deps)) throw Error('There is no batch.');
  if (control?.stop) throw Error('The batch is still stopping; try again in a moment.');
  const item = job.items.find(entry => entry.n === Number(n));
  if (item?.status !== 'failed') throw Error('That artwork has not failed: refresh the page.');
  item.status = 'waiting'; item.error = ''; item.step = 'Waiting';
  job.paused = false;
  await save(deps);
  run(deps);
  return job;
}

export async function resumeBatch(deps, { retryFailed = false } = {}) {
  if (!await current(deps)) throw Error('There is no batch to resume.');
  if (control?.stop) throw Error('The batch is still stopping; try again in a moment.');
  job.paused = false;
  for (const item of job.items) {
    if (item.status === 'working' && !control) item.status = 'waiting';
    if (retryFailed && item.status === 'failed') { item.status = 'waiting'; item.error = ''; item.step = 'Waiting'; }
  }
  run(deps);
  return job;
}

async function processItem(deps, item, mine) {
  const step = async text => { item.step = text; await save(deps); };
  const stopped = () => { if (!mine.stop) return false; item.status = 'waiting'; item.step = 'Stopped'; return true; };
  const saveArtwork = async () => {
    await step('Saving the artwork');
    Object.assign(item, await deps.reserveArtwork(item));
    await save(deps);
  };
  try {
    // The shape comes from the page; without it (e.g. a TIFF the browser cannot
    // read) the artwork is saved first, which tells it.
    if (!item.orientation) {
      item.orientation = layoutOfPixels(item.width, item.height);
      if (!item.orientation) await saveArtwork();
    }
    if (stopped()) return;
    if (!item.mockupJobId) {
      await step('Starting the mockups');
      const started = await deps.startMockups(item);
      item.mockupJobId = started.jobId;
      item.mockupsFromStaging = !item.artworkId;
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
      if (stopped()) return;
      // What the PC is doing, so a slow step (a large master downloading) or an offline worker shows.
      await step('Mockups: ' + mockups.done + ' of ' + mockups.total + ' made on the PC' + (mockups.note ? ' · ' + mockups.note : ''));
      await deps.pause(MOCKUP_POLL_MS);
    }
    if (!mockups.completedIds.length) throw Error('No mockup could be made for this artwork on the PC.');
    if (!item.seo) {
      await step('Writing the SEO with ChatGPT');
      item.seo = await seo;
      await save(deps);
    }
    if (stopped()) return;
    // Only now, as in the Product Creator, the artwork gets its ID and R2 folder.
    if (!item.artworkId) await saveArtwork();
    if (item.mockupsFromStaging && !item.mockupsLinked) {
      await deps.linkMockups(item);
      item.mockupsLinked = true;
    }
    if (!item.mockupsAttached) {
      await deps.attachMockups(item.artworkId, item.mockupJobId, mockups.completedIds);
      item.mockupsAttached = true;
    }
    // The photo order saved for the preset and this shape, used by the draft.
    if (!item.orderSaved && deps.savePhotoOrder) {
      await deps.savePhotoOrder(item, mockups.completedIds);
      item.orderSaved = true;
    }
    if (stopped()) return;
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

// Start over: the batch is stopped and emptied, and artworks are chosen again.
// Drafts already created stay on Etsy as drafts; masters still waiting in
// temporary storage are removed.
export async function startOver(deps, { waitMs = 90000 } = {}) {
  if (publishing) throw Error('Wait for publishing to finish first.');
  const batch = await current(deps);
  if (control) control.stop = true;
  const until = Date.now() + waitMs;
  while (control) {
    if (Date.now() > until) throw Error('The batch is still finishing a step; try again in a moment.');
    await deps.pause(200);
  }
  for (const item of batch?.items || []) if (!item.artworkId) await Promise.resolve(deps.discardUpload?.(item)).catch(() => {});
  job = null;
  saving = saving.catch(() => {}).then(() => deps.saveJob(null));
  await saving;
  return null;
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

// The Etsy photo order chosen for a preset and shape (Daily Listings → Arrange
// photos): tile ids as in the Product Creator's organizer
// (src/etsy-photo-organizer.mjs). An artwork's own order keeps those of its
// photos that it has, in that order; any others follow.
export const photoOrderKey = (preset, layout) => presetKey(preset) + '|' + String(layout || '');
export function orderForArtwork(saved = [], { templateIds = [], presetKeys = [] } = {}) {
  const have = new Set([...templateIds.map(id => 'generated:' + id), ...presetKeys.map(key => 'key:' + key)]);
  const order = [], seen = new Set();
  for (const id of [...saved, ...have]) if (have.has(id) && !seen.has(id)) { seen.add(id); order.push(id); }
  return order;
}
