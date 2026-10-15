import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {rm} from 'node:fs/promises';
import sharp from 'sharp';
import {inspectMaster,validateRatioSource,generateProductionCrop} from '../worker/crop.mjs';
import {FULFILLMENT_RATIOS,fulfillmentRatioForSize} from '../src/artwork-ratios.mjs';
import {productionSpecFor} from '../src/production.mjs';
import {SILVIA_SIZES,buildOwnSilviaInventory} from '../src/variants.mjs';

const data=path=>JSON.parse(readFileSync(new URL('../'+path,import.meta.url),'utf8'));

test('all three sizes have correct ratios and documented production formats',()=>{
 assert.equal(fulfillmentRatioForSize('5x7'),'5x7');
 assert.equal(fulfillmentRatioForSize('8x12'),'2x3');
 assert.equal(fulfillmentRatioForSize('28x30'),'14x15');
 assert.ok(FULFILLMENT_RATIOS.includes('14x15') && FULFILLMENT_RATIOS.includes('5x7'));
 assert.ok(['5x7','8x12','28x30'].every(size=>SILVIA_SIZES.includes(size)));
 assert.deepEqual(productionSpecFor({format:'P',size:'5x7'}).output,{width:1500,height:2100});
 assert.deepEqual(productionSpecFor({format:'P',size:'8x12'}).output,{width:2400,height:3600});
 assert.deepEqual(productionSpecFor({format:'P',size:'28x30'}).output,{width:8400,height:9000});
 assert.deepEqual(productionSpecFor({format:'C',size:'28x30'}).face,{width:8400,height:9000});
 assert.equal(productionSpecFor({format:'C',size:'28x30'}).template,null);
});

test('two poster SKUs are enabled; 28x30 stays unfulfillable until a real supplier SKU exists',()=>{
 const catalog=data('config/products.json');
 const matrix=data('config/size-matrix.json');
 assert.equal(catalog['P|5x7|NONE'].friendlySku,'42010000029');
 assert.equal(catalog['P|8x12|NONE'].friendlySku,'42010000035');
 assert.equal(catalog['P|28x30|NONE'],undefined);
 assert.equal(catalog['C|28x30|NONE'],undefined);
 assert.equal(matrix['28x30'].canvas,false);
 const inventory=buildOwnSilviaInventory({artworkId:'SAC1234',catalog,readinessStateId:123});
 const bySku=sku=>inventory.products.find(row=>row.sku===sku);
 assert.ok(bySku('SAC1234-P-57').offerings[0].is_enabled);
 assert.ok(bySku('SAC1234-P-812').offerings[0].is_enabled);
 const pending=inventory.products.filter(row=>row.property_values[0].values[0].includes('28x30'));
 assert.equal(pending.length,6);
 assert.ok(pending.every(row=>row.offerings[0].is_enabled===false));
});

test('crop targets below or above master never enlarge native pixel data',async()=>{
 const source=join(tmpdir(),'crop-src-'+randomUUID()+'.png');
 const output=join(tmpdir(),'crop-out-'+randomUUID()+'.jpg');
 try{
  await sharp({create:{width:900,height:1350,channels:3,background:'#7292a3'}}).png().toFile(source);
  const master=await inspectMaster(source,'portrait');
  for(const [ratio,dimensions] of [
   ['2x3',{width:12000,height:18000}],
   ['5x7',{width:1500,height:2100}],
   ['14x15',{width:8400,height:9000}],
   ['3x4',{width:9000,height:12000}]
  ]){
   const valid=validateRatioSource(master,ratio,dimensions);
   assert.equal(valid.upscaled,false);
   assert.equal(valid.recommendedPixelsMet,false);
   const result=await generateProductionCrop({masterPath:source,outputPath:output,master,ratio,target:dimensions});
   assert.equal(result.upscaled,false);
   assert.equal(result.width,valid.crop.width);
   assert.equal(result.height,valid.crop.height);
   assert.ok(result.width<=master.width && result.height<=master.height);
   const metadata=await sharp(output).metadata();
   assert.equal(metadata.width,result.width);
   assert.equal(metadata.height,result.height);
  }
 }finally{await Promise.all([rm(source,{force:true}),rm(output,{force:true})]);}
});

test('small-format files are proportionally downsized when the master has more pixels',async()=>{
 const source=join(tmpdir(),'crop-large-'+randomUUID()+'.png');
 const output=join(tmpdir(),'crop-small-'+randomUUID()+'.jpg');
 try{
  await sharp({create:{width:3000,height:4500,channels:3,background:'#c4c8c4'}}).png().toFile(source);
  const master=await inspectMaster(source,'portrait');
  const target={width:1500,height:2100};
  const plan=validateRatioSource(master,'5x7',target);
  assert.deepEqual(plan.crop,{width:3000,height:4200});
  assert.deepEqual(plan.output,{width:1500,height:2100});
  assert.equal(plan.upscaled,false);
  const done=await generateProductionCrop({masterPath:source,outputPath:output,master,ratio:'5x7',target});
  assert.equal(done.width,1500);
  assert.equal(done.height,2100);
  assert.equal(done.downscaled,true);
  const meta=await sharp(output).metadata();
  assert.deepEqual([meta.width,meta.height],[1500,2100]);
 }finally{await Promise.all([rm(source,{force:true}),rm(output,{force:true})]);}
});

test('server does not accept legacy 300-PPI output or forget new ratios',()=>{
 const server=readFileSync(new URL('../src/server.mjs',import.meta.url),'utf8');
 assert.ok(server.includes('Shared PC Crop Worker v4.4.1 is required'));
 assert.ok(server.includes('width > sourceCropWidth || height > sourceCropHeight'));
 assert.ok(server.includes('FULFILLMENT_RATIOS.some('));
});
