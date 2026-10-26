// ChatGPT writes a listing's SEO from the artwork: title, short description,
// 13 tags, Etsy Style and shop section. The instructions and the model are
// edited in the app (stored in R2); the key is OPENAI_API_KEY in Render.
import sharp from 'sharp';
import { getJsonObject, putJsonObject } from './r2.mjs';
import { ETSY_WALL_ART_STYLES, canonicalWallArtStyle } from './etsy-style.mjs';

export const AI_SEO_SETTINGS_KEY = 'settings/ai-seo.json';
export const DEFAULT_AI_SEO_MODEL = 'gpt-5-mini';
const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const NO_SECTION = 'None';

export const DEFAULT_AI_SEO_INSTRUCTIONS = `You write Etsy SEO for wall art prints sold as posters, canvas and framed canvas.
Look closely at the artwork: its subject, its exact colours, its texture and brushwork, its mood and its style.

Title: 60 to 100 characters, in exactly this form:
<Main subject phrase> Wall Art: <Colour> <Colour> <Texture or feel words> <Style> Style
- The main subject phrase is what a buyer types into Etsy search, for example "Neutral Coastal Landscape", "Sage Green Abstract", "Moody Botanical".
- After the colon: the two main colours as plain colour words (Beige, Brown, Sage, Navy, Ochre…), then one to three words for the texture or feel (Soft Textured, Layered, Distressed, Minimal…), then the style word and "Style".
- Title Case. One colon only; no other punctuation, no "|", no commas. No repeated words, no words in all capitals.

Description: exactly 2 sentences for the "About this artwork" part of the listing.
- Sentence 1 names the real colours with nuance (warm beige, soft taupe, muted grey, deep earthy brown…) and describes the composition, brushwork and texture.
- Sentence 2 says the mood it creates (calm, grounded, contemplative…).
- No sizes, prices, frames, shipping, rooms or sales phrases ("perfect for…").

Tags: exactly 13, all lowercase, 2 or 3 words each, at most 20 characters each including spaces.
- Mix: the subject (neutral landscape, abstract shoreline), colour with subject (beige coastal art, brown wall art), mood (moody landscape, calm neutral art), texture (textured wall art), style (minimalist art) and decor phrases (coastal wall decor, earth tone decor).
- No repeats, no single words, no tag that copies the title.

Style: the one Etsy style from the list that fits best.

Shop section: the one shop section from the list where this artwork belongs, by its colours and subject. Use "None" only if none fits.

An example of exactly the result wanted, for a neutral coastal landscape:
Title: Neutral Coastal Landscape Wall Art: Beige Brown Soft Textured Minimalist Style
Description: Warm beige, soft taupe, muted grey, and deep earthy brown tones blend across a quiet coastal landscape with layered horizontal brushwork and subtle distressed texture. The softened horizon, gentle tonal transitions, and atmospheric composition create a calm, grounded, and contemplative mood.
Tags: neutral landscape, beige coastal art, brown wall art, moody landscape, soft coastal art, muted wall art, textured wall art, abstract shoreline, earth tone decor, calm neutral art, minimalist art, coastal wall decor, neutral wall decor
Style: Minimalist
Shop section: Neutral & Muted Tone Art`;

const clean = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export async function loadAiSeoSettings({ get = getJsonObject } = {}) {
  let stored = null;
  try { stored = await get(AI_SEO_SETTINGS_KEY); } catch {}
  const instructions = String(stored?.instructions || '').trim();
  return {
    instructions: instructions || DEFAULT_AI_SEO_INSTRUCTIONS,
    model: clean(stored?.model, 80) || DEFAULT_AI_SEO_MODEL,
    custom: Boolean(instructions),
    updatedAt: stored?.updatedAt || null
  };
}

export async function saveAiSeoSettings({ instructions, model } = {}, { put = putJsonObject } = {}) {
  const text = String(instructions ?? '').trim();
  if (text.length > 20000) throw new Error('The instructions are too long (20,000 characters at most).');
  const name = clean(model, 80);
  if (name && !/^[a-z0-9][a-z0-9._:-]*$/i.test(name)) throw new Error('That is not a valid OpenAI model name.');
  // Saving the built-in text keeps following the built-in text when it improves.
  const record = { instructions: text === DEFAULT_AI_SEO_INSTRUCTIONS ? '' : text,
    model: name === DEFAULT_AI_SEO_MODEL ? '' : name, updatedAt: new Date().toISOString() };
  await put(AI_SEO_SETTINGS_KEY, record);
  return loadAiSeoSettings({ get: async () => record });
}

