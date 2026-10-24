import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {renderProductCreator} from '../src/product-creator.mjs';
import {canonicalWallArtStyle,styleAttributes,ETSY_WALL_ART_STYLES} from '../src/etsy-style.mjs';
import {parseSeoPaste} from '../src/seo-paste.mjs';

test('pasted Style values override fixed Art deco without creating duplicate Style fields',()=>{
 assert.equal(canonicalWallArtStyle(' contemporary '),'Contemporary');
 assert.equal(canonicalWallArtStyle('RUSTIC & PRIMITIVE'),'Rustic & primitive');
 assert.equal(canonicalWallArtStyle('Unlisted aesthetic'),null);
 const defaults={Materials:['Paper'],Style:['Art deco'],Room:['Living room']};
 const updated=styleAttributes(defaults,'Contemporary');
 assert.deepEqual(updated.find(x=>x.attributeName==='Style').values,['Contemporary']);
 assert.equal(updated.filter(x=>x.attributeName==='Style').length,1);
 assert.deepEqual(styleAttributes(defaults,'').find(x=>x.attributeName==='Style').values,['Art deco']);
 assert.throws(()=>styleAttributes(defaults,'made-up style'),/Unsupported Etsy Style/);
});

test('full SEO paste fills title, artwork description, section, Style and all tags',()=>{
 const html=renderProductCreator();
 const start=html.indexOf('function normalizedSeoLine(');
 const end=html.indexOf("applySeoButton.addEventListener('click',applySeoOutput);",start);
 assert.ok(start>0&&end>start);
 const source=html.slice(start,end);
 const fields=Object.fromEntries(['title','seo_description','seo_section_name','seo_section_url','homestyle','tags','listing_style'].map(id=>[id,{value:'',options:[]}]));
 fields.listing_style.value='Art deco';
 fields.listing_style.options=ETSY_WALL_ART_STYLES.map(value=>({value}));
 fields['style-status']={textContent:'',style:{display:'none'},className:''};
 fields['homestyle-status']={innerHTML:'',style:{display:'none'},className:''};
 fields['seo-section-status']={textContent:'',style:{display:'none'},className:''};
 fields['seo-paste-status']={textContent:'',style:{display:'none'},className:''};
 const section={options:[
  {value:'59806016',textContent:'Neutral Landscape Art'},
  {value:'60115367',textContent:'Abstract & Contemporary'},
  {value:'60115369',textContent:'Floral Wall Art'}
 ],value:'59806016'};
 const input={value:`SEO Title
White Floral Wall Art: Neutral Beige Sage Textured Botanical Painting

ABOUT THIS ARTWORK
Soft white blossoms emerge against warm beige, cream, and muted sage green tones in a richly textured floral composition. Layered painterly marks and gentle tonal variation create a quiet, elegant atmosphere with a soft organic feel.

MORE ART FROM SILVIA ART COLLECTIVE
𝐅𝐥𝐨𝐫𝐚𝐥 𝐖𝐚𝐥𝐥 𝐀𝐫𝐭
https://www.etsy.com/shop/SilviaArtCollective?ref=dashboard-header&section_id=60115369

Style
Contemporary

SEO Tags (13)
white floral art, neutral floral art, floral wall art, textured flowers, white flower art, beige floral art, botanical wall art, soft neutral art, sage green art, painterly floral, cream wall art, muted floral art, neutral wall decor`};
 // Both shops need to parse a Silvia section heading for pasted cross-shop examples.
 const script=source.replace(/MORE ART FROM JAPANDI ART COLLECTIVE/g,'MORE ART FROM SILVIA ART COLLECTIVE');
 // chosenInForm: fields the user or the SEO set, which a listing template leaves alone.
 const ctx={seoGeneratorOutput:input,document:{getElementById:id=>fields[id]},section,chosenInForm:new Set(),window:{parseSeoPaste}};
 vm.runInNewContext(script+'\napplySeoOutput();',ctx);
 assert.equal(fields.title.value,'White Floral Wall Art: Neutral Beige Sage Textured Botanical Painting');
 assert.match(fields.seo_description.value,/Soft white blossoms emerge/);
 assert.ok(!fields.seo_description.value.includes('MORE ART'));
 assert.equal(fields.seo_section_url.value,'https://www.etsy.com/shop/SilviaArtCollective?ref=dashboard-header&section_id=60115369');
 assert.equal(fields.listing_style.value,'Contemporary');
 assert.equal(section.value,'60115369','Fancy Unicode section heading + Etsy ID must select Floral Wall Art');
 section.value='59806016'; // Simulate a late Etsy default overriding the section.
 vm.runInNewContext('selectSeoShopSection()',ctx);
 assert.equal(section.value,'60115369','SEO wins over late loading defaults');
 assert.equal(fields.tags.value.split(',').length,13);
 assert.equal(fields.tags.value.split(',')[12].trim(),'neutral wall decor');
 assert.equal(fields.homestyle.value,'');
 assert.deepEqual([...ctx.chosenInForm].sort(),['listing_style','shop_section_id','tags']);
 // The paste had everything: the report says so.
 assert.match(fields['seo-paste-status'].textContent,/^Filled in: title, description, 13 tags, style, shop section\.$/);
});
test('Etsy Style is submitted for draft creation using supported taxonomy property',()=>{
 const html=renderProductCreator();
 assert.ok(html.includes('id="listing_style"'));
 assert.ok(html.includes("listing_style:document.getElementById('listing_style').value.trim()"));
 const server=readFileSync(new URL('../src/server.mjs',import.meta.url),'utf8');
 assert.ok(server.includes('styleAttributes(listingDefaults.fixedAttributes'));
 assert.ok(server.includes('canonicalWallArtStyle(body.listing_style)'));
 assert.ok(!server.includes("attributeName:'Style', values:['Art deco']"));
});

test('server rejects mismatched or forged SEO shop-section links before creating a draft',async()=>{
 const {assertSeoShopSection,seoEtsySectionId}=await import('../src/seo-shop-section.mjs');
 const link='https://www.etsy.com/shop/SilviaArtCollective?ref=dashboard-header&section_id=60115369';
 assert.equal(seoEtsySectionId(link),'60115369');
 assert.equal(assertSeoShopSection(link,60115369),'60115369');
 assert.throws(()=>assertSeoShopSection(link,59806016),/does not match/);
 assert.throws(()=>seoEtsySectionId('https://other.example/shop?section_id=60115369'),/etsy.com/);
 assert.throws(()=>seoEtsySectionId('https://www.etsy.com/shop/SilviaArtCollective'),/section_id/);
 assert.equal(assertSeoShopSection('',59806016),null);
 const server=readFileSync(new URL('../src/server.mjs',import.meta.url),'utf8');
 const route=server.slice(server.indexOf('async function createEtsyDraft(body)'));
 assert.ok(route.indexOf('assertSeoShopSection(body.seo_section_url,body.shop_section_id)')>=0);
 assert.ok(route.indexOf('assertSeoShopSection(body.seo_section_url,body.shop_section_id)')<route.indexOf('createDraftListing('));
});
