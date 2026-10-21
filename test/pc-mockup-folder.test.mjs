import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pcTemplateId,orientationFromFolder} from '../src/mockup-generator.mjs';
import {scanMockupFolder,mockupFolderFile,localPsdVersion,orientationFromShape} from '../worker/local-templates.mjs';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');

test('a PC folder PSD keeps one template ID for its path, and folder names give its orientation',()=>{
 assert.equal(pcTemplateId('Vertical/Room 1.psd'),pcTemplateId('vertical/room 1.PSD'.replace('PSD','psd')));
 assert.notEqual(pcTemplateId('Vertical/Room 1.psd'),pcTemplateId('Vertical/Room 2.psd'));
 assert.match(pcTemplateId('a.psd'),/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
 assert.equal(orientationFromFolder('Vertical/Room 1.psd'),'portrait');
 assert.equal(orientationFromFolder('Living rooms/Horizontals/a.psd'),'landscape');
 assert.equal(orientationFromFolder('Square/a.psb'),'square');
 assert.equal(orientationFromFolder('Room vertical.psd'),'','the file name itself does not count');
 assert.equal(orientationFromShape({width:2400,height:3000}),'portrait');
 assert.equal(orientationFromShape({width:3000,height:2000}),'landscape');
 assert.equal(orientationFromShape({width:1000,height:1020}),'square');
});

test('the worker scans PSDs in the folder and subfolders, skipping temporary files, and never reads outside it',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'mockups-'));
 try{
  fs.mkdirSync(path.join(root,'Vertical'));fs.mkdirSync(path.join(root,'.hidden'));
  fs.writeFileSync(path.join(root,'Vertical','Room 1.psd'),Buffer.alloc(500));
  fs.writeFileSync(path.join(root,'Big.psb'),Buffer.alloc(800));
  fs.writeFileSync(path.join(root,'~Room 1.psd'),Buffer.alloc(500));
  fs.writeFileSync(path.join(root,'.hidden','x.psd'),Buffer.alloc(500));
  fs.writeFileSync(path.join(root,'notes.txt'),'x');
  fs.writeFileSync(path.join(root,'tiny.psd'),'x');
  const files=await scanMockupFolder(root);
  assert.deepEqual(files.map(f=>f.path),['Big.psb','Vertical/Room 1.psd']);
  assert.equal(files[1].size,500);
  assert.ok(files[1].mtimeMs>0);
  assert.equal(mockupFolderFile(root,'Vertical/Room 1.psd'),path.join(root,'Vertical','Room 1.psd'));
  assert.throws(()=>mockupFolderFile(root,'../secret.psd'),/outside the mockup folder/);
  await assert.rejects(()=>scanMockupFolder(path.join(root,'missing')),/Mockup folder not found/);
  assert.notEqual(localPsdVersion('a.psd',1000),localPsdVersion('a.psd',2000),'an edit makes a new version');
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});

