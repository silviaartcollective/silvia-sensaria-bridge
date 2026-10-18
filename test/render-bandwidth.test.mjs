import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('API JSON is compact: every worker and browser poll is Render bandwidth',()=>{
 assert.match(read('src/server.mjs'),/function sendJson\(res, status, value\) \{\n  const body = JSON\.stringify\(value\);/);
});

test('Product Creator does not poll from a background tab or after a batch finishes',()=>{
 const client=read('src/mockup-generator-client.js');
 assert.match(client,/if\(preparing\|\|document\.hidden\)return;/);
 assert.match(client,/t\.status==='queued'\|\|t\.status==='processing'/);
 assert.match(client,/Date\.now\(\)-lastWorkerCheck>=30000/);
});

test('JPG download links redirect to R2 instead of streaming through Render',()=>{
 const api=read('src/mockup-api.mjs'),client=read('src/mockup-generator-client.js');
 assert.match(client,/'\/download\/'\+t\.id\+'\?direct=1'/);
 assert.match(api,/searchParams\.get\('direct'\)==='1'\)return redirectToObject/);
 assert.match(api,/res\.writeHead\(302,\{location:url/);
 assert.match(api,/max-age=2592000, immutable/);
});

test('an idle PC worker backs off to one poll per shop every 15 s',()=>{
 const worker=read('worker/index.mjs');
 assert.match(worker,/IDLE_BACKOFF_AFTER_MS = 60000, IDLE_POLL_MS = 15000/);
 assert.match(worker,/await sleep\(idlePollMs\(POLL_INTERVAL_MS\)\)/);
 assert.match(worker,/sleep\(idlePollMs\(MOCKUP_IDLE_POLL_MS\)\)/);
});
