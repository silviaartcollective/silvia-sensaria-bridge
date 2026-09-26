import crypto from 'node:crypto';

const COOKIE_NAME = 'silvia_admin';
const SESSION_SECONDS = 30 * 24 * 60 * 60;

function adminPassword() {
  return String(process.env.ADMIN_PASSWORD || '');
}

function sessionKey() {
  const password = adminPassword();
  if (!password) throw new Error('ADMIN_PASSWORD is not configured');
  return crypto.createHash('sha256').update('silvia-admin-session:' + password).digest();
}

function timingSafeTextEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function sign(value) {
  return crypto.createHmac('sha256', sessionKey()).update(value).digest('base64url');
}

function parseCookies(req) {
  const result = {};
  const source = String(req.headers.cookie || '');
  for (const chunk of source.split(';')) {
    const index = chunk.indexOf('=');
    if (index < 0) continue;
    const key = chunk.slice(0, index).trim();
    const value = chunk.slice(index + 1).trim();
    if (key) result[key] = value;
  }
  return result;
}

export function verifyAdminPassword(candidate) {
  const expected = adminPassword();
  if (!expected) throw new Error('ADMIN_PASSWORD is not configured');
  return timingSafeTextEqual(candidate, expected);
}

export function createAdminSessionCookie() {
  const expires = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const payload = String(expires);
  const token = payload + '.' + sign(payload);
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_SECONDS}`;
}

export function clearAdminSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function isAdminAuthenticated(req) {
  if (!adminPassword()) return false;
  const token = parseCookies(req)[COOKIE_NAME];
  if (!token) return false;
  const [expiresRaw, signature] = token.split('.');
  const expires = Number(expiresRaw);
  if (!Number.isFinite(expires) || expires <= Math.floor(Date.now() / 1000) || !signature) return false;
  return timingSafeTextEqual(signature, sign(expiresRaw));
}

export function renderLogin({ error = '', returnTo = '/' } = {}) {
  const safeReturn = String(returnTo || '/').startsWith('/') ? String(returnTo || '/') : '/';
  const escapedError = String(error || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
  const escapedReturn = safeReturn
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Silvia Admin Login</title>
<style>
:root{--bg:#f4f1eb;--panel:#fffdfa;--ink:#20221e;--muted:#74776f;--line:#dfdcd4;--green:#536454;--warn:#9c5d3f}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif;padding:24px}
.card{width:min(430px,100%);background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:30px;box-shadow:0 16px 45px rgba(40,40,30,.08)}
.brand{font-family:Georgia,serif;font-size:29px;line-height:1.05}.sub{color:var(--muted);font-size:13px;margin:9px 0 24px;line-height:1.5}
label{display:grid;gap:8px;font-size:12px;font-weight:700}input{width:100%;border:1px solid var(--line);border-radius:11px;background:#fff;padding:12px 13px;font:inherit}
input:focus{outline:2px solid #cfd9cf;border-color:#9bab9b}button{width:100%;margin-top:15px;border:0;border-radius:11px;background:#30352e;color:#fff;padding:12px 15px;font-weight:750;cursor:pointer}
.error{margin:0 0 14px;padding:10px 12px;border-radius:9px;background:#f8e8e0;color:var(--warn);font-size:12px}
.note{font-size:11px;color:var(--muted);margin-top:14px;line-height:1.45}
</style>
</head>
<body>
<form class="card" method="post" action="/login">
  <div class="brand">Silvia<br>Fulfillment</div>
  <div class="sub">Sign in to the private Etsy → Sensaria dashboard.</div>
  ${escapedError ? `<div class="error">${escapedError}</div>` : ''}
  <input type="hidden" name="returnTo" value="${escapedReturn}">
  <label>Password
    <input name="password" type="password" autocomplete="current-password" autofocus required>
  </label>
  <button type="submit">Sign in</button>
  <div class="note">Your login is remembered securely on this browser for 30 days.</div>
</form>
</body>
</html>`;
}
