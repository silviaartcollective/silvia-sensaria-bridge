import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_CONFIG_PATH = path.join(HERE,'config.local.json');
let local={};
try {local=JSON.parse(fs.readFileSync(LOCAL_CONFIG_PATH,'utf8').replace(/^\uFEFF/,''));}
catch(error){if(error?.code!=='ENOENT')throw new Error('Invalid worker/config.local.json: '+error.message);}

const defaults=[
  {name:'Arté Antica',appUrl:'https://arte-antica-product-creator.onrender.com'},
  {name:'Silvia Art Collective',appUrl:'https://silvia-sensaria-bridge.onrender.com'},
  {name:'Japandi Art Collective',appUrl:'https://japandi-sensaria-bridge.onrender.com'}
];
export function normalizeConnections(entries){
 if(!Array.isArray(entries))throw new Error('apps must be a list of shop connections.');
 const seen=new Set();
 return entries.map((entry,index)=>{
  const name=String(entry?.name||defaults[index]?.name||'Shop '+(index+1)).trim();
  const appUrl=String(entry?.appUrl||'').trim().replace(/\/+$/,'');
  const workerToken=String(entry?.workerToken||'').trim();
  if(!appUrl)throw new Error(name+': Render URL missing.');
  if(!/^https:\/\/[^/\s]+$/i.test(appUrl)&&!/^http:\/\/localhost(?::\d+)?$/i.test(appUrl))
    throw new Error(name+': use an HTTPS Render URL (localhost excepted).');
  if(workerToken.length<24)throw new Error(name+': CROP_WORKER_TOKEN must contain at least 24 characters.');
  if(seen.has(appUrl.toLowerCase()))throw new Error('Duplicate Render app: '+appUrl);
  seen.add(appUrl.toLowerCase());
  return {name,appUrl,workerToken};
 });
}
function configured(){
 if(Array.isArray(local.apps)&&local.apps.length)return local.apps;
 const appUrl=String(process.env.ARTE_ANTICA_APP_URL||local.appUrl||'').trim();
 const workerToken=String(process.env.ARTE_ANTICA_WORKER_TOKEN||local.workerToken||'').trim();
 return appUrl&&workerToken?[{name:'Arté Antica',appUrl,workerToken}]:[];
}
export const APP_CONNECTIONS=configured().length?normalizeConnections(configured()):[];
export const WORKER_ID=String(process.env.POD_CROP_WORKER_ID||local.workerId||'pod-crop-main-pc').trim();
export const POLL_INTERVAL_MS=Math.max(2000,Number(process.env.POD_CROP_WORKER_POLL_MS??local.pollIntervalMs??3000));
// The old installer saved 600000 (10 minutes). Treat it as an obsolete default.
const oldIdle=Number(local.idleExitMs??0);
export const IDLE_EXIT_MS=Math.max(0,Number(process.env.POD_CROP_WORKER_IDLE_EXIT_MS??(oldIdle===600000?0:oldIdle)));
export function validateWorkerConfig(){
 if(!APP_CONNECTIONS.length)throw new Error('Run worker/setup-worker.cmd and configure at least one shop.');
 if(!WORKER_ID)throw new Error('Worker ID missing.');
 return true;
}
