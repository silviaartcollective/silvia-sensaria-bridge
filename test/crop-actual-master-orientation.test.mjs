import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {masterGeometry} from '../src/master-geometry.mjs';
import {inspectMaster,validateRatioSource} from '../worker/crop.mjs';
import sharp from 'sharp';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {writeFile,rm} from 'node:fs/promises';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

test('image geometry identifies actual pixel orientation and EXIF rotation',()=>{
 assert.deepEqual(masterGeometry({width:6000,height:4000}),{width:6000,height:4000,orientation:'landscape'});
 assert.deepEqual(masterGeometry({width:4000,height:6000}),{width:4000,height:6000,orientation:'portrait'});
 assert.deepEqual(masterGeometry({width:4000,height:6000,orientation:6}),{width:6000,height:4000,orientation:'landscape'});
 assert.deepEqual(masterGeometry({width:6000,height:4000,orientation:8}),{width:4000,height:6000,orientation:'portrait'});
 assert.equal(masterGeometry({width:4000,height:4000}).orientation,'square');
 assert.throws(()=>masterGeometry({width:0,height:1000}),/dimensions/);
});
test('PC refuses portrait crop targets for a horizontal master',async()=>{
 const path=join(tmpdir(),'horizontal-master-'+randomUUID()+'.png');
 try{
  await writeFile(path,await sharp({create:{width:600,height:400,channels:3,background:'#d2d2d2'}}).png().toBuffer());
  await assert.rejects(inspectMaster(path,'portrait'),/orientation mismatch/i);
  const info=await inspectMaster(path,'landscape');
  assert.equal(info.orientation,'landscape');
  assert.ok(validateRatioSource(info,'3x4',{width:12000,height:9000}).required.width>
            validateRatioSource(info,'3x4',{width:12000,height:9000}).required.height);
 }finally{await rm(path,{force:true})}
});
test('R2 master metadata determines crop orientation, not form default',()=>{
 const storage=read('src/artwork-storage.mjs'),server=read('src/server.mjs'),ui=read('src/product-creator.mjs');
 assert.ok(storage.includes('inspectStoredMasterGeometry(manifest.master.key)'));
 assert.ok(storage.includes('manifest.orientation=geometry.orientation'));
 assert.ok(storage.includes('manifest.fulfillmentRatiosReady=false'));
 assert.ok(server.includes('const orientation=manifest.orientation;'));
 assert.ok(server.includes('orientation: manifest.orientation'));
 assert.ok(ui.includes('Auto detect from artwork'));
});
