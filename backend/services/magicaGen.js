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

// Magica can ONLY fetch a reference image from a PUBLIC http(s) URL — verified against the
// live API: data-URIs/base64 are rejected with HTTP_URL_REQUIRED, and there is no public
// REST upload endpoint. So the reference image's reachability depends on PUBLIC_URL being a
// real internet-reachable domain. These helpers PRE-CHECK that BEFORE a run so a bad
// PUBLIC_URL surfaces as a clear, actionable error instead of a silently "melenceng" video.
function isNonPublicHost(u) {
  try {
    const h = new URL(u).hostname;
    if (!h || h === 'localhost' || !h.includes('.')) return true;      // bare host / no TLD
    if (/^127\./.test(h) || h === '0.0.0.0' || h === '::1') return true; // loopback
    if (/^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)) return true; // private
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;             // private 172.16-31
    return false;
  } catch (e) { return true; }
}

// Throws with a clear message when the reference image URL is not a public, reachable
// http(s) URL. Definitive problems (non-http, private host, or a 4xx/5xx response) HARD-fail;
// an ambiguous network/timeout error on OUR side only warns and proceeds (Magica will try),
// so a transient blip never blocks an otherwise-working setup.
async function assertPublicImageReachable(url, onLog) {
  const log = typeof onLog === 'function' ? onLog : () => {};
  if (!/^https?:\/\//i.test(String(url || ''))) {
    throw new Error('URL gambar referensi bukan http(s) publik. Magica hanya menerima URL publik (bukan base64/lokal) — set PUBLIC_URL server ke domain yang dapat diakses internet.');
  }
  if (isNonPublicHost(url)) {
    throw new Error(`URL gambar referensi tidak publik: ${url}. Magica tidak bisa mengambilnya. Set PUBLIC_URL ke domain publik (mis. https://story.devcurl.me), jangan localhost/IP privat.`);
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    let res;
    try {
      res = await fetch(url, { method: 'HEAD', signal: controller.signal });
      if (res.status === 403 || res.status === 405) {
        // Some hosts disallow HEAD — retry a 1-byte ranged GET before judging.
        res = await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-0' }, signal: controller.signal });
      }
    } finally { clearTimeout(timer); }
    if (res && res.status >= 400) {
      throw new Error(`Gambar referensi tidak bisa diakses publik (HTTP ${res.status}): ${url}. Pastikan PUBLIC_URL benar dan folder /uploads dapat diakses dari internet.`);
    }
    // A 200 that returns the app's HTML page (SPA fallback) means the file is missing or
    // PUBLIC_URL points at the app, not the asset — Magica would get HTML, not an image.
    const ct = ((res && res.headers && res.headers.get('content-type')) || '').toLowerCase();
    if (ct.includes('text/html')) {
      throw new Error(`URL gambar mengembalikan halaman HTML, bukan file gambar: ${url}. Kemungkinan file tidak ada atau PUBLIC_URL salah — Magica tidak akan bisa membaca gambar ini (hasil akan melenceng).`);
    }
    log(`[Magica] Pra-cek gambar OK (dapat diakses publik${ct ? ', ' + ct : ''}).`);
  } catch (e) {
    if (e && /tidak bisa diakses publik|tidak publik|bukan http|mengembalikan halaman HTML/.test(String(e.message))) throw e; // our definitive errors
    log(`[Magica] Peringatan: gagal pra-cek jangkauan gambar (${e.message}). Melanjutkan; bila Magica gagal mengambil gambar, hasil bisa melenceng.`);
  }
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

// Minimum balance (microcredits) a key must have to be used for IMAGE/VIDEO. Keys
// below this are reserved for LLM only (admin rule: cheap keys -> LLM; funded -> media).
const MEDIA_MIN_MICRO = 5000000; // 5 credits

// Cached per-key balances (~60s) so key selection does not hammer the balance API.
let _balCache = { at: 0, keys: null };

async function disableMagicaKey(db, keyId, reason) {
  try {
    const statusMsg = `Saldo Habis (Auto Off)${reason ? ' - ' + String(reason).slice(0, 60) : ''}`;
    await db.run('UPDATE magica_api_keys SET is_active = 0, last_status = ? WHERE id = ?', [statusMsg, keyId]);
    invalidateBalanceCache();
  } catch (e) {}
}

async function getKeyBalances(db) {
  const now = Date.now();
  if (_balCache.keys && (now - _balCache.at) < 60000) return _balCache.keys;
  const rows = await db.all('SELECT id, key_value FROM magica_api_keys WHERE is_active = 1');
  const keys = [];
  await Promise.all((rows || []).map(async (k) => {
    let balance = 0;
    try { balance = Number((await magica.getCreditBalance(k.key_value)).availableBalance) || 0; } catch (e) { balance = 0; }
    
    // Auto-disable keys with balance < 0.1 credit (< 100,000 microcredits)
    if (balance < 100000) {
      await disableMagicaKey(db, k.id, `Saldo tinggal ${(balance / 1e6).toFixed(2)} kredit`);
    } else {
      keys.push({ id: k.id, key_value: k.key_value, balance });
    }
  }));
  _balCache = { at: now, keys };
  return keys;
}

function invalidateBalanceCache() { _balCache = { at: 0, keys: null }; }

// LLM key: prefer CHEAP (<5 credit) keys so funded keys stay free for media; fall back
// to any active key at random. Balance lookups are best-effort.
async function pickRandomMagicaKey(db) {
  let keys = [];
  try { keys = await getKeyBalances(db); } catch (e) {}
  if (!keys.length) {
    const rows = await db.all('SELECT id, key_value FROM magica_api_keys WHERE is_active = 1');
    if (!rows || !rows.length) return null;
    return rows[Math.floor(Math.random() * rows.length)];
  }
  const cheap = keys.filter((k) => k.balance < MEDIA_MIN_MICRO);
  const pool = cheap.length ? cheap : keys;
  return pool[Math.floor(Math.random() * pool.length)];
}

// IMAGE/VIDEO key: only keys with balance >= MEDIA_MIN_MICRO qualify (below that is
// LLM-only per admin rule). Honor the user's chosen key if it qualifies; else the
// highest-balance qualifying key (headroom for expensive renders); else null.
async function pickMediaMagicaKey(db, preferredId) {
  let keys = [];
  try { keys = await getKeyBalances(db); } catch (e) {}
  const qualifying = keys.filter((k) => k.balance >= MEDIA_MIN_MICRO);
  if (!qualifying.length) return null;
  const idNum = parseInt(preferredId, 10);
  if (preferredId != null && String(preferredId) !== 'auto' && Number.isFinite(idNum)) {
    const hit = qualifying.find((k) => k.id === idNum);
    if (hit) return hit;
  }
  qualifying.sort((a, b) => b.balance - a.balance);
  return qualifying[0];
}

// Return all qualifying media keys ordered with preferred/highest balance first for auto-failover
async function getAllMediaMagicaKeys(db, preferredId) {
  let keys = [];
  try { keys = await getKeyBalances(db); } catch (e) {}
  const qualifying = keys.filter((k) => k.balance >= MEDIA_MIN_MICRO);
  if (!qualifying.length) return [];
  qualifying.sort((a, b) => b.balance - a.balance);
  const idNum = parseInt(preferredId, 10);
  if (preferredId != null && String(preferredId) !== 'auto' && Number.isFinite(idNum)) {
    const hitIndex = qualifying.findIndex((k) => k.id === idNum);
    if (hitIndex > 0) {
      const [hit] = qualifying.splice(hitIndex, 1);
      qualifying.unshift(hit);
    }
  }
  return qualifying;
}

// Robust Failover Execution Loop: Tries Magica keys one by one if one encounters an error/insufficient credit
async function executeWithMagicaFailover(db, preferredId, renderFn, onLog) {
  const keys = await getAllMediaMagicaKeys(db, preferredId);
  if (!keys || !keys.length) {
    throw new Error('Tidak ada API Key Magica dengan saldo cukup (>= 5 kredit). Silakan isi ulang atau tambah API Key baru.');
  }

  let lastError = null;
  for (let i = 0; i < keys.length; i++) {
    const keyRecord = keys[i];
    if (onLog) onLog(`[Magica] Mencoba render via Key #${keyRecord.id} (Saldo: ${(keyRecord.balance / 1e6).toFixed(2)} kredit)...`);
    try {
      const result = await renderFn(keyRecord);
      try {
        await db.run('UPDATE magica_api_keys SET last_status = ? WHERE id = ?', ['OK - ' + new Date().toLocaleString('id-ID'), keyRecord.id]);
      } catch (e) {}
      return { result, keyRecord };
    } catch (err) {
      lastError = err;
      const errStr = String(err.message || err);
      const isBalanceErr = /insufficient|balance|credit|quota|400|402|429/i.test(errStr);
      if (isBalanceErr) {
        await disableMagicaKey(db, keyRecord.id, errStr);
        if (onLog) onLog(`[Magica Auto-Switch ⚠️] Key #${keyRecord.id} saldo habis / error (${errStr}). Key telah dinonaktifkan otomatis.`);
      } else {
        if (onLog) onLog(`[Magica Auto-Switch ⚠️] Key #${keyRecord.id} gagal: ${errStr}.`);
      }

      if (i < keys.length - 1) {
        if (onLog) onLog(`[Magica Auto-Switch 🔄] Otomatis beralih ke Key #${keys[i + 1].id} (Saldo: ${(keys[i + 1].balance / 1e6).toFixed(2)} kredit)...`);
      }
    }
  }

  throw lastError || new Error('Semua API Key Magica di kolam gagal digunakan.');
}

// Estimate a node run's cost in microcredits (no side effects). 0 on any failure.
async function estimateNodeCost(apiKey, nodeType, subModelId, data) {
  try {
    const node = { type: nodeType, data: data || {} };
    if (subModelId) node.subModelId = subModelId;
    const est = await magica.estimateCredits(apiKey, [node]);
    return Number(est[0] && est[0].microcredits) || 0;
  } catch (e) { return 0; }
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

// A SINGLE (non-array) image input field. Model field names vary — most use
// `image_url`, but e.g. kling uses `start_image_url`. Match any single string image
// field EXCEPT the optional end/last-frame and non-image string fields, so the
// storyboard panel is actually sent. (Previously only the exact name `image_url` was
// mapped, so kling & similar SILENTLY dropped the reference image → the generated
// video ignored the storyboard.)
function isSingleImageField(f) {
  const dt = f.dataType || f.type;
  if (dt !== 'string') return false;
  const n = lc(f.name);
  if (/(end|last|tail|video|audio|mask|negative|style|size|prompt)/.test(n)) return false;
  return /image/.test(n);
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
    } else if (isSingleImageField(f)) {
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
      // ALWAYS set audio booleans explicitly, defaulting to OFF. If this field is omitted,
      // native audio-visual models (e.g. Seedance) default to audio ON → the video gets
      // backsound/ambient even when the user did NOT enable audio. Verified against the live
      // API: generate_audio:false → 0 audio streams; omitted → 1 audio stream.
      v = vals.generateAudio != null ? !!vals.generateAudio : false;
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
  // Same public-URL requirement applies to image-to-image reference photos.
  if (refUrl) await assertPublicImageReachable(refUrl, onLog);
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
  let category = params.method;
  if (!category) {
    const gt = params.generationType;
    category = gt === 'text' ? 'text-to-video' : (gt === 'reference' ? 'reference-to-video' : 'image-to-video');
  }
  // Category-aware default model. reference-to-video needs a *_reference nodeType — plain
  // `seedance_2_0` has NO reference submodel, so pairing it with reference-to-video would
  // make resolveSubModel fall back to the text-to-video submodel and SILENTLY drop the
  // storyboard image (a root cause of "melenceng"). Only used when caller omits the model.
  const defaultNode = category === 'reference-to-video'
    ? (params.fast ? 'seedance_2_0_fast_reference' : 'seedance_2_0_reference')
    : (params.fast ? 'seedance_2_0_fast' : 'seedance_2_0');
  const nodeType = params.nodeType || defaultNode;
  const models = await getModelsCached(apiKey);
  const subModelId = resolveSubModel(models, nodeType, category);

  let fields = [];
  try { fields = ((await getSchemaCached(apiKey, subModelId || nodeType)) || {}).fields || []; } catch (e) {}

  const imgUrl = toPublicUrl(params.sceneImage);
  const hasImageField = fields.some((f) => isSingleImageField(f) || isImageArrayField(f));
  // Guard: an image/reference method MUST resolve to a submodel that actually declares an
  // image field. If it doesn't, the (model, method) pair is mismatched — e.g. a non-reference
  // model paired with reference-to-video — and we'd otherwise silently run text-to-video, so
  // the video completely ignores the storyboard. Fail clearly instead of producing garbage.
  if (category !== 'text-to-video' && !hasImageField) {
    throw new Error(`Model "${nodeType}" tidak mendukung metode ${category} (tidak ada field gambar pada skema). Pilih model yang sesuai — mis. model *_reference untuk reference-to-video.`);
  }
  // If the model HAS an image field but we have no public URL, FAIL FAST with a clear reason
  // instead of silently generating a video that ignores the storyboard (the "melenceng" bug).
  if (category !== 'text-to-video' && hasImageField && !imgUrl) {
    throw new Error('Gambar panel tidak punya URL publik untuk Magica (set PUBLIC_URL di server, atau pakai storyboard hasil Magica). Tanpa gambar, video akan melenceng dari storyboard.');
  }
  // Reachability preflight: Magica needs a PUBLIC url it can actually fetch. Verify before
  // the run so a bad PUBLIC_URL fails clearly here rather than producing a melenceng video.
  if (category !== 'text-to-video' && hasImageField && imgUrl) {
    await assertPublicImageReachable(imgUrl, onLog);
  }

  const input = buildInput(fields, {
    prompt: params.prompt,
    aspect: params.aspectRatio,
    resolution: params.resolution,
    duration: params.duration,
    generateAudio: params.generateAudio === true, // explicit boolean — never let it be undefined
    imageUrls: imgUrl ? [imgUrl] : [],
  });
  if (!('prompt' in input) && params.prompt) input.prompt = String(params.prompt);

  // Pre-flight: fail FAST when this key cannot afford THIS job. Without it an
  // unaffordable/expensive render either 403s or waits a long time before failing —
  // the cause of the ~2h "timeout". Estimate mirrors the real charge exactly.
  const cost = await estimateNodeCost(apiKey, nodeType, subModelId, input);
  if (cost) {
    let bal = null;
    try { bal = Number((await magica.getCreditBalance(apiKey)).availableBalance); } catch (e) {}
    onLog(`[Magica] Estimasi biaya: ~${(cost / 1e6).toFixed(2)} kredit${bal != null ? ` (saldo key ~${(bal / 1e6).toFixed(2)})` : ''}.`);
    if (bal != null && bal < cost) {
      throw new Error(`Kredit key tidak cukup untuk video ini: butuh ~${(cost / 1e6).toFixed(2)} kredit, saldo ~${(bal / 1e6).toFixed(2)}. Kurangi durasi/resolusi, pilih model lebih murah, atau pakai key lain / isi ulang.`);
    }
  }

  onLog(`[Magica] Video via ${nodeType}${subModelId ? ' / ' + subModelId : ''} (durasi ${input.duration || '-'}, rasio ${input.aspect_ratio || '-'}, resolusi ${input.resolution || '-'})...`);
  const runId = await magica.runModel(apiKey, nodeType, subModelId, input, params.webhook);
  // Let the caller persist the runId immediately (so an async webhook can map this
  // run back to its record + the exact key that owns it).
  if (typeof params.onRunStart === 'function') { try { await params.onRunStart(runId); } catch (e) {} }
  // Heavy renders (1080p/long) can take >15 min; allow up to 25 min before giving up.
  const done = await magica.pollRun(apiKey, runId, { onLog, timeoutMs: params.timeoutMs || 1500000 });
  const url = (done.mediaUrls || [])[0];
  if (!url) throw new Error('Magica tidak mengembalikan URL video.');
  invalidateBalanceCache();
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

// Build the Meshy V6 input from our settings, only including fields the resolved
// submodel actually declares (text-to-3D vs image-to-3D differ).
function buildMeshyInput(fields, opts, isImage) {
  const has = (n) => fields.some((f) => f.name === n);
  const input = {};
  if (isImage) {
    if (has('image_urls')) input.image_urls = (opts.imageUrls || []).map(toPublicUrl).filter(Boolean).slice(0, 4);
  } else if (has('prompt')) {
    input.prompt = String(opts.prompt || '').slice(0, 600);
  }
  const set = (n, v) => { if (v !== undefined && v !== null && has(n)) input[n] = v; };
  set('mode', opts.mode);
  set('topology', opts.topology);
  set('target_polycount', opts.targetPolycount != null ? Number(opts.targetPolycount) : undefined);
  set('symmetry_mode', opts.symmetryMode);
  set('should_remesh', opts.shouldRemesh);
  set('should_texture', opts.shouldTexture);
  set('enable_pbr', opts.enablePbr);
  set('is_a_t_pose', opts.isAtPose);
  set('rigging_height_meters', opts.riggingHeightMeters != null ? Number(opts.riggingHeightMeters) : undefined);
  set('animation_action_id', opts.animationActionId != null ? Number(opts.animationActionId) : undefined);
  set('texture_prompt', opts.texturePrompt);
  set('enable_prompt_expansion', opts.enablePromptExpansion);
  return input;
}

// Resolve a job to its exact submodel + input, then return its microcredit cost from
// the estimate engine (mirrors run-time charge). kind: 'image' | 'video' | '3d'.
async function estimateMagicaCost(apiKey, spec = {}) {
  const kind = spec.kind || 'image';
  const models = await getModelsCached(apiKey);
  let nodeType, subModelId, input;
  if (kind === '3d') {
    nodeType = 'meshy_v6_preview';
    const isImage = Array.isArray(spec.imageUrls) && spec.imageUrls.filter(Boolean).length > 0;
    subModelId = resolveSubModel(models, nodeType, isImage ? 'image-to-image' : 'text-to-image');
    let fields = []; try { fields = ((await getSchemaCached(apiKey, subModelId || nodeType)) || {}).fields || []; } catch (e) {}
    input = buildMeshyInput(fields, spec, isImage);
  } else if (kind === 'video') {
    nodeType = spec.model || 'seedance_2_0_fast';
    subModelId = resolveSubModel(models, nodeType, spec.method || 'image-to-video');
    let fields = []; try { fields = ((await getSchemaCached(apiKey, subModelId || nodeType)) || {}).fields || []; } catch (e) {}
    input = buildInput(fields, { prompt: spec.prompt || 'x', aspect: spec.aspectRatio, resolution: spec.resolution, duration: spec.duration, generateAudio: spec.generateAudio, imageUrls: spec.imageUrls || (spec.hasImage ? ['https://example.com/x.png'] : []) });
  } else {
    nodeType = spec.model || 'gpt_image_2';
    const isImg = Array.isArray(spec.imageUrls) && spec.imageUrls.filter(Boolean).length > 0;
    subModelId = resolveSubModel(models, nodeType, isImg ? 'image-to-image' : 'text-to-image');
    let fields = []; try { fields = ((await getSchemaCached(apiKey, subModelId || nodeType)) || {}).fields || []; } catch (e) {}
    input = buildInput(fields, { prompt: spec.prompt || 'x', aspect: spec.aspectRatio, imageUrls: spec.imageUrls || [] });
  }
  const micro = await estimateNodeCost(apiKey, nodeType, subModelId, input);
  return { microcredits: micro, credits: micro / 1e6, nodeType, subModelId };
}

// Extract the .glb model URL + preview thumbnail + credit from a completed Meshy run
// (raw run object). Shared by the synchronous generator and the async webhook handler.
function extractMeshyResult(run) {
  const urls = magica.extractMediaUrls(run);
  const meta = (run && run.output && run.output.resultMetadata) || [];
  let modelUrl = null, thumbUrl = null;
  urls.forEach((u, i) => {
    const mt = String((meta[i] && meta[i].mimeType) || '');
    if (/gltf|glb/i.test(mt) || /\.glb(\?|$)/i.test(u)) modelUrl = modelUrl || u;
    else if (/image\//i.test(mt) || /\.(png|jpe?g|webp)(\?|$)/i.test(u)) thumbUrl = thumbUrl || u;
  });
  if (!modelUrl) modelUrl = urls.find((u) => /\.glb(\?|$)/i.test(u)) || urls[0] || null;
  const credit = Number((run && run.creditUsed) || (run && run.output && run.output.creditUsed)) || 0;
  return { modelUrl, thumbUrl, credit };
}

// Build the per-run webhook object (async completion callback). Returns null when no
// public base URL is configured (PUBLIC_URL) — then we rely on polling only. metadata
// carries what the callback needs to map back safely: record id, kind, and a token.
function buildWebhook(kind, recId, token) {
  const base = publicBase();
  if (!base) return null;
  return {
    url: `${base}/api/magica/webhook`,
    events: ['run.completed', 'run.failed'],
    metadata: { app: 'storymax', kind, recId, token },
  };
}

// Generate a 3D model via Meshy V6 (text-to-3D or image-to-3D). Returns the .glb model
// URL + a preview thumbnail (.png) + credits used. Rigged/animated when the edit-mode
// rigging/animation fields are supplied.
async function generateMeshy3D(apiKey, opts = {}) {
  const onLog = typeof opts.onLog === 'function' ? opts.onLog : () => {};
  const nodeType = 'meshy_v6_preview';
  const isImage = Array.isArray(opts.imageUrls) && opts.imageUrls.filter(Boolean).length > 0;
  const category = isImage ? 'image-to-image' : 'text-to-image';
  const models = await getModelsCached(apiKey);
  const subModelId = resolveSubModel(models, nodeType, category);
  let fields = []; try { fields = ((await getSchemaCached(apiKey, subModelId || nodeType)) || {}).fields || []; } catch (e) {}
  const input = buildMeshyInput(fields, opts, isImage);
  if (isImage && (!input.image_urls || !input.image_urls.length)) {
    throw new Error('Gambar untuk 3D tidak punya URL publik (set PUBLIC_URL, atau pakai gambar hasil Magica).');
  }
  // image-to-3D shares the public-URL requirement — preflight the first image.
  if (isImage && input.image_urls && input.image_urls[0]) await assertPublicImageReachable(input.image_urls[0], onLog);
  if (!isImage && !input.prompt) throw new Error('Prompt teks untuk 3D wajib diisi.');

  // Pre-flight cost check (same as video) — fail fast if the key cannot afford it.
  const cost = await estimateNodeCost(apiKey, nodeType, subModelId, input);
  if (cost) {
    let bal = null;
    try { bal = Number((await magica.getCreditBalance(apiKey)).availableBalance); } catch (e) {}
    onLog(`[Magica] Estimasi biaya 3D: ~${(cost / 1e6).toFixed(2)} kredit${bal != null ? ` (saldo key ~${(bal / 1e6).toFixed(2)})` : ''}.`);
    if (bal != null && bal < cost) throw new Error(`Kredit key tidak cukup untuk 3D ini: butuh ~${(cost / 1e6).toFixed(2)} kredit, saldo ~${(bal / 1e6).toFixed(2)}.`);
  }

  onLog(`[Magica] 3D via ${nodeType} / ${subModelId} ...`);
  const runId = await magica.runModel(apiKey, nodeType, subModelId, input, opts.webhook);
  if (typeof opts.onRunStart === 'function') { try { await opts.onRunStart(runId); } catch (e) {} }
  const done = await magica.pollRun(apiKey, runId, { onLog, timeoutMs: opts.timeoutMs || 1200000 });
  const { modelUrl, thumbUrl, credit } = extractMeshyResult(done.run);
  if (!modelUrl) throw new Error('Magica tidak mengembalikan model 3D.');
  invalidateBalanceCache();
  return { modelUrl, thumbUrl, credit };
}

module.exports = {
  publicBase,
  toPublicUrl,
  sizeFromAspect,
  estimateMagicaCost,
  generateMeshy3D,
  pickActiveMagicaKey,
  pickMagicaKey,
  pickRandomMagicaKey,
  pickMediaMagicaKey,
  getAllMediaMagicaKeys,
  disableMagicaKey,
  executeWithMagicaFailover,
  getKeyBalances,
  estimateNodeCost,
  MEDIA_MIN_MICRO,
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
  buildWebhook,
  extractMeshyResult,
};
