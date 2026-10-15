import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const root=new URL('../worker/',import.meta.url);
const renderer=readFileSync(new URL('mockup-processor.mjs',root),'utf8');
const pageScript=readFileSync(new URL('photopea-worker-page.js',root),'utf8');
const mainWorker=readFileSync(new URL('index.mjs',root),'utf8');
const workerAPI=readFileSync(new URL('api.mjs',root),'utf8');
const routes=readFileSync(new URL('../src/mockup-api.mjs',import.meta.url),'utf8');

test('PC renderer scripts parse and require v4.2 for the persistent Photopea session',()=>{
 assert.doesNotThrow(()=>new vm.Script(pageScript));
 const js=renderer.replace(/^import .*?;\s*$/gm,'')
  .replaceAll('export async function ','async function ')
  .replaceAll('export function ','function ')
  .replaceAll('import.meta.url','"file:///worker/mockup-processor.mjs"');
 assert.doesNotThrow(()=>new vm.Script(js));
 assert.match(workerAPI,/WORKER_VERSION = '4\.2\.0'/);
 assert.match(routes,/v\[1\]>=2/);
 assert.match(mainWorker,/did not connect\|could not initialize/);
 assert.match(pageScript,/const reset=await script\(resetDocuments\)/);
 assert.match(pageScript,/MG_RESET_OK/);
});

test('failed Photopea initialization retries once, then reuses the warm editor',async()=>{
 const begin=renderer.indexOf('let sharedPhotopeaPage=null;');
 const end=renderer.indexOf('export async function renderMockupOnPC',begin);
 assert.ok(begin>=0&&end>begin);
 const helper=renderer.slice(begin,end);
 let created=0,initialized=0,closed=0;
 const browser={
  async newPage(){
   const n=++created;
   return {
    isClosed:()=>false,on(){},async setViewport(){},
    async goto(){},async waitForFunction(){},
    async evaluate(){
     initialized++;
     if(n===1)throw Error('Synthetic Photopea network failure');
     return true;
    },
    async close(){closed++}
   };
  }
 };
 const context={
  browser,console:{error(){}},bounded:error=>String(error?.message||error),
  Error,Promise,Date,setTimeout,clearTimeout
 };
 const api=vm.runInNewContext(
  'let sharedPhotopeaBrowser=browser;\n'+helper+'\ngetWarmPhotopeaPage;',context
 );
 const logs=[];
 const first=await api(browser,'http://127.0.0.1:39881/session/',async x=>logs.push(x));
 assert.equal(first.reused,false);
 assert.equal(created,2);
 assert.equal(initialized,2);
 assert.equal(closed,1);
 const again=await api(browser,'http://127.0.0.1:39881/session/',async x=>logs.push(x));
 assert.equal(again.reused,true);
 assert.equal(created,2,'must not boot another iframe for the next PSD');
 assert.equal(initialized,2,'must not initialize the site again');
});

test('localhost PSD server persists, rejects simultaneous renders and hides idle assets',async()=>{
 const begin=renderer.indexOf('let persistentPCServerPromise=null;');
 const end=renderer.indexOf('let nativeUnavailableReason=',begin);
 assert.ok(begin>=0&&end>begin);
 const helper=renderer.slice(begin,end)
  .replace("const script=fs.readFileSync(new URL('./photopea-worker-page.js',import.meta.url));",
   "const script={length:4};")
  .replaceAll('export async function ','async function ');
 let count=0,handler=null;
 const server={
  once(){},listen(port,host,ready){ready()},address(){return {port:39881}}
 };
 const context={
  createServer:callback=>{count++;handler=callback;return server},
  crypto:{randomBytes:()=>({toString:()=>'safe-token'})},
  html:()=>'<html></html>',
  bounded:error=>String(error),
  Error,Promise,Set,Object,URL,
  stat:async()=>({size:10}),
  pipeline:async()=>{},createReadStream:()=>{},createWriteStream:()=>{}
 };
 const api=vm.runInNewContext(helper+'\nopenPhotopeaPCServer;',context);
 const first=await api({psdPath:'one.psd',artworkPath:'art.jpg',outputPath:'a.jpg'});
 await assert.rejects(()=>api({psdPath:'two.psd'}),/already using the shared Photopea/);
 await first.close();
 const second=await api({psdPath:'two.psd',artworkPath:'art2.jpg',outputPath:'b.jpg'});
 assert.equal(first.url,second.url);
 assert.equal(count,1);
 await second.close();
 let code=0;
 await handler({method:'GET',url:new URL('psd',first.url).pathname},{
  writeHead(status){code=status;return this},end(){}
 });
 assert.equal(code,503,'no PSD file may be served after deactivating a render');
});
