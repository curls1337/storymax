const path = require('path');
const fs = require('fs');
const scenarioClient = require('./scenarioClient');
const { uploadsDir } = require('../config');

function publicBase() {
  return (process.env.PUBLIC_URL || process.env.APP_URL || '').replace(/\/$/, '');
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

/**
 * Ensure an image is converted to a valid Scenario Asset ID (asset_...).
 * Scenario custom generation endpoints require an assetId for file inputs.
 */
async function ensureScenarioAssetId(keyRecord, imagePathOrUrl, cdnFallback, onLog) {
  const log = typeof onLog === 'function' ? onLog : () => {};
  if (!imagePathOrUrl && !cdnFallback) return null;

  const raw = String(imagePathOrUrl || cdnFallback || '').trim();
  if (raw.startsWith('asset_')) return raw;

  // 1. Try to resolve local file first
  let localFile = null;
  if (path.isAbsolute(raw) && fs.existsSync(raw)) {
    localFile = raw;
  } else {
    const filename = path.basename(raw.split('?')[0]);
    const possiblePaths = [
      path.join(uploadsDir, filename),
      path.join(uploadsDir, 'previews', filename),
      path.join(__dirname, '..', 'public', 'uploads', filename),
      path.join(__dirname, '..', raw.replace(/^\//, '').split('?')[0])
    ];
    for (const p of possiblePaths) {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) {
        localFile = p;
        break;
      }
    }
  }

  if (localFile) {
    try {
      log(`[Scenario 📤] Mengunggah gambar (${path.basename(localFile)}) ke Scenario Cloud Assets...`);
      const buf = fs.readFileSync(localFile);
      const ext = path.extname(localFile).toLowerCase();
      const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : (ext === '.webp' ? 'image/webp' : 'image/png');
      const dataUri = `data:${mime};base64,${buf.toString('base64')}`;
      const uploadRes = await scenarioClient.uploadAsset(keyRecord.key_value, keyRecord.secret_value, dataUri, path.basename(localFile));
      const assetId = uploadRes?.asset?.id;
      if (assetId) {
        log(`[Scenario ✅] Asset siap (ID: ${assetId}).`);
        return assetId;
      }
    } catch (uErr) {
      log(`[Scenario ⚠️] Gagal upload local asset: ${uErr.message}`);
    }
  }

  // 2. If remote URL (cdnFallback or raw is http)
  const candidates = [cdnFallback, imagePathOrUrl].filter(Boolean);
  for (const c of candidates) {
    const s = String(c).trim();
    if (/^https?:\/\//i.test(s) && !isNonPublicHost(s)) {
      try {
        log(`[Scenario 🌐] Mengambil gambar dari CDN dan mendaftarkan ke Scenario Asset...`);
        const ab = await fetch(s).then(r => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.arrayBuffer();
        });
        const buf = Buffer.from(ab);
        const ext = path.extname(s.split('?')[0]).toLowerCase();
        const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : (ext === '.webp' ? 'image/webp' : 'image/png');
        const dataUri = `data:${mime};base64,${buf.toString('base64')}`;
        const uploadRes = await scenarioClient.uploadAsset(keyRecord.key_value, keyRecord.secret_value, dataUri, 'cdn_image.png');
        const assetId = uploadRes?.asset?.id;
        if (assetId) {
          log(`[Scenario ✅] CDN Asset siap (ID: ${assetId}).`);
          return assetId;
        }
      } catch (fErr) {
        log(`[Scenario ⚠️] Gagal fetch CDN asset: ${fErr.message}`);
      }
    }
  }

  return null;
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

const tierCache = new Map();

/**
 * Automatically detect the maximum subscription access tier for a Scenario API key.
 * Tier 25 = Starter / Standard / Free
 * Tier 50 = Pro / Team (Unlocks Seedance, Kling, Wan, GPT Image 2, etc.)
 */
async function detectKeyTier(apiKey, apiSecret) {
  const cacheKey = `${apiKey}:${apiSecret}`;
  if (tierCache.has(cacheKey)) {
    const cached = tierCache.get(cacheKey);
    if (Date.now() - cached.ts < 1800000) return cached.tier; // 30 min cache
  }

  let detectedTier = 50;
  try {
    // Quick probe on tier 50 model (Seedance 2.0)
    await scenarioClient.generateCustom(apiKey, apiSecret, 'model_bytedance-seedance-2-0', {
      prompt: 'probe', duration: 5
    });
    detectedTier = 50;
  } catch (e) {
    if (e.status === 403 && /plan/i.test(e.message || '')) {
      detectedTier = 25; // Standard / Starter tier
    } else {
      // 429 quota or other validation error means plan permission is OK (Tier 50)
      detectedTier = 50;
    }
  }

  tierCache.set(cacheKey, { tier: detectedTier, ts: Date.now() });
  return detectedTier;
}

/**
 * Curated list of popular Scenario models for Images & Videos with exact allowed settings and plan tiers
 */
const SCENARIO_CATALOG = {
  imageModels: [
    { id: 'model_openai-gpt-image-2', name: 'GPT Image 2 (OpenAI)', tier: 50, plan: 'Pro / Team Plan', tags: ['Featured', 'High Quality', 'Editing'] },
    { id: 'model_bfl-flux-2-dev', name: 'FLUX 2 Dev (Black Forest Labs)', tier: 50, plan: 'Pro / Team Plan', tags: ['Photorealism', 'Detail'] },
    { id: 'model_bytedance-seedream-5-0-pro', name: 'Seedream 5.0 Pro (ByteDance)', tier: 50, plan: 'Pro / Team Plan', tags: ['Fast', 'Stylized'] },
    { id: 'model_google-gemini-3-1-flash', name: 'Gemini 3.1 Flash (Google)', tier: 50, plan: 'Pro / Team Plan', tags: ['Multimodal', 'Prompt Adherence'] },
    { id: 'model_xai-grok-imagine-image-2-0', name: 'Grok Imagine 2.0 (xAI)', tier: 50, plan: 'Pro / Team Plan', tags: ['2K', 'Artistic'] },
    { id: 'model_ideogram-v4', name: 'Ideogram V4', tier: 50, plan: 'Pro / Team Plan', tags: ['Typography', 'Design'] },
    { id: 'model_bfl-flux-2-klein-9b', name: 'FLUX 2 Klein 9B', tier: 25, plan: 'Semua Plan', tags: ['Starter', 'Fast'] },
    { id: 'model_microsoft-mai-image-2-5', name: 'MAI Image 2.5', tier: 25, plan: 'Semua Plan', tags: ['Starter', 'Standard'] }
  ],
  videoModels: [
    {
      id: 'model_veo3-1-fast',
      name: 'Google Veo 3.1 Fast (Google)',
      tier: 25,
      plan: 'Semua Plan (Starter & Pro)',
      tags: ['Featured', 'Google', 'Audio', 'Semua Plan'],
      durations: [4, 6, 8],
      resolutions: ['720p', '1080p'],
      aspectRatios: ['16:9', '9:16'],
      hasAudio: true,
      defaultDuration: 6,
      defaultResolution: '720p',
      defaultAspectRatio: '16:9'
    },
    {
      id: 'model_veo3-1-lite',
      name: 'Google Veo 3.1 Lite (Google)',
      tier: 25,
      plan: 'Semua Plan (Starter & Pro)',
      tags: ['Google', 'Fast', 'Audio', 'Semua Plan'],
      durations: [4, 6, 8],
      resolutions: ['720p', '1080p'],
      aspectRatios: ['16:9', '9:16'],
      hasAudio: true,
      defaultDuration: 6,
      defaultResolution: '720p',
      defaultAspectRatio: '16:9'
    },
    {
      id: 'model_bytedance-seedance-2-0',
      name: 'Seedance 2.0 (ByteDance)',
      tier: 50,
      plan: 'Pro / Team Plan',
      tags: ['I2V', 'T2V', 'Audio', 'Pro Plan'],
      durations: [-1, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      resolutions: ['480p', '720p', '1080p', '4k'],
      aspectRatios: ['adaptive', '16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
      hasAudio: true,
      defaultDuration: 5,
      defaultResolution: '720p',
      defaultAspectRatio: 'adaptive'
    },
    {
      id: 'model_bytedance-seedance-2-5',
      name: 'Seedance 2.5 (ByteDance)',
      tier: 50,
      plan: 'Pro / Team Plan',
      tags: ['Latest', 'I2V', 'T2V', 'Audio', 'Pro Plan'],
      durations: [-1, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20, 25, 30],
      resolutions: ['480p', '720p', '1080p', '4k'],
      aspectRatios: ['adaptive', '16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
      hasAudio: true,
      defaultDuration: 5,
      defaultResolution: '720p',
      defaultAspectRatio: 'adaptive'
    },
    {
      id: 'model_kling-v3-i2v-pro',
      name: 'Kling V3 I2V Pro',
      tier: 50,
      plan: 'Pro / Team Plan',
      tags: ['High Fidelity', 'Motion', 'Audio', 'Pro Plan'],
      durations: [3, 4, 5, 6, 7, 8, 9, 10, 15],
      resolutions: ['720p', '1080p'],
      aspectRatios: ['16:9', '9:16', '1:1'],
      hasAudio: true,
      defaultDuration: 5,
      defaultResolution: '720p',
      defaultAspectRatio: '16:9'
    },
    {
      id: 'model_wan-2-7-i2v',
      name: 'Wan 2.7 I2V (Alibaba)',
      tier: 50,
      plan: 'Pro / Team Plan',
      tags: ['Smooth Motion', 'Cinematic', 'Pro Plan'],
      durations: [5, 10],
      resolutions: ['720p', '1080p'],
      aspectRatios: ['16:9', '9:16', '1:1'],
      hasAudio: false,
      defaultDuration: 5,
      defaultResolution: '720p',
      defaultAspectRatio: '16:9'
    },
    {
      id: 'model_ltx-2-5-pro',
      name: 'LTX-2.5 Pro',
      tier: 50,
      plan: 'Pro / Team Plan',
      tags: ['Pro', 'Fast', 'Audio', 'Pro Plan'],
      durations: [6, 8, 10],
      resolutions: ['720p', '1080p'],
      aspectRatios: ['auto', '16:9', '9:16'],
      hasAudio: true,
      defaultDuration: 6,
      defaultResolution: '720p',
      defaultAspectRatio: '16:9'
    },
    {
      id: 'model_minimax-h3',
      name: 'Minimax H3 (Hailuo)',
      tier: 50,
      plan: 'Pro / Team Plan',
      tags: ['Realistic', 'Cinematic', 'Pro Plan'],
      durations: [6, 10],
      resolutions: ['768P', '2K'],
      aspectRatios: ['adaptive', '16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
      hasAudio: false,
      defaultDuration: 6,
      defaultResolution: '768P',
      defaultAspectRatio: 'adaptive'
    },
    {
      id: 'model_pixverse-v6-t2v',
      name: 'Pixverse V6',
      tier: 50,
      plan: 'Pro / Team Plan',
      tags: ['Dynamic Animation', 'Pro Plan'],
      durations: [5, 8],
      resolutions: ['720p', '1080p'],
      aspectRatios: ['16:9', '9:16', '1:1'],
      hasAudio: false,
      defaultDuration: 5,
      defaultResolution: '720p',
      defaultAspectRatio: '16:9'
    }
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
  const assetId = await ensureScenarioAssetId(keyRecord, options.referenceImage || options.sceneImage, options.originalCdnUrl, onLog);
  if (assetId) {
    params.image = assetId;
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
  const duration = options.duration !== undefined ? options.duration : 5;
  const resolution = options.resolution || '720p';
  const generateAudio = options.generateAudio !== undefined ? !!options.generateAudio : true;

  onLog(`[Scenario] Memulai generasi video dengan model "${modelId}" (Durasi: ${duration}s, Rasio: ${aspectRatio}, Resolusi: ${resolution})...`);

  const params = {
    prompt: String(options.prompt || '').trim()
  };

  // Model-specific parameter mapping
  if (modelId === 'model_kling-v3-i2v-pro') {
    params.duration = String(duration === -1 ? '5' : duration);
    params.aspectRatio = aspectRatio === 'adaptive' || aspectRatio === 'auto' ? '16:9' : aspectRatio;
    params.generateAudio = generateAudio;
  } else if (modelId === 'model_minimax-h3') {
    params.duration = duration === -1 ? 6 : Number(duration);
    params.resolution = resolution === '1080p' || resolution === '4k' ? '2K' : '768P';
    params.aspectRatio = aspectRatio;
  } else if (modelId === 'model_pixverse-v6-t2v') {
    params.duration = duration === -1 ? 5 : Number(duration);
    params.resolution = resolution;
    params.aspectRatio = aspectRatio;
    params.generateAudioSwitch = generateAudio;
  } else {
    // Seedance, Wan, LTX, etc.
    params.aspectRatio = aspectRatio;
    params.duration = duration === -1 ? -1 : Number(duration);
    params.resolution = resolution;
    params.generateAudio = generateAudio;
  }

  // First frame / scene image
  const assetId = await ensureScenarioAssetId(keyRecord, options.sceneImage, options.originalCdnUrl, onLog);
  if (assetId) {
    if (modelId === 'model_kling-v3-i2v-pro') {
      params.startImage = assetId;
    } else if (modelId === 'model_minimax-h3') {
      params.firstFrameImage = assetId;
    } else {
      params.image = assetId;
    }
  }

  // Last frame image if provided
  if (options.lastFrameImage) {
    const lastAssetId = await ensureScenarioAssetId(keyRecord, options.lastFrameImage, null, onLog);
    if (lastAssetId) {
      if (modelId === 'model_kling-v3-i2v-pro') {
        params.endImage = lastAssetId;
      } else {
        params.lastFrameImage = lastAssetId;
      }
    }
  }

  // Reference images array (multimodal mode)
  if (options.referenceImages && Array.isArray(options.referenceImages) && options.referenceImages.length > 0) {
    const refs = [];
    for (const r of options.referenceImages) {
      const u = await ensureScenarioAssetId(keyRecord, r, null, onLog);
      if (u) refs.push(u);
    }
    if (refs.length > 0) {
      params.referenceImages = refs.slice(0, 9);
      // In Seedance multimodal mode, image (first frame) is mutually exclusive with referenceImages
      if (params.referenceImages.length > 0 && !params.lastFrameImage) {
        delete params.image;
        delete params.startImage;
        delete params.firstFrameImage;
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
  detectKeyTier,
  SCENARIO_CATALOG,
  generateOneImageScenario,
  generateVideoScenario
};
