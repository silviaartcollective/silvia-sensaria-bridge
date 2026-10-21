import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {renderProductCreator} from '../src/product-creator.mjs';

// The Product Creator's own preset code, as the browser receives it.
const html=renderProductCreator();
const script=html.slice(html.indexOf('<script>')+8,html.indexOf('</script>',html.indexOf('<script>')));
const from=script.indexOf('function presetRoleForFile('),to=script.indexOf('async function installPresetMedia(');
const plan=(files,installed=[])=>{
 const context={};
 vm.runInNewContext(script.slice(from,to)+';lastPresetStatus={items:'+JSON.stringify(installed.map(role=>({role,exists:true})))+'};'+
  'this.plan=files=>presetUploadPlan(files).map(x=>x.role+"="+x.file.name);',context);
 return [...context.plan(files.map(name=>({name,type:/\.(mov|mp4)$/i.test(name)?'video/quicktime':'image/jpeg'})))];
};

test('preset media is optional: any of the 3 images and the video can be installed',()=>{
 assert.deepEqual(plan(['Choose Option.jpeg','Promotion.jpg','Video.mov']),
  ['choose-option=Choose Option.jpeg','promotion=Promotion.jpg','video=Video.mov']);
 assert.deepEqual(plan(['Video.mov']),['video=Video.mov']);
 // Images without a slot name fill the empty image slots first.
 assert.deepEqual(plan(['IMG_1.jpg'],['choose-option']),['choose-frame=IMG_1.jpg']);
 assert.deepEqual(plan(['Frame.png','IMG_1.jpg','IMG_2.jpg']),
  ['choose-frame=Frame.png','choose-option=IMG_1.jpg','promotion=IMG_2.jpg']);
 // Capped at 3 images and 1 video.
 assert.throws(()=>plan(['a.jpg','b.jpg','c.jpg','d.jpg']),/3 preset images at most \(4 selected\)/);
 assert.throws(()=>plan(['Video.mov','Clip.mp4']),/1 preset video at most/);
 assert.throws(()=>plan([]),/up to 3 preset images and 1 video/);
 assert.throws(()=>plan(['Option 1.jpg','Option 2.jpg']),/Two images are named like Choose Option/);
 // The video extension check survives the page's template string.
 assert.match(script,/\/\\\.\(mov\|mp4\|m4v\)\$\//);
 assert.doesNotMatch(html,/Select exactly the 3 preset images/);
 assert.match(html,/up to 3 images \+ 1 video/);
});

test('the server installs only the preset slots sent, one file each, and the readiness check does not require all four',()=>{
 const server=readFileSync(new URL('../src/server.mjs',import.meta.url),'utf8');
 assert.match(server,/PRESET_MEDIA\.filter\(\(item\) => roles\.includes\(item\.role\)\)/);
 assert.match(server,/Each preset slot takes one file\./);
 assert.doesNotMatch(server,/Missing preset file:/);
 const readiness=readFileSync(new URL('../src/readiness-page.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(readiness,/d=>d\.configured===true,'Ready'/);
});
