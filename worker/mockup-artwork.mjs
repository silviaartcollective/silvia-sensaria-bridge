// A smaller copy of the master artwork for mockups. Renders use at most 6000 px
// of the artwork (ARTWORK_MAX_SIDE in native-mockup.mjs), but each render
// thread used to decode the full master (often 17,500 px) to get there. Now the
// master is shrunk once per batch, here, and every render reads the small copy:
// the same mockups, much less time and memory. The copy sits in the worker's
// download cache, which removes old files.
import fs from 'node:fs/promises';
import sharp from 'sharp';

export const MOCKUP_ARTWORK_SIDE = 6000;
const making = new Map();

export async function mockupArtwork(masterPath, { side = MOCKUP_ARTWORK_SIDE } = {}) {
  const info = await fs.stat(masterPath);
  const target = masterPath.replace(/\.[^.\\/]+$/, '') + '.mockup-' + side + '.jpg';
  const key = target + '|' + info.size + '|' + info.mtimeMs;
  if (!making.has(key)) {
    making.set(key, (async () => {
      const meta = await sharp(masterPath, { limitInputPixels: false }).metadata();
      // Small enough already: renders read the master itself.
      if (Math.max(meta.width || 0, meta.height || 0) <= side) return masterPath;
      const made = await fs.stat(target).catch(() => null);
      if (made && made.size > 1000 && made.mtimeMs >= info.mtimeMs) return target;
      const partial = target + '.' + process.pid + '.partial';
      try {
        await sharp(masterPath, { limitInputPixels: false }).rotate()
          .resize(side, side, { fit: 'inside', withoutEnlargement: true })
          .flatten({ background: '#ffffff' })
          .jpeg({ quality: 95, chromaSubsampling: '4:4:4' })
          .toFile(partial);
        await fs.rename(partial, target);
      } finally { await fs.rm(partial, { force: true }).catch(() => {}); }
      return target;
    })().catch(error => { making.delete(key); throw error; }));
    while (making.size > 20) making.delete(making.keys().next().value);
  }
  return making.get(key);
}