export const aiSeoConfigured = (env = process.env) => Boolean(String(env.OPENAI_API_KEY || '').trim());

// Etsy titles: up to 140 characters; %, : and & at most once each.
export function cleanEtsyTitle(value) {
  let title = clean(value, 400).replace(/[^\p{L}\p{N}\p{P}\p{Zs}\p{Sm}™©®]/gu, '');
  for (const [char, spare] of [[':', ' -'], ['&', ' and'], ['%', ' percent']]) {
    let seen = false;
    title = title.replace(new RegExp(char, 'g'), () => (seen ? spare : ((seen = true), char)));
  }
  title = title.replace(/\s+/g, ' ').trim();
  if (title.length > 140) title = title.slice(0, 140).replace(/[\s,|–—-]+\S*$/u, '').trim();
  return title;
}

// Etsy tags: letters, numbers, spaces and - ' ™ © ®; 20 characters; 13 at most.
export function cleanEtsyTags(values) {
  const seen = new Set(), tags = [];
  for (const value of Array.isArray(values) ? values : []) {
    const tag = String(value ?? '').replace(/^#/, '').replace(/[^\p{L}\p{N} '’™©®-]/gu, ' ')
      .replace(/\s+/g, ' ').trim();
    const id = tag.toLocaleLowerCase('en');
    if (!tag || tag.length > 20 || seen.has(id)) continue;
    seen.add(id); tags.push(tag);
    if (tags.length === 13) break;
  }
  return tags;
}

export const sectionUrl = (shopName, sectionId) =>
  'https://www.etsy.com/shop/' + encodeURIComponent(String(shopName || '')) + '?section_id=' + encodeURIComponent(String(sectionId));

// The reply checked and cleaned the way Etsy needs it; problems are what
// cleaning could not fix.
export function checkAiSeo(reply, { sections = [], shopName = '' } = {}) {
  const title = cleanEtsyTitle(reply?.title);
  const description = String(reply?.description ?? '').trim().slice(0, 4000);
  const tags = cleanEtsyTags(reply?.tags);
  const style = canonicalWallArtStyle(reply?.style) || '';
  const name = clean(reply?.shop_section, 120).toLocaleLowerCase('en');
  const section = name && name !== NO_SECTION.toLocaleLowerCase('en')
    ? sections.find(item => clean(item.title, 120).toLocaleLowerCase('en') === name) : null;
  const problems = [];
  if (!title) problems.push('no title');
  if (!description) problems.push('no description');
  if (tags.length < 13) problems.push('only ' + tags.length + ' usable tags (each must be at most 20 characters, no repeats)');
  if (!style) problems.push('no Etsy style from the list');
  return {
    seo: {
      title, description, tags, style,
      sectionId: section ? String(section.shop_section_id) : '',
      sectionName: section ? clean(section.title, 120) : '',
      sectionUrl: section && shopName ? sectionUrl(shopName, section.shop_section_id) : ''
    },
    problems
  };
}

// The same layout the SEO paste box reads, so ChatGPT's answer can be shown
// and applied like a pasted one.
export function seoPasteText(seo) {
  return ['SEO Title', seo.title, '', 'Short SEO Description', seo.description, '',
    'Shop Section', seo.sectionName || '', seo.sectionUrl || '', '',
    'Style', seo.style || '', '', 'SEO Tags (13)', (seo.tags || []).join(', ')]
    .join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// A small JPEG of the artwork for ChatGPT (1024 px is plenty to read it).
export async function seoImage(buffer) {
  const image = await sharp(buffer, { limitInputPixels: false, failOn: 'none' })
    .rotate().resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' }).jpeg({ quality: 82 }).toBuffer();
  return { base64: image.toString('base64'), contentType: 'image/jpeg' };
}

function seoSchema(sectionNames) {
  return {
    type: 'object', additionalProperties: false,
    required: ['title', 'description', 'tags', 'style', 'shop_section'],
    properties: {
      title: { type: 'string' },
      description: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } },
      style: { type: 'string', enum: [...ETSY_WALL_ART_STYLES] },
      shop_section: { type: 'string', enum: [...new Set([...sectionNames, NO_SECTION])] }
    }
  };
}

