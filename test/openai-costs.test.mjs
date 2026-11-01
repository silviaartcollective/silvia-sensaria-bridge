// ChatGPT costs on Fees & Expenses, with in-memory storage and a fake OpenAI.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { estimateOpenAiUsd, recordOpenAiUsage, openAiBilledCosts, openAiUsageForMonth } from '../src/openai-costs.mjs';
import { generateEtsySeo } from '../src/ai-seo.mjs';
import { renderListingFeesPage } from '../src/listing-fees-page.mjs';
import { ADMIN_LINKS } from '../src/admin-sidebar.mjs';

test('cost is estimated from the model\'s price per million tokens; unknown models have none', () => {
  assert.equal(estimateOpenAiUsd('gpt-5-mini', 1_000_000, 1_000_000), 2.25);
  assert.equal(estimateOpenAiUsd('gpt-5-mini-2025-08-07', 2000, 1000), 0.0005 + 0.002);
  assert.equal(estimateOpenAiUsd('gpt-5', 1000, 0), 0.00125);
  assert.equal(estimateOpenAiUsd('some-new-model', 1000, 1000), null);
});

test('each request is added to its month, also when several arrive at once', async () => {
  const store = new Map();
  const deps = { get: async key => { if (!store.has(key)) throw Object.assign(new Error('missing'), { code: 'missing' }); return structuredClone(store.get(key)); },
    put: async (key, value) => { await new Promise(r => setTimeout(r, 1)); store.set(key, structuredClone(value)); } };
  const now = new Date('2026-11-01T15:00:00Z');
  await Promise.all([
    recordOpenAiUsage({ model: 'gpt-5-mini', input_tokens: 4000, output_tokens: 2000 }, { now, ...deps }),
    recordOpenAiUsage({ model: 'gpt-5-mini', input_tokens: 6000, output_tokens: 3000 }, { now, ...deps }),
    recordOpenAiUsage({ model: 'mystery', input_tokens: 10, output_tokens: 10 }, { now, ...deps }),
    recordOpenAiUsage({ model: 'gpt-5-mini', input_tokens: 0, output_tokens: 0 }, { now, ...deps })
  ]);
  const doc = await openAiUsageForMonth('2026-11', deps);
  assert.equal(doc.calls, 3);
  assert.equal(doc.inputTokens, 10010);
  assert.equal(doc.unpricedCalls, 1);
  assert.ok(Math.abs(doc.estimatedUsd - (10000 * 0.25 + 5000 * 2) / 1e6) < 1e-12);
  assert.equal(doc.byModel['gpt-5-mini'].calls, 2);
  assert.equal(doc.byDay['2026-11-01'].calls, 3);
  assert.equal(await openAiUsageForMonth('2026-10', deps), null);
  // A storage failure never throws into the listing that made the request.
  await recordOpenAiUsage({ model: 'gpt-5-mini', input_tokens: 1, output_tokens: 1 }, { now, get: async () => { throw new Error('R2 down'); }, put: async () => {} });
});

test('the SEO request reports the tokens of every response, a retried one too', async () => {
  const seen = [];
  let calls = 0;
  const reply = (body) => ({ ok: true, status: 200, json: async () => body });
  const fetchImpl = async () => {
    calls++;
    const text = calls === 1 ? 'not json' : JSON.stringify({ title: 'Neutral Coastal Landscape Wall Art: Beige Brown Soft Textured Minimalist Style',
      description: 'Warm beige tones. A calm mood.', tags: ['neutral landscape', 'beige coastal art', 'brown wall art', 'moody landscape', 'soft coastal art',
        'muted wall art', 'textured wall art', 'abstract shoreline', 'earth tone decor', 'calm neutral art', 'minimalist art', 'coastal wall decor', 'neutral wall decor'],
      style: 'Minimalist', section: 'None' });
    return reply({ model: 'gpt-5-mini-2025-08-07', usage: { input_tokens: 1000 * calls, output_tokens: 500 }, output: [{ type: 'message', content: [{ type: 'output_text', text }] }] });
  };
  await generateEtsySeo({ image: { base64: 'eA==', contentType: 'image/jpeg' }, apiKey: 'k', fetchImpl,
    settings: { model: 'gpt-5-mini', instructions: 'x' }, onUsage: usage => seen.push(usage) }).catch(() => {});
  assert.deepEqual(seen, [{ model: 'gpt-5-mini-2025-08-07', input_tokens: 1000, output_tokens: 500 },
    { model: 'gpt-5-mini-2025-08-07', input_tokens: 2000, output_tokens: 500 }]);
});

