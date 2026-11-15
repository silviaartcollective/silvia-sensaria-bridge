// A private, expiring link to one production crop, served by this app, for
// suppliers that check an artwork URL with a HEAD request before downloading
// it (PrintShrimp). A signed R2 link is signed for GET only, so R2 answers a
// HEAD with 403. The link names one file under an artwork's fulfillment
// folder, carries its expiry and an HMAC; nothing else can be fetched with it.
import crypto from 'node:crypto';

const PREFIX = '/supplier-artwork/';
// Production crops only (ratio and size crops, current or revision); never a master.
const ALLOWED = /^artworks\/[A-Z]{2,5}\d+\/(?:revisions\/[0-9a-f-]{36}\/)?fulfillment\/(?:by-size\/)?[A-Za-z0-9.-]+\.(?:jpg|jpeg|png)$/;

function signingKey(env = process.env) {
  const password = String(env.ADMIN_PASSWORD || '');
  if (!password) throw new Error('ADMIN_PASSWORD is not configured');
  return crypto.createHash('sha256').update('supplier-artwork-link:' + password).digest();
}
const sign = (key, expires, env) => crypto.createHmac('sha256', signingKey(env)).update(key + '\n' + expires).digest('base64url');

export function supplierArtworkLink({ key, base, expiresInSeconds = 7 * 24 * 60 * 60, now = Date.now(), env = process.env }) {
  const objectKey = String(key || '');
  if (!ALLOWED.test(objectKey)) throw new Error('Only production crops can be shared with a supplier.');
  const origin = String(base || '').replace(/\/+$/, '');
  if (!/^https:\/\/[^/\s]+$/.test(origin)) throw new Error('The app address for the artwork link is not HTTPS.');
  const expires = Math.floor(now / 1000) + Math.max(60, Math.floor(expiresInSeconds));
  const name = objectKey.split('/').pop();
  return origin + PREFIX + Buffer.from(objectKey).toString('base64url') + '/' + expires + '/' + sign(objectKey, expires, env) + '/' + name;
}

export const isSupplierArtworkPath = pathname => String(pathname || '').startsWith(PREFIX);

// The R2 key a link names, or an error when it is altered, expired or not a crop.
export function verifySupplierArtworkPath(pathname, { now = Date.now(), env = process.env } = {}) {
  const parts = String(pathname || '').slice(PREFIX.length).split('/');
  if (parts.length !== 4) throw new Error('Not an artwork link.');
  const [encoded, expiresText, signature] = parts;
  let key = '';
  try { key = Buffer.from(encoded, 'base64url').toString('utf8'); } catch { throw new Error('Not an artwork link.'); }
  if (!ALLOWED.test(key)) throw new Error('Not an artwork link.');
  const expires = Number(expiresText);
  if (!Number.isSafeInteger(expires) || expires * 1000 < now) throw new Error('This artwork link has expired.');
  const expected = Buffer.from(sign(key, expires, env)), given = Buffer.from(String(signature || ''));
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) throw new Error('Not an artwork link.');
  return key;
}
