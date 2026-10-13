import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeEtsyDescription, sameEtsyDescription, listingSeoPreservation, describeEtsyDescriptionDifference} from '../src/converter-description.mjs';

const link='https://www.etsy.com/shop/SilviaArtCollective?ref=dashboard-header&section_id=59806016';
const original='Soft painterly forms.\n\nSHOP SECTION\n'+link+'\nCanvas (Thickness: 1.25" / 3.2 cm)';

test('whitespace-only normalization of Etsy API response does not fail conversion',()=>{
 assert.equal(normalizeEtsyDescription(' A\r\n\r\nB  '),'A B');
 assert.ok(sameEtsyDescription(original,original.replace(/\n/g,'\r\n').replace(/\r\n/g,'  ')));
 assert.ok(sameEtsyDescription(original+'\n\n',original));
 assert.equal(listingSeoPreservation({description:original+'\n',shop_section_id:42},original,42).ok,true);
});

test('the original description, section URL and Etsy shop section must truly survive',()=>{
 assert.equal(sameEtsyDescription('A  B','A C B'),false);
 assert.equal(listingSeoPreservation({description:original.replace(link,''),shop_section_id:42},original,42).ok,false);
 assert.equal(listingSeoPreservation({description:original,shop_section_id:99},original,42).ok,false);
 assert.deepEqual(listingSeoPreservation({description:original,shop_section_id:42},original,42),{
  ok:true,descriptionPreserved:true,sectionPreserved:true
 });
 assert.equal(listingSeoPreservation({description:original,shop_section_id:null},original,null).ok,true);
});

test('Etsy HTML entities in shop URLs and canvas copy are equivalent, without dropping content',()=>{
 const escaped=original.replace('&section_id=','&amp;section_id=').replace('1.25"','1.25&quot;');
 assert.ok(sameEtsyDescription(escaped,original));
 assert.ok(sameEtsyDescription(original.replace('Soft painterly','Soft&#32;painterly'),original));
 assert.equal(listingSeoPreservation({description:escaped,shop_section_id:42},original,42).ok,true);
 assert.equal(sameEtsyDescription(original.replace('section_id=59806016','section_id=12345678'),original),false);
 assert.equal(sameEtsyDescription(original.replace('SHOP SECTION',''),original),false);
 assert.match(describeEtsyDescriptionDifference('A B','A C B'),/character 3/);
});
