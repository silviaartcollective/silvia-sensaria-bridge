// Receives the artwork straight from the Product Creator in this PC's browser,
// so the worker renders from the original file without downloading it back
// from R2. Listens on this computer only (127.0.0.1).
//
// The page sends PUT /artwork with the batch's details and a one-time code the
// shop's server derived from its CROP_WORKER_TOKEN; the worker checks it with
// its own copy of that token, so no other website can push files here. The file
// lands exactly where the download cache would have put the R2 copy.
import { createServer } from 'node:http';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { cachedFilePath } from './asset-cache.mjs';

export const LOCAL_INTAKE_PORT = Number(process.env.POD_LOCAL_PORT) || 47823;
const MAX_BYTES = 2 * 1024 ** 3;

export function expectedToken(workerToken, jobId, artworkKey, size) {
  return crypto.createHmac('sha256', String(workerToken))
    .update(['pod-local-artwork', jobId, artworkKey, String(Number(size) || 0)].join('|')).digest('hex');
}

export function startLocalIntake({ apps, version, port = LOCAL_INTAKE_PORT, onArtwork = () => {} }) {
  const origins = new Map(apps.map(app => [new URL(app.appUrl).origin, app]));
  const server = createServer(async (req, res) => {
    const origin = String(req.headers.origin || '');
    const app = origins.get(origin);
    const cors = app ? {
      'access-control-allow-origin': origin, vary: 'Origin',
      'access-control-allow-methods': 'GET, PUT, OPTIONS',
      'access-control-allow-headers': 'content-type',
      // Chrome asks before a public site reaches this computer; allow it once.
      'access-control-allow-private-network': 'true',
      'access-control-max-age': '600'
    } : {};
    const reply = (status, body) => {
      res.writeHead(status, { ...cors, 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(body === undefined ? undefined : JSON.stringify(body));
    };
    try {
      if (!app) return reply(403, { ok: false, error: 'Unknown shop.' });
      const url = new URL(req.url, 'http://127.0.0.1');
      if (req.method === 'OPTIONS') return reply(204);
      if (req.method === 'GET' && url.pathname === '/status') return reply(200, { ok: true, version });
      if (req.method !== 'PUT' || url.pathname !== '/artwork') return reply(404, { ok: false, error: 'Not found.' });
      const job = url.searchParams.get('job') || '', key = url.searchParams.get('key') || '';
      const filename = url.searchParams.get('filename') || '', size = Number(url.searchParams.get('size'));
      const token = String(url.searchParams.get('token') || '');
      if (!/^[a-f0-9-]{36}$/.test(job) || !key || !Number.isSafeInteger(size) || size < 100 || size > MAX_BYTES)
        return reply(400, { ok: false, error: 'Invalid artwork details.' });
      const expected = expectedToken(app.workerToken, job, key, size);
      if (token.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected)))
        return reply(403, { ok: false, error: 'This artwork was not authorized by the shop.' });
      // Same identity processPSDJob uses for the batch artwork.
      const target = cachedFilePath({ shop: app.appUrl, id: job, key, size, ext: path.extname(filename) || '.jpg' });
      await fs.mkdir(path.dirname(target), { recursive: true });
      const partial = target + '.' + crypto.randomUUID() + '.partial';
      try {
        let received = 0;
        const counted = async function* () {
          for await (const chunk of req) {
            received += chunk.length;
            if (received > size) throw new Error('More data than announced.');
            yield chunk;
          }
        };
        await pipeline(counted, createWriteStream(partial, { flags: 'wx' }));
        if (received !== size) throw new Error('Artwork transfer incomplete (' + received + ' of ' + size + ' bytes).');
        await fs.rename(partial, target);
      } finally { await fs.rm(partial, { force: true }).catch(() => {}); }
      onArtwork({ app, job, size });
      return reply(200, { ok: true });
    } catch (error) {
      if (!res.headersSent) reply(400, { ok: false, error: String(error?.message || error).slice(0, 200) });
      else res.destroy();
    }
  });
  server.on('error', error => console.error('Local artwork intake unavailable (port ' + port + '):', error.message));
  server.listen(port, '127.0.0.1', () => console.log('Local artwork intake listening on 127.0.0.1:' + port));
  server.unref();
  return server;
}
