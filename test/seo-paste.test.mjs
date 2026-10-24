import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSeoPaste} from '../src/seo-paste.mjs';

const tags13='abstract wall art, neutral wall art, sage green print, living room decor, modern canvas art, earth tone art, minimalist painting, large wall art, textured art print, calm wall decor, gift for her, bedroom wall art, japandi decor';

test('the usual SEO generator output still works',()=>{
 const seo=parseSeoPaste(`SEO Title
Abstract Landscape Wall Art: Olive Green Earth Tones
ABOUT THIS ARTWORK
A soft, textured landscape in olive and sand.
It brings calm to any room.
MORE ART FROM SILVIA ART COLLECTIVE
Abstract Landscapes
https://www.etsy.com/shop/SilviaArtCollective?section_id=51234567
Style
Minimalist
SEO Tags (13)
${tags13}`);
 assert.equal(seo.title,'Abstract Landscape Wall Art: Olive Green Earth Tones');
 assert.equal(seo.description,'A soft, textured landscape in olive and sand.\nIt brings calm to any room.');
 assert.equal(seo.sectionName,'Abstract Landscapes');
 assert.match(seo.sectionUrl,/section_id=51234567$/);
 assert.equal(seo.style,'Minimalist');
 assert.equal(seo.tags.length,13);
 assert.deepEqual(seo.missing,[]);
});

test('a plain "Tags" heading, with one tag per line, is read',()=>{
 const seo=parseSeoPaste('Title\nSage Field Painting\nDescription\nA quiet field.\nTags\n'+tags13.split(', ').join('\n'));
 assert.equal(seo.tags.length,13);
 assert.equal(seo.tags[0],'abstract wall art');
 assert.deepEqual(seo.missing,['style','shop section']);
});

test('markdown, colons, numbering, counts and values on the heading line are understood',()=>{
 const seo=parseSeoPaste(`## 1. SEO Title:
**Warm Dusk Horizon Wall Art**

### 📝 Short Description
Golden light over still water.

**Etsy Tags (13):** ${tags13}

Etsy Style: Coastal
Shop Section - Coastal Art
Section URL: https://www.etsy.com/shop/X?section_id=1`);
 assert.equal(seo.title,'Warm Dusk Horizon Wall Art');
 assert.equal(seo.description,'Golden light over still water.');
 assert.equal(seo.tags.length,13);
 assert.equal(seo.style,'Coastal');
 assert.equal(seo.sectionName,'Coastal Art');
 assert.equal(seo.sectionUrl,'https://www.etsy.com/shop/X?section_id=1');
 assert.deepEqual(seo.missing,[]);
});

test('tags as bullets, numbers, hashtags or semicolons are cleaned and deduplicated',()=>{
 assert.deepEqual(parseSeoPaste('Tags\n- wall art\n• neutral decor\n3. Wall Art\n"gift idea"').tags,['wall art','neutral decor','gift idea']);
 assert.deepEqual(parseSeoPaste('Keywords: #wallart #neutraldecor #giftidea').tags,['wallart','neutraldecor','giftidea']);
 assert.deepEqual(parseSeoPaste('Tags: wall art; boho decor; gift').tags,['wall art','boho decor','gift']);
});

test('what cannot be used is said: too many tags, tags over 20 characters, missing parts',()=>{
 const many=parseSeoPaste('Title\nX\nTags\n'+tags13+', extra one, extra two');
 assert.equal(many.tags.length,13);
 assert.ok(many.notes.some(note=>/15 tags were pasted; Etsy allows 13/.test(note)));
 const long=parseSeoPaste('Tags\nwall art, this tag is far too long for etsy');
 assert.deepEqual(long.tags,['wall art']);
 assert.ok(long.notes.some(note=>/at most 20 characters/.test(note)));
 const partial=parseSeoPaste('Description\nJust a description.');
 assert.deepEqual(partial.missing,['title','tags','style','shop section']);
 assert.deepEqual(parseSeoPaste('').missing,['title','description','tags','style','shop section']);
});

test('a title without a heading is taken from the first line, and said so',()=>{
 const seo=parseSeoPaste('Blue Hour Lake Wall Art\n\nDescription\nStill water at dusk.\nTags\n'+tags13);
 assert.equal(seo.title,'Blue Hour Lake Wall Art');
 assert.ok(seo.notes.some(note=>/first line/.test(note)));
});

test('a description that mentions a style or tags in its sentences is not cut short',()=>{
 const seo=parseSeoPaste('Description\nThis style of painting suits calm rooms.\nTags are not needed here.\nStyle\nMinimalist\nTags\n'+tags13);
 assert.equal(seo.description,'This style of painting suits calm rooms.\nTags are not needed here.');
 assert.equal(seo.style,'Minimalist');
});
