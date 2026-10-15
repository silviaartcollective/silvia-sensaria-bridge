import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import sharp from 'sharp';
import {
 NativeMockupUnsupported,verifyNativeSmartObject,nativeSmartObjects,
 renderNativeScene,prepareNativePsd
} from '../worker/native-mockup.mjs';

const rect={left:60,top:60,width:100,height:100};
const transform=[60,60,160,60,160,160,60,160];

test('native PSD Smart Object strictly rejects skewed, perspective and warp transforms',()=>{
 assert.equal(verifyNativeSmartObject({placedLayer:{transform}},rect),true);
 assert.throws(()=>verifyNativeSmartObject({placedLayer:{transform:[60,60,180,60,160,160,60,160]}},rect),
  NativeMockupUnsupported);
 assert.throws(()=>verifyNativeSmartObject({placedLayer:{transform,warp:{style:'arc'}}},rect),
  NativeMockupUnsupported);
 assert.throws(()=>verifyNativeSmartObject({placedLayer:{transform:[]}},rect),
  NativeMockupUnsupported);
});

test('native parser discovers Photoshop Smart Object paths without guessing hidden layers',()=>{
 const psd={children:[
  {name:'Top',placedLayer:{},visible:false},
  {name:'Main Art',placedLayer:{},visible:true},
  {name:'Backdrop',children:[{name:'Inside',placedLayer:{},visible:true}],visible:true}
 ]};
 const found=nativeSmartObjects(psd);
 assert.deepEqual(found.map(r=>r.path),['0','1','2.0']);
 assert.deepEqual(found.map(r=>r.visible),[false,true,true]);
});

test('native compositor inserts artwork and preserves foreground overlays without browser',async()=>{
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'native-pod-test-'));
 try{
  const background=path.join(folder,'bg.png');
  const foreground=path.join(folder,'front.png');
  const mask=path.join(folder,'mask.png');
  const artwork=path.join(folder,'art.jpg');
  const out=path.join(folder,'out.jpg');
  const width=220,height=220;
  await sharp({create:{width,height,channels:4,background:'#dddddd'}}).png().toFile(background);
  const red=await sharp({create:{width:140,height:12,channels:4,background:'#ff0000'}})
   .png().toBuffer();
  await sharp({create:{width,height,channels:4,background:{r:0,g:0,b:0,alpha:0}}})
   .composite([{input:red,left:40,top:56}]).png().toFile(foreground);
  await sharp({create:{width:100,height:100,channels:4,background:'#ffffff'}})
   .png().toFile(mask);
  await sharp({create:{width:120,height:160,channels:3,background:'#1562e2'}})
   .jpeg().toFile(artwork);
  const report=await renderNativeScene({background,foreground,mask,artwork,slot:rect,
   outputPath:out,fitMode:'cover'});
  assert.equal(report.width,220);
  assert.equal(report.height,220);
  const {data,info}=await sharp(out).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const sample=(x,y)=>[...data.subarray((y*info.width+x)*4,(y*info.width+x)*4+3)];
  const center=sample(100,110),top=sample(100,60),outside=sample(12,12);
  assert.ok(center[2]>center[0]+100,'artwork blue must fill the Smart Object slot');
  assert.ok(top[0]>top[1]+100,'PSD foreground overlay must remain above the artwork');
  assert.ok(outside.every(c=>Math.abs(c-221)<15),'unaltered PSD background must be preserved');
 }finally{await fs.rm(folder,{recursive:true,force:true})}
});

test('unsupported PSB fails safely without generating an incorrect JPG',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pod-unsupported-'));
 try{
  await assert.rejects(()=>prepareNativePsd({psdPath:path.join(dir,'scene.psb')}),
   error=>error instanceof NativeMockupUnsupported&&/PSB/.test(error.message));
 }finally{await fs.rm(dir,{recursive:true,force:true})}
});

test('PC renderer tries native before Photopea and retains legacy fallback for complex PSDs',async()=>{
 const source=await fs.readFile(new URL('../worker/mockup-processor.mjs',import.meta.url),'utf8');
 assert.match(source,/POD_PSD_RENDERER\|\|'auto'/);
 assert.match(source,/renderMockupNative\(/);
 assert.match(source,/error instanceof NativeMockupUnsupported/);
 assert.match(source,/engine==='native'/);
 assert.match(source,/getWarmPhotopeaPage/);
});
