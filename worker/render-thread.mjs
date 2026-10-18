// One render thread of the PC worker's pool: runs native PSD renders off the
// main thread so several mockups use several CPU cores at once.
import { parentPort } from 'node:worker_threads';
import { renderMockupNative, NativeMockupUnsupported } from './native-mockup.mjs';

parentPort.on('message', async ({ id, args }) => {
  const onStage = stage => { parentPort.postMessage({ id, stage: String(stage) }); };
  try {
    parentPort.postMessage({ id, result: await renderMockupNative({ ...args, onStage }) });
  } catch (error) {
    parentPort.postMessage({ id, error: {
      message: String(error?.message || error), unsupported: error instanceof NativeMockupUnsupported } });
  }
});
