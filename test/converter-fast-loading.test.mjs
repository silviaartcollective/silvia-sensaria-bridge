import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {originalEtsyCreationTimestamp,sortConverterListingsOldestFirst}
 from '../src/converter-listing-order.mjs';

const server=readFileSync(new URL('../src/server.mjs',import.meta.url),'utf8');
const page=readFileSync(new URL('../src/listing-converter-page.mjs',import.meta.url),'utf8');

test('metadata API does not block on any Etsy image fetch; retains original order and mapping',async()=>{
 const start=server.indexOf('async function converterListingRows(session) {');
 const end=server.indexOf('function sendJson(res, status, value)',start);
 assert.ok(start!==-1&&end>start);
 const fragment=server.slice(start,end);
 let previews=0;
 const ctx=vm.createContext({
  allShopListingsForPriceSync:async()=>[
   {listing_id:200,title:'New',state:'draft',original_creation_timestamp:1767225600},
   {listing_id:100,title:'Old',state:'active',original_creation_timestamp:1577836800}
  ],
  loadListingConverterMap:async()=>({listings:{100:{artworkId:'JAC001',status:'converted'}}}),
  getEtsyListingImages:async()=>{previews++;throw Error('Image endpoint should not be used')},
  originalEtsyCreationTimestamp,sortConverterListingsOldestFirst,
  Date,Number,String,Math,Promise
 });
 vm.runInContext(fragment+';globalThis.load=converterListingRows;',ctx);
 const data=await ctx.load({shop:{shop_id:99}});
 assert.equal(previews,0);
 assert.deepEqual(Array.from(data.listings,x=>x.listingId),[100,200]);
 assert.equal(data.listings[0].converted,true);
 assert.equal(data.listings[0].artworkId,'JAC001');
 assert.equal(data.listings[0].firstImageUrl,null);
 assert.equal(data.listings[1].state,'draft');
});

test('preview endpoint is separate, cached, and gated by admin authentication',()=>{
 assert.match(server,/url.pathname==='\/api\/listing-converter\/listing-image'/);
 assert.match(server,/requireAdminApi\(req,res\)/);
 assert.match(server,/cachedConverterListingPreview\(session,listingId\)/);
 assert.match(server,/CONVERTER_PREVIEW_TTL_MS=10\*60\*1000/);
 assert.match(server,/converterPreviewCache\.set\(key,\{pending/);
});

test('UI shows cards before queue request and lazy-loads previews at bounded concurrency',()=>{
 const start=page.indexOf('<script>');
 const end=page.indexOf('</script>',start);
 assert.ok(end>start);
 assert.doesNotThrow(()=>new vm.Script(page.slice(start+8,end)));
 assert.match(page,/renderCards\(\);\s*void refreshConversionQueue\(\);/);
 assert.match(page,/MAX_PREVIEW_REQUESTS=4/);
 assert.match(page,/IntersectionObserver\(entries/);
 assert.match(page,/previewObserver\.observe\(card\)/);
 assert.match(page,/loading="lazy" decoding="async"/);
 assert.match(page,/Preview loads when visible/);
 assert.match(page,/Oldest originally listed first/);
 assert.match(page,/View on Etsy/);
});
