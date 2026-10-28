import test from 'node:test';
import assert from 'node:assert/strict';
import { Writable, Readable } from 'node:stream';
import { readFileSync } from 'node:fs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { writeZip, crc32, zipName } from '../src/zip-stream.mjs';
import { ORIGINAL_SIZES, originalKey, renderOriginal, makeOriginal, originalState } from '../src/artwork-originals.mjs';
const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');

// The archive as a browser receives it, read back the way unzip tools do: from
// the central directory (with ZIP64 records when there are any).
async function zipOf(files, options) {
  const chunks = [];
  const out = new Writable({ highWaterMark: 1024, write(chunk, _e, done) { chunks.push(chunk); setImmediate(done); } });
  const result = await writeZip(out, files.map(([name, data]) => ({ name, size: data.length, date: new Date(2026, 9, 28, 10, 20, 30),
    open: async () => Readable.from([data.subarray(0, 7), data.subarray(7)]) })), options);
  await new Promise(resolve => out.end(resolve));
  return { zip: Buffer.concat(chunks), result };
}
function unzip(zip) {
  let end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let count = zip.readUInt16LE(end + 10), dirStart = zip.readUInt32LE(end + 16), zip64 = false;
  if (dirStart === 0xffffffff || count === 0xffff) {
    const end64 = Number(zip.readBigUInt64LE(end - 20 + 8));
    assert.equal(zip.readUInt32LE(end64), 0x06064b50);
    count = Number(zip.readBigUInt64LE(end64 + 32)); dirStart = Number(zip.readBigUInt64LE(end64 + 48)); zip64 = true;
  }
  const files = [];
  for (let at = dirStart, i = 0; i < count; i++) {
    assert.equal(zip.readUInt32LE(at), 0x02014b50);
    const nameLength = zip.readUInt16LE(at + 28), extraLength = zip.readUInt16LE(at + 30);
    let size = zip.readUInt32LE(at + 24), start = zip.readUInt32LE(at + 42);
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString('ascii'), crc = zip.readUInt32LE(at + 16);
    const extra = zip.subarray(at + 46 + nameLength, at + 46 + nameLength + extraLength);
    if (extra.length) {
      assert.equal(extra.readUInt16LE(0), 0x0001);
      let p = 4;
      if (size === 0xffffffff) { size = Number(extra.readBigUInt64LE(p)); p += 16; }
      if (start === 0xffffffff) start = Number(extra.readBigUInt64LE(p));
    }
    assert.equal(zip.readUInt32LE(start), 0x04034b50);
    const dataStart = start + 30 + zip.readUInt16LE(start + 26) + zip.readUInt16LE(start + 28);
    const data = zip.subarray(dataStart, dataStart + size);
    assert.equal(crc32(data), crc, name);
    files.push({ name, data });
    at += 46 + nameLength + extraLength;
  }
  return { files, zip64 };
}

test('the zip holds every file exactly, and switches to ZIP64 past 4 GB', async () => {
  const files = [['SAC0001 - Sage Sweep.jpeg', Buffer.from('master one'.repeat(5000))], ['SAC0002 - Ünïcode/name.tif', Buffer.alloc(0)],
    ['SAC0003.png', Buffer.from('third master')]];
  for (const options of [{}, { zip64At: 20000 }]) {
    const { zip, result } = await zipOf(files, options);
    assert.equal(result.files, 3);
    assert.equal(result.bytes, zip.length);
    const back = unzip(zip);
    assert.equal(back.zip64, Boolean(options.zip64At));
    assert.deepEqual(back.files.map(f => f.name), ['SAC0001 - Sage Sweep.jpeg', 'SAC0002 - Unicode_name.tif', 'SAC0003.png']);
    back.files.forEach((file, i) => assert.ok(file.data.equals(files[i][1])));
  }
  assert.equal(zipName('../x\\y:"z".jpg'), 'x_y__z_.jpg');
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  // A download cancelled half-way stops reading the masters.
  const closed = new Writable({ write(_c, _e, done) { this.destroy(); done(); } });
  await assert.rejects(writeZip(closed, [{ name: 'a', size: 1, open: async () => Readable.from([Buffer.from('a')]) },
    { name: 'b', size: 1, open: async () => Readable.from([Buffer.from('b')]) }]), /cancelled/);
});

