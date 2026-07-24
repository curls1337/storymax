// Subject Analyzer — the consistency anchor.
// If a reference image exists, a vision LLM describes the product precisely so
// the EXACT same product (shape, colors, logo, text/branding) can be repeated
// across every panel. Non-blocking & bounded: async file read, size cap, short
// timeout, and always falls back to the user's text idea on any failure — so it
// can never freeze/hang the server (the earlier heaviness cause).
const fs = require('fs');
const fsp = require('fs').promises;
const { chatCompletion } = require('./aiClient');

const SYS = [
  'You are a meticulous product-identification assistant for a storyboard generator.',
  'Describe the ONE main product/subject in the image so it can be reproduced IDENTICALLY across many panels.',
  'Be literal and factual — never creative, never invent details that are not visible.',
  'Order the description so the most identity-critical facts come FIRST:',
  '(1) product type/category;',
  '(2) any visible BRAND NAME, LOGO or TEXT — transcribe it VERBATIM inside double quotes and say where it appears (critical: exact spelling);',
  '(3) exact colors (name them precisely) plus finish and materials;',
  '(4) shape, proportions and key structural parts;',
  '(5) distinctive features or markings.',
  'Write 1-3 dense sentences, front-loaded with the type + brand. Output ONLY the description.',
].join(' ');

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
      if (out && out.length > 3) return out.slice(0, 600);
    }
  } catch (e) { /* fall through to text fallback */ }
  return fallback;
}

module.exports = { analyzeSubject };
