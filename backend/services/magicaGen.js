// Magica generation helpers. Keeps Magica-specific generate+store logic OUT of the
// big Freebeat files.
//
// SCHEMA-DRIVEN: every Magica model declares its own input fields (GET /models/{id}
// /schema). Field names + allowed values differ per model — e.g. the reference image
// field is `uploadedImages` on gpt_image_2 but `image_urls` on grok/flux/nano and
// `reference_image_urls` on the *_reference video models; sizing is `size` (gpt),
// `image_size` (flux) or `aspect_ratio`+`resolution` (grok/nano); video duration/
// resolution/aspect options vary per model. So instead of hardcoding one input shape
// we fetch the schema and map our generic values (prompt, reference image, aspect,
// resolution, duration, audio) onto whatever fields that model actually declares,
// clamping enums to the allowed options. This makes ALL models work correctly.

const path = require('path');
const magica = require('./magicaClient');

function publicBase() {
  return (process.env.PUBLIC_URL || process.env.APP_URL || '').replace(/\/$/, '');
}

// Turn a stored image path/URL into a PUBLIC url Magica can fetch.
function toPublicUrl(p) {
  if (!p) return null;
  const s = String(p);
  if (/^https?:\/\//i.test(s)) return s;
  const base = publicBase();
  if (!base) return null;
  const idx = s.indexOf('uploads/');
  const rel = idx >= 0 ? s.slice(idx) : ('uploads/' + path.basename(s));
  return `${base}/${rel}`;
}

// Map an aspect ratio to a gpt_image_2 `size` value (its size enum is WxH strings).
function sizeFromAspect(ar) {
  switch (String(ar || '')) {
    case '1:1': return '1024x1024';
    case '16:9': return '1536x1024';
    case '9:16': return '1024x1536';
    default: return 'Auto';
  }
}

async function pickActiveMagicaKey(db) {
  return (await db.get('SELECT id, key_value FROM magica_api_keys WHERE is_active = 1 ORDER BY id ASC LIMIT 1')) || null;
}

// Pick a specific active Magica key by id when the user chose one in the UI;
// fall back to the first active key when preferredId is empty/'auto'/invalid/inactive.
async function pickMagicaKey(db, preferredId) {
  const idNum = parseInt(preferredId, 10);
  if (preferredId != null && String(preferredId) !== 'auto' && Number.isFinite(idNum)) {
    const row = await db.get('SELECT id, key_value FROM magica_api_keys WHERE id = ? AND is_active = 1', [idNum]);
    if (row) return row;
  }
  return pickActiveMagicaKey(db);
}

// Random active Magica key — the admin asked LLM traffic to spread across keys.
async function pickRandomMagicaKey(db) {
  const rows = await db.all('SELECT id, key_value FROM magica_api_keys WHERE is_active = 1');
  if (!rows || !rows.length) return null;
  return rows[Math.floor(Math.random() * rows.length)];
}

async function isMagicaForStoryboard(db, storyboardId) {
  try {
    const row = await db.get(
      'SELECT u.preferred_provider AS pp, u.can_use_magica AS cum FROM storyboards s JOIN users u ON u.id = s.user_id WHERE s.id = ?',
      [storyboardId]
    );
    return !!(row && row.pp === 'magica' && row.cum);
  } catch (e) { return false; }
}

// --- Model catalog + schema (cached ~5 min) ---
let _modelsCache = { key: null, at: 0, models: null };
async function getModelsCached(apiKey) {
  const now = Date.now();
  if (_modelsCache.models && _modelsCache.key === apiKey && (now - _modelsCache.at) < 5 * 60 * 1000) return _modelsCache.models;
  const models = await magica.listModels(apiKey);
  _modelsCache = { key: apiKey, at: now, models };
  return models;
}

const _schemaCache = new Map(); // id -> { at, schema }
async function getSchemaCached(apiKey, modelId) {
  const hit = _schemaCache.get(modelId);
  const now = Date.now();
  if (hit && (now - hit.at) < 5 * 60 * 1000) return hit.schema;
  const schema = await magica.getModelSchema(apiKey, modelId);
  _schemaCache.set(modelId, { at: now, schema });
  return schema;
}

// Resolve a nodeType + desired category (e.g. 'image-to-video') to the exact subModelId.
// Returns null for single-mode models (run with nodeType only).
function resolveSubModel(models, nodeType, category) {
  const m = (models || []).find((x) => x.nodeType === nodeType);
  if (!m) return null;
  const subs = m.subModels || [];
  if (subs.length === 0) return null;
  const hit = subs.find((s) => s.category === category)
    || subs.find((s) => String(s.subModelId || '').includes(category))
    || subs[0];
  return hit ? hit.subModelId : null;
}

const VIDEO_METHODS = ['text-to-video', 'image-to-video', 'reference-to-video'];
const IMAGE_METHODS = ['text-to-image', 'image-to-image'];
// Models that declare image categories but do not output usable 2D storyboard images.
const IMAGE_MODEL_EXCLUDE = new Set(['meshy_v6_preview']);

// --- Schema-driven input building ---------------------------------------------

const lc = (s) => String(s || '').toLowerCase();

// Pick a value from an enum, case-insensitively; try fallbacks; else undefined.
function coerceEnum(options, want, fallbacks) {
  if (!Array.isArray(options) || !options.length) return want;
  const find = (v) => options.find((o) => lc(o) === lc(v));
  if (want != null && find(want) !== undefined) return find(want);
  for (const f of (fallbacks || [])) {
    if (f != null && find(f) !== undefined) return find(f);
  }
  return undefined;
}

// Largest numeric option <= want; else the smallest option.
function nearestNum(options, want) {
  const nums = (options || []).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!nums.length) return undefined;
  const w = Number(want);
  if (!Number.isFinite(w)) return undefined;
  const le = nums.filter((n) => n <= w).pop();
  return le != null ? le : nums[0];
}

