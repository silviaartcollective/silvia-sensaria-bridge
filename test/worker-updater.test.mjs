import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

// The updater's lock path is read at import: use a private one for these tests.
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'worker-updater-'));
process.env.POD_WORKER_LOCK_PATH=path.join(tmp,'worker.lock');
const updater=await import('../worker/updater.mjs');
const {workerUpdateBundle,workerUpdateText,heartbeatUpdate,compareWorkerVersions}=await import('../src/worker-update.mjs');
const {WORKER_VERSION}=await import('../worker/api.mjs');
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const file=(name,text)=>{const data=Buffer.from(text);return {name,data:data.toString('base64'),
 sha256:crypto.createHash('sha256').update(data).digest('hex')}};
test.after(()=>fs.rmSync(tmp,{recursive:true,force:true}));

test('versions compare numerically and updates come from the Silvia app unless configured',()=>{
 assert.equal(updater.compareVersions('4.10.0','4.9.9'),1);
 assert.equal(updater.compareVersions('4.6.0','4.6'),0);
 assert.equal(compareWorkerVersions('4.5.8','4.6.0'),-1);
 const apps=[{appUrl:'https://arte-antica-product-creator.onrender.com'},{appUrl:'https://silvia-sensaria-bridge.onrender.com'},
  {appUrl:'https://japandi-sensaria-bridge.onrender.com'}];
 assert.equal(updater.updateSource(apps).appUrl,apps[1].appUrl);
 assert.equal(updater.updateSource(apps,'https://japandi-sensaria-bridge.onrender.com/').appUrl,apps[2].appUrl);
 assert.equal(updater.updateSource([apps[0]]).appUrl,apps[0].appUrl);
});

test('the server offers the deployed worker files, which the worker accepts, without the PC\'s settings',()=>{
 const dir=path.join(tmp,'deployed');fs.mkdirSync(path.join(dir,'node_modules'),{recursive:true});
 const source=new URL('../worker/',import.meta.url);
 for(const name of fs.readdirSync(source))if(fs.statSync(new URL(name,source)).isFile())fs.copyFileSync(new URL(name,source),path.join(dir,name));
 fs.writeFileSync(path.join(dir,'config.local.json'),'{"apps":[{"workerToken":"secret"}]}');
 fs.writeFileSync(path.join(dir,'worker.log'),'log');
 const bundle=workerUpdateBundle(dir);
 assert.equal(bundle.version,WORKER_VERSION);
 const names=bundle.files.map(f=>f.name);
 for(const name of ['index.mjs','updater.mjs','update-worker.mjs','update-worker.cmd','package.json','start-worker.cmd'])assert.ok(names.includes(name),name);
 for(const name of ['config.local.json','worker.log','node_modules'])assert.ok(!names.includes(name),name);
 const verified=updater.verifyBundle(JSON.parse(JSON.stringify(bundle)));
 assert.equal(verified.version,WORKER_VERSION);
 assert.equal(verified.files.length,bundle.files.length);
});

test('an update with a bad checksum, an unsafe file name or the wrong version is refused',()=>{
 const base=['index.mjs','package.json','start-worker.cmd','update-worker.mjs','updater.mjs'].map(n=>file(n,'x'));
 const good={version:'9.0.0',files:[...base,file('api.mjs',"export const WORKER_VERSION = '9.0.0';")]};
 assert.equal(updater.verifyBundle(good).version,'9.0.0');
 assert.throws(()=>updater.verifyBundle({...good,files:[...good.files.slice(0,-1),{...file('api.mjs',"export const WORKER_VERSION = '9.0.0';"),sha256:'0'.repeat(64)}]}),/checksum/);
 assert.throws(()=>updater.verifyBundle({...good,files:[...good.files,file('../evil.mjs','x')]}),/invalid file name/);
 assert.throws(()=>updater.verifyBundle({...good,files:[...good.files,file('config.local.json','{}')]}),/invalid file name/);
 assert.throws(()=>updater.verifyBundle({...good,version:'9.0.1'}),/contains v9\.0\.0/);
 assert.throws(()=>updater.verifyBundle({version:'9.0.0',files:base}),/missing api\.mjs/);
});

// A stand-in worker: holds the lock while running, like index.mjs.
const fakeWorker=(label,lifeMs)=>`import fs from 'node:fs';
const lock=process.env.POD_WORKER_LOCK_PATH;
${lifeMs?`fs.writeFileSync(lock,String(process.pid));
process.on('exit',()=>{try{if(fs.readFileSync(lock,'utf8')===String(process.pid))fs.rmSync(lock)}catch{}});
setTimeout(()=>process.exit(0),${lifeMs});`:'process.exit(1);'}
// ${label}
`;
function workerDir(name){
 const dir=path.join(tmp,name);
 for(const dep of ['sharp','ag-psd'])fs.mkdirSync(path.join(dir,'node_modules',dep),{recursive:true});
 fs.writeFileSync(path.join(dir,'index.mjs'),fakeWorker('old worker',8000));
 fs.writeFileSync(path.join(dir,'package.json'),'{"type":"module"}');
 fs.writeFileSync(path.join(dir,'config.local.json'),'{"keep":true}');
 return dir;
}
const killRunning=async()=>{const pid=updater.runningWorkerPid();if(pid){process.kill(pid);await updater.waitForExit(pid,5000)}};
const health={startMs:8000,stableMs:1500};

