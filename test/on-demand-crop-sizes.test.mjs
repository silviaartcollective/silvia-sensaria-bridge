import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 normalizeCropSize,sizeCropRatioKey,sizeCropTarget,sizeCropObjectKey
} from '../src/size-crops.mjs';
import {createCropJobRecord,findReusableCropJob} from '../src/crop-job-store.mjs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('accepts arbitrary exact custom inches and uses stable safe identifiers',()=>{
 assert.equal(normalizeCropSize('5 × 3.5'),'3.5x5');
 assert.equal(normalizeCropSize('28x30'),'28x30');
 assert.equal(normalizeCropSize('60x40'),'40x60');
 assert.equal(normalizeCropSize({width:5.25,height:7}),'5.25x7');
 assert.equal(sizeCropRatioKey('3.5x5'),'size-3p5x5');
 assert.equal(sizeCropObjectKey('SAC0042','3.5x5'),
  'artworks/SAC0042/fulfillment/by-size/3p5x5.jpg');
 assert.notEqual(sizeCropObjectKey('SAC0042','8x12'),sizeCropObjectKey('SAC0042','12x18'));
 assert.throws(()=>normalizeCropSize('121x12'),/120/);
 assert.throws(()=>normalizeCropSize('5x0'),/120/);
 assert.throws(()=>normalizeCropSize('5x7.123'),/decimal/);
 assert.throws(()=>normalizeCropSize('../not-a-size'),/Enter a size/);
});

test('targets follow the stored master orientation at 300 PPI, not Etsy variants',()=>{
 assert.deepEqual(sizeCropTarget('3.5x5','portrait'),{width:1050,height:1500});
 assert.deepEqual(sizeCropTarget('3.5x5','landscape'),{width:1500,height:1050});
 assert.deepEqual(sizeCropTarget('5x5','square'),{width:1500,height:1500});
 assert.deepEqual(sizeCropTarget('28x30','landscape'),{width:9000,height:8400});
});

test('custom sizes and default crop jobs are distinct; same-size requests are reused',()=>{
 const base={artworkId:'SAC0042',masterKey:'artworks/SAC0042/source/master.jpg',
  orientation:'portrait'};
 const defaultJob=createCropJobRecord(base);
 const special=createCropJobRecord({...base,size:'3.5x5'});
 const identical=createCropJobRecord({...base,size:'5x3.5'});
 const different=createCropJobRecord({...base,size:'7x10'});
 const square=createCropJobRecord({...base,orientation:'square',size:'5x5'});
 assert.equal(defaultJob.size,null);
 assert.equal(special.size,'3.5x5');
 assert.deepEqual(special.ratios,['size-3p5x5']);
 assert.deepEqual(square.ratios,['size-5x5']);
 assert.equal(findReusableCropJob({jobs:[square]}, {...base,orientation:'square',size:'5x5'}).id,square.id);
 assert.ok(defaultJob.ratios.includes('2x3'));
 assert.equal(findReusableCropJob({jobs:[defaultJob,special]}, {...base,size:'5x3.5'}).id,special.id);
 assert.equal(findReusableCropJob({jobs:[defaultJob,special]},base).id,defaultJob.id);
 assert.equal(findReusableCropJob({jobs:[defaultJob,special]}, {...base,size:'7x10'}),null);
 assert.notEqual(different.size,identical.size);
 assert.throws(()=>createCropJobRecord({...base,orientation:'square'}),/square/i);
});

test('server saves on-demand crops separately and validates against source master',()=>{
 const server=read('src/server.mjs');
 const creator=read('src/product-creator.mjs');
 const custom=read('src/custom-size-page.mjs');
 assert.ok(server.includes('sizeCropTarget(job.size,job.orientation)'));
 assert.ok(server.includes('sizeCropObjectKey(job.artworkId,job.size)'));
 assert.ok(server.includes('latest.fulfillmentSizeCrops[currentJob.size]'));
 assert.ok(server.includes('latest.master?.key!==currentJob.masterKey'));
 assert.ok(server.includes('if (!job.size) await writeFulfillmentStatus'));
 assert.ok(server.includes('Shared PC Crop Worker v4.4.2 is required'));
 assert.ok(creator.includes('id="extra-crop-size"'));
 assert.ok(creator.includes('id="queue-extra-crop"'));
 assert.ok(custom.includes('id="custom-crop-artwork"'));
 assert.ok(custom.includes('id="custom-crop-queue"'));
});