function isImageArrayField(f) {
  const dt = f.dataType || f.type;
  return dt === 'string[]' && /image/.test(lc(f.name)) && !/(video|audio)/.test(lc(f.name));
}

// Build the exact input object a model expects from our generic values.
// vals: { prompt, aspect, resolution, duration, generateAudio, imageUrls: [url] }
function buildInput(fields, vals) {
  const input = {};
  const imageUrls = (vals.imageUrls || []).filter(Boolean);
  for (const f of (fields || [])) {
    const name = f.name;
    const lname = lc(name);
    const dt = f.dataType || f.type;
    const opts = f.options;
    let v;

    if (lname === 'prompt') {
      v = String(vals.prompt || '');
      if (f.max) v = v.slice(0, f.max);
    } else if (isImageArrayField(f)) {
      if (imageUrls.length) v = imageUrls.slice(0, f.maxImages || 10);
      else if (f.required) v = [];
    } else if (lname === 'image_url') {
      if (imageUrls[0]) v = imageUrls[0];
    } else if (lname === 'size') {
      v = coerceEnum(opts, sizeFromAspect(vals.aspect), ['Auto']);
      if (v === undefined) v = f.default;
    } else if (lname === 'image_size' || lname.includes('aspect')) {
      v = coerceEnum(opts, vals.aspect, ['auto', 'Auto']);
      if (v === undefined) v = f.default;
    } else if (lname.includes('resolution')) {
      if (vals.resolution != null) {
        v = coerceEnum(opts, vals.resolution, []);
        if (v === undefined) v = f.default;
      }
    } else if (lname.includes('duration')) {
      if (vals.duration != null) {
        v = nearestNum(opts, vals.duration);
        if (v === undefined) v = f.default;
      }
    } else if ((dt === 'boolean') && lname.includes('audio')) {
      if (vals.generateAudio != null) v = !!vals.generateAudio;
    } else if (lname === 'n' || lname === 'num_images') {
      v = 1;
    }

    if (v === undefined) {
      // Fill required fields we didn't map with their declared default so the API
      // never receives `undefined` for a required field.
      if (f.required && f.default !== undefined) v = f.default;
      else continue;
    }
    input[name] = v;
  }
  return input;
}

// Pull UI constraints out of a schema (allowed durations/resolutions/aspects + audio).
function extractConstraints(schema) {
  const fields = (schema && schema.fields) || [];
  const find = (pred) => fields.find(pred);
  const durF = find((f) => lc(f.name).includes('duration'));
  const resF = find((f) => lc(f.name).includes('resolution'));
  const arF = find((f) => lc(f.name).includes('aspect') || lc(f.name) === 'image_size' || lc(f.name) === 'size');
  const audioF = find((f) => (f.dataType === 'boolean' || f.type === 'boolean') && lc(f.name).includes('audio'));
  const imgArr = find(isImageArrayField);
  const imgOne = find((f) => lc(f.name) === 'image_url');
  return {
    durations: durF && durF.options ? durF.options : null,
    resolutions: resF && resF.options ? resF.options : null,
    aspectRatios: arF && arF.options ? arF.options : null,
    hasAudio: !!audioF,
    needsImage: !!((imgArr && imgArr.required) || (imgOne && imgOne.required)),
  };
}

