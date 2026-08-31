// Centralized rules, character/reference fidelity contracts, and rendering constraint
// definitions shared between the deterministic builder (masterPrompt.js) and the LLM
// prompt generator (masterPromptLLM.js). Prevents logic and constraint drift.

const { faceClause, faceNegative, normalizeFaceMode } = require('./faceMode');

// Styles that are INTENTIONALLY illustrated (not photographic).
const ILLUSTRATION_STYLES = new Set([
  'anime_manga',
  'kawaii_playful',
  'infographic_explainer',
  'stop_motion',
]);

// Creative transform styles where reference image is only inspiration for subject identity & color.
const STYLIZED_REF_STYLES = new Set([
  'mechanical_transform',
  'jelly_character_asmr',
  'bts_practical_fx',
  'mini_restoration_asmr',
]);

function isPhotoreal(styleId) {
  return styleId ? !ILLUSTRATION_STYLES.has(styleId) : true;
}

function fmtDuration(totalDuration) {
  const d = Number(totalDuration);
  return `${Number.isFinite(d) && d > 0 ? d : 15}s`;
}

function fmtRatio(aspectRatio, model) {
  const ar = String(aspectRatio || '1:1');
  if (String(model) === '108') {
    if (ar === '16:9') return '16:9';
    if (ar === '9:16') return '9:16';
    return '1:1';
  }
  return ar;
}

function bgClause(bg) {
  if (bg === 'dark') return 'clean solid flat dark-charcoal background';
  if (bg === 'textured') return 'stylized textured art background';
  return 'clean solid flat bright white background';
}

function dedupeList(arr) {
  const seen = new Set();
  const out = [];
  for (const raw of arr) {
    const s = String(raw).trim();
    const k = s.toLowerCase();
    if (!s || seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

// Character identity anchor clause
function getCharacterAnchor(characterDescriptor) {
  if (!characterDescriptor) return '';
  return `CHARACTER (SAME physical identity in EVERY panel & page — face, gender, ethnicity, hair color/style and body type must NEVER change; only wardrobe, setting & activity may vary): ${characterDescriptor}.`;
}

// Reference reproduction note (prose in subject line for strict styles)
function getReferenceProseNote(hasRefImage, looseRef) {
  if (hasRefImage && !looseRef) {
    return ' Every panel shows the SAME product as the reference — identical shape, proportions, colors and logo/text (verbatim); never redesign, rename or replace it.';
  }
  return '';
}

// Builds positive, natural rendering quality & constraint instructions without
// using literal "NEGATIVE:" syntax, while preserving all style-specific (spec.negatives)
// and face-mode (faceNegative) restrictions.
function buildRenderingConstraints({
  spec = {},
  faceMode = 'full',
  hasRefImage = false,
  looseRef = false,
  characterDescriptor = '',
  photoreal = true,
}) {
  const parts = [];

  // 1. Photographic vs Illustration style directive
  if (photoreal) {
    parts.push('Render as clean photorealistic photography with sharp focus; no sketches, drawings, or CGI.');
  } else {
    parts.push(`Render in authentic ${spec.name || 'stylized'} art style.`);
  }

  // 2. Product & Reference consistency
  if (hasRefImage) {
    if (looseRef) {
      parts.push("Keep subject recognizable with matching colors transformed into style's shape (no 1:1 copy).");
    } else {
      parts.push('100% exact product fidelity across panels (same shape, buttons, branding, materials, colors; no redesigns).');
    }
  } else {
    parts.push('Maintain identical product features and colors across panels.');
  }

  // 3. Character consistency
  if (characterDescriptor) {
    parts.push('Keep character identity (face, hair, ethnicity, body) 100% consistent across panels.');
  }

  // 4. Style-specific exclusions and face negatives preserved in natural sentence form
  const rawStyleNegs = looseRef
    ? (spec.negatives || []).filter((n) => !/redesign|rename|keep the reference|matches the reference|1:1/i.test(String(n)))
    : (spec.negatives || []);

  const fNeg = faceNegative(faceMode);
  const faceNegTerms = fNeg ? fNeg.split(',').map(s => s.trim()).filter(Boolean) : [];

  const specificTerms = dedupeList(
    [...rawStyleNegs, ...faceNegTerms].filter(n =>
      !/^(garbled or misspelled text|panels bleeding into the background|layout drifting between panels|the product changing design between panels|text paragraphs inside panels)$/i.test(String(n))
    )
  );

  if (specificTerms.length > 0) {
    let avoidStr = specificTerms.join(', ');
    if (avoidStr.length > 140) {
      const cut = avoidStr.lastIndexOf(', ', 140);
      avoidStr = avoidStr.slice(0, cut > 0 ? cut : 140);
    }
    parts.push(`Avoid: ${avoidStr}.`);
  }

  // 5. Clean composition and typography
  parts.push('Clean typography, zero garbled text, no text paragraphs inside panels.');

  return 'RENDERING QUALITY & CONSTRAINTS: ' + parts.join(' ');
}

module.exports = {
  ILLUSTRATION_STYLES,
  STYLIZED_REF_STYLES,
  isPhotoreal,
  fmtDuration,
  fmtRatio,
  bgClause,
  dedupeList,
  getCharacterAnchor,
  getReferenceProseNote,
  buildRenderingConstraints,
  faceClause,
  faceNegative,
  normalizeFaceMode,
};
