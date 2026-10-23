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
  // POD_RENDER_THREAD_SCRIPT stands in for the renderer in tests.
  const thread = new Worker(process.env.POD_RENDER_THREAD_SCRIPT || new URL('./render-thread.mjs', import.meta.url));
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

// A render that runs longer than this is stopped (its thread is ended and
// replaced), so one stuck PSD never holds a render slot for good. A prepared
// template renders in seconds; a first-time preparation reads the whole PSD.
// POD_RENDER_TIMEOUT_MINUTES / POD_PREPARE_TIMEOUT_MINUTES change them (or
// *_SECONDS, for tests).
const limit = (name, fallbackMinutes) => {
  const seconds = Number(process.env[name + '_SECONDS']);
  if (seconds > 0) return seconds * 1000;
  return Math.max(1, Number(process.env[name + '_MINUTES']) || fallbackMinutes) * 60_000;
};
export function renderTimeLimitMs({ prepared, psdSize = 0 }) {
  if (prepared) return limit('POD_RENDER_TIMEOUT', 5);
  const extra = Math.ceil(Math.max(0, Number(psdSize) || 0) / (100 * 1024 * 1024)) * 2 * 60_000;
  return Math.min(limit('POD_PREPARE_TIMEOUT', 10) + extra, 45 * 60_000);
}

function runOnThread(op, args, onStage, { timeLimitMs = 0, onThread = () => {} } = {}) {
  return acquire().then(thread => new Promise((resolve, reject) => {
    const id = ++nextId;
    let timer = null;
    const settle = fn => value => { clearTimeout(timer); fn(value); };
    thread.jobs.set(id, { resolve: settle(resolve), reject: settle(reject), onStage });
    onThread(thread, id);
    if (timeLimitMs) timer = setTimeout(() => {
      const job = thread.jobs.get(id);
      if (!job) return;
      thread.jobs.delete(id);
      job.reject(Error('PSD render timed out after ' + Math.max(1, Math.round(timeLimitMs / 60000)) + ' min and was stopped.'));
      void thread.terminate(); // its slot gets a fresh thread
    }, timeLimitMs);
    thread.postMessage({ id, op, args });
  }));
}

// The background warm-up gives way: a real batch that needs a first-time
// preparation stops the warm-up one, which is redone later.
let warmUp = null;
function stopWarmUp() {
  if (!warmUp) return;
  const { thread, id } = warmUp;
  warmUp = null;
  const job = thread.jobs.get(id);
  if (!job) return;
  thread.jobs.delete(id);
  job.reject(Object.assign(Error('Advance preparation stopped for a mockup batch.'), { warmUpStopped: true }));
  void thread.terminate();
}

export async function renderInPool({ psdPath, artworkPath, outputPath, mapping = null, psdSize = 0, psdVersion = '', fitMode = 'contain', onStage = () => {} }) {
  const args = { psdPath, artworkPath, outputPath, mapping, psdSize, psdVersion, fitMode };
  const prepared = await isTemplatePrepared({ psdPath, mapping, psdSize, psdVersion });
  const render = () => runOnThread('render', args, onStage, { timeLimitMs: renderTimeLimitMs({ prepared, psdSize }) });
  if (prepared) return render();
  stopWarmUp();
  return onePreparationAtATime(render);
}

// Prepares a template ahead of time (background warm-up), one at a time.
export function prepareInPool({ psdPath, mapping = null, psdSize = 0, psdVersion = '' }) {
  return onePreparationAtATime(() => runOnThread('prepare', { psdPath, mapping, psdSize, psdVersion }, () => {}, {
    timeLimitMs: renderTimeLimitMs({ prepared: false, psdSize }),
    onThread: (thread, id) => { warmUp = { thread, id }; }
  })).finally(() => { warmUp = null; });
}