// Shaped catalog for the UI: image + video models (with per-method constraints) + keys.
async function getCatalog(db) {
  const mk = await pickActiveMagicaKey(db);
  if (!mk) return { keys: [], imageModels: [], videoModels: [] };
  const models = await getModelsCached(mk.key_value);

  const shape = (m, allowed) => {
    const subs = (m.subModels || []).filter((s) => allowed.includes(s.category));
    const methods = subs.length
      ? subs.map((s) => ({ subModelId: s.subModelId, category: s.category, label: s.label || s.category }))
      : (allowed.includes(m.category) ? [{ subModelId: null, category: m.category, label: m.category }] : []);
    return { nodeType: m.nodeType, name: m.name, methods };
  };

  // Only TRUE image generators (they expose a text-to-image method). This drops
  // image utilities like topaz_upscale / faceswap / background_remover (image-to-image
  // only) and meshy (3D mesh output, not a usable storyboard panel).
  const imageModels = models
    .filter((m) => !IMAGE_MODEL_EXCLUDE.has(m.nodeType))
    .filter((m) => (m.subModels || []).some((s) => s.category === 'text-to-image') || m.category === 'text-to-image')
    .map((m) => shape(m, IMAGE_METHODS))
    .filter((m) => m.methods.length);
  const videoModels = models
    .filter((m) => (m.subModels || []).some((s) => VIDEO_METHODS.includes(s.category)) || VIDEO_METHODS.includes(m.category))
    .map((m) => shape(m, VIDEO_METHODS))
    .filter((m) => m.methods.length);

  // Enrich each VIDEO method with its schema constraints (duration/resolution/aspect/
  // audio) so the UI can offer exactly what each model supports. Cached per schema.
  const jobs = [];
  for (const m of videoModels) {
    for (const mt of m.methods) {
      jobs.push((async () => {
        try {
          const sc = await getSchemaCached(mk.key_value, mt.subModelId || m.nodeType);
          Object.assign(mt, extractConstraints(sc));
        } catch (e) { /* leave method without constraints on any failure */ }
      })());
    }
  }
  await Promise.all(jobs);

  // Active keys WITH balances so the UI shows credits and the user can pick a funded
  // key (a 403 "insufficient credits" means the chosen key's balance is too low).
  const rawKeys = await db.all('SELECT id, label, key_value FROM magica_api_keys WHERE is_active = 1 ORDER BY id ASC');
  const keys = await Promise.all(rawKeys.map(async (k) => {
    let balance = null, formatted = null;
    try {
      const bal = await magica.getCreditBalance(k.key_value);
      balance = Number(bal.availableBalance);
      formatted = bal.formatted;
    } catch (e) {}
    return { id: k.id, label: k.label, balance, formatted };
  }));

  // Text LLM models (category 'llm') for the admin LLM-provider picker.
  const llmModels = models
    .filter((m) => m.category === 'llm')
    .map((m) => ({ nodeType: m.nodeType, name: m.name }));

  return { keys, imageModels, videoModels, llmModels };
}

// Generate ONE storyboard image. nodeType defaults to gpt_image_2; text vs edit is
// chosen by whether a reference image is present, then the input is built from the
// resolved submodel's live schema (correct field names per model).
async function generateOneImageMagica(apiKey, prompt, opts = {}) {
  const onLog = typeof opts.onLog === 'function' ? opts.onLog : () => {};
  const nodeType = opts.nodeType || 'gpt_image_2';
  const refUrl = toPublicUrl(opts.refUrl);
  const category = refUrl ? 'image-to-image' : 'text-to-image';
  const models = await getModelsCached(apiKey);
  const subModelId = resolveSubModel(models, nodeType, category);

  let fields = [];
  try { fields = ((await getSchemaCached(apiKey, subModelId || nodeType)) || {}).fields || []; } catch (e) {}
  const input = buildInput(fields, { prompt, aspect: opts.aspectRatio, imageUrls: refUrl ? [refUrl] : [] });
  if (!('prompt' in input) && prompt) input.prompt = String(prompt);

  onLog(`[Magica] Gambar via ${nodeType}${subModelId ? ' / ' + subModelId : ''} (fields: ${Object.keys(input).join(', ')})...`);
  const runId = await magica.runModel(apiKey, nodeType, subModelId, input);
  const done = await magica.pollRun(apiKey, runId, { onLog });
  const url = (done.mediaUrls || [])[0];
  if (!url) throw new Error('Magica tidak mengembalikan URL gambar.');
  return { url, credit: Number(done.creditUsed) || 0 };
}

