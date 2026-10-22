import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildOwnSilviaInventory,SILVIA_PANORAMIC_SIZES,SILVIA_SIZES,
 SILVIA_SQUARE_SIZES} from '../src/variants.mjs';
import {parseSilviaSku} from '../src/core.mjs';
import {listingLayoutForManifest,listingLayoutForReconversion} from '../src/panoramic-layout.mjs';
import {fulfillmentRatioForSize,fulfillmentRatiosForOrientation,
 PANORAMIC_FULFILLMENT_RATIOS} from '../src/artwork-ratios.mjs';
import {createCropJobRecord} from '../src/crop-job-store.mjs';
import {planDefaultTemplateInventory} from '../src/default-listing-pricing.mjs';
const load=name=>JSON.parse(readFileSync(new URL('../config/'+name,import.meta.url),'utf8'));
const catalog=load('products.json'),go=load('go-products.json'),cost=load('sensaria-costs.json');
function inventory(orientation){
 return buildOwnSilviaInventory({artworkId:'SAC0007',catalog,readinessStateId:12,orientation});
}
test('only sufficiently wide masters use panoramic Etsy layout',()=>{
 assert.equal(listingLayoutForManifest({orientation:'landscape',master:{width:3000,height:1500}}),'panoramic');
 assert.equal(listingLayoutForManifest({orientation:'landscape',master:{width:3000,height:2000}}),'landscape');
 assert.equal(listingLayoutForManifest({orientation:'square',master:{width:3000,height:3000}}),'square');
 assert.equal(listingLayoutForManifest({orientation:'portrait',master:{width:2000,height:3000}}),'portrait');
});
test('the panoramic variation inventory has exactly 13 supplier-supported sizes, 70 enabled SKUs',()=>{
 const all=inventory('panoramic').products;
 const enabled=all.filter(p=>p.offerings[0].is_enabled);
 assert.equal(SILVIA_PANORAMIC_SIZES.length,13);
 assert.equal(enabled.length,70);
 const counts={P:0,C:0,FC:0};
 for(const row of enabled){
   const {format,size,frame}=parseSilviaSku(row.sku),key=[format,size,frame].join('|');
   assert.ok(SILVIA_PANORAMIC_SIZES.includes(size),row.sku);
   assert.ok(!SILVIA_SQUARE_SIZES.includes(size),row.sku);
   assert.ok(!SILVIA_SIZES.includes(size),row.sku);
   assert.ok(catalog[key]?.friendlySku,key);
   assert.ok(go[key]?.productCode,key);
   assert.ok(cost[format]?.[size]>0,key);
   assert.ok(row.offerings[0].price>0,key);
   counts[format]++;
 }
 assert.deepEqual(counts,{P:5,C:13,FC:52});
});
test('two panoramic ratio families generate landscape crops under 17500 pixels',()=>{
 assert.deepEqual([...PANORAMIC_FULFILLMENT_RATIOS],['1x2','1x3']);
 assert.equal(fulfillmentRatioForSize('20x40'),'1x2');
 assert.equal(fulfillmentRatioForSize('12x36'),'1x3');
 // A panoramic master (1.85:1 or wider) is cropped to the panoramic ratios only.
 const job=createCropJobRecord({artworkId:'SAC0007',masterKey:'artworks/SAC0007/master.jpg',orientation:'landscape',width:6000,height:2000});
 assert.deepEqual(job.ratios,['1x2','1x3']);
 assert.deepEqual([...fulfillmentRatiosForOrientation('landscape',{width:3700,height:2000})],['1x2','1x3']);
 const source=readFileSync(new URL('../src/artwork-ratios.mjs',import.meta.url),'utf8');
 assert.match(source,/'1x2':\[8750,17500\]/);
 assert.match(source,/'1x3':\[5800,17400\]/);
});
test('existing ordinary landscape and square artworks retain their previous variants',()=>{
 const normal=inventory('landscape').products.filter(p=>p.offerings[0].is_enabled);
 const square=inventory('square').products.filter(p=>p.offerings[0].is_enabled);
 assert.ok(normal.length>0&&square.length>0);
 assert.ok(!normal.some(p=>String(p.sku).endsWith('-2040')));
 assert.ok(!square.some(p=>String(p.sku).endsWith('-2040')));
});
test('universal pricing updater previews panoramic stock and price changes without Etsy writes',()=>{
 const old=inventory('panoramic'),missing=old.products.find(p=>p.sku);
 old.products=old.products.filter(p=>p!==missing);
 const price=old.products.find(p=>p.sku&&p.offerings[0].is_enabled);
 price.offerings[0].price=9999;
 const plan=planDefaultTemplateInventory({
   inventory:old,artworkId:'SAC0007',orientation:'panoramic',
   catalog,readinessStateId:12,buildInventory:buildOwnSilviaInventory
 });
 assert.equal(plan.previewOnly,true);
 assert.equal(plan.changed,true);
 assert.ok(plan.added.includes(missing.sku));
 assert.ok(plan.repriced.some(v=>v.sku===price.sku));
});

