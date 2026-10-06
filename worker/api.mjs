import { APP_URL, WORKER_ID, WORKER_TOKEN } from './config.mjs';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function transientHttpStatus(status) {
  return [408, 425, 429, 500, 502, 503, 504].includes(Number(status));
}

async function request(path, { method = 'GET', body = undefined } = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    let response;
    try {
      response = await fetch(APP_URL + path, {
        method,
        headers: {
          Authorization: `Bearer ${WORKER_TOKEN}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
    } catch (error) {
      lastError = error;
      if (attempt < 4) {
        await sleep(500 * attempt);
        continue;
      }
      throw error;
    }

    const text = await response.text();
    let payload = {};
    if (text.trim()) {
      try {
        payload = JSON.parse(text);
      } catch {
        const snippet = text.replace(/\s+/g, ' ').trim().slice(0, 120);
        lastError = new Error(
          `Silvia server returned non-JSON (HTTP ${response.status})` +
          (snippet ? `: ${snippet}` : '.')
        );
        if (attempt < 4 && (response.ok || transientHttpStatus(response.status))) {
          await sleep(500 * attempt);
          continue;
        }
        throw lastError;
      }
    }

    if (!response.ok) {
      lastError = new Error(payload.error || `Silvia request failed (HTTP ${response.status}).`);
      if (attempt < 4 && transientHttpStatus(response.status)) {
        await sleep(500 * attempt);
        continue;
      }
      throw lastError;
    }
    return payload;
  }
  throw lastError || new Error('Silvia request failed.');
}

export function heartbeat(extra = {}) {
  return request('/api/crop-worker/heartbeat', {
    method: 'POST',
    body: { workerId: WORKER_ID, version: '1.0.0', ...extra }
  });
}

export function claimJob() {
  return request('/api/crop-jobs/claim', {
    method: 'POST',
    body: { workerId: WORKER_ID }
  });
}

export function updateProgress(jobId, patch) {
  return request(`/api/crop-jobs/${encodeURIComponent(jobId)}/progress`, {
    method: 'POST',
    body: { workerId: WORKER_ID, ...patch }
  });
}

export function completeJob(jobId, assets) {
  return request(`/api/crop-jobs/${encodeURIComponent(jobId)}/complete`, {
    method: 'POST',
    body: { workerId: WORKER_ID, assets }
  });
}

export function failJob(jobId, error) {
  return request(`/api/crop-jobs/${encodeURIComponent(jobId)}/fail`, {
    method: 'POST',
    body: { workerId: WORKER_ID, error: String(error?.message || error || 'Crop worker failed') }
  });
}
