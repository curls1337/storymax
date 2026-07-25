// Magica generation helpers (Bagian 2). Keeps the Magica-specific generate+store
// logic OUT of the big Freebeat files so their branches stay tiny and the Freebeat
// path is never touched. Uses services/magicaClient.js (verified REST client).
//
// Image  -> gpt_image_2 (gpt-image-2-text, or gpt-image-2-edit when a reference is given)
// Video  -> seedance_2_0 (seedance-2.0-image-to-video / -text-to-video), fast variant optional

const path = require('path');
const { getDb } = require('../db');
const magica = require('./magicaClient');

// Public base URL so Magica (a remote API) can fetch our /uploads assets and any
// reference image. In background jobs there is no req, so we rely on PUBLIC_URL.
function publicBase() {
  return (process.env.PUBLIC_URL || process.env.APP_URL || '').replace(/\/$/, '');
}

// Turn a stored image path/URL into a PUBLIC url Magica can fetch.
// - already http(s)  -> use as-is (e.g. a Magica CDN url from a Magica-generated panel)
// - local /uploads/… -> PUBLIC_URL + /uploads/<basename>
// - anything else     -> null (caller falls back to text-only)
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
  if (Number.isFinite(n) && n >= 4 && n <= 15) return Math.round(n);
  return 5;
}

async function pickActiveMagicaKey(db) {
  const row = await db.get('SELECT id, key_value FROM magica_api_keys WHERE is_active = 1 ORDER BY id ASC LIMIT 1');
  return row || null;
}

// Whether this storyboard's owner prefers Magica AND is allowed to use it.
async function isMagicaForStoryboard(db, storyboardId) {
  try {
    const row = await db.get(
      'SELECT u.preferred_provider AS pp, u.can_use_magica AS cum FROM storyboards s JOIN users u ON u.id = s.user_id WHERE s.id = ?',
      [storyboardId]
    );
    return !!(row && row.pp === 'magica' && row.cum);
  } catch (e) {
    return false;
  }
}

// Generate ONE storyboard-sheet image via Magica GPT Image 2. Returns { url, credit }.
async function generateOneImageMagica(apiKey, prompt, opts = {}) {
  const onLog = typeof opts.onLog === 'function' ? opts.onLog : () => {};
  const size = sizeFromAspect(opts.aspectRatio);
  const refUrl = toPublicUrl(opts.refUrl);

  let nodeType = 'gpt_image_2';
  let subModelId = 'gpt-image-2-text';
  const input = { prompt: String(prompt || ''), size, quality: 'High', n: 1 };
  if (refUrl) {
    subModelId = 'gpt-image-2-edit';
    input.uploadedImages = [refUrl];
    onLog(`[Magica] Edit dari referensi: ${refUrl}`);
  }

  onLog(`[Magica] Mengirim gambar ke ${subModelId} (size ${size})...`);
  const runId = await magica.runModel(apiKey, nodeType, subModelId, input);
  const done = await magica.pollRun(apiKey, runId, { onLog });
  const url = (done.mediaUrls || [])[0];
  if (!url) throw new Error('Magica tidak mengembalikan URL gambar.');
  return { url, credit: Number(done.creditUsed) || 0 };
}

// Generate ONE video via Magica Seedance. Returns { url, credit }.
// generationType 'text' -> text-to-video; otherwise image-to-video (needs a public image url).
async function generateVideoMagica(apiKey, params = {}) {
  const onLog = typeof params.onLog === 'function' ? params.onLog : () => {};
  const fast = !!params.fast;
  const nodeType = fast ? 'seedance_2_0_fast' : 'seedance_2_0';
  const wantImage = params.generationType && params.generationType !== 'text';

  const input = {
    prompt: String(params.prompt || ''),
    duration: videoDuration(params.duration),
    aspect_ratio: videoAspect(params.aspectRatio),
    resolution: videoResolution(params.resolution),
    generate_audio: !!params.generateAudio,
  };

  let subModelId;
  if (wantImage) {
    const imgUrl = toPublicUrl(params.sceneImage);
    if (!imgUrl) throw new Error('Gambar panel tidak punya URL publik untuk Magica (set PUBLIC_URL, atau gunakan gambar hasil Magica).');
    subModelId = `${fast ? 'seedance-2.0-fast' : 'seedance-2.0'}-image-to-video`;
    input.image_url = imgUrl;
  } else {
    subModelId = `${fast ? 'seedance-2.0-fast' : 'seedance-2.0'}-text-to-video`;
  }

  onLog(`[Magica] Mengirim video ke ${subModelId} (durasi ${input.duration}s, ${input.aspect_ratio}, ${input.resolution})...`);
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
  isMagicaForStoryboard,
  generateOneImageMagica,
  generateVideoMagica,
};
