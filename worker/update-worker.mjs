// Updates the shared PC worker from the shop it updates from (normally the
// Silvia app; see updater.mjs).
//   node update-worker.mjs           check, download and install now (update-worker.cmd)
//   node update-worker.mjs --force   reinstall the latest version even if this one is current
//   node update-worker.mjs --apply <staged folder> --after <pid>
//                                    run by the worker itself: install a downloaded
//                                    update once that worker process has exited
import fs from 'node:fs';
import path from 'node:path';
import {
 UPDATE_DIR,WORKER_DIR,compareVersions,downloadUpdate,installStaged,runningWorkerPid,stageUpdate,
 startWorker,updateSource,waitForExit
} from './updater.mjs';

const args=process.argv.slice(2);
const log=text=>{
 console.log(text);
 try{fs.appendFileSync(path.join(WORKER_DIR,'update.log'),'['+new Date().toISOString()+'] '+text+'\n')}catch{}
};

async function applyAfterExit(){
 const staged=path.resolve(String(args[1]||''));
 if(path.dirname(staged)!==UPDATE_DIR||!fs.existsSync(staged))throw Error('No downloaded update at '+staged+'.');
 const after=Number(args[args.indexOf('--after')+1])||0;
 if(after&&!await waitForExit(after,120000)){
  log('The worker did not stop by itself; stopping it.');
  try{process.kill(after)}catch{}
  await waitForExit(after,15000);
 }
 return installStaged(staged,{log,previousPid:after});
}

async function updateNow(){
 const {APP_CONNECTIONS,UPDATE_FROM,validateWorkerConfig}=await import('./config.mjs');
 const {WORKER_VERSION}=await import('./api.mjs');
 validateWorkerConfig();
 const source=updateSource(APP_CONNECTIONS,UPDATE_FROM);
 log('Worker v'+WORKER_VERSION+'. Checking '+source.name+' for a newer version…');
 const update=await downloadUpdate(source);
 if(compareVersions(update.version,WORKER_VERSION)<=0&&!args.includes('--force')){
  log('The worker is up to date (latest is v'+update.version+').');
  if(!runningWorkerPid()){log('Starting the worker…');startWorker()}
  return {ok:true,version:WORKER_VERSION};
 }
 log('Installing v'+update.version+'…');
 const staged=await stageUpdate(update);
 const pid=runningWorkerPid();
 if(pid){
  log('Stopping the running worker (an unfinished job is retried by its shop)…');
  try{process.kill(pid)}catch{}
  await waitForExit(pid,15000);
 }
 return installStaged(staged,{log,previousPid:pid});
}

try{
 const result=args[0]==='--apply'?await applyAfterExit():await updateNow();
 process.exitCode=result.ok?0:1;
}catch(error){
 log('Worker update failed: '+error.message);
 process.exitCode=1;
}
