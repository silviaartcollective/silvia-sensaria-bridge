import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'worker-supervisor-'));
process.env.POD_WORKER_LOCK_PATH=path.join(tmp,'worker.lock');
process.env.POD_SUPERVISOR_PAUSE_MS='50';
const {supervise}=await import('../worker/supervise.mjs');
const {STOP_PATH}=await import('../worker/updater.mjs');
const read=file=>fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');

// A stand-in for index.mjs: each run is counted, and it ends as `script` says.
function standIn(name,script){
 const file=path.join(tmp,name+'.mjs'),runs=path.join(tmp,name+'.runs');
 fs.writeFileSync(file,`import fs from 'node:fs';
const runs=fs.existsSync(${JSON.stringify(runs)})?JSON.parse(fs.readFileSync(${JSON.stringify(runs)},'utf8')):[];
runs.push(process.env.POD_WORKER_RESTART?JSON.parse(process.env.POD_WORKER_RESTART):null);
fs.writeFileSync(${JSON.stringify(runs)},JSON.stringify(runs));
const run=runs.length;
${script}`);
 process.env.POD_SUPERVISED_SCRIPT=file;
 return ()=>JSON.parse(fs.readFileSync(runs,'utf8'));
}

test('a worker that stops unexpectedly is started again and told why; a normal exit ends it',async()=>{
 const runs=standIn('crashy',`if(run===1){console.error('out of memory');process.exit(3)}
if(run===2)process.abort();`);
 assert.equal(await supervise(),0);
 const seen=runs();
 assert.equal(seen.length,3);
 assert.equal(seen[0],null);
 assert.equal(seen[1].reason,'exit code 3');
 assert.equal(seen[1].crashesInTenMinutes,1);
 assert.match(seen[2].reason,/^(ended by SIGABRT|exit code \d+)$/);
 assert.equal(seen[2].crashesInTenMinutes,2);
});

test('a worker stopped on purpose (stop-worker.cmd, an update) is not started again',async()=>{
 fs.writeFileSync(STOP_PATH,'old marker');
 const runs=standIn('stopped',`if(run===1){fs.writeFileSync(${JSON.stringify(STOP_PATH)},'1');process.exit(1)}`);
 // The old marker is cleared at start; the one left while running stops it.
 assert.equal(await supervise(),0);
 assert.equal(runs().length,1);
});

test('the launcher runs the worker under supervise.mjs; every deliberate stop leaves the marker',()=>{
 assert.match(read('worker/start-worker.cmd'),/'node supervise\.mjs >> worker\.log 2>&1'/);
 assert.doesNotMatch(read('worker/start-worker.cmd'),/'node index\.mjs/);
 // A launch while the worker runs ends quietly, and nothing writes to the log the worker holds open.
 const launcher=read('worker/start-worker.cmd');
 assert.ok(launcher.indexOf("if \"%errorlevel%\"==\"3\" exit /b 0")<launcher.indexOf('node supervise.mjs'));
 assert.doesNotMatch(launcher,/echo[^\n]*>>"%LOG%"/);
 assert.match(launcher,/>>"%~dp0launch\.log" 2>nul/);
 assert.match(read('worker/stop-worker.cmd'),/Set-Content -Path \(\$lock \+ '\.stop'\) -Value \$p\.Id; Stop-Process/);
 const updater=read('worker/update-worker.mjs');
 assert.doesNotMatch(updater,/process\.kill\(/);
 assert.equal(updater.match(/await stopWorker\(/g).length,2);
 assert.match(read('worker/updater.mjs'),/if\(pid&&pid!==previousPid\)await stopWorker\(pid\);/);
 // The restart reason reaches each shop's log, and a stray failed promise no longer ends the worker.
 const worker=read('worker/index.mjs');
 assert.match(worker,/\.\.\.\(RESTART&&Date\.now\(\)-STARTED_AT<RESTART_REPORT_MS\?\{restart:RESTART\}:\{\}\)/);
 assert.match(worker,/process\.on\('unhandledRejection'/);
 assert.match(read('src/server.mjs'),/logWorkerRestart\(input\.restart\);/);
});
