import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
test('converter resumes old artwork IDs and launches the correct shop PC worker',()=>{
 const html=readFileSync(new URL('../src/listing-converter-page.mjs',import.meta.url),'utf8');
 const script=html.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(script);
 assert.doesNotThrow(()=>new vm.Script(script[1]));
 assert.ok(html.includes('silvia-worker://start'));
 assert.ok(!html.includes('pod-crop-worker://start'));
 assert.ok(html.includes('d.uploadAlreadyPresent'));
 assert.ok(html.includes('previouslyQueuedCropJobId'));
 assert.ok(html.includes('Start worker/start-worker.cmd'));
});
