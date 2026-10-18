// One render thread of the PC worker's pool: runs native PSD renders off the
// main thread so several mockups use several CPU cores at once.
import { parentPort } from 'node:worker_threads';
import { renderMockupNative, prepareNativePsd, NativeMockupUnsupported } from './native-mockup.mjs';

parentPort.on('message', async ({ id, op = 'render', args }) => {
  const onStage = stage => { parentPort.postMessage({ id, stage: String(stage) }); };
  try {
    if (op === 'prepare') {
      // Background warm-up: prepare a template before any artwork needs it.
      const prepared = await prepareNativePsd({ ...args, onStage });
      parentPort.postMessage({ id, result: { needsMapping: !!prepared.needsMapping,
        preparedFromCache: !!prepared.preparedFromCache, reason: prepared.reason || '' } });
      return;
    }
    parentPort.postMessage({ id, result: await renderMockupNative({ ...args, onStage }) });
  } catch (error) {
    parentPort.postMessage({ id, error: {
      message: String(error?.message || error), unsupported: error instanceof NativeMockupUnsupported } });
  }
});
