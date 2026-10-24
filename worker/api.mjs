import { WORKER_ID } from './config.mjs';
export const WORKER_VERSION = '4.7.7';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function transientHttpStatus(status) {
  return [408, 425, 429, 500, 502, 503, 504].includes(Number(status));
}

async function request(app, path, { method = 'GET', body = undefined, timeoutMs = 20000, attempts = 4 } = {}) {
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let response;
    try {
      response = await fetch(app.appUrl + path, {
        method,
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          Authorization: `Bearer ${app.workerToken}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
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
        if (attempt < attempts && (response.ok || transientHttpStatus(response.status))) {
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
      if (attempt < attempts && transientHttpStatus(response.status)) {
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
    // `wait`: the server holds the request until a batch is queued (long poll).
    claimMockup(owner,limit=1,wait=0) {
      return request(app,'/api/mockups/worker/claim',{method:'POST',body:{owner,version:WORKER_VERSION,limit,wait},
        timeoutMs:wait+20000,attempts:wait?1:4});
    },
    mockupTemplates() {
      return request(app,'/api/mockups/worker/templates');
    },
    // The PSDs in this PC's mockup folder for the shop.
    localTemplates(files) {
      return request(app, '/api/mockups/worker/local-templates', { method: 'POST', body: { files }, attempts: 2 });
    },
    // A small preview of a template's scene, sent once per version of the PSD.
    async templatePreview(templateId, jpeg, version) {
      const id = encodeURIComponent(templateId);
      const { key, uploadUrl } = await request(app, '/api/mockups/templates/' + id + '/preview', { method: 'POST', body: {} });
      const put = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: jpeg,
        signal: AbortSignal.timeout(60000) });
      if (!put.ok) throw new Error('Template preview upload failed (HTTP ' + put.status + ').');
      return request(app, '/api/mockups/templates/' + id + '/preview-confirm', { method: 'POST', body: { key, version }, attempts: 2 });
    },
    templateOrientation(templateId, orientation, squareCompatible = false) {
      return request(app, '/api/mockups/worker/templates/' + encodeURIComponent(templateId) + '/orientation', {
        method: 'POST', body: { orientation, squareCompatible }, attempts: 2 });
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
    // fullPending: the full-size JPG follows later (mockupFull); `dimensions`
    // is its size until then.
    mockupComplete(jobId,owner,templateId,outputKey,mapping,previewUploaded=false,etsyUploaded=false,{fullPending=false,dimensions=null}={}) {
      return request(app,'/api/mockups/jobs/'+encodeURIComponent(jobId)+'/complete',{
       method:'POST',body:{owner,templateId,outputKey,mapping,previewUploaded,etsyUploaded,fullPending,dimensions,visibilityVerified:true,
         mappingVerified:true,artworkReplaced:true}
      });
    },
    // action "url": a fresh upload URL for a pending full-size JPG; "done": check it.
    mockupFull(jobId,templateId,outputKey,action) {
      return request(app,'/api/mockups/worker/'+encodeURIComponent(jobId)+
       '/templates/'+encodeURIComponent(templateId)+'/full',{method:'POST',body:{outputKey,action},attempts:2});
    },
    // retry: a temporary problem; the shop queues the PSD again (up to 3 tries).
    mockupFail(jobId,owner,templateId,error,needsMapping=false,{retry=false}={}) {
      return request(app,'/api/mockups/jobs/'+encodeURIComponent(jobId)+'/fail',{
       method:'POST',body:{owner,templateId,error:String(error?.message||error).slice(0,450),needsMapping,retry}
      });
    },
    mockupPause(jobId,owner) {
      return request(app,'/api/mockups/jobs/'+encodeURIComponent(jobId)+'/control',{
       method:'POST',body:{owner,action:'pause'}
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
