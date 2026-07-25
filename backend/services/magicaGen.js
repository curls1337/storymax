// Magica generation helpers. Keeps Magica-specific generate+store logic OUT of the
// big Freebeat files. Model + method are chosen by the user (Bagian 3) and resolved
// to the exact Magica nodeType + subModelId from the live catalog.

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

function sizeFromAspect(ar) {
  switch (String(ar || '')) {
    case '1:1': return '1024x1024';
    case '16:9': return '1536x1024';
    case '9:16': return '1024x1536';
    default: return 'Auto';
  }
}
function videoAspect(ar) {
  const ok = ['16:9', '9:16', '4:3', '3:4', '1:1', '21:9'];
  return ok.includes(String(ar)) ? String(ar) : '9:16';
}
function videoResolution(res) {
  const ok = ['480p', '720p', '1080p', '4k'];
  return ok.includes(String(res)) ? String(res) : '720p';
}
function videoDuration(d) {
  const n = Number(d);
  return (Number.isFinite(n) && n >= 4 && n <= 15) ? Math.round(n) : 5;
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

async function isMagicaForStoryboard(db, storyboardId) {
  try {
    const row = await db.get(
      'SELECT u.preferred_provider AS pp, u.can_use_magica AS cum FROM storyboards s JOIN users u ON u.id = s.user_id WHERE s.id = ?',
      [storyboardId]
    );
    return !!(row && row.pp === 'magica' && row.cum);
  } catch (e) { return false; }
}

// --- Model catalog (cached ~5 min) + submodel resolution ---
let _cache = { key: null, at: 0, models: null };
async function getModelsCached(apiKey) {
  const now = Date.now();
  if (_cache.models && _cache.key === apiKey && (now - _cache.at) < 5 * 60 * 1000) return _cache.models;
  const models = await magica.listModels(apiKey);
  _cache = { key: apiKey, at: now, models };
  return models;
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

// Shaped catalog for the UI: image + video models (with their methods) + active keys.
async function getCatalog(db) {
  const mk = await pickActiveMagicaKey(db);
  if (!mk) return { keys: [], imageModels: [], videoModels: [] };
  const models = await getModelsCached(mk.key_value);
  const shape = (m, allowed) => ({
    nodeType: m.nodeType,
    name: m.name,
    methods: (m.subModels || [])
      .filter((s) => allowed.includes(s.category))
      .map((s) => ({ subModelId: s.subModelId, category: s.category, label: s.label || s.category })),
  });
  const imageModels = models
    .filter((m) => (m.subModels || []).some((s) => IMAGE_METHODS.includes(s.category)) || m.category === 'text-to-image')
    .map((m) => shape(m, IMAGE_METHODS));
  const videoModels = models
    .filter((m) => (m.subModels || []).some((s) => VIDEO_METHODS.includes(s.category)) || VIDEO_METHODS.includes(m.category))
    .map((m) => shape(m, VIDEO_METHODS));
  const keys = await db.all('SELECT id, label FROM magica_api_keys WHERE is_active = 1 ORDER BY id ASC');
  return { keys, imageModels, videoModels };
}

// Generate ONE storyboard image. nodeType defaults to gpt_image_2; text vs edit is
// chosen by whether a reference image is present.
async function generateOneImageMagica(apiKey, prompt, opts = {}) {
  const onLog = typeof opts.onLog === 'function' ? opts.onLog : () => {};
  const nodeType = opts.nodeType || 'gpt_image_2';
  const refUrl = toPublicUrl(opts.refUrl);
  const category = refUrl ? 'image-to-image' : 'text-to-image';
  let subModelId = null;
  try { subModelId = resolveSubModel(await getModelsCached(apiKey), nodeType, category); } catch (e) {}
  const size = sizeFromAspect(opts.aspectRatio);
  const input = { prompt: String(prompt || ''), size, quality: 'High', n: 1 };
  if (refUrl) input.uploadedImages = [refUrl];
  onLog(`[Magica] Gambar via ${nodeType}${subModelId ? ' / ' + subModelId : ''} (size ${size})...`);
  const runId = await magica.runModel(apiKey, nodeType, subModelId, input);
  const done = await magica.pollRun(apiKey, runId, { onLog });
  const url = (done.mediaUrls || [])[0];
  if (!url) throw new Error('Magica tidak mengembalikan URL gambar.');
  return { url, credit: Number(done.creditUsed) || 0 };
}

// Generate ONE video. nodeType defaults to seedance_2_0; method is the submodel
// category (text-to-video | image-to-video | reference-to-video). Falls back from
// the legacy Freebeat generationType when method is not supplied.
async function generateVideoMagica(apiKey, params = {}) {
  const onLog = typeof params.onLog === 'function' ? params.onLog : () => {};
  const nodeType = params.nodeType || (params.fast ? 'seedance_2_0_fast' : 'seedance_2_0');
  let category = params.method;
  if (!category) {
    const gt = params.generationType;
    category = gt === 'text' ? 'text-to-video' : (gt === 'reference' ? 'reference-to-video' : 'image-to-video');
  }
  let subModelId = null;
  try { subModelId = resolveSubModel(await getModelsCached(apiKey), nodeType, category); } catch (e) {}

  const input = {
    prompt: String(params.prompt || ''),
    duration: videoDuration(params.duration),
    aspect_ratio: videoAspect(params.aspectRatio),
    resolution: videoResolution(params.resolution),
    generate_audio: !!params.generateAudio,
  };
  if (category !== 'text-to-video') {
    const imgUrl = toPublicUrl(params.sceneImage);
    if (!imgUrl) throw new Error('Gambar panel tidak punya URL publik untuk Magica (set PUBLIC_URL, atau gunakan gambar hasil Magica).');
    input.image_url = imgUrl;
  }
  onLog(`[Magica] Video via ${nodeType}${subModelId ? ' / ' + subModelId : ''} (${input.duration}s, ${input.aspect_ratio}, ${input.resolution})...`);
  const runId = await magica.runModel(apiKey, nodeType, subModelId, input);
  const done = await magica.pollRun(apiKey, runId, { onLog, timeoutMs: 900000 });
  const url = (done.mediaUrls || [])[0];
  if (!url) throw new Error('Magica tidak mengembalikan URL video.');
  return { url, credit: Number(done.creditUsed) || 0 };
}

module.exports = {
  publicBase,
  toPublicUrl,
  sizeFromAspect,
  pickActiveMagicaKey,
  pickMagicaKey,
  isMagicaForStoryboard,
  getCatalog,
  generateOneImageMagica,
  generateVideoMagica,
};
