import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {
  generateEtsySeo, checkAiSeo, cleanEtsyTitle, cleanEtsyTags, seoPasteText, seoImage,
  loadAiSeoSettings, saveAiSeoSettings, DEFAULT_AI_SEO_INSTRUCTIONS, DEFAULT_AI_SEO_MODEL
} from '../src/ai-seo.mjs';
import { parseSeoPaste } from '../src/seo-paste.mjs';

const sections = [{ shop_section_id: 111, title: 'Abstract Art' }, { shop_section_id: 222, title: 'Coastal Art' }];
const tags13 = ['sage wall art', 'abstract print', 'neutral decor', 'living room art', 'calm wall art', 'green landscape',
  'modern art print', 'nature painting', 'boho wall decor', 'farmhouse art', 'gift for her', 'bedroom decor', 'soft green art'];
const good = { title: 'Sage Green Abstract Wall Art, Neutral Landscape Print', description: 'A calm sage field.',
  tags: tags13, style: 'Minimalist', shop_section: 'Abstract Art' };
const image = { base64: Buffer.from('jpeg').toString('base64'), contentType: 'image/jpeg' };
const settings = { instructions: 'Write SEO.', model: 'gpt-5-mini' };

function fakeOpenAi(replies) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body), headers: options.headers });
    const next = replies.shift();
    if (next.status) return { ok: false, status: next.status, json: async () => next.body };
    return { ok: true, status: 200, json: async () => ({ status: 'completed', usage: { input_tokens: 900, output_tokens: 400 },
      output: [{ type: 'reasoning' }, { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(next) }] }] }) };
  };
  return { calls, fetchImpl };
}

test('ChatGPT gets the artwork, the instructions and the choices, and its answer comes back cleaned', async () => {
  const { calls, fetchImpl } = fakeOpenAi([good]);
  const seo = await generateEtsySeo({ image, orientation: 'portrait', sections, shopName: 'SilviaArtCollective',
    settings, apiKey: 'sk-test', fetchImpl });
  assert.equal(calls[0].url, 'https://api.openai.com/v1/responses');
  assert.equal(calls[0].headers.authorization, 'Bearer sk-test');
  const body = calls[0].body;
  assert.equal(body.model, 'gpt-5-mini');
  assert.equal(body.instructions, 'Write SEO.');
  assert.deepEqual(body.reasoning, { effort: 'medium' });
  assert.equal(body.text.format.type, 'json_schema');
  assert.equal(body.text.format.strict, true);
  assert.deepEqual(body.text.format.schema.properties.shop_section.enum, ['Abstract Art', 'Coastal Art', 'None']);
  assert.ok(body.text.format.schema.properties.style.enum.includes('Minimalist'));
  const [text, picture] = body.input[0].content;
  assert.match(text.text, /orientation: portrait/);
  assert.match(picture.image_url, /^data:image\/jpeg;base64,/);
  assert.equal(seo.title, good.title);
  assert.equal(seo.tags.length, 13);
  assert.equal(seo.style, 'Minimalist');
  assert.equal(seo.sectionId, '111');
  assert.equal(seo.sectionUrl, 'https://www.etsy.com/shop/SilviaArtCollective?section_id=111');
  assert.deepEqual(seo.usage, { input_tokens: 900, output_tokens: 400 });
});

test('an answer Etsy would refuse is sent back once with what to fix', async () => {
  const short = { ...good, tags: ['wall art', 'this tag is far too long for etsy', 'wall art'] };
  const { calls, fetchImpl } = fakeOpenAi([short, good]);
  const seo = await generateEtsySeo({ image, sections, settings, apiKey: 'k', fetchImpl });
  assert.equal(calls.length, 2);
  // Each refused tag is named with the reason.
  assert.equal(calls[1].body.input.at(-1).content[0].text, 'Please fix: only 1 usable tags of the 13 needed; Etsy refuses ' +
    '"this tag is far too long for etsy" (33 characters), "wall art" (a repeat); each tag must be 20 characters or fewer counting spaces, all different.');
  assert.equal(seo.tags.length, 13);
  assert.equal(seo.missingTags, undefined);
  // Etsy's limits are said whatever the instructions are.
  assert.match(calls[0].body.input[0].content[0].text, /exactly 13 tags, all different, each 20 characters or fewer counting spaces/);
  const { fetchImpl: noTags } = fakeOpenAi([{ ...good, tags: [] }, { ...good, tags: ['x'.repeat(30)] }]);
  await assert.rejects(generateEtsySeo({ image, sections, settings, apiKey: 'k', fetchImpl: noTags }), /could not be used: only 0 usable tags/);
});

test('still short of 13 tags after the second try: the SEO is used and says how many to add by hand', async () => {
  const twelve = { ...good, tags: [...tags13.slice(0, 12), 'contemporary wall art'] };
  const { calls, fetchImpl } = fakeOpenAi([twelve, twelve]);
  const seo = await generateEtsySeo({ image, sections, settings, apiKey: 'k', fetchImpl });
  assert.equal(calls.length, 2);
  assert.deepEqual(seo.tags, tags13.slice(0, 12));
  assert.equal(seo.missingTags, 1);
  assert.equal(seo.title, good.title);
  assert.match(parseSeoPaste(seoPasteText(seo)).notes.join(' '), /Only 12 of 13 tags were found: add 1 more in SEO tags\./);
  // Good tags of the first answer make up for ones the second loses.
  const { fetchImpl: topUp } = fakeOpenAi([{ ...good, tags: tags13.slice(0, 11) }, { ...good, tags: tags13.slice(2) }]);
  const full = await generateEtsySeo({ image, sections, settings, apiKey: 'k', fetchImpl: topUp });
  assert.equal(full.tags.length, 13);
  assert.equal(full.missingTags, undefined);
  // Other problems still stop it.
  const { fetchImpl: noStyle } = fakeOpenAi([{ ...twelve, style: 'Nope' }, { ...twelve, style: 'Nope' }]);
  await assert.rejects(generateEtsySeo({ image, sections, settings, apiKey: 'k', fetchImpl: noStyle }), /no Etsy style from the list/);
});

