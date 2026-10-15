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
import {renderMockupWithPhotoshop,NativePhotoshopUnavailable} from './native-photoshop.mjs';
import {renderMockupNative,NativeMockupUnsupported} from './native-mockup.mjs';

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
// One localhost origin and one Photopea iframe for the entire PC worker lifetime.
// Only the active PSD job can access the temporary asset and output endpoints.
// Keeping this server alive is essential: closing it after every PSD forced the
// Photopea editor to boot and reload all its resources for the next template.
let persistentPCServerPromise=null;
async function createPersistentPCServer(){
 const token=crypto.randomBytes(24).toString('hex');
 const script=fs.readFileSync(new URL('./photopea-worker-page.js',import.meta.url));
 let active=null;
 const server=createServer(async(req,res)=>{
  const url=new URL(req.url||'/', 'http://127.0.0.1');
  const prefix='/'+token+'/';
  if(!url.pathname.startsWith(prefix)){res.writeHead(404);res.end();return}
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
   // The app may remain warm between jobs, but asset access is only enabled
   // while a single active PSD render owns this local server.
   const current=active;
   if(!current){res.writeHead(503);res.end('No active PSD render');return}
   const assets={psd:current.psdPath,artwork:current.artworkPath};
   if(req.method==='GET'&&Object.hasOwn(assets,route)){
    const filename=assets[route];
    const metadata=await stat(filename);
    res.writeHead(200,{'content-type':'application/octet-stream','content-length':metadata.size,
     'cache-control':'no-store','x-content-type-options':'nosniff'});
    await pipeline(createReadStream(filename),res);return;
   }
   if(req.method==='POST'&&route==='stage'){
    let line='',length=0;
    for await(const chunk of req){
     length+=chunk.length;if(length>1000)throw Error('Status is too long');
     line+=chunk.toString('utf8');
    }
    void Promise.resolve().then(()=>current.onStage(line.slice(0,220))).catch(()=>{});
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
    await pipeline(guarded(),createWriteStream(current.outputPath,{flags:'w'}));
    res.writeHead(204);res.end();return;
   }
   res.writeHead(404);res.end();
  }catch(error){
   if(!res.headersSent){
    res.writeHead(500,{'content-type':'text/plain'});res.end(bounded(error));
   }else res.destroy(error);
  }
 });
 await new Promise((resolve,reject)=>{
  server.once('error',reject);server.listen(0,'127.0.0.1',resolve);
 });
 return {
  url:'http://127.0.0.1:'+server.address().port+'/'+token+'/',
  activate(context){
   if(active)throw Error('Another PSD render is already using the shared Photopea session.');
   active=context;
   return async()=>{if(active===context)active=null};
  }
 };
}
export async function openPhotopeaPCServer({psdPath,artworkPath,outputPath,onStage=()=>{}}){
 if(!persistentPCServerPromise){
  persistentPCServerPromise=createPersistentPCServer().catch(error=>{
   persistentPCServerPromise=null;throw error;
  });
 }
 const session=await persistentPCServerPromise;
 const close=session.activate({psdPath,artworkPath,outputPath,onStage});
 return {url:session.url,close};
}
let nativeUnavailableReason='';
// One persistent background Chromium process serves all PSDs from the shared PC
// worker. Launching Chrome for every template added seconds of avoidable overhead.
let sharedPhotopeaBrowser=null;
let sharedBrowserLaunch=null;
async function getWarmPhotopeaBrowser(puppeteer,executablePath,onStage){
 if(sharedPhotopeaBrowser?.isConnected?.())return {browser:sharedPhotopeaBrowser,reused:true};
 if(!sharedBrowserLaunch){
  sharedBrowserLaunch=(async()=>{
   await onStage('Starting persistent background Chromium for Photopea');
   const browser=await puppeteer.launch({
    executablePath,headless:true,protocolTimeout:18*60*1000,
    args:['--no-first-run','--no-default-browser-check','--disable-extensions',
     '--disable-dev-shm-usage','--enable-unsafe-swiftshader']
   });
   sharedPhotopeaBrowser=browser;
   browser.on('disconnected',()=>{if(sharedPhotopeaBrowser===browser)sharedPhotopeaBrowser=null});
   return browser;
  })().finally(()=>{sharedBrowserLaunch=null});
 }
 return {browser:await sharedBrowserLaunch,reused:false};
}

