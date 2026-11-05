// ChatGPT costs for Fees & Expenses. Every ChatGPT request this app makes (the
// listing SEO) records its tokens by month in R2 (expenses/openai/<YYYY-MM>.json),
// with a cost estimated from the model's price per million tokens. With an
// OpenAI admin key (OPENAI_ADMIN_KEY in Render), the page also shows what
// OpenAI actually billed the organization for the month.
import { getJsonObject, putJsonObject, isMissingR2Object } from './r2.mjs';

// US$ per million tokens: [input, output]. Check https://openai.com/api/pricing
// when OpenAI changes them; a model not listed shows tokens without a cost.
export const OPENAI_PRICES_PER_MILLION = Object.freeze({
  'gpt-5': [1.25, 10], 'gpt-5-mini': [0.25, 2], 'gpt-5-nano': [0.05, 0.4],
  'gpt-4.1': [2, 8], 'gpt-4.1-mini': [0.4, 1.6], 'gpt-4.1-nano': [0.1, 0.4],
  'gpt-4o': [2.5, 10], 'gpt-4o-mini': [0.15, 0.6]
});
const priceOf = model => {
  const name = String(model || '').toLowerCase();
  // Dated snapshots ("gpt-5-mini-2025-08-07") use their model's price.
  const key = Object.keys(OPENAI_PRICES_PER_MILLION).sort((a, b) => b.length - a.length)
    .find(k => name === k || name.startsWith(k + '-2'));
  return key ? OPENAI_PRICES_PER_MILLION[key] : null;
};
export function estimateOpenAiUsd(model, inputTokens, outputTokens) {
  const price = priceOf(model);
  if (!price) return null;
  return (Number(inputTokens) || 0) / 1e6 * price[0] + (Number(outputTokens) || 0) / 1e6 * price[1];
}

const monthKey = month => 'expenses/openai/' + month + '.json';
const isMonth = value => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value || ''));
let writing = Promise.resolve();

// One ChatGPT response: { model, input_tokens, output_tokens }. Never throws:
// a cost that cannot be recorded must not stop a listing.
export function recordOpenAiUsage(usage, { now = new Date(), get = getJsonObject, put = putJsonObject } = {}) {
  const input = Number(usage?.input_tokens) || 0, output = Number(usage?.output_tokens) || 0;
  if (!input && !output) return Promise.resolve();
  const model = String(usage?.model || 'unknown').slice(0, 80);
  const day = now.toISOString().slice(0, 10), month = day.slice(0, 7);
  const usd = estimateOpenAiUsd(model, input, output);
  // One write at a time, so simultaneous listings do not overwrite each other.
  writing = writing.then(async () => {
    let doc;
    try { doc = await get(monthKey(month)); }
    catch (error) { if (!isMissingR2Object(error) && error?.code !== 'missing') throw error; doc = null; }
    doc ||= { month, calls: 0, inputTokens: 0, outputTokens: 0, estimatedUsd: 0, unpricedCalls: 0, byModel: {}, byDay: {} };
    doc.calls++; doc.inputTokens += input; doc.outputTokens += output;
    if (usd == null) doc.unpricedCalls++; else doc.estimatedUsd += usd;
    const m = doc.byModel[model] ||= { calls: 0, inputTokens: 0, outputTokens: 0, estimatedUsd: 0 };
    m.calls++; m.inputTokens += input; m.outputTokens += output; m.estimatedUsd += usd || 0;
    const d = doc.byDay[day] ||= { calls: 0, estimatedUsd: 0 };
    d.calls++; d.estimatedUsd += usd || 0;
    doc.updatedAt = now.toISOString();
    await put(monthKey(month), doc);
  }).catch(error => console.warn('[openai costs] not recorded: ' + String(error?.message || error)));
  return writing;
}

export async function openAiUsageForMonth(month, { get = getJsonObject } = {}) {
  if (!isMonth(month)) throw new Error('Choose a month.');
  try { return await get(monthKey(month)); }
  catch (error) { if (isMissingR2Object(error) || error?.code === 'missing') return null; throw error; }
}

// What OpenAI billed the organization between two times (seconds), from its
// Costs API, which needs an admin key; null without one.
export async function openAiBilledCosts({ min, max, adminKey = process.env.OPENAI_ADMIN_KEY, fetchImpl = fetch } = {}) {
  const key = String(adminKey || '').trim();
  if (!key) return null;
  let total = 0, currency = 'usd', page = '';
  const byLineItem = {};
  for (let i = 0; i < 10; i++) {
    const query = new URLSearchParams({ start_time: String(min), end_time: String(max + 1), bucket_width: '1d', limit: '31', group_by: 'line_item' });
    if (page) query.set('page', page);
    const response = await fetchImpl('https://api.openai.com/v1/organization/costs?' + query, {
      headers: { authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(20000) });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error('OpenAI costs could not be read (HTTP ' + response.status + ')' +
      (data?.error?.message ? ': ' + String(data.error.message).slice(0, 200) : '') + '. OPENAI_ADMIN_KEY must be an admin key.');
    for (const bucket of data?.data || []) for (const result of bucket.results || []) {
      const value = Number(result?.amount?.value) || 0;
      total += value; currency = String(result?.amount?.currency || currency);
      const item = String(result?.line_item || 'other');
      byLineItem[item] = (byLineItem[item] || 0) + value;
    }
    if (!data?.has_more || !data?.next_page) break;
    page = data.next_page;
  }
  return { total, currency: currency.toUpperCase(), byLineItem };
}
