// Shared HTTP for the supplier APIs added after the first six (Printful,
// Lumaprints, Gooten): a time limit on every request, retries with backoff for
// requests that are safe to repeat, and errors that say what went wrong
// (credentials, rate limit, outage, malformed response…) without echoing a
// credential. Order creation passes retry:false and is never repeated here.

export class ProviderApiError extends Error {
  constructor(provider, kind, message, { status = null, retryAfterMs = null } = {}) {
    super(message);
    this.name = 'ProviderApiError';
    this.provider = provider;
    this.kind = kind;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

// What each kind means on the comparison page.
export const ERROR_KIND_STATUS = Object.freeze({
  'not-configured': 'not-configured',
  'invalid-credentials': 'invalid-credentials',
  'rate-limited': 'rate-limited',
  'api-unavailable': 'api-unavailable',
  timeout: 'timed-out',
  'malformed-response': 'quote-error',
  'not-found': 'not-found',
  'bad-request': 'quote-error',
  network: 'api-unavailable',
  'destination-unsupported': 'destination-unsupported'
});

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// A credential never leaves in a message: every configured secret is masked.
export function redact(text, secrets = []) {
  let value = String(text ?? '');
  for (const secret of secrets) {
    const s = String(secret || '');
    if (s.length >= 4) value = value.split(s).join('[redacted]');
    const encoded = s.length >= 4 ? encodeURIComponent(s) : '';
    if (encoded && encoded !== s) value = value.split(encoded).join('[redacted]');
  }
  return value.replace(/(authorization|x-api-key|partnerbillingkey|password|secret|token)(["'=:\s]+)[^\s"'&,}]+/gi, '$1$2[redacted]');
}

function retryAfter(header) {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 60000);
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.max(0, Math.min(at - Date.now(), 60000)) : null;
}

function errorDetail(text) {
  const value = String(text || '').trim();
  if (!value) return '';
  try {
    const parsed = JSON.parse(value);
    const message = parsed?.error?.message || parsed?.error || parsed?.message || parsed?.detail ||
      parsed?.result || parsed?.Message || parsed?.ErrorReferenceCode ||
      (Array.isArray(parsed?.Errors) ? parsed.Errors.map(e => e?.ErrorMessage || e?.Message || e).join('; ') : '');
    return String(typeof message === 'string' ? message : JSON.stringify(message)).slice(0, 400);
  } catch {
    return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400);
  }
}

// One request, returning parsed JSON (or null for an empty body).
// options: { provider, method, headers, body, timeoutMs, retries, retry, secrets, fetchImpl, wait }
export async function providerRequest(url, {
  provider, method = 'GET', headers = {}, body, timeoutMs = 15000, retries = 2, retry,
  secrets = [], fetchImpl = globalThis.fetch, wait = sleep
} = {}) {
  const repeatable = retry ?? ['GET', 'HEAD'].includes(String(method).toUpperCase());
  const attempts = repeatable ? Math.max(1, retries + 1) : 1;
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response, text;
    try {
      response = await fetchImpl(url, {
        method,
        headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
        body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
        signal: controller.signal
      });
      text = await response.text();
    } catch (error) {
      clearTimeout(timer);
      const aborted = error?.name === 'AbortError' || controller.signal.aborted;
      lastError = new ProviderApiError(provider, aborted ? 'timeout' : 'network',
        aborted ? `${provider} API did not answer within ${Math.round(timeoutMs / 1000)} seconds.`
          : `${provider} API could not be reached: ${redact(error?.message || error, secrets)}`);
      if (attempt + 1 < attempts) { await wait(500 * 2 ** attempt); continue; }
      throw lastError;
    }
    clearTimeout(timer);
    const status = response.status;
    if (response.ok) {
      if (!text) return null;
      try { return JSON.parse(text); }
      catch { throw new ProviderApiError(provider, 'malformed-response', `${provider} API returned a response that is not JSON (HTTP ${status}).`, { status }); }
    }
    const detail = redact(errorDetail(text), secrets);
    if (status === 401 || status === 403) {
      throw new ProviderApiError(provider, 'invalid-credentials',
        `${provider} rejected the API credentials (HTTP ${status})${detail ? ': ' + detail : ''}. Check the key in Render.`, { status });
    }
    if (status === 429) {
      const delay = retryAfter(response.headers?.get?.('retry-after'));
      lastError = new ProviderApiError(provider, 'rate-limited',
        `${provider} API rate limit reached (HTTP 429)${detail ? ': ' + detail : ''}. Try again shortly.`, { status, retryAfterMs: delay });
      if (attempt + 1 < attempts) { await wait(delay ?? 1000 * 2 ** attempt); continue; }
      throw lastError;
    }
    if (status >= 500) {
      lastError = new ProviderApiError(provider, 'api-unavailable',
        `${provider} API is unavailable (HTTP ${status})${detail ? ': ' + detail : ''}.`, { status });
      if (attempt + 1 < attempts) { await wait(700 * 2 ** attempt); continue; }
      throw lastError;
    }
    if (status === 404) throw new ProviderApiError(provider, 'not-found', `${provider} API: not found (HTTP 404)${detail ? ': ' + detail : ''}.`, { status });
    throw new ProviderApiError(provider, 'bad-request', `${provider} API refused the request (HTTP ${status})${detail ? ': ' + detail : ''}.`, { status });
  }
  throw lastError;
}

// A comparison record's status for a failed lookup.
export function statusForError(error, fallback = 'error') {
  return error instanceof ProviderApiError ? (ERROR_KIND_STATUS[error.kind] || fallback) : fallback;
}

// Several lookups a few at a time.
export async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
