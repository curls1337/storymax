// Scenario API generation service for Storymax (Images & Videos)
// Keeps Scenario logic cleanly isolated from Freebeat & Magica.

const path = require('path');
const fs = require('fs');
const scenarioClient = require('./scenarioClient');

function publicBase() {
  return (process.env.PUBLIC_URL || process.env.APP_URL || '').replace(/\/$/, '');
}

// Convert local stored path into an internet-reachable public URL
function toPublicUrl(p, cdnFallback) {
  if (!p && !cdnFallback) return null;
  const s = String(p || '');
  if (/^https?:\/\//i.test(s)) return s;
  const base = publicBase();
  if (base && !isNonPublicHost(base)) {
    const idx = s.indexOf('uploads/');
    const rel = idx >= 0 ? s.slice(idx) : ('uploads/' + path.basename(s));
    return `${base}/${rel}`;
  }
  if (cdnFallback && /^https?:\/\//i.test(String(cdnFallback))) {
    return String(cdnFallback);
  }
  if (base) {
    const idx = s.indexOf('uploads/');
    const rel = idx >= 0 ? s.slice(idx) : ('uploads/' + path.basename(s));
    return `${base}/${rel}`;
  }
  return null;
}

function isNonPublicHost(u) {
  try {
    const h = new URL(u).hostname;
    if (!h || h === 'localhost' || !h.includes('.')) return true;
    if (/^127\./.test(h) || h === '0.0.0.0' || h === '::1') return true;
    if (/^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
    return false;
  } catch (e) { return true; }
}

/**
 * Check if a storyboard belongs to a user who prefers Scenario
 */
async function isScenarioForStoryboard(db, storyboardId) {
  try {
    const row = await db.get(
      'SELECT u.preferred_provider AS pp, u.can_use_scenario AS cus FROM storyboards s JOIN users u ON u.id = s.user_id WHERE s.id = ?',
      [storyboardId]
    );
    return !!(row && row.pp === 'scenario' && (row.cus === 1 || row.cus === null || row.cus === undefined));
  } catch (e) {
    return false;
  }
}

/**
 * Get all active Scenario API keys from database
 */
async function getAllActiveScenarioKeys(db, specificKeyId) {
  if (specificKeyId) {
    const key = await db.get('SELECT * FROM scenario_api_keys WHERE id = ? AND is_active = 1', [specificKeyId]);
    if (key) return [key];
  }
  const rows = await db.all('SELECT * FROM scenario_api_keys WHERE is_active = 1 ORDER BY id ASC');
  return rows || [];
}

/**
 * Pick a random active Scenario API key
 */
async function pickScenarioKey(db, specificKeyId) {
  const keys = await getAllActiveScenarioKeys(db, specificKeyId);
  if (!keys.length) return null;
  return keys[Math.floor(Math.random() * keys.length)];
}

/**
 * Execute a task with automatic key failover across active Scenario keys
 */
async function executeWithScenarioFailover(db, fn, { onLog, specificKeyId } = {}) {
  const keys = await getAllActiveScenarioKeys(db, specificKeyId);
  if (!keys.length) {
    throw new Error('Tidak ada API Key Scenario yang aktif. Tambahkan API Key & Secret di Panel Admin.');
  }

  let lastError = null;
  for (let i = 0; i < keys.length; i++) {
    const keyRecord = keys[i];
    try {
      if (onLog && i > 0) {
        onLog(`[Scenario Auto-Switch 🔄] Mencoba Key #${keyRecord.id} (${keyRecord.label})...`);
      }
      const result = await fn(keyRecord);
      try {
        await db.run('UPDATE scenario_api_keys SET last_status = ? WHERE id = ?', ['OK - ' + new Date().toLocaleString('id-ID'), keyRecord.id]);
      } catch (e) {}
      return { result, keyRecord };
    } catch (err) {
      lastError = err;
      const errStr = String(err.message || err);
      const isAuthOrQuota = /unauthorized|401|403|quota|credit|insufficient|limit/i.test(errStr);
      if (isAuthOrQuota) {
        try {
          await db.run('UPDATE scenario_api_keys SET is_active = 0, last_status = ? WHERE id = ?', [`Error: ${errStr.slice(0, 60)}`, keyRecord.id]);
        } catch (e) {}
        if (onLog) onLog(`[Scenario Auto-Switch ⚠️] Key #${keyRecord.id} dinonaktifkan: ${errStr}`);
      } else {
        if (onLog) onLog(`[Scenario ⚠️] Key #${keyRecord.id} gagal: ${errStr}`);
      }

      if (i < keys.length - 1 && onLog) {
        onLog(`[Scenario Auto-Switch 🔄] Beralih ke Key #${keys[i + 1].id}...`);
      }
    }
  }

  throw lastError || new Error('Semua API Key Scenario di pool gagal digunakan.');
}

/**
 * Curated list of popular Scenario models for Images & Videos
 */
const SCENARIO_CATALOG = {
  imageModels: [
    { id: 'model_openai-gpt-image-2', name: 'GPT Image 2 (OpenAI)', tags: ['Featured', 'High Quality', 'Editing'] },
    { id: 'model_bfl-flux-2-dev', name: 'FLUX 2 Dev (Black Forest Labs)', tags: ['Photorealism', 'Detail'] },
    { id: 'model_bytedance-seedream-5-0-pro', name: 'Seedream 5.0 Pro (ByteDance)', tags: ['Fast', 'Stylized'] },
    { id: 'model_google-gemini-3-1-flash', name: 'Gemini 3.1 Flash (Google)', tags: ['Multimodal', 'Prompt Adherence'] },
    { id: 'model_xai-grok-imagine-image-2-0', name: 'Grok Imagine 2.0 (xAI)', tags: ['2K', 'Artistic'] },
    { id: 'model_ideogram-v4', name: 'Ideogram V4', tags: ['Typography', 'Design'] },
    { id: 'model_flux-1-schnell', name: 'FLUX 1 Schnell', tags: ['Ultra Fast'] }
  ],
  videoModels: [
    { id: 'model_bytedance-seedance-2-0', name: 'Seedance 2.0 (ByteDance)', tags: ['I2V', 'T2V', 'Audio', 'Featured'] },
    { id: 'model_bytedance-seedance-2-5', name: 'Seedance 2.5 (ByteDance)', tags: ['Latest', 'I2V', 'Audio'] },
    { id: 'model_kling-v3-i2v-pro', name: 'Kling V3 I2V Pro', tags: ['High Fidelity', 'Motion'] },
    { id: 'model_wan-2-7-i2v', name: 'Wan 2.7 I2V (Alibaba)', tags: ['Smooth Motion', 'Cinematic'] },
    { id: 'model_ltx-2-5-pro', name: 'LTX-2.5 Pro', tags: ['Pro', 'Fast'] },
    { id: 'model_minimax-h3', name: 'Minimax H3 (Hailuo)', tags: ['Realistic'] },
    { id: 'model_pixverse-v6-t2v', name: 'Pixverse V6', tags: ['Dynamic Animation'] }
  ]
};

/**
 * Generate ONE image via Scenario API
 */
async function generateOneImageScenario(keyRecord, prompt, options = {}) {
  const onLog = typeof options.onLog === 'function' ? options.onLog : () => {};
  const modelId = options.model || 'model_openai-gpt-image-2';
  const aspectRatio = options.aspectRatio || '16:9';

  onLog(`[Scenario] Memulai generasi gambar dengan model "${modelId}" (Rasio: ${aspectRatio})...`);

  const params = {
    prompt: String(prompt || '').trim(),
    aspectRatio
  };

  // Add reference images if provided and valid
  const refUrl = toPublicUrl(options.referenceImage || options.sceneImage);
  if (refUrl) {
    params.image = refUrl;
  }

  const submitRes = await scenarioClient.generateCustom(keyRecord.key_value, keyRecord.secret_value, modelId, params);
  const jobId = submitRes?.job?.jobId || submitRes?.jobId || submitRes?.id;

  if (!jobId) {
    throw new Error('Scenario tidak mengembalikan jobId untuk proses generasi gambar.');
  }

  onLog(`[Scenario] Job dibuat (ID: ${jobId}), menunggu proses rendering...`);

  const done = await scenarioClient.pollJobUntilDone(keyRecord.key_value, keyRecord.secret_value, jobId, {
    timeoutMs: options.timeoutMs || 300000,
    intervalMs: 3000,
    onProgress: (p) => {
      if (p.progress) onLog(`[Scenario] Progress: ${p.progress}%`);
    }
  });

  if (!done.url) {
    throw new Error('Scenario tidak mengembalikan URL gambar yang valid.');
  }

  onLog(`[Scenario] Gambar berhasil dibuat: ${done.url}`);
  return {
    url: done.url,
    credit: done.cost || 0,
    jobId,
    assetId: done.assetIds?.[0]
  };
}

/**
 * Generate ONE video via Scenario API
 */
async function generateVideoScenario(keyRecord, options = {}) {
  const onLog = typeof options.onLog === 'function' ? options.onLog : () => {};
  const modelId = options.model || options.nodeType || 'model_bytedance-seedance-2-0';
  const aspectRatio = options.aspectRatio || '16:9';
  const duration = options.duration ? Number(options.duration) : 5;
  const resolution = options.resolution || '720p';
  const generateAudio = options.generateAudio !== undefined ? !!options.generateAudio : true;

  onLog(`[Scenario] Memulai generasi video dengan model "${modelId}" (Durasi: ${duration}s, Rasio: ${aspectRatio}, Resolusi: ${resolution})...`);

  const params = {
    prompt: String(options.prompt || '').trim(),
    aspectRatio,
    duration,
    resolution,
    generateAudio
  };

  // First frame / scene image
  const imgUrl = toPublicUrl(options.sceneImage, options.originalCdnUrl);
  if (imgUrl) {
    params.image = imgUrl;
  }

  // Last frame image if provided
  if (options.lastFrameImage) {
    const lastUrl = toPublicUrl(options.lastFrameImage);
    if (lastUrl) params.lastFrameImage = lastUrl;
  }

  // Reference images array (multimodal mode)
  if (options.referenceImages && Array.isArray(options.referenceImages) && options.referenceImages.length > 0) {
    const refs = options.referenceImages.map(r => toPublicUrl(r)).filter(Boolean);
    if (refs.length > 0) {
      params.referenceImages = refs.slice(0, 9);
      // In Seedance multimodal mode, image (first frame) is mutually exclusive with referenceImages
      if (params.referenceImages.length > 0 && !params.lastFrameImage) {
        delete params.image;
      }
    }
  }

  const submitRes = await scenarioClient.generateCustom(keyRecord.key_value, keyRecord.secret_value, modelId, params);
  const jobId = submitRes?.job?.jobId || submitRes?.jobId || submitRes?.id;

  if (!jobId) {
    throw new Error('Scenario tidak mengembalikan jobId untuk proses generasi video.');
  }

  onLog(`[Scenario] Video Job dibuat (ID: ${jobId}), menunggu proses rendering (dapat memakan waktu 1-5 menit)...`);

  const done = await scenarioClient.pollJobUntilDone(keyRecord.key_value, keyRecord.secret_value, jobId, {
    timeoutMs: options.timeoutMs || 900000, // 15 min
    intervalMs: 4000,
    onProgress: (p) => {
      if (p.progress) onLog(`[Scenario] Render progress: ${p.progress}%`);
    }
  });

  if (!done.url) {
    throw new Error('Scenario tidak mengembalikan URL video yang valid.');
  }

  onLog(`[Scenario] Video berhasil dibuat: ${done.url}`);
  return {
    url: done.url,
    credit: done.cost || 0,
    jobId,
    assetId: done.assetIds?.[0]
  };
}

module.exports = {
  toPublicUrl,
  isScenarioForStoryboard,
  getAllActiveScenarioKeys,
  pickScenarioKey,
  executeWithScenarioFailover,
  SCENARIO_CATALOG,
  generateOneImageScenario,
  generateVideoScenario
};
