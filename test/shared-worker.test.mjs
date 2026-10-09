import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeConnections,IDLE_EXIT_MS} from '../worker/config.mjs';
import {rotatingApps,heartbeatFor} from '../worker/worker-scheduling.mjs';

const entries=[
{name:'Arte',appUrl:'https://arte.example',workerToken:'a'.repeat(32)},
{name:'Silvia',appUrl:'https://silvia.example',workerToken:'b'.repeat(32)},
{name:'Japandi',appUrl:'https://japandi.example',workerToken:'c'.repeat(32)}
];
test('three app-specific tokens stay separate',()=>{
 const result=normalizeConnections(entries);
 assert.equal(result.length,3);
 assert.deepEqual(result.map(x=>x.workerToken),['a'.repeat(32),'b'.repeat(32),'c'.repeat(32)]);
 assert.throws(()=>normalizeConnections([{...entries[0],workerToken:'short'}]),/token/i);
 assert.throws(()=>normalizeConnections([entries[0],{...entries[0]}]),/Duplicate/);
});
test('round-robin scheduling visits every app without starvation',()=>{
 const apps=normalizeConnections(entries);
 assert.deepEqual(rotatingApps(apps,0).map(x=>x.name),['Arte','Silvia','Japandi']);
 assert.deepEqual(rotatingApps(apps,1).map(x=>x.name),['Silvia','Japandi','Arte']);
 assert.deepEqual(rotatingApps(apps,2).map(x=>x.name),['Japandi','Arte','Silvia']);
});
test('all apps show worker busy while only owning app shows job identifier',()=>{
 const apps=normalizeConnections(entries);
 const active={app:apps[1],job:{id:'crop_123'}};
 assert.deepEqual(apps.map(a=>heartbeatFor(a,active).jobId),['','crop_123','']);
 assert.ok(apps.every(a=>heartbeatFor(a,active).busy));
 assert.ok(apps.every(a=>heartbeatFor(a,null).busy===false));
});
test('default worker remains running and shared protocol installer covers 3 apps',()=>{
 assert.equal(IDLE_EXIT_MS,0);
 const install=readFileSync(new URL('../worker/install-protocol.ps1',import.meta.url),'utf8');
 for(const protocol of ['pod-crop-worker','arteantica-worker','silvia-worker','japandi-worker'])
   assert.ok(install.includes('Register-WorkerProtocol "'+protocol+'"'));
});
