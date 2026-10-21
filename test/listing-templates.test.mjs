import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {cleanListingTemplate,listingDescription,TEMPLATE_ORIENTATIONS} from '../src/listing-templates.mjs';
import {listingLayoutForManifest} from '../src/panoramic-layout.mjs';
import {renderListingsPage} from '../src/listings-page.mjs';
import {renderProductCreator} from '../src/product-creator.mjs';
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');

test('a listing template keeps only valid Product Creator defaults; empty fields stay automatic',()=>{
 assert.deepEqual(TEMPLATE_ORIENTATIONS,['portrait','landscape','square','panoramic']);
 assert.deepEqual(cleanListingTemplate({listing_style:'minimalist',tags:'calm wall art, sage print',shipping_profile_id:'12',
  shop_section_id:'0',readiness_state_id:'',who_made:'i_did',is_supply:'false',should_auto_renew:'false',extra:'dropped',
  description_template:'TOP\r\n{{SHORT_SEO_DESCRIPTION}}'}),
  {listing_style:'Minimalist',tags:['calm wall art','sage print'],shipping_profile_id:12,shop_section_id:0,who_made:'i_did',
   is_supply:false,should_auto_renew:false,description_template:'TOP\n{{SHORT_SEO_DESCRIPTION}}'});
 assert.deepEqual(cleanListingTemplate({}),{});
 assert.throws(()=>cleanListingTemplate({listing_style:'Neon'}),/valid Etsy Style/);
 assert.throws(()=>cleanListingTemplate({tags:Array.from({length:14},(_,i)=>'tag '+i)}),/13/);
 assert.throws(()=>cleanListingTemplate({shipping_profile_id:0}),/Invalid shipping profile id/);
 assert.throws(()=>cleanListingTemplate({when_made:'1990'}),/Invalid when made/);
 assert.throws(()=>cleanListingTemplate({should_auto_renew:'maybe'}),/Auto renew/);
 assert.throws(()=>cleanListingTemplate({description_template:'No placeholder'}),/\{\{SHORT_SEO_DESCRIPTION\}\}/);
});

test('a new listing gets its orientation template\'s description, or the built-in one',()=>{
 const parts={seoDescription:'A calm meadow.',shopSectionName:'Landscapes',shopSectionUrl:'https://etsy.test/s'};
 assert.equal(listingDescription({description_template:'V\n{{SHORT_SEO_DESCRIPTION}}\n{{SHOP_SECTION_NAME}} {{SHOP_SECTION_URL}}'},'B',parts),
  'V\nA calm meadow.\nLandscapes https://etsy.test/s');
 assert.equal(listingDescription({},'Built-in {{SHORT_SEO_DESCRIPTION}}',parts),'Built-in A calm meadow.');
 const server=read('src/server.mjs');
 assert.match(server,/orientations\?\.\[listingLayoutForManifest\(manifest\)\]/);
 assert.match(server,/body\.should_auto_renew = typeof body\.should_auto_renew === 'boolean' \? body\.should_auto_renew : listingDefaults\.autoRenew;/);
 assert.match(server,/listingTemplates: \(await loadListingTemplates\(\)/);
 assert.match(server,/url\.pathname === '\/api\/listing-templates'/);
 assert.match(server,/Cross-site template change blocked\./);
});

test('Listings has a Templates tab with the Product Creator\'s fields for every orientation',()=>{
 const html=renderListingsPage();
 assert.match(html,/id="tab-templates"/);
 const panel=html.slice(html.indexOf('id="templates-panel"'),html.indexOf('id="converter-panel"'));
 for(const o of ['portrait','landscape','square','panoramic'])assert.ok(panel.includes('data-orientation="'+o+'"'),o);
 for(const f of ['listing_style','tags','shipping_profile_id','readiness_state_id','shop_section_id','return_policy_id',
  'production_partner_id','who_made','when_made','is_supply','should_auto_renew','description'])
  assert.ok(panel.includes('id="tpl-'+f+'"'),f);
 const client=read('src/listings-client.js');
 assert.doesNotThrow(()=>new vm.Script(client));
 assert.match(client,/request\('\/api\/listing-templates'\),\s*request\('\/etsy\/listing-options'\)/);
 assert.match(client,/Discard unsaved changes to the '\+TEMPLATE_NAMES\[templateOrientation\]\+' template\?/);
 assert.match(client,/if\(tab==='master'&&!masterLoaded\)/);
});

test('the Product Creator picks the template like the listing layout and keeps what the user or the SEO set',()=>{
 const html=renderProductCreator();
 const script=html.slice(html.indexOf('<script>')+8,html.indexOf('</script>',html.indexOf('<script>')));
 assert.doesNotThrow(()=>new vm.Script(script));
 const from=script.indexOf('function orientationOfSize(');
 const context={};
 vm.runInNewContext(script.slice(from,script.indexOf('function applyListingTemplate(',from))+';this.of=orientationOfSize;',context);
 for(const [w,h] of [[3000,1000],[1850,1000],[1840,1000],[1200,1600],[1500,1500]]){
  const layout=listingLayoutForManifest({orientation:w===h?'square':w>h?'landscape':'portrait',master:{width:w,height:h}});
  assert.equal(context.of(w,h),layout,w+'×'+h);
 }
 assert.match(script,/chosenInForm\.add\('listing_style'\)/);
 assert.match(script,/chosenInForm\.add\('tags'\)/);
 assert.match(script,/chosenInForm\.add\('shop_section_id'\)/);
 assert.match(script,/if\(event\.isTrusted\)chosenInForm\.add\(id\)/);
 assert.match(html,/id="template-status"/);
});
