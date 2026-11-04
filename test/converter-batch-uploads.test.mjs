// Converting several artworks in a row: the worker launch link opens only when
// the worker is offline, and a stalled upload or request cannot hold its slot.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../src/listing-converter-page.mjs',import.meta.url),'utf8');
const script=html.slice(html.indexOf('<script>')+8,html.indexOf('</script>'));
const between=(from,to)=>script.slice(script.indexOf(from),script.indexOf(to,script.indexOf(from)));

test('Convert opens the worker launch link only while the worker is offline, once every 2 minutes', () => {
  const convert=between('async function convertListing(','async function loadListings(');
  assert.doesNotMatch(convert,/location\.href/);
  assert.match(convert,/launchWorkerIfOffline\(\);/);
  let now=1e6;
  const ctx=vm.createContext({window:{location:{href:'/listing-converter'}},Date:{now:()=>now}});
  vm.runInContext(between('let workerOnline=null','async function refreshWorker(){')+
    ';globalThis.launch=launchWorkerIfOffline;globalThis.setOnline=v=>{workerOnline=v};',ctx);
  ctx.launch();
  assert.equal(ctx.window.location.href,'/listing-converter','status not read yet: nothing opened');
  ctx.setOnline(true); ctx.launch();
  assert.equal(ctx.window.location.href,'/listing-converter','worker running: nothing opened');
  ctx.setOnline(false); ctx.launch();
  assert.equal(ctx.window.location.href,'pod-crop-worker://start');
  ctx.window.location.href='/listing-converter'; now+=60000; ctx.launch();
  assert.equal(ctx.window.location.href,'/listing-converter','not again within 2 minutes');
  now+=61000; ctx.launch();
  assert.equal(ctx.window.location.href,'pod-crop-worker://start');
  assert.match(between('async function refreshWorker(){','launchWorker.addEventListener'),/workerOnline=Boolean\(w\.online\);/);
});

test('uploads and converter requests have time limits, so a stalled one is retried and frees its slot', async () => {
  const signals=[];
  let calls=0;
  const ctx=vm.createContext({Promise,Math,AbortSignal:{timeout:ms=>({ms})},sleep:async()=>{},
    fetch:async(url,options)=>{signals.push(options.signal?.ms);calls++;
      if(calls===1)throw Object.assign(Error('signal timed out'),{name:'TimeoutError'});
      return {ok:true,status:200,json:async()=>({ok:true})};}});
  vm.runInContext(between('const MAX_SIMULTANEOUS_SETUPS=','async function detectOrientation(')+
    between('async function putFile(','// One batched request')+
    ';globalThis.request=requestJsonRetry;globalThis.put=putFile;',ctx);
  await ctx.request('/api/listing-converter/reserve',{method:'POST'});
  assert.deepEqual(signals,[90000,90000],'timed out once, retried, then answered');
  signals.length=0; calls=0;
  await ctx.put('https://r2.example/upload',{size:200*1048576,type:'image/jpeg'},()=>{});
  assert.deepEqual(signals,[920000,920000],'200 MB: 2 min + 800 s, retried after the timeout');
  signals.length=0; calls=1;
  await ctx.put('https://r2.example/upload',{size:4000*1048576,type:'image/jpeg'},()=>{});
  assert.deepEqual(signals,[1800000],'never more than 30 minutes');
});
