// A ZIP written while it is sent, so any number of large files can be
// downloaded without holding them in memory. Files are stored as they are
// (photos do not compress any further), each followed by its CRC and size (a
// data descriptor), with the central directory at the end. ZIP64 records are
// added once the archive passes 4 GB, which Windows, macOS and 7-Zip read.
import zlib from 'node:zlib';

const LIMIT = 0xffffffff;
const table = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
export function crc32(data, crc = 0) {
  if (zlib.crc32) return zlib.crc32(data, crc);
  let c = ~crc;
  for (let i = 0; i < data.length; i++) c = table[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}
function dosTime(date) {
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
}
const u64 = (buffer, value, at) => buffer.writeBigUInt64LE(BigInt(value), at);
// Names in plain ASCII ("Ünïcode" becomes "Unicode") and without folders:
// every unzip tool, old Windows Explorer included, then shows them the same.
export function zipName(name) {
  const plain = String(name ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/^[\s./\\]+/, '')
    .replace(/[^\x20-\x7e]/g, '_').replace(/[\\/:*?"<>|]/g, '_').trim();
  return plain || 'file';
}

// Writes to `out` (an HTTP response) and waits whenever it asks to slow down.
// entries: [{ name, date, size, open: async () => readable stream }]; `size`
// (known from storage) says ahead whether one file needs ZIP64 itself (4 GB
// or more). `zip64At` is only lowered by tests.
export async function writeZip(out, entries, { zip64At = LIMIT } = {}) {
  let offset = 0;
  const written = [];
  const send = chunk => new Promise((resolve, reject) => {
    if (out.destroyed) return reject(Error('The download was cancelled.'));
    offset += chunk.length;
    if (out.write(chunk)) return resolve();
    const done = error => { out.off('drain', done); out.off('close', closed); error ? reject(error) : resolve(); };
    const closed = () => done(Error('The download was cancelled.'));
    out.once('drain', done); out.once('close', closed);
  });
  for (const entry of entries) {
    const name = Buffer.from(zipName(entry.name), 'ascii');
    const { time, date } = dosTime(entry.date);
    const start = offset;
    const big = Number(entry.size) >= zip64At;
    const header = Buffer.alloc(30), zip64Extra = big ? Buffer.alloc(20) : Buffer.alloc(0);
    if (big) { zip64Extra.writeUInt16LE(0x0001, 0); zip64Extra.writeUInt16LE(16, 2); }
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(big ? 45 : 20, 4);
    header.writeUInt16LE(0x0008, 6); // sizes after the data
    header.writeUInt16LE(0, 8);
    header.writeUInt16LE(time, 10); header.writeUInt16LE(date, 12);
    header.writeUInt16LE(name.length, 26);
    header.writeUInt16LE(zip64Extra.length, 28);
    await send(Buffer.concat([header, name, zip64Extra]));
    let crc = 0, size = 0;
    for await (const chunk of await entry.open()) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      crc = crc32(bytes, crc); size += bytes.length;
      await send(bytes);
    }
    if (size >= zip64At && !big) throw Error(entry.name + ' is larger than its size said.');
    const descriptor = Buffer.alloc(big ? 24 : 16);
    descriptor.writeUInt32LE(0x08074b50, 0);
    descriptor.writeUInt32LE(crc >>> 0, 4);
    if (big) { u64(descriptor, size, 8); u64(descriptor, size, 16); }
    else { descriptor.writeUInt32LE(size, 8); descriptor.writeUInt32LE(size, 12); }
    await send(descriptor);
    written.push({ name, time, date, crc, size, start, big });
  }
  // The central directory: where each file is, with ZIP64 fields for what does not fit 4 bytes.
  const directoryStart = offset;
  for (const file of written) {
    const bigSize = file.big, bigStart = file.start >= zip64At;
    const extra = [];
    if (bigSize) extra.push(file.size, file.size);
    if (bigStart) extra.push(file.start);
    const extraField = extra.length ? Buffer.alloc(4 + 8 * extra.length) : Buffer.alloc(0);
    if (extra.length) {
      extraField.writeUInt16LE(0x0001, 0); extraField.writeUInt16LE(8 * extra.length, 2);
      extra.forEach((value, i) => u64(extraField, value, 4 + 8 * i));
    }
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(45, 4);
    record.writeUInt16LE(extra.length ? 45 : 20, 6);
    record.writeUInt16LE(0x0008, 8);
    record.writeUInt16LE(0, 10);
    record.writeUInt16LE(file.time, 12); record.writeUInt16LE(file.date, 14);
    record.writeUInt32LE(file.crc >>> 0, 16);
    record.writeUInt32LE(bigSize ? LIMIT : file.size, 20);
    record.writeUInt32LE(bigSize ? LIMIT : file.size, 24);
    record.writeUInt16LE(file.name.length, 28);
    record.writeUInt16LE(extraField.length, 30);
    record.writeUInt32LE(bigStart ? LIMIT : file.start, 42);
    await send(Buffer.concat([record, file.name, extraField]));
  }
  const directorySize = offset - directoryStart, count = written.length;
  if (count >= 0xffff || directoryStart >= zip64At || directorySize >= zip64At) {
    const end64At = offset, end64 = Buffer.alloc(56), locator = Buffer.alloc(20);
    end64.writeUInt32LE(0x06064b50, 0); u64(end64, 44, 4);
    end64.writeUInt16LE(45, 12); end64.writeUInt16LE(45, 14);
    u64(end64, count, 24); u64(end64, count, 32); u64(end64, directorySize, 40); u64(end64, directoryStart, 48);
    locator.writeUInt32LE(0x07064b50, 0); u64(locator, end64At, 8); locator.writeUInt32LE(1, 16);
    await send(Buffer.concat([end64, locator]));
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Math.min(count, 0xffff), 8); end.writeUInt16LE(Math.min(count, 0xffff), 10);
  end.writeUInt32LE(directorySize >= zip64At ? LIMIT : directorySize, 12);
  end.writeUInt32LE(directoryStart >= zip64At ? LIMIT : directoryStart, 16);
  await send(end);
  return { files: count, bytes: offset };
}
