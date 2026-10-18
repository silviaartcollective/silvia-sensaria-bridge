// Self-update for the shared PC worker.
// Updates come from ONE shop, normally the Silvia app (the repo the worker is
// installed from): its server serves the worker files it was deployed with.
// Every file is checked against its SHA-256, only plain file names in the
// worker folder are accepted, and an older version is never installed. The
// replaced files are kept, so an update whose worker does not start is undone.
import fs from 'node:fs';
import {copyFile,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export const WORKER_DIR=path.dirname(fileURLToPath(import.meta.url));
export const UPDATE_DIR=path.join(WORKER_DIR,'.update');
// The running worker writes its process ID here (stop-worker.cmd reads it too).
export const LOCK_PATH=process.env.POD_WORKER_LOCK_PATH||path.join(os.tmpdir(),'pod-crop-worker.lock');
// Files an update never touches: the shop tokens and the logs.
const KEEP=new Set(['config.local.json','worker.log','update.log']);
const FILE_NAME=/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;
const MAX_UPDATE_BYTES=8*1024*1024;
const REQUIRED=['api.mjs','index.mjs','package.json','start-worker.cmd','update-worker.mjs','updater.mjs'];
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export function compareVersions(a,b){
 const x=String(a||'0').split('.').map(n=>parseInt(n,10)||0),y=String(b||'0').split('.').map(n=>parseInt(n,10)||0);
 for(let i=0;i<Math.max(x.length,y.length);i++){
  const d=(x[i]||0)-(y[i]||0);
  if(d)return d<0?-1:1;
 }
 return 0;
}
export const sha256=data=>crypto.createHash('sha256').update(data).digest('hex');

// The shop updates come from: config "updateFrom", else the Silvia app, else the first.
export function updateSource(apps=[],updateFrom=''){
 const wanted=String(updateFrom||'').trim().replace(/\/+$/,'').toLowerCase();
 return (wanted&&apps.find(app=>app.appUrl.toLowerCase()===wanted))||
  apps.find(app=>/silvia-sensaria-bridge/i.test(app.appUrl))||apps[0]||null;
}

// Checks an update from the server and returns its files.
export function verifyBundle(bundle){
 const version=String(bundle?.version||'');
 if(!/^\d+(\.\d+){1,3}$/.test(version))throw Error('The worker update has no valid version.');
 if(!Array.isArray(bundle.files)||!bundle.files.length)throw Error('The worker update has no files.');
 const files=[],seen=new Set();let total=0;
 for(const file of bundle.files){
  const name=String(file?.name||'');
  if(!FILE_NAME.test(name)||KEEP.has(name)||seen.has(name.toLowerCase()))
   throw Error('The worker update contains an invalid file name: '+name.slice(0,60));
  seen.add(name.toLowerCase());
  const data=Buffer.from(String(file.data||''),'base64');
  total+=data.length;
  if(total>MAX_UPDATE_BYTES)throw Error('The worker update is larger than expected.');
  if(sha256(data)!==String(file.sha256||'').toLowerCase())throw Error('The worker update file '+name+' does not match its checksum.');
  files.push({name,data});
 }
 for(const name of REQUIRED)if(!seen.has(name.toLowerCase()))throw Error('The worker update is missing '+name+'.');
 const declared=files.find(f=>f.name==='api.mjs').data.toString('utf8').match(/WORKER_VERSION\s*=\s*'([^']+)'/)?.[1];
 if(declared!==version)throw Error('The worker update says v'+version+' but contains v'+(declared||'unknown')+'.');
 return {version,files};
}

export async function downloadUpdate(app,{timeoutMs=60000}={}){
 const response=await fetch(app.appUrl+'/api/crop-worker/update',{signal:AbortSignal.timeout(timeoutMs),
  headers:{Authorization:'Bearer '+app.workerToken},cache:'no-store'});
 if(!response.ok)throw Error(app.name+' could not provide the worker update (HTTP '+response.status+').');
 return verifyBundle(await response.json());
}

// Saves a verified update in .update/v<version>/ until the worker is idle.
export async function stageUpdate(update,{updateDir=UPDATE_DIR}={}){
 const dir=path.join(updateDir,'v'+update.version);
 await rm(dir,{recursive:true,force:true});
 await mkdir(dir,{recursive:true});
 for(const file of update.files)await writeFile(path.join(dir,file.name),file.data);
 await writeFile(path.join(dir,'.manifest.json'),JSON.stringify({version:update.version,
  files:update.files.map(file=>({name:file.name,sha256:sha256(file.data)}))}));
 return dir;
}

// Copies a staged update over the worker's files, keeping the replaced ones.
export async function applyStaged(stagedDir,{dir=WORKER_DIR,updateDir=UPDATE_DIR}={}){
 const manifest=JSON.parse(await readFile(path.join(stagedDir,'.manifest.json'),'utf8'));
 for(const {name,sha256:expected} of manifest.files){
  if(!FILE_NAME.test(name)||KEEP.has(name))throw Error('Invalid staged file '+name+'.');
  if(sha256(await readFile(path.join(stagedDir,name)))!==expected)throw Error('Staged file '+name+' changed after download.');
 }
 const backup=path.join(updateDir,'backup');
 await rm(backup,{recursive:true,force:true});
 await mkdir(backup,{recursive:true});
 const added=[];
 for(const {name} of manifest.files){
  const target=path.join(dir,name);
  if(fs.existsSync(target))await copyFile(target,path.join(backup,name));else added.push(name);
 }
 await writeFile(path.join(backup,'.added.json'),JSON.stringify(added));
 for(const {name} of manifest.files)await copyFile(path.join(stagedDir,name),path.join(dir,name));
 return {version:manifest.version};
}
export async function restoreBackup({dir=WORKER_DIR,updateDir=UPDATE_DIR}={}){
 const backup=path.join(updateDir,'backup');
 const added=JSON.parse(await readFile(path.join(backup,'.added.json'),'utf8').catch(()=>'[]'));
 for(const name of fs.readdirSync(backup))if(FILE_NAME.test(name))await copyFile(path.join(backup,name),path.join(dir,name));
 for(const name of added)if(FILE_NAME.test(name))await rm(path.join(dir,name),{force:true});
}

