// Single-process PSD renderer used by the existing shared crop worker.
// Photoshop/Photopea never runs in the user's Product Creator browser.
import fs from 'node:fs';
import {createReadStream,createWriteStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import {pipeline} from 'node:stream/promises';
import sharp from 'sharp';

export function chromiumCandidates(env=process.env){
 const dirs=[env.PROGRAMFILES,env['PROGRAMFILES(X86)'],env.LOCALAPPDATA].filter(Boolean);
 return [...new Set([
  env.PHOTOPEA_CHROME_PATH,env.PUPPETEER_EXECUTABLE_PATH,
  ...dirs.flatMap(dir=>[
   path.join(dir,'Google','Chrome','Application','chrome.exe'),
   path.join(dir,'Microsoft','Edge','Application','msedge.exe'),
   path.join(dir,'Chromium','Application','chrome.exe')
  ]),
  '/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome'
 ].filter(Boolean))];
}
export function findPCBrowser(env=process.env){
 return chromiumCandidates(env).find(p=>fs.existsSync(p))||null;
}
function bounded(error){return String(error?.message||error).slice(0,300)}
function html(){
 return '<!doctype html><html><head><meta charset="utf-8">'+
  '<meta name="viewport" content="width=device-width,initial-scale=1">'+
  '<style>html,body{margin:0;background:#fff}iframe{width:1200px;height:850px;border:0}#stage{display:none}</style>'+
  '</head><body><iframe id="photopea" title="Shared PC PSD processor"></iframe>'+
  '<div id="stage"></div><script src="./processor.js"></script></body></html>';
}
export async function openPhotopeaPCServer({psdPath,artworkPath,outputPath,onStage=()=>{}}){
 const token=crypto.randomBytes(24).toString('hex');
 const script=fs.readFileSync(new URL('./photopea-worker-page.js',import.meta.url));
 const assets={psd:psdPath,artwork:artworkPath};
 const server=createServer(async(req,res)=>{
  const url=new URL(req.url||'/', 'http://127.0.0.1');
  const prefix='/'+token+'/';
  if(!url.pathname.startsWith(prefix)){res.writeHead(404);res.end();return;}
  const route=url.pathname.slice(prefix.length)||'index';
  try{
   if(req.method==='GET'&&route==='index'){
    const page=html();
    res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store',
     'x-content-type-options':'nosniff'});
    res.end(page);return;
   }
   if(req.method==='GET'&&route==='processor.js'){
    res.writeHead(200,{'content-type':'application/javascript','content-length':script.length,
     'cache-control':'no-store','x-content-type-options':'nosniff'});
    res.end(script);return;
   }
   if(req.method==='GET'&&Object.hasOwn(assets,route)){
    const filename=assets[route];
    const metadata=await stat(filename);
    res.writeHead(200,{'content-type':'application/octet-stream','content-length':metadata.size,
     'cache-control':'no-store','x-content-type-options':'nosniff'});
    await pipeline(createReadStream(filename),res);return;
   }
   if(req.method==='POST'&&route==='stage'){
    let line='',length=0;
    for await(const chunk of req){length+=chunk.length;if(length>1000)throw Error('Status is too long');line+=chunk.toString('utf8')}
    void Promise.resolve().then(()=>onStage(line.slice(0,220))).catch(()=>{});
    res.writeHead(204);res.end();return;
   }
   if(req.method==='POST'&&route==='output'){
    let length=0;
    const guarded=async function*(){
     for await(const chunk of req){
      length+=chunk.length;
      if(length>60*1024*1024)throw Error('Generated JPG is larger than 60 MB.');
      yield chunk;
     }
    };
    await pipeline(guarded(),createWriteStream(outputPath,{flags:'w'}));
    res.writeHead(204);res.end();return;
   }
   res.writeHead(404);res.end();
  }catch(err){
   if(!res.headersSent){res.writeHead(500,{'content-type':'text/plain'});res.end(bounded(err))}
   else res.destroy(err);
  }
 });
 await new Promise((resolve,reject)=>{
  server.once('error',reject);server.listen(0,'127.0.0.1',resolve);
 });
 return {
  url:'http://127.0.0.1:'+server.address().port+'/'+token+'/',
  async close(){await new Promise(resolve=>server.close(()=>resolve()))}
 };
}
export async function renderMockupOnPC({psdPath,artworkPath,outputPath,templateName='',mapping,fitMode='contain',onStage=()=>{}}){
 const executablePath=findPCBrowser();
 if(!executablePath)throw Error('Chrome or Microsoft Edge not found on PC. Set PHOTOPEA_CHROME_PATH or install Chrome/Edge.');
 let puppeteer;
 try{puppeteer=(await import('puppeteer-core')).default}
 catch{throw Error('Run worker/setup-worker.cmd to install the updated shared crop and PSD worker.')}
 const local=await openPhotopeaPCServer({psdPath,artworkPath,outputPath,onStage});
 let browser=null,deadlineTimer=null;
 try{
  await onStage('Starting background Chromium on PC');
  browser=await puppeteer.launch({
   executablePath,headless:true,protocolTimeout:18*60*1000,
   args:['--no-first-run','--no-default-browser-check','--disable-extensions',
    '--disable-dev-shm-usage','--enable-unsafe-swiftshader']
  });
  const page=await browser.newPage();
  await page.setViewport({width:1250,height:900,deviceScaleFactor:1});
  page.on('error',error=>{void Promise.resolve(onStage('PC Chromium error: '+bounded(error))).catch(()=>{})});
  await page.goto(local.url,{waitUntil:'domcontentloaded',timeout:45000});
  await page.waitForFunction(()=>typeof window.renderMockupOnPC==='function',{timeout:20000});
  const rendering=page.evaluate(({templateName,mapping,fitMode})=>window.renderMockupOnPC({templateName,mapping,fitMode}),{templateName,mapping,fitMode});
  const deadline=new Promise((_,reject)=>{
   deadlineTimer=setTimeout(()=>reject(Error('PSD processing exceeded 16 minutes on PC. Check RAM and retry.')),16*60*1000);
  });
  const result=await Promise.race([rendering,deadline]);
  if(result.needsMapping)return result;
  const metadata=await sharp(outputPath,{limitInputPixels:24_000_001}).metadata();
  if(metadata.format!=='jpeg'||!metadata.width||!metadata.height||
     metadata.width*metadata.height>24000000||metadata.width<150||metadata.height<150)
   throw Error('Worker export is not a valid JPEG within 24 megapixels.');
  const size=(await stat(outputPath)).size;
  if(size<100||size>60*1024*1024)throw Error('Generated JPG file size is invalid.');
  return {...result,dimensions:{width:metadata.width,height:metadata.height},size};
 }finally{
  if(deadlineTimer)clearTimeout(deadlineTimer);
  if(browser)await browser.close().catch(()=>{});
  await local.close();
 }
}
