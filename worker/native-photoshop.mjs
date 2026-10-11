// Faster renderer for Windows PCs with installed Adobe Photoshop.
// The existing shared worker remains the only queue owner; Photopea is fallback.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import sharp from 'sharp';

export class NativePhotoshopUnavailable extends Error {
 constructor(message='Desktop Photoshop is not installed or its Windows COM automation is unavailable.'){
  super(message);this.name='NativePhotoshopUnavailable';
 }
}
const tempName=(dir,name)=>path.join(dir,'pod-photoshop-'+crypto.randomUUID()+'-'+name);
export function photoshopConfig({psdPath,artworkPath,outputPath,templateName='',mapping=null,smartObjects=[],fitMode='contain',reportPath,stagePath}){
 const mapped=typeof mapping==='string'?mapping:mapping?.path||'';
 const match=smartObjects.find(x=>x.path===mapped);
 return {
  psd:psdPath,artwork:artworkPath,output:outputPath,templateName,
  fitMode:fitMode==='cover'?'cover':'contain',
  fileMB:Math.round((Number(mapping?.sourceBytes)||0)/1048576),
  mappingPath:mapped,
  mappingName:match?.name||'',
  stage:stagePath,report:reportPath
 };
}
export async function renderMockupWithPhotoshop({psdPath,artworkPath,outputPath,templateName='',mapping=null,smartObjects=[],fitMode='contain',onStage=async()=>{},timeoutMs=3*60*1000}){
 if(process.platform!=='win32')throw new NativePhotoshopUnavailable('Native Photoshop requires Windows.');
 if(process.env.POD_PSD_RENDERER==='photopea')
  throw new NativePhotoshopUnavailable('Photopea renderer explicitly selected.');
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'pod-photoshop-'));
 const scriptPath=path.join(folder,'job.jsx'),reportPath=path.join(folder,'result.json');
 const stagePath=path.join(folder,'stage.txt'),diagPath=path.join(folder,'diagnostic.txt');
 let interval=null,child=null,forceTimer=null;
 try{
  const source=await fs.readFile(new URL('./photoshop-native.jsx',import.meta.url),'utf8');
  const input=photoshopConfig({psdPath,artworkPath,outputPath,templateName,mapping,
   smartObjects,fitMode,stagePath,reportPath});
  const body=source.replace('__MOCKUP_CONFIGURATION__',JSON.stringify(input));
  if(body===source)throw Error('Native Photoshop JSX configuration placeholder missing.');
  await fs.writeFile(scriptPath,body,{encoding:'utf8',flag:'wx'});
  await onStage('Starting native Photoshop renderer (no Photopea or Chromium)');
  let lastStage='',lastRead=Promise.resolve();
  const readStage=async()=>{
   const value=await fs.readFile(stagePath,'utf8').catch(()=>null);
   const status=value?.trim();
   if(status&&status!==lastStage){
    lastStage=status;
    await onStage(status);
   }
  };
  interval=setInterval(()=>{lastRead=lastRead.then(readStage).catch(()=>{})},900);
  const runner=new URL('./photoshop-runner.ps1',import.meta.url);
  const {fileURLToPath}=await import('node:url');
  const args=['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass',
   '-File',fileURLToPath(runner),'-Script',scriptPath,'-Diagnostic',diagPath];
  const exitCode=await new Promise((resolve,reject)=>{
   child=spawn('powershell.exe',args,{windowsHide:true,stdio:['ignore','pipe','pipe']});
   let stderr='',stdout='';
   child.stdout.on('data',d=>{stdout=(stdout+d.toString()).slice(-4096)});
   child.stderr.on('data',d=>{stderr=(stderr+d.toString()).slice(-4096)});
   child.once('error',reject);
   child.once('close',(code,signal)=>{
    if(signal)return reject(Error('Native Photoshop helper was interrupted ('+signal+').'));
    resolve({code,output:(stderr+' '+stdout).trim()});
   });
   forceTimer=setTimeout(()=>{
    child?.kill();
    reject(Error('Native Photoshop rendering exceeded '+Math.round(timeoutMs/1000)+' seconds. The PSD was not exported; continuing the batch.'));
   },timeoutMs);
  });
  if(forceTimer){clearTimeout(forceTimer);forceTimer=null}
  clearInterval(interval);interval=null;
  await lastRead.catch(()=>{});await readStage();
  if(exitCode.code===9){
   const detail=await fs.readFile(diagPath,'utf8').catch(()=>exitCode.output);
   throw new NativePhotoshopUnavailable(detail.slice(0,400));
  }
  const reportText=await fs.readFile(reportPath,'utf8').catch(()=>null);
  if(!reportText){
   const diag=await fs.readFile(diagPath,'utf8').catch(()=>exitCode.output);
   throw Error('Native Photoshop did not produce a result: '+String(diag).slice(0,350));
  }
  const report=JSON.parse(reportText.replace(/^\uFEFF/,''));
  if(!report.ok)throw Error('Native Photoshop: '+String(report.error||'Unknown failure'));
  if(report.needsMapping)return report;
  if(exitCode.code!==0)throw Error('Native Photoshop exited with code '+exitCode.code);
  const metadata=await sharp(outputPath,{limitInputPixels:24_000_001}).metadata();
  if(metadata.format!=='jpeg'||metadata.width*metadata.height>24000000||
   metadata.width<150||metadata.height<150)
   throw Error('Native Photoshop output failed JPEG/24MP validation.');
  const size=(await fs.stat(outputPath)).size;
  if(size<100||size>60*1024*1024)throw Error('Native Photoshop JPG file size out of range.');
  return {...report,engine:'photoshop',size,dimensions:{width:metadata.width,height:metadata.height}};
 }finally{
  if(forceTimer)clearTimeout(forceTimer);
  if(interval)clearInterval(interval);
  await fs.rm(folder,{recursive:true,force:true}).catch(()=>{});
 }
}