test('a staged update is installed and the new worker started',async()=>{
 const dir=workerDir('install-ok'),updateDir=path.join(dir,'.update');
 const staged=await updater.stageUpdate({version:'9.0.0',files:[
  {name:'index.mjs',data:Buffer.from(fakeWorker('new worker',8000))},{name:'added.mjs',data:Buffer.from('// new file')}]},{updateDir});
 const result=await updater.installStaged(staged,{dir,updateDir,log:()=>{},health});
 try{
  assert.deepEqual(result,{ok:true,version:'9.0.0'});
  assert.match(fs.readFileSync(path.join(dir,'index.mjs'),'utf8'),/new worker/);
  assert.ok(fs.existsSync(path.join(dir,'added.mjs')));
  assert.equal(fs.readFileSync(path.join(dir,'config.local.json'),'utf8'),'{"keep":true}');
  assert.ok(updater.runningWorkerPid()>0,'the new worker is running');
  assert.ok(!fs.existsSync(staged),'the download is cleared');
 }finally{await killRunning()}
});

test('a new worker that does not start is rolled back, the old one restarted, and that version paused',async()=>{
 const dir=workerDir('install-broken'),updateDir=path.join(dir,'.update');
 const staged=await updater.stageUpdate({version:'9.0.1',files:[
  {name:'index.mjs',data:Buffer.from(fakeWorker('broken worker',0))},{name:'added.mjs',data:Buffer.from('// new file')}]},{updateDir});
 const result=await updater.installStaged(staged,{dir,updateDir,log:()=>{},health});
 try{
  assert.equal(result.ok,false);
  assert.match(fs.readFileSync(path.join(dir,'index.mjs'),'utf8'),/old worker/);
  assert.ok(!fs.existsSync(path.join(dir,'added.mjs')),'files the update added are removed');
  assert.ok(updater.recentFailure('9.0.1',{updateDir}),'the failed version is not retried straight away');
  assert.equal(updater.recentFailure('9.0.2',{updateDir}),null);
  const deadline=Date.now()+8000;
  while(!updater.runningWorkerPid()&&Date.now()<deadline)await new Promise(r=>setTimeout(r,200));
  assert.ok(updater.runningWorkerPid()>0,'the previous worker is running again');
 }finally{await killRunning()}
});

test('the worker installs a downloaded update only when idle, then hands over and exits',()=>{
 const worker=read('worker/index.mjs');
 assert.match(worker,/if\(app===UPDATE_SOURCE\)void considerUpdate\(reply\?\.latestWorkerVersion\)/);
 assert.match(worker,/if\(!stagedUpdate\|\|stopping\|\|active\.size\|\|Date\.now\(\)-lastWorkAt<UPDATE_IDLE_MS\)return;/);
 assert.match(worker,/'--apply',update\.dir,'--after',String\(process\.pid\)/);
 assert.match(worker,/await Promise\.race\(\[sleep\(WARM_UP_EVERY_MS\),stopped,warmUpRequested\]\)/);
 assert.match(worker,/update:updateState,autoUpdate:AUTO_UPDATE/);
 assert.match(read('worker/update-worker.cmd'),/node update-worker\.mjs %\*/);
 assert.match(read('.gitignore'),/worker\/\.update\//);
});

test('dashboards say when the worker is outdated, downloading, waiting, updating or failed',()=>{
 const base={online:true,version:'4.6.0',latestVersion:'4.6.1'};
 assert.equal(workerUpdateText({...base,latestVersion:'4.6.0'}),'');
 assert.match(workerUpdateText({...base,update:{state:'downloading',to:'4.6.1'}}),/outdated · downloading v4\.6\.1/);
 assert.match(workerUpdateText({...base,update:{state:'waiting',to:'4.6.1'}}),/installs as soon as the current work is done/);
 assert.match(workerUpdateText({...base,update:{state:'failed',to:'4.6.1',error:'npm install failed'}}),/failed: npm install failed\. Run update-worker\.cmd/);
 assert.match(workerUpdateText({...base,online:false,restarting:true,update:{state:'restarting',to:'4.6.1'}}),/Updating the PC worker to v4\.6\.1\. It restarts/);
 assert.match(workerUpdateText({...base,version:'4.5.8'}),/Install the new worker folder once/);
 assert.match(workerUpdateText({...base,autoUpdate:false}),/Run update-worker\.cmd/);
 assert.match(workerUpdateText(base),/updating to v4\.6\.1 shortly/);
 assert.equal(heartbeatUpdate({state:'hacked'}),null);
 assert.equal(heartbeatUpdate({state:'waiting',to:'x'.repeat(50)}).to.length,20);
 const server=read('src/server.mjs');
 assert.match(server,/url\.pathname === '\/api\/crop-worker\/update'\) \{\n    if \(!requireCropWorker\(req, res\)\) return;/);
 assert.match(server,/latestWorkerVersion: latestWorkerVersion\(\)/);
 // Crop claims and progress also record a heartbeat; they must not clear the update state.
 assert.match(server,/update: 'update' in input \? heartbeatUpdate\(input\.update\) : cropWorkerHeartbeat\.update \|\| null/);
 assert.match(read('src/mockup-generator-client.js'),/worker\.updateText&&\(fixed\|\|worker\.updating\)/);
});