test('Etsy panoramic size variations retain thirteen distinct size values and both variation axes',()=>{
 const products=inventory('panoramic').products;
 assert.equal(products.length,13*6);
 const labels=new Set();
 for(let i=0;i<products.length;i+=6){
  const group=products.slice(i,i+6);
  const sizeLabel=group[0].property_values[0].values[0];
  assert.ok(sizeLabel.includes('″'),sizeLabel);
  assert.ok(!labels.has(sizeLabel),'Duplicate Etsy size label: '+sizeLabel);
  labels.add(sizeLabel);
  for(const row of group){
   assert.deepEqual(row.property_values.map(v=>v.property_id),[513,514]);
   assert.equal(row.property_values[0].values[0],sizeLabel);
   assert.equal(row.offerings.length,1);
  }
 }
 assert.equal(labels.size,13);
});
test('reconversion switches only the Etsy size ladder based on staged replacement pixels',()=>{
 const original={orientation:'landscape',master:{width:3000,height:2000}};
 const wide={orientation:'landscape',masterGeometry:{width:4000,height:2000,orientation:'landscape'}};
 assert.equal(listingLayoutForReconversion(original,null),'landscape');
 assert.equal(listingLayoutForReconversion(original,wide),'panoramic');
 assert.equal(listingLayoutForManifest(original),'landscape','Old R2 master remains unchanged while staged');
 const oldPanoramic={orientation:'landscape',master:{width:4000,height:2000}};
 const ordinary={orientation:'landscape',masterGeometry:{width:3000,height:2000,orientation:'landscape'}};
 assert.equal(listingLayoutForReconversion(oldPanoramic,ordinary),'landscape');
 assert.throws(()=>listingLayoutForReconversion(original,{orientation:'landscape'}),/dimensions/);
 assert.throws(()=>listingLayoutForReconversion(original,{
  orientation:'portrait',masterGeometry:{width:2000,height:3000,orientation:'portrait'}
 }),/orientation/);
});


test('mixed 2:1 and 3:1 panoramic sizes appear in ascending first-dimension order',()=>{
 const expected=["8x16","8x24","10x20","10x30","12x24","12x36","16x32","16x48","18x36","20x40","20x60","24x48","30x60"];
 assert.deepEqual(SILVIA_PANORAMIC_SIZES,expected);
 const products=inventory('panoramic').products;
 const displayed=products.filter((_,index)=>index%6===0)
  .map(product=>product.property_values[0].values[0].match(/\/\s*(\d+x\d+)″/)[1]);
 assert.deepEqual(displayed,expected,'Etsy should show smaller panoramic sizes before larger ones');
 const posters=products.filter(product=>
  product.offerings[0].is_enabled&&product.property_values[1].values[0]==='Matte Paper Poster'
 ).map(product=>product.property_values[0].values[0].match(/\/\s*(\d+x\d+)″/)[1]);
 // Low minimum prices on these five sizes are genuine enabled poster prices.
 assert.deepEqual(posters,['8x16','10x20','12x36','20x40','24x48']);
 assert.equal(inventory('panoramic').enabledCount,70);
});

test('an ordinary horizontal or vertical master gets only the regular ratios; square gets 1:1',()=>{
 const regular=['2x3','3x4','4x5','11x14','5x7','14x15'];
 const horizontal=createCropJobRecord({artworkId:'SAC0011',masterKey:'artworks/SAC0011/master.jpg',orientation:'landscape',width:6000,height:4000});
 assert.deepEqual(horizontal.ratios,regular);
 assert.deepEqual([...fulfillmentRatiosForOrientation('landscape',{width:3699,height:2000})],regular);
 assert.deepEqual([...fulfillmentRatiosForOrientation('portrait',{width:2000,height:6000})],regular);
 assert.deepEqual([...fulfillmentRatiosForOrientation('square',{width:3000,height:3000})],['1x1']);
 // Without a known size a horizontal master is not taken for panoramic.
 assert.deepEqual([...fulfillmentRatiosForOrientation('landscape')],regular);
});