test('OpenAI\'s billed costs are read with an admin key, page after page; none without one', async () => {
  assert.equal(await openAiBilledCosts({ min: 1, max: 2, adminKey: '' }), null);
  const urls = [];
  const pages = [
    { data: [{ results: [{ amount: { value: 0.42, currency: 'usd' }, line_item: 'gpt-5-mini, input' }] }], has_more: true, next_page: 'p2' },
    { data: [{ results: [{ amount: { value: 1.08, currency: 'usd' }, line_item: 'gpt-5-mini, output' }] }], has_more: false }
  ];
  const billed = await openAiBilledCosts({ min: 1761955200, max: 1764547199, adminKey: 'sk-admin-x',
    fetchImpl: async (url, options) => { urls.push(url); assert.equal(options.headers.authorization, 'Bearer sk-admin-x'); return { ok: true, status: 200, json: async () => pages.shift() }; } });
  assert.equal(billed.total, 1.5);
  assert.equal(billed.currency, 'USD');
  assert.match(urls[0], /\/v1\/organization\/costs\?start_time=1761955200&end_time=1764547200/);
  assert.match(urls[1], /page=p2/);
  await assert.rejects(openAiBilledCosts({ min: 1, max: 2, adminKey: 'sk-proj', fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'Insufficient permissions' } }) }) }),
    /HTTP 401\): Insufficient permissions\. OPENAI_ADMIN_KEY must be an admin key/);
});

test('the page is Fees & Expenses, with the ChatGPT section and the month\'s total', () => {
  const page = renderListingFeesPage();
  assert.match(page, /<title>Fees &amp; Expenses<\/title>/);
  for (const id of ['ex-etsy', 'ex-ai', 'ex-total', 'ai-estimated', 'ai-billed', 'ai-models']) assert.ok(page.includes('id="' + id + '"'), id);
  assert.ok(ADMIN_LINKS.some(link => link.href === '/listing-fees' && link.label === 'Fees & Expenses'));
  const client = readFileSync(new URL('../src/listing-fees-client.js', import.meta.url), 'utf8');
  assert.doesNotThrow(() => new vm.Script(client));
  assert.match(client, /\/api\/expenses\/chatgpt\?/);
  const server = readFileSync(new URL('../src/server.mjs', import.meta.url), 'utf8');
  assert.equal((server.match(/generateEtsySeo\(\{ ?onUsage: ?recordOpenAiUsage,/g) || []).length, 4, 'every SEO request records its cost');
});

test('one month picker at the top drives every section, and late answers for an earlier month are dropped', () => {
  const page = renderListingFeesPage();
  const totals = page.indexOf('id="totals"'), picker = page.indexOf('id="lf-month"');
  assert.ok(totals > 0 && picker > totals && picker < page.indexOf('id="fees"'), 'the picker sits in the top card');
  assert.equal((page.match(/id="lf-month"/g) || []).length, 1);
  assert.equal((page.match(/class="muted month-name"|class="month-name"/g) || []).length, 2);
  const client = readFileSync(new URL('../src/listing-fees-client.js', import.meta.url), 'utf8');
  assert.match(client, /addEventListener\('change',\(\)=>\{monthNames\(\);void load\(\);void loadChatGpt\(\);\}\)/);
  assert.match(client, /if\(mine!==asked\)return;/);
  assert.match(client, /if\(mine!==askedEtsy\)return;/);
});
