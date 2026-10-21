// Full-size mockup JPGs go to R2 after their batch: a mockup is ready once its
// preview and 2400 px Etsy copy are uploaded (a quarter of the bytes), so a home
// connection is not shared with the full-size files while a batch renders.
// Pending files are kept in the worker cache, so a restart or update resumes them.
import fs from 'node:fs';
import {copyFile,mkdir,readdir,readFile,rename,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const FULL_UPLOAD_DIR=path.join(process.env.LOCALAPPDATA||os.tmpdir(),'pod-worker-cache','full-jpg');
// A file the shop never took within a week is dropped.
const MAX_AGE_MS=7*24*60*60*1000;
const NAME=/^[A-Za-z0-9-]{1,160}$/;

// Moves a rendered JPG into the pending folder with what is needed to send it.
export async function keepForFullUpload(filePath,{appUrl,jobId,itemId,outputKey},{dir=FULL_UPLOAD_DIR}={}){
  // One file per render: a regenerated mockup has a new output key.
  const render=String(outputKey||'').split('/').pop().replace(/\.jpg$/i,'');
  const name=String(jobId)+'-'+String(itemId)+'-'+render;
  if(!NAME.test(name))throw Error('Invalid mockup ID for a full-size upload.');
  await mkdir(dir,{recursive:true});
  const target=path.join(dir,name+'.jpg');
  await rename(filePath,target).catch(async()=>{await copyFile(filePath,target);await rm(filePath,{force:true})});
  await writeFile(path.join(dir,name+'.json'),JSON.stringify({appUrl,jobId,itemId,outputKey,at:Date.now()}));
  return name;
}

// Pending uploads, oldest first. Stale or broken entries are removed.
export async function pendingFullUploads({dir=FULL_UPLOAD_DIR,now=Date.now()}={}){
  const out=[];
  for(const file of (await readdir(dir).catch(()=>[])).filter(n=>n.endsWith('.json'))){
    const name=file.slice(0,-5);
    try{
      const entry=JSON.parse(await readFile(path.join(dir,file),'utf8'));
      const jpg=path.join(dir,name+'.jpg');
      if(!NAME.test(name)||now-Number(entry.at||0)>MAX_AGE_MS||!fs.existsSync(jpg)){await dropFullUpload(name,{dir});continue}
      out.push({...entry,name,file:jpg});
    }catch{await dropFullUpload(name,{dir})}
  }
  return out.sort((a,b)=>a.at-b.at);
}

export async function dropFullUpload(name,{dir=FULL_UPLOAD_DIR}={}){
  if(!NAME.test(String(name)))return;
  await rm(path.join(dir,name+'.jpg'),{force:true});
  await rm(path.join(dir,name+'.json'),{force:true});
}

// Sends one pending JPG: the shop gives a fresh upload URL while that mockup
// still waits for it (a regenerated or deleted one no longer does).
export async function sendFullUpload(entry,{api,upload}){
  const ask=await api.mockupFull(entry.jobId,entry.itemId,entry.outputKey,'url');
  if(!ask?.pending)return 'not-needed';
  await upload(ask.uploadUrl,entry.file);
  const done=await api.mockupFull(entry.jobId,entry.itemId,entry.outputKey,'done');
  return done?.done?'uploaded':'not-needed';
}