function openAiError(status, data) {
  const error = data?.error || {};
  const text = String(error.message || '').slice(0, 300);
  // OpenAI's own words say which (wrong key, deleted key, missing permission); it masks the key.
  if (status === 401 || status === 403) return 'The OpenAI API key in Render was not accepted. Check OPENAI_API_KEY.' +
    (text ? ' OpenAI says: ' + text : '');
  if (error.code === 'insufficient_quota') return 'Your OpenAI account has no API credit left. Add credit at platform.openai.com → Billing.';
  if (status === 429) return 'ChatGPT is busy or the account limit was reached; try again in a minute. (' + text + ')';
  if (error.code === 'model_not_found' || /model/i.test(error.param || ''))
    return 'OpenAI does not offer the model set in ChatGPT SEO settings to this account: ' + text;
  return 'ChatGPT could not write the SEO (HTTP ' + status + '): ' + (text || 'no details');
}

function replyText(data) {
  if (data?.status === 'incomplete')
    throw new Error('ChatGPT stopped before finishing (' + (data.incomplete_details?.reason || 'incomplete') + ').');
  for (const item of data?.output || []) {
    if (item?.type !== 'message') continue;
    for (const part of item.content || []) {
      if (part?.type === 'refusal') throw new Error('ChatGPT declined to describe this artwork: ' + String(part.refusal || '').slice(0, 200));
      if (part?.type === 'output_text' && part.text) return part.text;
    }
  }
  if (typeof data?.output_text === 'string' && data.output_text) return data.output_text;
  throw new Error('ChatGPT returned no SEO.');
}

// image: { base64, contentType }; previous: the listing's current SEO when it
// is being renewed, so the new SEO is different.
export async function generateEtsySeo({
  image, orientation = '', sections = [], shopName = '', previous = null,
  settings = null, apiKey = process.env.OPENAI_API_KEY, fetchImpl = fetch, timeoutMs = 120000
} = {}) {
  if (!String(apiKey || '').trim()) throw new Error('ChatGPT is not connected: add OPENAI_API_KEY in Render.');
  if (!image?.base64) throw new Error('An artwork image is needed to write the SEO.');
  const options = settings || await loadAiSeoSettings();
  const names = sections.map(item => clean(item.title, 120)).filter(Boolean);
  const lines = [
    orientation ? 'Artwork orientation: ' + orientation + '.' : '',
    'Etsy styles (choose one): ' + ETSY_WALL_ART_STYLES.join('; ') + '.',
    'Shop sections (choose one): ' + (names.length ? names.join('; ') : 'none') + '.'
  ];
  if (previous?.title) lines.push('',
    'This listing is being renewed as a new listing. Write new SEO that is clearly different from its current SEO (a new title and mostly new tags), still true to the artwork.',
    'Current title: ' + clean(previous.title, 200),
    'Current tags: ' + (previous.tags || []).join(', '));
  const request = {
    model: options.model,
    instructions: options.instructions,
    input: [{ role: 'user', content: [
      { type: 'input_text', text: lines.filter(line => line !== '').join('\n') },
      { type: 'input_image', image_url: 'data:' + (image.contentType || 'image/jpeg') + ';base64,' + image.base64 }
    ] }],
    text: { format: { type: 'json_schema', name: 'etsy_listing_seo', strict: true, schema: seoSchema(names) } },
    max_output_tokens: 6000
  };
  // Reasoning models think a little: enough to follow the title pattern closely.
  if (/^(gpt-5|o\d)/i.test(options.model)) request.reasoning = { effort: 'medium' };

  let problems = [], usage = { input_tokens: 0, output_tokens: 0 };
  for (let attempt = 1; attempt <= 2; attempt++) {
    const response = await fetchImpl(OPENAI_RESPONSES_URL, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + String(apiKey).trim(), 'content-type': 'application/json' },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(timeoutMs)
    });
    let data = null;
    try { data = await response.json(); } catch {}
    if (!response.ok) throw new Error(openAiError(response.status, data));
    usage.input_tokens += Number(data?.usage?.input_tokens || 0);
    usage.output_tokens += Number(data?.usage?.output_tokens || 0);
    let reply;
    try { reply = JSON.parse(replyText(data)); }
    catch (error) { if (attempt === 2) throw error; problems = [String(error.message || error)]; continue; }
    const checked = checkAiSeo(reply, { sections, shopName });
    if (!checked.problems.length) return { ...checked.seo, model: options.model, usage };
    problems = checked.problems;
    // One more try, saying what was wrong.
    request.input = [...request.input,
      { role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify(reply) }] },
      { role: 'user', content: [{ type: 'input_text', text: 'Please fix: ' + problems.join('; ') + '.' }] }];
  }
  throw new Error('ChatGPT\'s SEO could not be used: ' + problems.join('; ') + '.');
}
