// Subject Analyzer — the consistency anchor.
// If a reference image exists, a vision LLM describes the product precisely so
// the EXACT same product (shape, colors, logo, text/branding) can be repeated
// across every panel. Non-blocking & bounded: async file read, size cap, short
// timeout, and always falls back to the user's text idea on any failure — so it
// can never freeze/hang the server (the earlier heaviness cause).
const fs = require('fs');
const fsp = require('fs').promises;
const { chatCompletion } = require('./aiClient');

const SYS = 'You are a product-identification assistant. Describe the MAIN product/subject in the image precisely and factually in ONE dense sentence: type, exact colors, materials, shape & proportions, distinctive features, and any visible brand name / logo / text. This description will be reused verbatim to keep the product identical across storyboard panels, so be specific and literal. Output ONLY the description.';

async function toDataUrl(imagePath) {
  const buf = await fsp.readFile(imagePath);
  if (buf.length > 8 * 1024 * 1024) return null; // too large — skip vision, keep it light
  const ext = (imagePath.split('.').pop() || 'png').toLowerCase();
  const mime = (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg' : (ext === 'webp' ? 'image/webp' : 'image/png');
  return `data:${mime};base64,${buf.toString('base64')}`;
}

async function analyzeSubject({ imagePath, ideaText }, db) {
  const fallback = String(ideaText || 'the product').slice(0, 300);
  try {
    if (imagePath && fs.existsSync(imagePath)) {
      const dataUrl = await toDataUrl(imagePath);
      if (!dataUrl) return fallback;
      const messages = [
        { role: 'system', content: SYS },
        { role: 'user', content: [
          { type: 'text', text: `Context idea: ${ideaText || '(none)'}. Describe the product to keep it identical across panels.` },
          { type: 'image_url', image_url: { url: dataUrl } },
        ] },
      ];
      const out = await chatCompletion(messages, { db, temperature: 0.2, timeoutMs: 15000 });
      if (out && out.length > 3) return out.slice(0, 400);
    }
  } catch (e) { /* fall through to text fallback */ }
  return fallback;
}

module.exports = { analyzeSubject };