test('PC templates render from the file: no R2 link, prepared again when edited, and only removable on the PC',()=>{
 const api=read('src/mockup-api.mjs'),gen=read('src/mockup-generator.mjs'),worker=read('worker/index.mjs'),native=read('worker/native-mockup.mjs');
 assert.match(api,/templateUrl:template\.source==='pc'\?null:/);
 assert.match(gen,/if\(r\.source==='pc'\)throw Error\('"'\+r\.name\+'" comes from the mockup folder on the PC/);
 // A PSD no longer in the folder is no longer offered.
 assert.match(gen,/if\(!seen\.has\(record\.id\)&&record\.status!=='deleted'\)\{\s*record\.status='deleted'/);
 // The app's orientation choice wins over the folder name and the detected shape.
 assert.match(gen,/if\(folderOrientation&&record\.orientationSource!=='user'\)/);
 assert.match(gen,/if\(record\.source!=='pc'\|\|\['user','folder','uploaded'\]\.includes\(record\.orientationSource\)\)return record;/);
 assert.match(worker,/const local=await localTemplateFile\(app,claim\.template\);/);
 assert.match(native,/PREP_VERSION, \.\.\.\(psdVersion \? \[String\(psdVersion\)\] : \[\]\)/);
 // The folder can be set in the Product Creator; config.local.json wins.
 assert.match(read('src/server.mjs'),/mockupFolder: await getPcMockupFolder\(\)/);
 assert.match(worker,/if\(!app\.configMockupFolder&&typeof reply\?\.mockupFolder==='string'/);
 assert.match(read('src/mockup-generator-ui.mjs'),/id="mg-pc-folder"/);
});

test('one folder: its Vertical, Horizontal and Square subfolders sort the PSDs, and the example path shows its backslashes',async()=>{
 for(const [file,kind] of [['Vertical/a.psd','portrait'],['VERTICAL MOCKUPS/a.psd','portrait'],['Horizontal/b.psd','landscape'],
  ['Horizontals/Living/c.psd','landscape'],['Square/d.psb','square'],['Other/e.psd','']])
  assert.equal(orientationFromFolder(file),kind,file);
 const {renderMockupGeneratorSection}=await import('../src/mockup-generator-ui.mjs');
 assert.match(renderMockupGeneratorSection(),/placeholder="e\.g\. D:\\Mockups\\Silvia"/);
 assert.match(read('src/mockup-generator-client.js'),/\[count\('portrait'\),'vertical'\],\[count\('landscape'\),'horizontal'\],\[count\('square'\),'square'\]/);
});

test('while the PC folder holds PSDs the template list is exactly the folder; renamed uploads cannot render twice',async()=>{
 const {folderOrUploads}=await import('../src/mockup-generator.mjs');
 const records=[
  {id:'u1',name:'Close up framed dark wood mockup.psd',status:'ready',key:'k1',size:5000},
  {id:'u2',name:'Only uploaded.psd',status:'ready',key:'k2'},
  {id:'p1',name:'Horizontal Close up framed dark wood mockup.psd',status:'ready',source:'pc',size:5000,
   localPath:'Horizontal/Horizontal Close up framed dark wood mockup.psd'},
  {id:'p2',name:'Room.psd',status:'ready',source:'pc',localPath:'Vertical/Room.psd'}];
 assert.deepEqual(folderOrUploads(records).map(r=>r.id),['p1','p2']);
 // With no folder PSDs, the uploaded library is offered as before.
 assert.deepEqual(folderOrUploads(records.filter(r=>r.source!=='pc')).map(r=>r.id),['u1','u2']);
 const source=read('src/mockup-generator.mjs');
 assert.match(source,/return folderOrUploads\(records\.filter\(x=>x\.status!=='deleted'\)\)/);
 // A renamed upload is recognised by its size, so its settings still carry over.
 assert.match(source,/const twin=uploaded\.get\(twinName\(record\)\)\|\|uploadedBySize\.get\(size\);/);
 assert.match(source,/if\(!record\.mapping\?\.path&&twin\.mapping\?\.path\)record\.mapping=\{\.\.\.twin\.mapping\};/);
});

test('the artwork fills the template\'s artwork layer instead of leaving white bands',()=>{
 assert.match(read('src/mockup-generator.mjs'),/export async function createMockupJob\(\{filename,size,templateIds,fitMode='cover',/);
 assert.match(read('src/mockup-api.mjs'),/fitMode:body\.fitMode\|\|'cover'/);
 const client=read('src/mockup-generator-client.js');
 assert.equal((client.match(/fitMode:'cover'/g)||[]).length,2);
 assert.doesNotMatch(client,/fitMode:'contain'/);
});

test('the chosen folder\'s own name sorts the PSDs directly in it, and unsorted ones are named, not silently skipped',()=>{
 // "Silvia Mockups\\Silvia Art Co Horizontal" chosen, PSDs directly inside it.
 assert.equal(orientationFromFolder('mockup 19.psd','D:\\Silvia Mockups\\Silvia Art Co Horizontal'),'landscape');
 assert.equal(orientationFromFolder('Silvia Art Co Horizontal/mockup 19.psd','D:\\Silvia Mockups'),'landscape');
 // The folder nearest the file wins.
 assert.equal(orientationFromFolder('Vertical/a.psd','D:\\Mockups\\Horizontal'),'portrait');
 assert.equal(orientationFromFolder('a.psd','D:\\Silvia Mockups'),'');
 assert.match(read('src/mockup-api.mjs'),/syncPcTemplates\(body\.files,\{mockupFolder:await getPcMockupFolder\(\)\}\)/);
 assert.match(read('src/mockup-generator-client.js'),/not sorted yet and left out: /);
});
