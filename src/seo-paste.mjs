// Reads pasted SEO generator output, however it is laid out: headings with or
// without a colon, in capitals, markdown (#, **), numbered or bulleted, with
// counts like "(13)", the value on the heading line or below it; tags separated
// by commas, lines, bullets, semicolons or hashtags. It also says which parts
// it could not find. Runs in the Product Creator page (its source is included
// there) and in tests.

const SEO_FIELDS = [
  ['title', ['seo title', 'title', 'etsy title', 'listing title', 'product title', 'optimized title',
    'seo optimized title', 'etsy listing title', 'listing name', 'product name']],
  ['description', ['short seo description', 'about this artwork', 'about this piece', 'about the artwork',
    'seo description', 'short description', 'description', 'listing description', 'product description',
    'etsy description', 'artwork description', 'short seo blurb']],
  ['section', ['shop section', 'etsy shop section', 'section', 'section name', 'shop section name']],
  ['sectionUrl', ['section url', 'section link', 'shop section url', 'shop section link', 'section url link']],
  ['style', ['style', 'etsy style', 'primary style', 'listing style', 'art style', 'style attribute']],
  ['homestyle', ['homestyle', 'home style']],
  ['tags', ['seo tags', 'tags', 'etsy tags', 'listing tags', 'keywords', 'seo keywords', 'tag list', 'search tags',
    'etsy seo tags', 'hashtags']]
];
const SEO_LABELS = new Map(SEO_FIELDS.flatMap(([field, names]) => names.map(name => [name, field])));

function seoLabelKey(text) {
  return String(text || '').normalize('NFKC').toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, ' ')          // counts: (13), [1]
    .replace(/\b\d+\b/g, ' ')                  // "13 tags"
    .replace(/[^\p{L}\s]/gu, ' ')              // markdown, emoji, punctuation
    .replace(/\s+/g, ' ').trim();
}

// A heading line: { field, value } (value: text after "Label:" on the same line).
function seoHeading(line) {
  let text = String(line || '').normalize('NFKC').trim();
  if (!text) return null;
  // Leading markdown, quotes, bullets and numbering: "### ", "**", "> ", "- ", "1. ", "2) ".
  text = text.replace(/^(?:[>#*_`~•·\-–—\s]|\d{1,2}[.)]\s)+/u, '').replace(/^[^\p{L}\p{N}]+/u, '');
  // "Label: value" (the label is short; the value may be long), or a label alone.
  const split = text.match(/^(.{1,60}?)\s*(?:[:：]|\s[-–—]\s)\s*(.*)$/u);
  const candidates = [...(split ? [[split[1], split[2]]] : []), ...(text.length <= 80 ? [[text, '']] : [])];
  for (const [label, value] of candidates) {
    const key = seoLabelKey(label);
    const field = SEO_LABELS.get(key) || (/^more art from\b/.test(key) ? 'section' : null);
    if (field) return { field, value: String(value || '').replace(/^[*_`\s]+|[*_`\s]+$/g, '').trim() };
  }
  return null;
}

const SEO_URL = /https?:\/\/[^\s<>()"']+/i;
const stripDecoration = line => String(line || '').trim()
  .replace(/^(?:[>*_`•·\-–—\s]|\d{1,2}[.)]\s)+/u, '').replace(/[*_`]+$/g, '')
  .replace(/^["“”']+|["“”']+$/g, '').trim();

// Tags from any list layout, cleaned the way Etsy needs them.
function seoTagList(text) {
  const raw = String(text || '');
  const parts = (/[,\n;|]/.test(raw) ? raw.split(/[,\n;|]+/) : raw.includes('#') ? raw.split('#') : [raw]);
  const seen = new Set(), tags = [];
  for (const part of parts) {
    const tag = stripDecoration(part).replace(/^#/, '').replace(/[^\p{L}\p{N} '’&™©®-]/gu, '').replace(/\s+/g, ' ').trim();
    if (!tag || seen.has(tag.toLocaleLowerCase('en'))) continue;
    seen.add(tag.toLocaleLowerCase('en'));
    tags.push(tag);
  }
  return tags;
}

export function parseSeoPaste(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = {}, before = [];
  let current = null;
  for (const line of lines) {
    const heading = seoHeading(line);
    if (heading) {
      // The first heading of a field wins; a repeat of it is ignored.
      current = blocks[heading.field] ? '_repeat' : heading.field;
      blocks[current] = blocks[current] || [];
      if (heading.value) blocks[current].push(heading.value);
      continue;
    }
    if (current) blocks[current].push(line);
    else before.push(line);
  }
  const block = field => (blocks[field] || []).join('\n').trim();
  const firstLine = field => stripDecoration((blocks[field] || []).find(line => stripDecoration(line)) || '');
  const notes = [];

  let title = firstLine('title');
  // No title heading: a short first line above every heading is the title.
  if (!title) {
    const lead = stripDecoration(before.find(line => stripDecoration(line)) || '');
    if (lead && lead.length <= 140 && Object.keys(blocks).length) {
      title = lead;
      notes.push('The title was taken from the first line (no "Title" heading found).');
    }
  }
  if (title.length > 140) notes.push('The title is ' + title.length + ' characters; Etsy allows 140.');

  const description = block('description').split('\n').map(line => line.replace(/\s+$/g, '')).join('\n').trim();

  const sectionLines = (blocks.section || []).map(stripDecoration).filter(Boolean);
  const urlIn = value => (String(value || '').match(SEO_URL)?.[0] || '').replace(/[).,]+$/, '');
  const sectionUrl = urlIn(sectionLines.find(line => SEO_URL.test(line))) || urlIn(block('sectionUrl'));
  const sectionName = (sectionLines.find(line => !SEO_URL.test(line)) || '')
    .replace(/^\[([^\]]+)\]\(.*\)$/, '$1').trim();

  const style = firstLine('style');
  const homestyle = firstLine('homestyle');

  let tags = seoTagList(block('tags'));
  const tooLong = tags.filter(tag => tag.length > 20);
  if (tooLong.length) notes.push('Not used (Etsy tags are at most 20 characters): ' + tooLong.join(', ') + '.');
  tags = tags.filter(tag => tag.length <= 20);
  if (tags.length > 13) {
    notes.push(tags.length + ' tags were pasted; Etsy allows 13, so the first 13 are used.');
    tags = tags.slice(0, 13);
  } else if (tags.length && tags.length < 13) notes.push('Only ' + tags.length + ' of 13 tags were found: add ' +
    (13 - tags.length) + ' more in SEO tags.');

  const found = [], missing = [];
  const check = (ok, name) => (ok ? found : missing).push(name);
  check(title, 'title');
  check(description, 'description');
  check(tags.length, 'tags');
  check(style || homestyle, 'style');
  check(sectionName || sectionUrl, 'shop section');
  return { title, description, sectionName, sectionUrl, style, homestyle, tags, found, missing, notes };
}