// The Chromium PROCESS alone was warm, but the original code closed every
// page and reinitialized Photopea for EACH PSD. Preserve the actual initialized
// Photopea iframe and reset documents before importing a new template.
let sharedPhotopeaPage=null;
async function getWarmPhotopeaPage(browser,url,onStage){
 if(sharedPhotopeaPage&&!sharedPhotopeaPage.isClosed()&&
    sharedPhotopeaBrowser===browser){
  return {page:sharedPhotopeaPage,reused:true};
 }
 const errors=[];
 for(let attempt=1;attempt<=2;attempt++){
  let page=null,bootTimer=null;
  try{
   await onStage('Opening Photopea editor in PC Chromium (attempt '+attempt+'/2)');
   page=await browser.newPage();
   await page.setViewport({width:1250,height:900,deviceScaleFactor:1});
   page.on('pageerror',error=>console.error('[PC PSD renderer] Page error:',bounded(error)));
   page.on('error',error=>console.error('[PC PSD renderer] Chrome tab error:',bounded(error)));
   page.on('requestfailed',request=>{
    if(request.url().startsWith('https://www.photopea.com')){
     const reason=request.failure()?.errorText||'unknown network error';
     if(errors.length<8)errors.push(reason);
     console.error('[PC PSD renderer] Photopea request failed:',reason);
    }
   });
   page.on('response',response=>{
    if(response.url().startsWith('https://www.photopea.com')&&response.status()>=400){
     const info='Photopea HTTP '+response.status();
     if(errors.length<8)errors.push(info);
     console.error('[PC PSD renderer]',info,response.url().split('?')[0]);
    }
   });
   page.on('crash',()=>console.error('[PC PSD renderer] Chromium crashed while loading Photopea.'));
   await page.goto(url,{waitUntil:'domcontentloaded',timeout:35000});
   await page.waitForFunction(()=>typeof window.initializePhotopeaWorker==='function',{timeout:15000});
   await Promise.race([
    page.evaluate(()=>window.initializePhotopeaWorker()),
    new Promise((_,reject)=>{
     bootTimer=setTimeout(()=>reject(Error('Background Photopea initialization exceeded 55 seconds.')),55000);
    })
   ]);
   if(bootTimer)clearTimeout(bootTimer);
   sharedPhotopeaPage=page;
   await onStage('Photopea editor initialized and ready; reusing it for the remaining PSDs');
   return {page,reused:false};
  }catch(error){
   if(bootTimer)clearTimeout(bootTimer);
   console.error('[PC PSD renderer] Photopea startup '+attempt+'/2 failed:',bounded(error));
   if(page)await page.close().catch(()=>{});
   if(attempt===2)
    throw Error('Photopea could not initialize in background Chrome/Edge. '+
     'Open https://www.photopea.com in the same PC browser to check connectivity and any browser challenge. '+
     'Recent errors: '+[bounded(error),...errors].slice(0,5).join('; '));
   await onStage('Photopea did not connect; restarting its background tab once');
  }
 }
 throw Error('Photopea could not initialize.');
}