// A failed version is not tried again for six hours.
const failedPath=updateDir=>path.join(updateDir,'failed.json');
export async function recordFailure(version,error,{updateDir=UPDATE_DIR}={}){
 await mkdir(updateDir,{recursive:true});
 await writeFile(failedPath(updateDir),JSON.stringify({version,error:String(error?.message||error).slice(0,300),
  at:new Date().toISOString()}));
}
export function recentFailure(version,{updateDir=UPDATE_DIR,withinMs=6*60*60*1000}={}){
 try{
  const failed=JSON.parse(fs.readFileSync(failedPath(updateDir),'utf8'));
  return failed.version===version&&Date.now()-Date.parse(failed.at)<withinMs?failed:null;
 }catch{return null}
}

export function runningWorkerPid(){
 try{
  const pid=Number(fs.readFileSync(LOCK_PATH,'utf8').trim());
  if(!Number.isInteger(pid)||pid<=0)return 0;
  process.kill(pid,0);
  return pid;
 }catch{return 0}
}
export async function waitForExit(pid,timeoutMs){
 const deadline=Date.now()+timeoutMs;
 while(Date.now()<deadline){
  try{process.kill(pid,0)}catch{return true}
  await sleep(500);
 }
 return false;
}
export function startWorker(dir=WORKER_DIR){
 if(process.platform==='win32'){
  spawn('cmd.exe',['/c','start-worker.cmd'],{cwd:dir,detached:true,stdio:'ignore',windowsHide:true}).unref();
  return;
 }
 const log=fs.openSync(path.join(dir,'worker.log'),'a');
 spawn(process.execPath,['index.mjs'],{cwd:dir,detached:true,stdio:['ignore',log,log]}).unref();
}
// A started worker is healthy once it has held the lock for `stableMs`.
export async function workerHealthy({previousPid=0,startMs=90000,stableMs=10000}={}){
 const deadline=Date.now()+startMs;
 let pid=0;
 while(Date.now()<deadline){
  pid=runningWorkerPid();
  if(pid&&pid!==previousPid)break;
  await sleep(500);
 }
 if(!pid||pid===previousPid)return false;
 const until=Date.now()+stableMs;
 while(Date.now()<until){
  if(runningWorkerPid()!==pid)return false;
  await sleep(1000);
 }
 return true;
}

const dependenciesMissing=dir=>!['sharp','ag-psd'].every(name=>fs.existsSync(path.join(dir,'node_modules',name)));
const fileHash=file=>{try{return sha256(fs.readFileSync(file))}catch{return ''}};
function npmInstall(dir,log){
 return new Promise((resolve,reject)=>{
  const child=spawn('npm',['install','--no-audit','--no-fund'],{cwd:dir,windowsHide:true,
   shell:process.platform==='win32',stdio:['ignore','pipe','pipe']});
  const timer=setTimeout(()=>{child.kill();reject(Error('npm install took longer than 10 minutes.'))},10*60*1000);
  const write=chunk=>String(chunk).split(/\r?\n/).filter(Boolean).forEach(line=>log('npm: '+line));
  child.stdout.on('data',write);child.stderr.on('data',write);
  child.on('error',error=>{clearTimeout(timer);reject(error)});
  child.on('exit',code=>{clearTimeout(timer);code===0?resolve():reject(Error('npm install failed (exit '+code+').'))});
 });
}

// Installs a staged update once the old worker has exited: copies the files,
// runs npm install when the dependencies changed, starts the worker and checks
// it stays up. Otherwise the previous files are restored and that worker started.
export async function installStaged(stagedDir,{dir=WORKER_DIR,updateDir=UPDATE_DIR,log=console.log,previousPid=0,
 health={}}={}){
 const packageBefore=fileHash(path.join(dir,'package.json'));
 const {version}=await applyStaged(stagedDir,{dir,updateDir});
 log('Worker v'+version+' files installed.');
 try{
  if(fileHash(path.join(dir,'package.json'))!==packageBefore||dependenciesMissing(dir)){
   log('Installing dependencies (npm install)…');
   await npmInstall(dir,log);
  }
  startWorker(dir);
  if(!await workerHealthy({previousPid,...health}))throw Error('the updated worker did not stay running');
  await rm(failedPath(updateDir),{force:true});
  await rm(stagedDir,{recursive:true,force:true});
  log('Worker v'+version+' is running.');
  return {ok:true,version};
 }catch(error){
  log('Update to v'+version+' failed: '+error.message+'. Restoring the previous version.');
  const pid=runningWorkerPid();
  if(pid&&pid!==previousPid){try{process.kill(pid)}catch{} await waitForExit(pid,15000)}
  await restoreBackup({dir,updateDir});
  if(dependenciesMissing(dir))await npmInstall(dir,log).catch(e=>log('npm install failed: '+e.message));
  await recordFailure(version,error,{updateDir});
  startWorker(dir);
  return {ok:false,version,error:error.message};
 }
}
