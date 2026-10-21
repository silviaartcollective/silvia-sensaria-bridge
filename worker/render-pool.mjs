// Pool of render threads. Renders of prepared templates run in parallel (one
// per thread); a first-time template preparation reads the whole PSD into
// memory, so only one of those runs at a time.
import os from 'node:os';
import { Worker } from 'node:worker_threads';
import { NativeMockupUnsupported, isTemplatePrepared } from './native-mockup.mjs';

const cores = os.availableParallelism?.() || os.cpus().length || 2;
export const RENDER_THREADS = Math.max(1, Math.min(8,
  Number(process.env.POD_MOCKUP_CONCURRENCY) || Math.max(2, Math.min(6, Math.floor(cores / 2)))));

const threads = [], idle = [], waiting = [];
let nextId = 0;

function spawn() {
  const thread = new Worker(new URL('./render-thread.mjs', import.meta.url));
  thread.jobs = new Map();
  thread.on('message', message => {
    const job = thread.jobs.get(message.id);
    if (!job) return;
    if ('stage' in message) { Promise.resolve(job.onStage(message.stage)).catch(() => {}); return; }
    thread.jobs.delete(message.id);
    if (message.error) job.reject(message.error.unsupported
      ? new NativeMockupUnsupported(message.error.message) : Error(message.error.message));
    else job.resolve(message.result);
    release(thread);
  });
  const lost = error => {
    threads.splice(threads.indexOf(thread), 1);
    const at = idle.indexOf(thread);
    if (at >= 0) idle.splice(at, 1);
    for (const job of thread.jobs.values()) job.reject(Error('PSD render thread stopped: ' + String(error?.message || error)));
    thread.jobs.clear();
    // Hand a waiting render a fresh thread.
    if (waiting.length) waiting.shift()(spawn());
  };
  thread.on('error', lost);
  thread.on('exit', code => { if (threads.includes(thread)) lost('exit code ' + code); });
  threads.push(thread);
  return thread;
}
function acquire() {
  const thread = idle.pop() || (threads.length < RENDER_THREADS ? spawn() : null);
  if (thread) { thread.ref(); return Promise.resolve(thread); }
  return new Promise(resolve => waiting.push(thread => { thread.ref(); resolve(thread); }));
}
function release(thread) {
  if (!threads.includes(thread)) return;
  const next = waiting.shift();
  if (next) next(thread);
  else { thread.unref(); idle.push(thread); }
}

let preparing = Promise.resolve();
function onePreparationAtATime(task) {
  const run = preparing.then(task, task);
  preparing = run.catch(() => {});
  return run;
}

async function runOnThread(op, args, onStage) {
  const thread = await acquire();
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    thread.jobs.set(id, { resolve, reject, onStage });
    thread.postMessage({ id, op, args });
  });
}

export async function renderInPool({ psdPath, artworkPath, outputPath, mapping = null, psdSize = 0, psdVersion = '', fitMode = 'contain', onStage = () => {} }) {
  const args = { psdPath, artworkPath, outputPath, mapping, psdSize, psdVersion, fitMode };
  const render = () => runOnThread('render', args, onStage);
  if (await isTemplatePrepared({ psdPath, mapping, psdSize, psdVersion })) return render();
  return onePreparationAtATime(render);
}

// Prepares a template ahead of time (background warm-up), one at a time.
export function prepareInPool({ psdPath, mapping = null, psdSize = 0, psdVersion = '' }) {
  return onePreparationAtATime(() => runOnThread('prepare', { psdPath, mapping, psdSize, psdVersion }, () => {}));
}