test('an original is the master in one size per shape, light, in sRGB, centre-cropped to fill', async () => {
  assert.deepEqual(ORIGINAL_SIZES, { portrait: [928, 1232], landscape: [1344, 896], panoramic: [1536, 768], square: [1024, 1024] });
  assert.equal(originalKey('SAC0012'), 'artworks/SAC0012/original/SAC0012-original.jpg');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'originals-'));
  try {
    const noise = await sharp({ create: { width: 300, height: 400, channels: 3, noise: { type: 'gaussian', mean: 128, sigma: 60 } } })
      .resize(3000, 4000).blur(4).png().toBuffer();
    const cases = [['portrait', 3000, 4000, 'jpeg'], ['landscape', 3000, 2000, 'png'], ['panoramic', 6000, 2900, 'tiff'], ['square', 2000, 2000, 'cmyk']];
    for (const [layout, w, h, kind] of cases) {
      const image = sharp({ create: { width: w, height: h, channels: 3, background: '#9a8f7c' } })
        .composite([{ input: await sharp(noise).resize(w, h).toBuffer(), blend: 'soft-light' }]);
      const master = kind === 'png' ? await image.png().toBuffer() : kind === 'tiff' ? await image.tiff().toBuffer()
        : kind === 'cmyk' ? await image.toColourspace('cmyk').jpeg().toBuffer() : await image.jpeg({ quality: 92 }).toBuffer();
      const file = path.join(dir, layout);
      await writeFile(file, master);
      const out = await renderOriginal(file, ORIGINAL_SIZES[layout]);
      const meta = await sharp(out).metadata();
      assert.deepEqual([meta.width, meta.height, meta.format, meta.space], [...ORIGINAL_SIZES[layout], 'jpeg', 'srgb'], layout);
      assert.ok(out.length < 220000, layout + ' ' + out.length);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('an original is made when missing, kept while up to date, and made again when its master is replaced', async () => {
  const store = new Map([['artworks/SAC0001/source/SAC0001-master.jpg', { size: 900, etag: '"a"' }]]);
  const manifests = { SAC0001: { artworkId: 'SAC0001', status: 'ready', orientation: 'landscape',
    master: { key: 'artworks/SAC0001/source/SAC0001-master.jpg', width: 3700, height: 1800 } },
    SAC0002: { artworkId: 'SAC0002', status: 'reserved', master: { key: 'x' } } };
  const renders = [];
  const deps = {
    loadManifest: async id => structuredClone(manifests[id]),
    objectInfo: async key => store.get(key),
    exists: async key => store.has(key),
    render: async (key, size) => { renders.push(size.join('x')); return Buffer.from('jpg'); },
    put: async ({ key, body }) => store.set(key, { size: body.length, etag: '"o"' }),
    updateManifest: async (id, change) => change(manifests[id])
  };
  const first = await makeOriginal('SAC0001', deps);
  // 3700 × 1800 is wider than 1.85:1, so it is a panoramic.
  assert.equal(first.made.layout, 'panoramic');
  assert.deepEqual(renders, ['1536x768']);
  assert.equal(manifests.SAC0001.original.masterEtag, '"a"');
  assert.equal(originalState(manifests.SAC0001, store), 'made');
  assert.equal((await makeOriginal('SAC0001', deps)).skipped, 'up to date');
  store.set('artworks/SAC0001/source/SAC0001-master.jpg', { size: 950, etag: '"b"' });
  assert.equal(originalState(manifests.SAC0001, store), 'outdated');
  assert.ok((await makeOriginal('SAC0001', deps)).made);
  assert.equal(renders.length, 2);
  assert.equal((await makeOriginal('SAC0002', deps)).skipped, 'the artwork is not ready');
  assert.equal(originalState({ master: { key: 'k' } }, store), 'missing');
});

test('Artwork Files: the page, the two separate zips, Generate, and an original for every new artwork', () => {
  const server = read('src/server.mjs');
  assert.match(read('src/admin-sidebar.mjs'), /\{ href:'\/artwork-files', label:'Artwork Files' \}/);
  assert.match(server, /url\.pathname\.match\(\/\^\\\/api\\\/artwork-files\\\/\(masters\|originals\)\\\.zip\$\/\)/);
  // New artworks (Product Creator, converter, Daily Listings) and replaced masters get their original.
  assert.match(server, /const manifest = await completeArtworkUpload\(artworkCompleteMatch\[1\]\.toUpperCase\(\)\);\n      queueOriginal\(manifest\.artworkId\);/);
  assert.match(server, /const manifest=await completeArtworkUpload\(reservation\.artworkId\);\n      queueOriginal\(reservation\.artworkId\);/);
  assert.match(server, /if\(!activated\.alreadyActive\)queueOriginal\(artworkId\);/);
  const page = read('src/artwork-files-page.mjs');
  assert.match(page, /href="\/api\/artwork-files\/masters\.zip" download/);
  assert.match(page, /href="\/api\/artwork-files\/originals\.zip" download/);
});
