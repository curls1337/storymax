// Magica REST API client (https://magica.com/docs).
//
// Base: https://api.magica.com/api/v1  ·  Auth: Authorization: Bearer gx_...
// Flow (verified against the live API):
//   POST /nodes/{nodeType}/run  body {subModelId, input}  -> 202 { runId }
//   GET  /nodes/runs/{runId}  -> { status: RUNNING|COMPLETED|FAILED|CANCELED,
//                                  output: { result: [mediaUrl...], resultMetadata: [{mediaType}], creditUsed },
//                                  error, creditUsed }
//
// This module is provider-isolated: it does NOT touch the Freebeat pipeline. It is
// used by the Magica generation paths and by the admin "Test connection" endpoint.

const MAGICA_BASE = 'https://api.magica.com/api/v1';
const TERMINAL = new Set(['COMPLETED', 'FAILED', 'CANCELED', 'ERROR']);

function authHeaders(apiKey) {
  return {
    Authorization: `Bearer ${String(apiKey || '').trim()}`,
    'Content-Type': 'application/json',
  };
}

// Small fetch wrapper with a timeout. Returns { ok, status, data }.
async function request(apiKey, method, path, body, timeoutMs = 60000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${MAGICA_BASE}${path}`, {
      method,
      headers: authHeaders(apiKey),
      body: body != null ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    let data = null;
    const text = await res.text();
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = { raw: text }; }
    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

async function listModels(apiKey) {
  const r = await request(apiKey, 'GET', '/models', null, 40000);
  if (!r.ok) throw new Error(magicaError(r, 'Gagal mengambil daftar model Magica'));
  return Array.isArray(r.data) ? r.data : (r.data && r.data.models) || [];
}

async function getCreditBalance(apiKey) {
  const r = await request(apiKey, 'GET', '/credits/balance', null, 30000);
  if (!r.ok) throw new Error(magicaError(r, 'Gagal mengambil saldo kredit Magica'));
  return r.data; // { availableBalance, formatted, hasActiveSubscription, ... }
}

// Estimate the microcredit cost of one or more node runs WITHOUT side effects.
// nodes: [{ type, data, subModelId? }]. Mirrors the run-time charge exactly.
async function estimateCredits(apiKey, nodes) {
  const r = await request(apiKey, 'POST', '/nodes/estimate-credits', { nodes }, 30000);
  if (!r.ok) throw new Error(magicaError(r, 'Gagal estimasi kredit Magica'));
  return (r.data && r.data.estimates) || [];
}

async function getModelSchema(apiKey, modelId) {
  const r = await request(apiKey, 'GET', `/models/${encodeURIComponent(modelId)}/schema`, null, 30000);
  if (!r.ok) throw new Error(magicaError(r, `Gagal mengambil schema model ${modelId}`));
  return r.data;
}

// Start a model run. Returns the runId. Optional `webhook` object ({url, events,
// metadata}) registers an async callback for this run (Magica POSTs on completion).
async function runModel(apiKey, nodeType, subModelId, input, webhook) {
  const body = { input: input || {} };
  if (subModelId) body.subModelId = subModelId;
  if (webhook && webhook.url) body.webhook = webhook;
  const r = await request(apiKey, 'POST', `/nodes/${encodeURIComponent(nodeType)}/run`, body, 60000);
  if (!r.ok) throw new Error(magicaError(r, 'Gagal memulai run Magica'));
  const runId = r.data && (r.data.runId || r.data.id || (r.data.data && r.data.data.runId));
  if (!runId) throw new Error('Respons run Magica tidak berisi runId.');
  return runId;
}

async function getRun(apiKey, runId) {
  const r = await request(apiKey, 'GET', `/nodes/runs/${encodeURIComponent(runId)}`, null, 30000);
  if (!r.ok) throw new Error(magicaError(r, 'Gagal mengambil status run Magica'));
  return r.data;
}

// Media URLs from a completed run (output.result is an array of URLs).
function extractMediaUrls(run) {
  const out = run && run.output;
  if (!out) return [];
  if (Array.isArray(out.result)) return out.result.filter(Boolean);
  if (typeof out.result === 'string') return [out.result];
  if (Array.isArray(out.media)) return out.media.filter(Boolean);
  if (typeof out.url === 'string') return [out.url];
  return [];
}

// Poll a run until it reaches a terminal state. onLog(msg) receives progress lines.
async function pollRun(apiKey, runId, opts = {}) {
  const timeoutMs = opts.timeoutMs || 600000; // 10 min
  const intervalMs = opts.intervalMs || 5000;
  const onLog = typeof opts.onLog === 'function' ? opts.onLog : () => {};
  const start = Date.now();
  while (true) {
    let run;
    try {
      run = await getRun(apiKey, runId);
    } catch (e) {
      // transient — keep polling until timeout
      onLog(`(menunggu status Magica: ${e.message})`);
      run = null;
    }
    const status = run && (run.status || run.state);
    if (status) onLog(`Status Magica: ${status}`);
    if (status && TERMINAL.has(String(status).toUpperCase())) {
      const up = String(status).toUpperCase();
      if (up === 'COMPLETED') {
        return { status: up, run, mediaUrls: extractMediaUrls(run), creditUsed: run.creditUsed };
      }
      throw new Error(`Run Magica ${up}${run && run.error ? ': ' + (run.error.message || run.error) : ''}`);
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error('Timeout menunggu hasil Magica.');
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

// Lightweight connectivity test for the admin UI: verifies the key and returns a
// small summary (credit balance + how many image/video models are available).
async function testConnection(apiKey) {
  const [credits, models] = await Promise.all([
    getCreditBalance(apiKey),
    listModels(apiKey),
  ]);
  const catCount = {};
  for (const m of models) catCount[m.category] = (catCount[m.category] || 0) + 1;
  return {
    ok: true,
    credits,
    totalModels: models.length,
    imageModels: models.filter((m) => String(m.category || '').includes('image')).length,
    videoModels: models.filter((m) => String(m.category || '').includes('video')).length,
  };
}

function magicaError(r, fallback) {
  const d = r && r.data;
  const msg = d && (d.message || d.error || (d.details && JSON.stringify(d.details)));
  return `${fallback} (HTTP ${r ? r.status : '?'})${msg ? ': ' + msg : ''}`;
}

module.exports = {
  MAGICA_BASE,
  listModels,
  getCreditBalance,
  estimateCredits,
  getModelSchema,
  runModel,
  getRun,
  pollRun,
  extractMediaUrls,
  testConnection,
};
