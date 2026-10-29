import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { inspectMaster, validateRatioSource, generateProductionCrop } from '../worker/crop.mjs';

// Arté Antica's crop jobs ask for exact target sizes (exactTargets): the crop
// is made at exactly that size, enlarging a smaller master; other shops' jobs
// keep the master's own resolution.
test('a job asking for exact targets gets crops of exactly that size, others keep the master\'s size', async () => {
  const files = [];
  const master = async (w, h) => {
    const file = join(tmpdir(), 'exact-' + randomUUID() + '.jpg');
    files.push(file);
    await writeFile(file, await sharp({ create: { width: w, height: h, channels: 3, background: '#8a9f7c' } }).jpeg().toBuffer());
    return file;
  };
  try {
    const target = { width: 1200, height: 1800 };
    // A small master is enlarged to the target.
    const small = await master(600, 900), smallInfo = await inspectMaster(small, 'portrait');
    const out = join(tmpdir(), 'exact-out-' + randomUUID() + '.jpg'); files.push(out);
    const made = await generateProductionCrop({ masterPath: small, outputPath: out, master: smallInfo, ratio: '2x3', target, exact: true });
    assert.deepEqual([made.width, made.height, made.upscaled], [1200, 1800, true]);
    // A master whose crop would round to one pixel short still gives the exact size.
    const odd = await master(1301, 1951), oddInfo = await inspectMaster(odd, 'portrait');
    const kept = validateRatioSource(oddInfo, '2x3', target);
    assert.notDeepEqual([kept.output.width, kept.output.height], [1200, 1800]);
    const out2 = join(tmpdir(), 'exact-out-' + randomUUID() + '.jpg'); files.push(out2);
    const exact = await generateProductionCrop({ masterPath: odd, outputPath: out2, master: oddInfo, ratio: '2x3', target, exact: true });
    assert.deepEqual([exact.width, exact.height, exact.upscaled], [1200, 1800, false]);
    // Without the request, the small master is never enlarged.
    const out3 = join(tmpdir(), 'exact-out-' + randomUUID() + '.jpg'); files.push(out3);
    const native = await generateProductionCrop({ masterPath: small, outputPath: out3, master: smallInfo, ratio: '2x3', target });
    assert.deepEqual([native.width, native.height, native.upscaled], [600, 900, false]);
  } finally { for (const file of files) await rm(file, { force: true }); }
});

test('the worker passes the job\'s exactTargets to every crop', async () => {
  const { readFileSync } = await import('node:fs');
  const index = readFileSync(new URL('../worker/index.mjs', import.meta.url), 'utf8');
  assert.match(index, /const exact = job\.exactTargets === true;/);
  assert.match(index, /validateRatioSource\(master, ratio, job\.targets\?\.\[ratio\], \{ exact \}\);/);
  assert.match(index, /target: job\.targets\?\.\[ratio\],\n        exact\n/);
});
