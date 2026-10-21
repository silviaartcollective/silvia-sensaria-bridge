import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {
 PANORAMIC_RATIO,mockupOrientationFromPixels,mockupOrientationOf,normalizeTemplateOrientation,
 templateMatchesArtwork,validateTemplateSelection,artworkOrientationFromPixels
} from '../src/mockup-orientation.mjs';
import {orientationFromFolder} from '../src/mockup-generator.mjs';
import {listingLayoutForManifest} from '../src/panoramic-layout.mjs';
import * as local from '../worker/local-templates.mjs';

const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');

test('an artwork 1.85:1 or wider is panoramic for mockups, still landscape for crops',()=>{
 assert.equal(mockupOrientationFromPixels(6000,2000),'panoramic');
 assert.equal(mockupOrientationFromPixels(3600,1800),'panoramic');
 assert.equal(mockupOrientationFromPixels(3800,2000),'panoramic');
 assert.equal(mockupOrientationFromPixels(3740,2000),'panoramic');
 assert.equal(mockupOrientationFromPixels(3640,2000),'landscape');
 assert.equal(mockupOrientationFromPixels(1920,1080),'landscape');
 assert.equal(mockupOrientationFromPixels(3000,2000),'landscape');
 assert.equal(mockupOrientationFromPixels(2000,6000),'portrait');
 assert.equal(mockupOrientationFromPixels(3000,3000),'square');
 assert.equal(artworkOrientationFromPixels(6000,2000),'landscape');
 // An uploaded artwork: from its stored master's size, else its orientation.
 assert.equal(mockupOrientationOf({orientation:'landscape',master:{width:7200,height:2400}}),'panoramic');
 assert.equal(mockupOrientationOf({orientation:'landscape',master:{width:6000,height:4000}}),'landscape');
 assert.equal(mockupOrientationOf({orientation:'portrait',master:{}}),'portrait');
 // Exactly the artworks whose Etsy listing gets the panoramic sizes get panoramic mockups.
 for(const [width,height] of [[3700,2000],[3699,2000],[3740,2000],[3800,2000],[6000,2000],[3000,2000],[2000,3000],[2000,2000]]){
  const manifest={orientation:artworkOrientationFromPixels(width,height),master:{width,height}};
  assert.equal(mockupOrientationOf(manifest)==='panoramic',listingLayoutForManifest(manifest)==='panoramic',width+'×'+height);
 }
});

test('panoramic artwork gets panoramic templates only, and horizontal artwork never gets them',()=>{
 assert.equal(normalizeTemplateOrientation('Panoramic'),'panoramic');
 assert.equal(normalizeTemplateOrientation('panorama'),'panoramic');
 const pano={name:'Long sofa.psd',orientation:'panoramic'},wide={name:'Living room.psd',orientation:'landscape'};
 assert.equal(templateMatchesArtwork(pano,'panoramic'),true);
 assert.equal(templateMatchesArtwork(wide,'panoramic'),false);
 assert.equal(templateMatchesArtwork(pano,'landscape'),false);
 assert.deepEqual(validateTemplateSelection([pano],'panoramic'),[pano]);
 assert.throws(()=>validateTemplateSelection([wide],'panoramic'),/not designated for panoramic artwork/);
});

test('a Panoramic folder sorts PSDs, before any other word in the same folder name',()=>{
 assert.equal(orientationFromFolder('Panoramic/Long sofa.psd'),'panoramic');
 assert.equal(orientationFromFolder('Panorama/a.psd'),'panoramic');
 assert.equal(orientationFromFolder('Horizontal Panoramic/a.psd'),'panoramic');
 assert.equal(orientationFromFolder('Horizontal/Panos/a.psd'),'panoramic');
 assert.equal(orientationFromFolder('Horizontal/a.psd'),'landscape');
 assert.equal(orientationFromFolder('a.psd','D:\\Mockups\\Silvia Panoramic'),'panoramic');
 // "Panoramic" inside a file name is not a folder.
 assert.equal(orientationFromFolder('Vertical/panoramic view.psd'),'portrait');
});

test('the PC worker tells a panoramic template from its artwork layer, with the shop\'s ratio',()=>{
 assert.equal(local.PANORAMIC_RATIO,PANORAMIC_RATIO);
 assert.equal(local.orientationFromShape({width:3000,height:1000}),'panoramic');
 assert.equal(local.orientationFromShape({width:1900,height:1000}),'panoramic');
 assert.equal(local.orientationFromShape({width:1850,height:1000}),'panoramic');
 assert.equal(local.orientationFromShape({width:1800,height:1000}),'landscape');
 assert.equal(local.orientationFromShape({width:1000,height:3000}),'portrait');
 assert.equal(local.orientationFromShape({width:1000,height:1020}),'square');
 assert.match(read('worker/api.mjs'),/WORKER_VERSION = '4\.7\.5'/);
});

test('the Product Creator detects panoramic artwork and offers the Panoramic orientation',()=>{
 const client=read('src/mockup-generator-client.js');
 const pick=name=>client.slice(client.indexOf('function '+name+'('),client.indexOf('\nfunction ',client.indexOf('function '+name+'(')+10));
 const context={};
 vm.runInNewContext(client.match(/const PANORAMIC_RATIO=[^;]+;/)[0]+pick('mockupOrientation')+pick('templateFitsOrientation')+
  ';this.ratio=PANORAMIC_RATIO;this.of=mockupOrientation;this.fits=templateFitsOrientation;',context);
 assert.equal(context.ratio,PANORAMIC_RATIO);
 for(const [w,h] of [[6000,2000],[3800,2000],[3740,2000],[3640,2000],[1920,1080],[2000,6000],[3000,3000]])
  assert.equal(context.of(w,h),mockupOrientationFromPixels(w,h),w+'×'+h);
 assert.equal(context.fits({orientation:'panoramic'},'panoramic'),true);
 assert.equal(context.fits({orientation:'landscape'},'panoramic'),false);
 assert.match(client,/\['panoramic','Panoramic'\]/);
 assert.match(client,/panoramic:'panoramic'/);
 assert.match(client,/\[count\('panoramic'\),'panoramic'\]/);
 // The stored master's size keeps a panoramic artwork panoramic after upload.
 assert.match(client,/Number\(info\.width\)>0&&Number\(info\.height\)>0\?mockupOrientation/);
 const creator=read('src/product-creator.mjs');
 assert.equal((creator.match(/width:(?:verified|completed)\.manifest\?\.master\?\.width/g)||[]).length,2);
 // Batches made on the server use the same rule.
 const api=read('src/mockup-api.mjs');
 assert.equal((api.match(/mockupOrientationOf\(manifest\)/g)||[]).length,2);
});
