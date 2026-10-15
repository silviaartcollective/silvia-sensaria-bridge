import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {boundedProductionGeometry,MAX_PRODUCTION_FACE_PIXELS} from '../src/production-resolution.mjs';
import {renderProductionArtworkToFile} from '../src/production.mjs';

test('large canvas never upscales the 40x60 original',()=>{
 const dims=boundedProductionGeometry({sourceWidth:1200,sourceHeight:1800,targetWidth:12000,targetHeight:18000});
 assert.deepEqual(dims.crop,{left:0,top:0,width:1200,height:1800});
 assert.deepEqual(dims.output,{width:1200,height:1800});
 assert.equal(dims.upscaled,false);
});

test('oversized original is proportionally capped for Render memory',()=>{
 const dims=boundedProductionGeometry({sourceWidth:20000,sourceHeight:30000,targetWidth:12000,targetHeight:18000});
 assert.ok(dims.output.width*dims.output.height<=MAX_PRODUCTION_FACE_PIXELS);
 assert.ok(dims.output.width<=12000&&dims.output.height<=18000);
 assert.ok(dims.output.width<=dims.crop.width&&dims.output.height<=dims.crop.height);
});

test('40x60 framed canvas generates native-resolution source with 1.25-inch mirrored bleed',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'sensaria-csv-canvas-'));
 try{
  const input=join(folder,'source.jpg'),output=join(folder,'canvas.jpg');
  await sharp({create:{width:1200,height:1800,channels:3,background:'#9b8a79'}})
    .jpeg({quality:85}).toFile(input);
  await renderProductionArtworkToFile({input,outputPath:output,format:'FC',size:'40x60',orientation:'portrait'});
  const md=await sharp(output).metadata();
  // 1200/40=30 pixels per finished inch, 1.25-inch bleed=38px per side.
  assert.equal(md.width,1276);
  assert.equal(md.height,1876);
  assert.equal(md.format,'jpeg');
 }finally{await rm(folder,{recursive:true,force:true});}
});

test('5x7 poster scales down from master without enlarging it',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'sensaria-csv-poster-'));
 try{
  const input=join(folder,'source.jpg'),output=join(folder,'poster.jpg');
  await sharp({create:{width:2800,height:4200,channels:3,background:'#acb3a4'}})
    .jpeg({quality:85}).toFile(input);
  await renderProductionArtworkToFile({input,outputPath:output,format:'P',size:'5x7',orientation:'portrait'});
  const md=await sharp(output).metadata();
  assert.equal(md.width,1500);
  assert.equal(md.height,2100);
 }finally{await rm(folder,{recursive:true,force:true});}
});
