// Scenario API HTTP Client (Scenario Cloud v1)
// Documentation: https://docs.scenario.com/api
// Base URL: https://api.cloud.scenario.com/v1

const SCENARIO_API_BASE = 'https://api.cloud.scenario.com/v1';

function toAuthHeader(apiKey, apiSecret) {
  const creds = `${String(apiKey || '').trim()}:${String(apiSecret || '').trim()}`;
  return 'Basic ' + Buffer.from(creds).toString('base64');
}

async function request(apiKey, apiSecret, path, options = {}) {
  const url = path.startsWith('http') ? path : `${SCENARIO_API_BASE}${path.startsWith('/') ? path : '/' + path}`;
  const headers = {
    'Authorization': toAuthHeader(apiKey, apiSecret),
    'Accept': 'application/json',
    ...(options.headers || {})
  };

  if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.body);
  }

  const res = await fetch(url, {
    ...options,
    headers
  });

  let data;
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  if (ct.includes('application/json')) {
    data = await res.json().catch(() => null);
  } else {
    data = await res.text().catch(() => null);
  }

  if (!res.ok) {
    const msg = (data && (data.message || data.error || data.reason)) || `HTTP ${res.status} ${res.statusText}`;
    const err = new Error(`Scenario API Error (${res.status}): ${msg}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}

/**
 * Test credentials validity against /projects and /models/public
 */
async function testConnection(apiKey, apiSecret) {
  try {
    const [projRes, pubModelsRes] = await Promise.allSettled([
      request(apiKey, apiSecret, '/projects', { method: 'GET' }),
      request(apiKey, apiSecret, '/models/public?pageSize=1', { method: 'GET' })
    ]);

    if (pubModelsRes.status === 'fulfilled' || projRes.status === 'fulfilled') {
      const consumption = projRes.status === 'fulfilled' && projRes.value?.projects?.[0]?.consumption;
      return {
        ok: true,
        consumption: typeof consumption === 'number' ? consumption : 0,
        message: 'Koneksi Scenario API Berhasil'
      };
    }

    const err = pubModelsRes.reason || projRes.reason;
    throw err || new Error('Gagal memverifikasi API Key & Secret');
  } catch (err) {
    return {
      ok: false,
      message: err.message || 'Koneksi gagal'
    };
  }
}

/**
 * Get public models with pagination
 */
async function getPublicModels(apiKey, apiSecret, options = {}) {
  const { pageSize = 100, paginationToken } = options;
  let qs = `pageSize=${encodeURIComponent(pageSize)}`;
  if (paginationToken) qs += `&paginationToken=${encodeURIComponent(paginationToken)}`;
  return await request(apiKey, apiSecret, `/models/public?${qs}`, { method: 'GET' });
}

/**
 * Get details & inputs schema of a specific model
 */
async function getModelDetails(apiKey, apiSecret, modelId) {
  return await request(apiKey, apiSecret, `/models/${encodeURIComponent(modelId)}`, { method: 'GET' });
}

/**
 * Trigger generation on a model (image / video / 3D / audio)
 */
async function generateCustom(apiKey, apiSecret, modelId, params = {}) {
  return await request(apiKey, apiSecret, `/generate/custom/${encodeURIComponent(modelId)}`, {
    method: 'POST',
    body: params
  });
}

/**
 * Poll job status
 */
async function getJob(apiKey, apiSecret, jobId) {
  return await request(apiKey, apiSecret, `/jobs/${encodeURIComponent(jobId)}`, { method: 'GET' });
}

/**
 * Get asset info (URL, dimensions, etc.)
 */
async function getAsset(apiKey, apiSecret, assetId) {
  return await request(apiKey, apiSecret, `/assets/${encodeURIComponent(assetId)}`, { method: 'GET' });
}

/**
 * Poll job until completed or failed
 */
async function pollJobUntilDone(apiKey, apiSecret, jobId, {
  timeoutMs = 600000, // 10 minutes max
  intervalMs = 3000,
  onProgress
} = {}) {
  const startTime = Date.now();
  const log = typeof onProgress === 'function' ? onProgress : () => {};

  while (Date.now() - startTime < timeoutMs) {
    const jobRes = await getJob(apiKey, apiSecret, jobId);
    const job = jobRes?.job || jobRes;
    const status = job?.status;

    log({ status, progress: job?.progress || 0, jobId });

    if (status === 'success' || status === 'succeeded' || status === 'completed') {
      const assetIds = job?.metadata?.assetIds || [];
      let asset = null;
      let url = null;

      if (assetIds.length > 0) {
        const assetRes = await getAsset(apiKey, apiSecret, assetIds[0]);
        asset = assetRes?.asset || assetRes;
        url = asset?.url;
      }

      return {
        job,
        asset,
        url,
        assetIds,
        cost: job?.billing?.cuCost || job?.cost || 0
      };
    }

    if (status === 'failed' || status === 'canceled' || status === 'error') {
      const reason = job?.error || job?.reason || 'Job execution failed in Scenario';
      throw new Error(`Scenario job ${jobId} ${status}: ${reason}`);
    }

    await new Promise(r => setTimeout(r, intervalMs));
  }

  throw new Error(`Scenario generation timed out after ${Math.round(timeoutMs / 1000)}s (job: ${jobId})`);
}

module.exports = {
  SCENARIO_API_BASE,
  toAuthHeader,
  testConnection,
  getPublicModels,
  getModelDetails,
  generateCustom,
  getJob,
  getAsset,
  pollJobUntilDone
};