test('a renewal asks for SEO different from the listing\'s current one', async () => {
  const { calls, fetchImpl } = fakeOpenAi([good]);
  await generateEtsySeo({ image, sections, settings, apiKey: 'k', fetchImpl,
    previous: { title: 'Old Title Wall Art', tags: ['old tag'] } });
  const text = calls[0].body.input[0].content[0].text;
  assert.match(text, /clearly different/);
  assert.match(text, /Current title: Old Title Wall Art/);
  assert.match(text, /Current tags: old tag/);
});

test('OpenAI problems are explained in plain words', async () => {
  const fail = (status, body) => generateEtsySeo({ image, settings, apiKey: 'k', fetchImpl: fakeOpenAi([{ status, body }]).fetchImpl });
  await assert.rejects(fail(401, { error: { message: 'Incorrect API key provided: sk-proj-****abcd.' } }),
    /API key in Render was not accepted\. Check OPENAI_API_KEY\. OpenAI says: Incorrect API key provided: sk-proj-\*\*\*\*abcd\./);
  await assert.rejects(fail(401, { error: { message: 'You have insufficient permissions for this operation. Missing scopes: api.responses.write.' } }),
    /OpenAI says: You have insufficient permissions .*api\.responses\.write/);
  await assert.rejects(fail(429, { error: { code: 'insufficient_quota', message: 'quota' } }), /no API credit left/);
  await assert.rejects(fail(404, { error: { code: 'model_not_found', message: 'no such model' } }), /does not offer the model/);
  await assert.rejects(generateEtsySeo({ image, settings, apiKey: '' }), /add OPENAI_API_KEY in Render/);
});

test('titles and tags are made acceptable to Etsy', () => {
  assert.equal(cleanEtsyTitle('Art: Sage & Gold: 100% Calm & Quiet 50%'), 'Art: Sage & Gold - 100% Calm and Quiet 50 percent');
  const long = cleanEtsyTitle('Word '.repeat(40));
  assert.ok(long.length <= 140 && !long.endsWith(' '));
  assert.deepEqual(cleanEtsyTags(['#Wall Art!', 'wall art', 'boho, decor', 'x'.repeat(21), ' gift   idea ']),
    ['Wall Art', 'boho decor', 'gift idea']);
  const { seo, problems } = checkAiSeo({ ...good, style: 'Not a style', shop_section: 'None' }, { sections, shopName: 'S' });
  assert.deepEqual(problems, ['no Etsy style from the list']);
  assert.equal(seo.sectionId, '');
});

test('the answer, laid out as a paste, is read back exactly', () => {
  const { seo } = checkAiSeo(good, { sections, shopName: 'SilviaArtCollective' });
  const read = parseSeoPaste(seoPasteText(seo));
  assert.equal(read.title, seo.title);
  assert.equal(read.description, seo.description);
  assert.deepEqual(read.tags, seo.tags);
  assert.equal(read.style, 'Minimalist');
  assert.equal(read.sectionName, 'Abstract Art');
  assert.equal(read.sectionUrl, seo.sectionUrl);
  assert.deepEqual(read.missing, []);
});

test('settings: the built-in instructions until edited; the model can be changed', async () => {
  let stored = null;
  const get = async () => stored, put = async (_key, value) => { stored = value; };
  assert.equal((await loadAiSeoSettings({ get })).instructions, DEFAULT_AI_SEO_INSTRUCTIONS);
  const saved = await saveAiSeoSettings({ instructions: 'My own rules', model: 'gpt-5.4-mini' }, { put });
  assert.equal(saved.instructions, 'My own rules');
  assert.equal(saved.model, 'gpt-5.4-mini');
  assert.equal(saved.custom, true);
  await saveAiSeoSettings({ instructions: DEFAULT_AI_SEO_INSTRUCTIONS, model: '' }, { put });
  assert.deepEqual(stored.instructions, '');
  assert.equal((await loadAiSeoSettings({ get })).model, DEFAULT_AI_SEO_MODEL);
  await assert.rejects(saveAiSeoSettings({ model: 'bad model!' }, { put }), /not a valid OpenAI model/);
});

test('the artwork sent to ChatGPT is a small JPEG', async () => {
  const big = await sharp({ create: { width: 3000, height: 2000, channels: 4, background: '#88aa88' } }).png().toBuffer();
  const small = await seoImage(big);
  const info = await sharp(Buffer.from(small.base64, 'base64')).metadata();
  assert.equal(info.format, 'jpeg');
  assert.equal(info.width, 1024);
  assert.equal(info.height, 683);
});

test('rows made with fewer than 13 tags say how many to add on Etsy (Daily Listings, Listing Reposter)', async () => {
  const { readFileSync } = await import('node:fs');
  const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
  assert.match(read('src/daily-batch-client.js'), /if\(item\.seo\?\.tags\?\.length<13\)text\.append\(make\('div','warnline','Only '\+item\.seo\.tags\.length\+' of 13 tags: add '/);
  assert.match(read('src/repost-listings-client.js'), /if\(row\.warning\)text\.append\(make\('div','warnline',row\.warning\)\);/);
  assert.match(read('src/daily-listings-page.mjs'), /\.warnline\{color:#8a5a1f;/);
});
