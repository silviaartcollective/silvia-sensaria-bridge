import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 buildOwnSilviaInventory,
 SILVIA_SIZES,SILVIA_SQUARE_SIZES
} from '../src/variants.mjs';
import {parseSilviaSku} from '../src/core.mjs';
import {fulfillmentRatioForSize,fulfillmentRatiosForOrientation,FULFILLMENT_RATIOS} from '../src/artwork-ratios.mjs';
import {createCropJobRecord} from '../src/crop-job-store.mjs';
import {productionSpecFor} from '../src/production.mjs';
const load=name=>JSON.parse(readFileSync(new URL('../config/'+name,import.meta.url),'utf8'));
const catalog=load('products.json'),go=load('go-products.json'),cost=load('sensaria-costs.json');
const sizes=["5x5","8x8","10x10","12x12","16x16","18x18","20x20","24x24","30x30","36x36","40x40"];
const build=orientation=>buildOwnSilviaInventory({
 artworkId:'SAC0042',catalog,readinessStateId:123,orientation
});
test('square and rectangular listing size sets stay separate',()=>{
 assert.deepEqual([...SILVIA_SQUARE_SIZES],sizes);
 assert.ok(SILVIA_SIZES.includes('20x30'));
 assert.ok(!SILVIA_SIZES.includes('20x20'));
 for(const orientation of ['portrait','landscape','square']){
  const inventory=build(orientation);
  const enabled=inventory.products.filter(p=>p.offerings[0].is_enabled);
  assert.ok(enabled.length);
  for(const row of enabled){
    const parsed=parseSilviaSku(row.sku);
    const isSquare=parsed.size.split('x')[0]===parsed.size.split('x')[1];
    assert.equal(isSquare,orientation==='square',row.sku);
  }
 }
});
test('every enabled square SKU has valid Sensaria and GO codes, costs, and a 1x1 crop ratio',()=>{
 const inventory=build('square'),enabled=inventory.products.filter(p=>p.offerings[0].is_enabled);
 assert.ok(enabled.some(p=>p.sku==='SAC0042-P-55'));
 assert.ok(!enabled.some(p=>p.sku.includes('-FC-55-')));
 for(const item of enabled){
   const parsed=parseSilviaSku(item.sku);
   const key=[parsed.format,parsed.size,parsed.frame].join('|');
   assert.ok(catalog[key]?.friendlySku,key);
   assert.ok(go[key]?.productCode,key);
   assert.ok(Number(cost[parsed.format]?.[parsed.size])>0,key);
   assert.equal(fulfillmentRatioForSize(parsed.size),'1x1');
   assert.ok(Number(item.offerings[0].price)>0,key);
 }
 assert.equal(enabled.length,9+9*1+10*4); // 5x5 poster + 8 other posters; 10 canvases and four frame colors.
});
test('20x30 is enabled for every product style in portrait and landscape listings',()=>{
 for(const orientation of ['portrait','landscape']){
  const enabled=build(orientation).products.filter(p=>p.offerings[0].is_enabled);
  const thirty=enabled.filter(p=>p.sku.includes('-2030'));
  assert.equal(thirty.length,6);
  assert.deepEqual(new Set(thirty.map(p=>parseSilviaSku(p.sku).format)),new Set(['P','C','FC']));
  for(const p of thirty){
   const parsed=parseSilviaSku(p.sku);
   const key=[parsed.format,parsed.size,parsed.frame].join('|');
   assert.ok(catalog[key]?.friendlySku&&go[key]?.productCode,key);
  }
 }
 assert.equal(fulfillmentRatioForSize('20x30'),'2x3');
 assert.deepEqual(productionSpecFor({format:'P',size:'20x30'}).output,{width:6000,height:9000});
 assert.deepEqual(productionSpecFor({format:'FC',size:'20x30',orientation:'landscape'}).face,{width:9000,height:6000});
});
test('worker default crop job preserves 1x1 for square and normal ratios for rectangles',()=>{
 const base={artworkId:'SAC0042',masterKey:'artworks/SAC0042/source/master.jpg'};
 const sq=createCropJobRecord({...base,orientation:'square'});
 const rect=createCropJobRecord({...base,orientation:'portrait'});
 assert.deepEqual(sq.ratios,['1x1']);
 assert.deepEqual(rect.ratios,[...FULFILLMENT_RATIOS]);
 assert.deepEqual([...fulfillmentRatiosForOrientation('square')],['1x1']);
 assert.deepEqual(productionSpecFor({format:'C',size:'40x40',orientation:'square'}).face,{width:12000,height:12000});
});
test('worker defaults to topmost visible Smart Object without overriding manual mapping',()=>{
 const worker=readFileSync(new URL('../worker/native-mockup.mjs',import.meta.url),'utf8');
 assert.match(worker,/const topFirst=visible\.slice\(\)\.sort/);
 assert.match(worker,/const chosen=wanted!=null/);
});
