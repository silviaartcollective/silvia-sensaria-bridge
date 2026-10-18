// The shared PC worker updates itself from the worker files this server was
// deployed with (worker/updater.mjs checks and installs them).
import {readdirSync,readFileSync} from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

const WORKER_DIR=fileURLToPath(new URL('../worker/',import.meta.url));
const WORKER_FILE=/^[A-Za-z0-9][A-Za-z0-9._-]*\.(mjs|js|json|cmd|ps1|md)$/;
// The PC's own settings are never part of an update.
const PRIVATE_FILES=new Set(['config.local.json','package-lock.json']);
// The first version that can update itself.
export const SELF_UPDATING_WORKER='4.6.0';

export function compareWorkerVersions(a,b){
 const x=String(a||'0').split('.').map(n=>parseInt(n,10)||0),y=String(b||'0').split('.').map(n=>parseInt(n,10)||0);
 for(let i=0;i<Math.max(x.length,y.length);i++){
  const d=(x[i]||0)-(y[i]||0);
  if(d)return d<0?-1:1;
 }
 return 0;
}

const bundles=new Map();
export function workerUpdateBundle(dir=WORKER_DIR){
 if(bundles.has(dir))return bundles.get(dir);
 const files=readdirSync(dir,{withFileTypes:true})
  .filter(entry=>entry.isFile()&&WORKER_FILE.test(entry.name)&&!PRIVATE_FILES.has(entry.name))
  .map(entry=>entry.name).sort()
  .map(name=>{
   const data=readFileSync(path.join(dir,name));
   return {name,size:data.length,sha256:crypto.createHash('sha256').update(data).digest('hex'),data:data.toString('base64')};
  });
 const api=files.find(file=>file.name==='api.mjs');
 const version=api?Buffer.from(api.data,'base64').toString('utf8').match(/WORKER_VERSION\s*=\s*'([^']+)'/)?.[1]||'':'';
 const bundle={version,files};
 bundles.set(dir,bundle);
 return bundle;
}
export function latestWorkerVersion(){
 try{return workerUpdateBundle().version}catch{return ''}
}

// What the worker reports about its update in each heartbeat.
const UPDATE_STATES=new Set(['downloading','waiting','restarting','failed']);
export function heartbeatUpdate(input){
 const state=String(input?.state||'');
 if(!UPDATE_STATES.has(state))return null;
 return {state,to:String(input.to||'').slice(0,20),error:String(input.error||'').slice(0,200)};
}

// One line for the dashboards, or '' when the worker is current.
export function workerUpdateText({online,version,latestVersion,update,restarting,autoUpdate}){
 if(restarting)return 'Updating the PC worker to v'+update.to+'. It restarts in a moment.';
 if(!online||!latestVersion||compareWorkerVersions(version,latestVersion)>=0)return '';
 const to=update?.to||latestVersion;
 switch(update?.state){
  case 'downloading':return 'PC worker v'+version+' is outdated · downloading v'+to+'…';
  case 'waiting':return 'PC worker v'+version+' is outdated · v'+to+' is downloaded and installs as soon as the current work is done.';
  case 'restarting':return 'Updating the PC worker to v'+to+'…';
  case 'failed':return 'PC worker update to v'+to+' failed'+(update.error?': '+update.error:'')+
   '. Run update-worker.cmd in the worker folder on the PC.';
 }
 if(compareWorkerVersions(version,SELF_UPDATING_WORKER)<0)
  return 'PC worker v'+version+' is outdated (v'+latestVersion+' available). Install the new worker folder once and run '+
   'setup-worker.cmd; from v'+SELF_UPDATING_WORKER+' it updates itself.';
 if(autoUpdate===false)
  return 'PC worker v'+version+' is outdated (v'+latestVersion+' available). Run update-worker.cmd in the worker folder.';
 return 'PC worker v'+version+' is outdated · updating to v'+latestVersion+' shortly.';
}
