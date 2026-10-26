// Keeps the PC worker running. start-worker.cmd starts this, and this starts
// index.mjs. When the worker stops unexpectedly (a crash, or Windows ending it
// when memory runs out) it is started again after a short pause, and its next
// heartbeats tell the shops why it stopped (their Render logs show it). A
// normal exit ends this too: an update taking over, another worker already
// running, or stop-worker.cmd (which leaves the stop marker first).
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {STOP_PATH,WORKER_DIR} from './updater.mjs';

const PAUSE_MS=Number(process.env.POD_SUPERVISOR_PAUSE_MS)||5000;
// Several crashes in a row (e.g. a setting that keeps failing): wait longer.
const CRASHES_BEFORE_BACKOFF=5,CRASH_WINDOW_MS=10*60*1000,BACKOFF_MS=Number(process.env.POD_SUPERVISOR_BACKOFF_MS)||2*60*1000;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const stamp=()=>new Date().toISOString();
const stopRequested=()=>fs.existsSync(STOP_PATH);

// The worker's last lines before it stopped, from worker.log (where both write).
export function logTail(file=path.join(WORKER_DIR,'worker.log'),{lines=15,bytes=16384}={}){
 try{
  const size=fs.statSync(file).size,length=Math.min(size,bytes),buffer=Buffer.alloc(length);
  const handle=fs.openSync(file,'r');
  try{fs.readSync(handle,buffer,0,length,size-length)}finally{fs.closeSync(handle)}
  return buffer.toString('utf8').split(/\r?\n/).filter(line=>line.trim()).slice(-lines).join('\n').slice(-1500);
 }catch{return ''}
}

function runWorker(restart){
 return new Promise(resolve=>{
  const child=spawn(process.execPath,[path.resolve(WORKER_DIR,process.env.POD_SUPERVISED_SCRIPT||'index.mjs')],{cwd:WORKER_DIR,stdio:'inherit',
   env:restart?{...process.env,POD_WORKER_RESTART:JSON.stringify(restart)}:process.env});
  child.on('error',error=>resolve({code:null,signal:null,error:error.message}));
  child.on('exit',(code,signal)=>resolve({code,signal}));
 });
}

export async function supervise(){
 // A new start means run: an old stop marker no longer applies.
 fs.rmSync(STOP_PATH,{force:true});
 let restart=null;
 const crashes=[];
 for(;;){
  const startedAt=Date.now();
  const {code,signal,error}=await runWorker(restart);
  if(stopRequested()){console.log('['+stamp()+'] Worker stopped on request.');return 0}
  if(code===0&&!signal)return 0;
  const reason=error?'could not start: '+error:signal?'ended by '+signal:'exit code '+code;
  crashes.push(Date.now());
  while(crashes.length&&Date.now()-crashes[0]>CRASH_WINDOW_MS)crashes.shift();
  const pause=crashes.length>=CRASHES_BEFORE_BACKOFF?BACKOFF_MS:PAUSE_MS;
  console.error('['+stamp()+'] The worker stopped unexpectedly ('+reason+') after '+
   Math.round((Date.now()-startedAt)/1000)+' s; starting it again in '+Math.round(pause/1000)+' s.');
  restart={at:new Date().toISOString(),reason,ranSeconds:Math.round((Date.now()-startedAt)/1000),
   crashesInTenMinutes:crashes.length,lastLines:logTail()};
  await sleep(pause);
  if(stopRequested()){console.log('['+stamp()+'] Worker stopped on request.');return 0}
 }
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
 process.exitCode=await supervise();
