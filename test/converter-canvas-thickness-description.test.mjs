import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {OLD_THICKNESS,NEW_THICKNESS,reviseCanvasThickness} from '../src/description-updater.mjs';

const source=readFileSync(new URL('../src/server.mjs',import.meta.url),'utf8');
const convert=source.slice(source.indexOf('async function performListingConversion(body)'),
  source.indexOf('async function runPendingListingConversions()'));
test('Gelato conversion uses existing 1.25-inch canvas correction for the full original description',()=>{
 assert.ok(convert.includes('const expectedDescription=reviseCanvasThickness(originalDescription);'));
 assert.ok(source.includes('if(!report.descriptionPreserved)correction.description=expectedDescription'));
 assert.ok(convert.includes('await ensureConverterListingSeo(session,listingId,expectedDescription,originalShopSectionId);'));
 assert.ok(convert.includes('originalShopSectionId'));
 assert.ok(convert.includes('originalDescription,originalShopSectionId'));
 assert.ok(convert.includes('await saveListingConverterMap(snapshotMap)'));
 assert.ok(source.includes('if(!report.descriptionPreserved)correction.description=expectedDescription'));
 assert.ok(convert.includes('shop_section_id:originalShopSectionId'));
 assert.ok(convert.includes('ensureConverterListingSeo'))
 assert.ok(convert.includes('existingSeoPreserved: true'));
});
test('canvas thickness update preserves shop section, SEO, materials, and all other text',()=>{
 const url='https://www.etsy.com/shop/ShopName?ref=dashboard-header&section_id=60115369';
 const text='ABOUT THIS ARTWORK\\nSoft landscapes.\\n\\nSHOP SECTION\\n'+url+
  '\\n\\n• Fine Art Print — archival matte paper\\n• Canvas — Premium canvas (Thickness: 2 cm)'+
  '\\n• Framed Canvas — professionally finished frame\\nThank you.';
 const result=reviseCanvasThickness(text);
 assert.equal(result,text.replace(OLD_THICKNESS,NEW_THICKNESS));
 assert.ok(result.includes(url));
 assert.equal(result.split(NEW_THICKNESS).length,2);
 assert.equal(reviseCanvasThickness(result),result,'already corrected listings are unchanged');
 assert.equal(reviseCanvasThickness('No legacy canvas phrase; '+url),'No legacy canvas phrase; '+url);
});
test('already-configured conversion retry also repairs any outdated canvas sentence',()=>{
 assert.ok(convert.includes('String(prior.originalDescription||recoveryListing.description||\'\'))'));
 assert.ok(convert.includes('await ensureConverterListingSeo(session,listingId,recoveryDescription,'));
});
