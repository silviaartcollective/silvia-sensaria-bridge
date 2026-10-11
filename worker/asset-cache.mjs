// Local on-disk cache for private R2 master images and PSD templates.
// Reuse the exact immutable R2 object between batches; never cache signed URLs.
import {createWriteStream} from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';

const BASE=path.join(process.env.LOCALAPPDATA||os.tmpdir(),'pod-worker-cache','v1');
const MAX_BYTES=Number(process.env.POD_WORKER_CACHE_GB||4)*1024**3;
const MAX_AGE_MS=7*24*60*60*1000;
const inflight=new Map();
export function cacheKeyFor({shop,id,key,updatedAt,size}){
 if(!shop||!id||!key)throw Error('R2 cache identity is incomplete.');
 return crypto.createHash('sha256').update(JSON.stringify([shop,id,key,updatedAt||'',size||0])).digest('hex');
}
function extension(value){
 const v=String(value||'.jpg').toLowerCase();
 if(!/^\.(psd|psb|jpg|jpeg|png|webp|tiff?|bmp)$/.test(v))
  throw Error('Unsupported cached artwork extension.');
 return v;
}
export async function downloadCached(url,{shop,id,key,updatedAt='',size=0,ext='.jpg'},onStage=async()=>{}){
 const hash=cacheKeyFor({shop,id,key,updatedAt,size});
 const target=path.join(BASE,hash+extension(ext));
 if(inflight.has(hash))return inflight.get(hash);
 const work=(async()=>{
  await fs.mkdir(BASE,{recursive:true});
  const expected=Number(size)||0;
  try{
   const present=await fs.stat(target);
   if(present.size>100&&(!expected||present.size===expected)){
    await fs.utimes(target,new Date(),new Date()).catch(()=>{});
    await onStage('Using cached '+extension(ext).slice(1).toUpperCase()+' file (no download)');
    return {path:target,cached:true,bytes:present.size};
   }
   await fs.rm(target,{force:true}).catch(()=>{});
  }catch(error){if(error.code!=='ENOENT')throw error}
  const tmp=target+'.'+crypto.randomUUID()+'.partial';
  try{
   const result=await fetch(url,{signal:AbortSignal.timeout(10*60*1000)});
   if(!result.ok||!result.body)throw Error('R2 source download failed (HTTP '+result.status+').');
   await pipeline(Readable.fromWeb(result.body),createWriteStream(tmp,{flags:'wx'}));
   const metadata=await fs.stat(tmp);
   if(metadata.size<100||(expected&&metadata.size!==expected))
    throw Error('R2 source size mismatch ('+metadata.size+' bytes, expected '+expected+').');
   await fs.rename(tmp,target);
   await pruneCache(target);
   return {path:target,cached:false,bytes:metadata.size};
  }finally{await fs.rm(tmp,{force:true}).catch(()=>{})}
 })();
 inflight.set(hash,work);
 try{return await work}finally{inflight.delete(hash)}
}
export async function pruneCache(exclude=''){
 let entries=await fs.readdir(BASE,{withFileTypes:true}).catch(()=>[]);
 let files=[];
 for(const entry of entries){
  if(!entry.isFile()||entry.name.endsWith('.partial'))continue;
  const filename=path.join(BASE,entry.name);
  const st=await fs.stat(filename).catch(()=>null);
  if(st)files.push({filename,size:st.size,time:st.mtimeMs});
 }
 files.sort((a,b)=>a.time-b.time);
 let total=files.reduce((sum,f)=>sum+f.size,0);
 const now=Date.now();
 for(const file of files){
  if(file.filename===exclude)continue;
  if(total>MAX_BYTES||now-file.time>MAX_AGE_MS){
   await fs.rm(file.filename,{force:true}).catch(()=>{});
   total-=file.size;
  }
 }
}
