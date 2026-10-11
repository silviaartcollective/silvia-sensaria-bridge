import { WORKER_ID } from './config.mjs';
const WORKER_VERSION = '4.0.1';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function transientHttpStatus(status) {
  return [408, 425, 429, 500, 502, 503, 504].includes(Number(status));
}

async function request(app, path, { method = 'GET', body = undefined } = {}) {
  let lastError = null;

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    let response;
    try {
      response = await fetch(app.appUrl + path, {
        method,
        signal: AbortSignal.timeout(20000),
        headers: {
          Authorization: `Bearer ${app.workerToken}`,
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
          `${app.name} returned non-JSON (HTTP ${response.status})` +
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
      lastError = new Error(
        payload.error || `${app.name} request failed (HTTP ${response.status}).`
      );
      if (attempt < 4 && transientHttpStatus(response.status)) {
        await sleep(500 * attempt);
        continue;
      }
      throw lastError;
    }

    return payload;
  }

  throw lastError || new Error(`${app.name} request failed.`);
}

export function apiFor(app) {
  return {
    heartbeat(extra = {}) {
      return request(app, '/api/crop-worker/heartbeat', {
        method: 'POST',
        body: {
          workerId: WORKER_ID,
          version: WORKER_VERSION,
          ...extra
        }
      });
    },
    claimJob() {
      return request(app, '/api/crop-jobs/claim', {
        method: 'POST',
        body: { workerId: WORKER_ID, version: WORKER_VERSION }
      });
    },
    updateProgress(jobId, patch) {
      return request(app, `/api/crop-jobs/${encodeURIComponent(jobId)}/progress`, {
        method: 'POST',
        body: {
          workerId: WORKER_ID,
          version: WORKER_VERSION,
          ...patch
        }
      });
    },
    completeJob(jobId, assets) {
      return request(app, `/api/crop-jobs/${encodeURIComponent(jobId)}/complete`, {
        method: 'POST',
        body: {
          workerId: WORKER_ID,
          version: WORKER_VERSION,
          assets
        }
      });
    },
    // The PSD generator shares this same worker, per-shop token, and scheduler.
    claimMockup(owner) {
      return request(app,'/api/mockups/worker/claim',{method:'POST',body:{owner,version:WORKER_VERSION}});
    },
    inspectMockupTemplate(templateId,objects) {
      return request(app,'/api/mockups/templates/'+encodeURIComponent(templateId)+'/inspect',{
       method:'POST',body:{objects}
      });
    },
    mockupHeartbeat(jobId,owner) {
      return request(app,'/api/mockups/jobs/'+encodeURIComponent(jobId)+'/heartbeat',{
       method:'POST',body:{owner}
      });
    },
    mockupProgress(jobId,templateId,owner,stage) {
      return request(app,'/api/mockups/worker/'+encodeURIComponent(jobId)+
       '/templates/'+encodeURIComponent(templateId)+'/progress',{method:'POST',body:{owner,stage}});
    },
    mockupComplete(jobId,owner,templateId,outputKey,mapping) {
      return request(app,'/api/mockups/jobs/'+encodeURIComponent(jobId)+'/complete',{
       method:'POST',body:{owner,templateId,outputKey,mapping,visibilityVerified:true,
         mappingVerified:true,artworkReplaced:true}
      });
    },
    mockupFail(jobId,owner,templateId,error,needsMapping=false) {
      return request(app,'/api/mockups/jobs/'+encodeURIComponent(jobId)+'/fail',{
       method:'POST',body:{owner,templateId,error:String(error?.message||error).slice(0,450),needsMapping}
      });
    },
    mockupRelease(jobId,owner) {
      return request(app,'/api/mockups/jobs/'+encodeURIComponent(jobId)+'/control',{
       method:'POST',body:{owner,action:'release'}
      });
    },
    failJob(jobId, error) {
      return request(app, `/api/crop-jobs/${encodeURIComponent(jobId)}/fail`, {
        method: 'POST',
        body: {
          workerId: WORKER_ID,
          version: WORKER_VERSION,
          error: String(error?.message || error || 'Crop worker failed')
        }
      });
    }
  };
}
