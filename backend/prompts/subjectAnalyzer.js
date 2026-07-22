// Subject Analyzer — the consistency anchor.
// If a reference image exists, a vision LLM describes the subject precisely so
// the exact same subject can be repeated across every storyboard panel.
// Always safe: on any failure it falls back to the user's text idea.
const fs = require('fs');
const { chatCompletion } = require('./aiClient');

const SYS = 'Describe the MAIN subject in the image factually and specifically (type, colors, materials, shape, distinctive features, any visible text/branding) in ONE dense sentence, to be reused verbatim as a consistency anchor across storyboard panels. Output only the description, no preamble.';

function toDataUrl(imagePath) {
  const buf = fs.readFileSync(imagePath);
  const ext = (imagePath.split('.').pop() || 'png').toLowerCase();
  const mime = (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg' : (ext === 'webp' ? 'image/webp' : 'image/png');
  return `data:${mime};base64,${buf.toString('base64')}`;
}

async function analyzeSubject({ imagePath, ideaText }, db) {
  const fallback = String(ideaText || 'the product').slice(0, 300);
  try {
    if (imagePath && fs.existsSync(imagePath)) {
      const messages = [
        { role: 'system', content: SYS },
        { role: 'user', content: [
          { type: 'text', text: `Context idea: ${ideaText || '(none)'}. Describe the subject.` },
          { type: 'image_url', image_url: { url: toDataUrl(imagePath) } },
        ] },
      ];
      const out = await chatCompletion(messages, { db, temperature: 0.3 });
      if (out && out.length > 3) return out.slice(0, 400);
    }
  } catch (e) { /* fall through to text fallback */ }
  return fallback;
}

module.exports = { analyzeSubject };