// Generate ONE video. nodeType defaults to seedance_2_0_fast; method is the submodel
// category (text-to-video | image-to-video | reference-to-video). Input is built from
// the resolved submodel's live schema, so duration/resolution/aspect are clamped to
// what THAT model supports and the reference-image field name is chosen correctly.
async function generateVideoMagica(apiKey, params = {}) {
  const onLog = typeof params.onLog === 'function' ? params.onLog : () => {};
  const nodeType = params.nodeType || (params.fast ? 'seedance_2_0_fast' : 'seedance_2_0');
  let category = params.method;
  if (!category) {
    const gt = params.generationType;
    category = gt === 'text' ? 'text-to-video' : (gt === 'reference' ? 'reference-to-video' : 'image-to-video');
  }
  const models = await getModelsCached(apiKey);
  const subModelId = resolveSubModel(models, nodeType, category);

  let fields = [];
  try { fields = ((await getSchemaCached(apiKey, subModelId || nodeType)) || {}).fields || []; } catch (e) {}

  const imgUrl = toPublicUrl(params.sceneImage);
  const needsImage = fields.some((f) => (lc(f.name) === 'image_url' && f.required) || (isImageArrayField(f) && f.required));
  if (category !== 'text-to-video' && needsImage && !imgUrl) {
    throw new Error('Gambar panel tidak punya URL publik untuk Magica (set PUBLIC_URL di server, atau gunakan gambar hasil Magica).');
  }

  const input = buildInput(fields, {
    prompt: params.prompt,
    aspect: params.aspectRatio,
    resolution: params.resolution,
    duration: params.duration,
    generateAudio: params.generateAudio,
    imageUrls: imgUrl ? [imgUrl] : [],
  });
  if (!('prompt' in input) && params.prompt) input.prompt = String(params.prompt);

  onLog(`[Magica] Video via ${nodeType}${subModelId ? ' / ' + subModelId : ''} (durasi ${input.duration || '-'}, rasio ${input.aspect_ratio || '-'}, resolusi ${input.resolution || '-'})...`);
  const runId = await magica.runModel(apiKey, nodeType, subModelId, input);
  const done = await magica.pollRun(apiKey, runId, { onLog, timeoutMs: 900000 });
  const url = (done.mediaUrls || [])[0];
  if (!url) throw new Error('Magica tidak mengembalikan URL video.');
  return { url, credit: Number(done.creditUsed) || 0 };
}

// LLM text completion via a Magica text model (category 'llm'). Maps OpenAI-style
// messages -> Magica {prompt, system_prompt}. Uses a RANDOM active key (admin request).
// Text-only: callers must route vision requests to the default provider (Magica LLM
// needs public image URLs, not base64).
async function magicaChatCompletion(db, messages, opts = {}) {
  const key = await pickRandomMagicaKey(db);
  if (!key) throw new Error('Tidak ada API Key Magica aktif untuk LLM.');
  const nodeType = opts.model || 'gemini_3_5_flash';
  const msgs = Array.isArray(messages) ? messages : [];
  const textOf = (c) => Array.isArray(c)
    ? c.filter((p) => p && (p.type === 'text' || typeof p === 'string')).map((p) => (typeof p === 'string' ? p : p.text)).join('\n')
    : String(c || '');
  const system_prompt = msgs.filter((m) => m.role === 'system').map((m) => textOf(m.content)).join('\n\n');
  const prompt = msgs.filter((m) => m.role !== 'system')
    .map((m) => (m.role === 'assistant' ? 'Assistant: ' : '') + textOf(m.content)).join('\n\n');
  const input = {
    prompt: prompt || ' ',
    system_prompt: system_prompt || '',
    temperature: opts.temperature != null ? opts.temperature : 0.6,
    max_tokens: opts.maxTokens || 4096,
  };
  const runId = await magica.runModel(key.key_value, nodeType, null, input);
  const done = await magica.pollRun(key.key_value, runId, { timeoutMs: opts.timeoutMs || 120000, intervalMs: 2000 });
  const out = done.run && done.run.output;
  let text = out && (out.output || out.text || out.result || out.content);
  if (Array.isArray(text)) text = text.join('');
  if (!text || !String(text).trim()) throw new Error('Respons LLM Magica kosong.');
  return String(text).trim();
}

module.exports = {
  publicBase,
  toPublicUrl,
  sizeFromAspect,
  pickActiveMagicaKey,
  pickMagicaKey,
  pickRandomMagicaKey,
  magicaChatCompletion,
  isMagicaForStoryboard,
  getModelsCached,
  getSchemaCached,
  resolveSubModel,
  buildInput,
  extractConstraints,
  getCatalog,
  generateOneImageMagica,
  generateVideoMagica,
};
