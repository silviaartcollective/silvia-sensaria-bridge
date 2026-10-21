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

test('a PSD both uploaded and in the PC folder is offered once, from the folder, with the upload\'s settings',async()=>{
 const {withoutUploadedTwins}=await import('../src/mockup-generator.mjs');
 const records=[
  {id:'u1',name:'BlackPNG.psd',status:'ready',key:'k1'},
  {id:'u2',name:'Bythewindow.psd',status:'ready',key:'k2'},
  {id:'u3',name:'Only uploaded.psd',status:'ready',key:'k3'},
  {id:'p1',name:'blackpng.psd',status:'ready',source:'pc',localPath:'Horizontal/blackpng.psd'},
  {id:'p2',name:'Bythewindow.psd',status:'ready',source:'pc',localPath:'Horizontal/Bythewindow.psd'},
  {id:'p3',name:'Only on PC.psd',status:'ready',source:'pc',localPath:'Vertical/Only on PC.psd'}];
 assert.deepEqual(withoutUploadedTwins(records).map(r=>r.id),['u3','p1','p2','p3']);
 // The upload comes back once the file leaves the folder.
 assert.deepEqual(withoutUploadedTwins(records.map(r=>r.id==='p2'?{...r,status:'deleted'}:r)).filter(r=>r.status!=='deleted').map(r=>r.id),['u2','u3','p1','p3']);
 const source=read('src/mockup-generator.mjs');
 assert.match(source,/return withoutUploadedTwins\(records\.filter\(x=>x\.status!=='deleted'\)\)/);
 assert.match(source,/if\(!record\.mapping\?\.path&&twin\.mapping\?\.path\)record\.mapping=\{\.\.\.twin\.mapping\};/);
});
