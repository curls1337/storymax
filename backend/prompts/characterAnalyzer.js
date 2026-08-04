// Character Analyzer — the CHARACTER identity anchor (separate from the
// PRODUCT-focused subjectAnalyzer.js). When a storyboard uses a saved
// "Consistent Character", nothing previously described that PERSON'S physical
// identity (face, gender, ethnicity, hair, body type) in the actual image
// prompt — only the reference image + the AI splitter's per-page text carried
// it, both of which can drift or fail silently. This gives every page an
// explicit, never-trimmed anchor line describing the character, independent
// of the product-only subjectDescriptor.
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const { chatCompletion } = require('./aiClient');
const { uploadsDir } = require('../config');
const { downloadFile } = require('../services/download');

const SYS = [
  'You are a meticulous character-identification assistant for a commercial storyboard generator.',
  'Describe ONLY the physical identity of the ONE main human character/person in the image so that identity can be reproduced IDENTICALLY across ALL storyboard panels and pages.',
  'Be literal and factual — never creative, never invent details that are not visible.',
  'Order the description so the most identity-critical facts come FIRST:',
  '(1) apparent gender and approximate age range;',
  '(2) ethnicity / skin tone;',
  '(3) hair color, length and style;',
  '(4) face shape and distinctive facial features;',
  '(5) body type / build and approximate height.',
  'Do NOT describe clothing, wardrobe, accessories, pose or the background — those are allowed to change per scene.',
  'Write 1-2 dense sentences. Output ONLY the description.',
].join(' ');

// Resolves a character's sheet_image_url (which may be a remote CDN URL, a
// local "/uploads/..." path, or an absolute path) into a local file path the
// vision model can read. Downloads remote URLs to a throwaway temp file.
async function resolveLocalPath(imageUrlOrPath) {
  if (!imageUrlOrPath || typeof imageUrlOrPath !== 'string') return null;
  if (imageUrlOrPath.startsWith('/uploads/') || imageUrlOrPath.startsWith('uploads/')) {
    return path.join(uploadsDir, imageUrlOrPath.replace(/^\/?uploads\//, ''));
  }
  if (imageUrlOrPath.startsWith('http://') || imageUrlOrPath.startsWith('https://')) {
    try {
      const tmpName = `char_analyze_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.png`;
      const tmpPath = path.join(uploadsDir, tmpName);
      await downloadFile(imageUrlOrPath, tmpPath);
      return tmpPath;
    } catch (e) {
      return null;
    }
  }
  return imageUrlOrPath;
}

async function toDataUrl(imagePath) {
  const buf = await fsp.readFile(imagePath);
  if (buf.length > 8 * 1024 * 1024) return null; // too large — skip vision, keep it light
  const ext = (imagePath.split('.').pop() || 'png').toLowerCase();
  const mime = (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg' : (ext === 'webp' ? 'image/webp' : 'image/png');
  return `data:${mime};base64,${buf.toString('base64')}`;
}

// Bounded & non-blocking, exactly like analyzeSubject: any failure returns ''
// (never throws, never hangs), so a missing/slow vision call never breaks
// storyboard generation — it just means the extra anchor line is skipped.
async function analyzeCharacterSubject({ imageUrlOrPath }, db) {
  try {
    const localPath = await resolveLocalPath(imageUrlOrPath);
    if (!localPath || !fs.existsSync(localPath)) return '';
    const dataUrl = await toDataUrl(localPath);
    if (!dataUrl) return '';
    const messages = [
      { role: 'system', content: SYS },
      { role: 'user', content: [
        { type: 'text', text: 'Describe this character/person so their exact physical identity can be reproduced identically across every storyboard panel and page.' },
        { type: 'image_url', image_url: { url: dataUrl } },
      ] },
    ];
    const out = await chatCompletion(messages, { db, temperature: 0.2, timeoutMs: 15000 });
    if (out && out.length > 3) return out.slice(0, 400);
  } catch (e) { /* fall through */ }
  return '';
}

module.exports = { analyzeCharacterSubject };