export async function renderMockupOnPC({psdPath,artworkPath,outputPath,templateName='',mapping,
 smartObjects=[],fitMode='contain',artworkOrientation='',onStage=()=>{}}){
 const engine=String(process.env.POD_PSD_RENDERER||'auto').toLowerCase();
 const started=Date.now();
 if(!['auto','native','photopea','photoshop'].includes(engine))
  throw Error('POD_PSD_RENDERER must be auto, native, photopea or photoshop.');
 if(engine==='auto'||engine==='native'){
  try{
   await onStage('Native PSD rendering first — checking Photoshop layer compatibility');
   const native=await renderMockupNative({
    psdPath,artworkPath,outputPath,mapping,fitMode,onStage
   });
   if(native.dimensions.width<150||native.dimensions.height<150)
    throw Error('Native rendered mockup is unexpectedly small.');
   console.log('[PC PSD renderer] '+templateName+' native output in '+
    ((Date.now()-started)/1000).toFixed(2)+'s ('+
    (native.preparedFromCache?'reused prepared scene':'first-time scene analysis')+').');
   return native;
  }catch(error){
   if(!(error instanceof NativeMockupUnsupported)||engine==='native')throw error;
   console.log('[PC PSD renderer] '+templateName+
    ' requires legacy PSD features: '+error.message);
   await onStage('Native PSD not yet compatible: '+error.message+
     ' — using Photopea without changing template or image');
  }
 }
 if(engine==='photoshop'){
  try{
   const result=await renderMockupWithPhotoshop({psdPath,artworkPath,outputPath,
    templateName,mapping,smartObjects,fitMode,onStage});
   console.log('[PC PSD renderer] '+templateName+' completed with desktop Photoshop in '+
    ((Date.now()-started)/1000).toFixed(1)+'s.');
   return result;
  }catch(error){
   if(!(error instanceof NativePhotoshopUnavailable))throw error;
   if(engine==='photoshop')throw error;
   nativeUnavailableReason=error.message;
   console.log('[PC PSD renderer] Native Photoshop unavailable: '+nativeUnavailableReason+
    '. Falling back to Photopea.');
  }
 }
 await onStage('Using Photopea PC renderer (persistent editor session)');
 const executablePath=findPCBrowser();
 if(!executablePath)throw Error('Chrome or Microsoft Edge not found on PC. Set PHOTOPEA_CHROME_PATH or install Chrome/Edge.');
 let puppeteer;
 try{puppeteer=(await import('puppeteer-core')).default}
 catch{throw Error('Run worker/setup-worker.cmd to install the updated shared crop and PSD worker.')}
 const local=await openPhotopeaPCServer({psdPath,artworkPath,outputPath,onStage});
 let page=null,deadlineTimer=null,renderSucceeded=false;
 try{
  const warm=await getWarmPhotopeaBrowser(puppeteer,executablePath,onStage);
  const ready=await getWarmPhotopeaPage(warm.browser,local.url,onStage);
  page=ready.page;
  if(ready.reused)await onStage('Reusing already initialized Photopea editor');
  const rendering=page.evaluate(({templateName,mapping,fitMode,artworkOrientation})=>
    window.renderMockupOnPC({templateName,mapping,fitMode,artworkOrientation}),
    {templateName,mapping,fitMode,artworkOrientation});
  const deadline=new Promise((_,reject)=>{
   deadlineTimer=setTimeout(()=>reject(Error('PSD processing exceeded 16 minutes on PC. Check RAM and retry.')),16*60*1000);
  });
  const result=await Promise.race([rendering,deadline]);
  if(result.needsMapping){renderSucceeded=true;return result;}
  const metadata=await sharp(outputPath,{limitInputPixels:24_000_001}).metadata();
  if(metadata.format!=='jpeg'||!metadata.width||!metadata.height||
     metadata.width*metadata.height>24000000||metadata.width<150||metadata.height<150)
   throw Error('Worker export is not a valid JPEG within 24 megapixels.');
  const size=(await stat(outputPath)).size;
  if(size<100||size>60*1024*1024)throw Error('Generated JPG file size is invalid.');
  console.log('[PC PSD renderer] '+templateName+' completed with Photopea in '+
   ((Date.now()-started)/1000).toFixed(1)+'s.');
  renderSucceeded=true;
  return {...result,engine:'photopea',dimensions:{width:metadata.width,height:metadata.height},size};
 }finally{
  if(deadlineTimer)clearTimeout(deadlineTimer);
  if(!renderSucceeded&&page){
   // A failed script may leave Photopea's interpreter in an unknown state.
   // Drop the tab so the next retry starts in a clean editor.
   if(sharedPhotopeaPage===page)sharedPhotopeaPage=null;
   await page.close().catch(()=>{});
  }
  // The permanent local server remains alive but cannot serve job assets
  // when there is no active render. Successful Photopea tabs stay warm.
  await local.close();
 }
}
