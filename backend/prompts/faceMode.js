// 3-way face handling.
// 'chin_max' keeps human presence only BELOW the eye line so the Seedance video
// engine (which refuses recognizable faces) can still animate the result.

// Accepts an explicit faceMode, or falls back to the legacy boolean showFace,
// and automatically forces 'no_people' (0 hands/humans) for transformation styles.
function normalizeFaceMode(faceMode, showFace, styleId) {
  if (styleId) {
    const s = String(styleId).toLowerCase();
    if (s.includes('cube') || s.includes('asmr') || s.includes('shape_morph') || s.includes('capsule')) {
      return 'no_people';
    }
  }
  if (faceMode === 'no_people' || faceMode === 'faceless' || faceMode === 'chin_max' || faceMode === 'full') return faceMode;
  if (showFace === true) return 'full';
  return 'faceless';
}

function faceClause(mode) {
  switch (mode) {
    case 'no_people':
      return 'ABSOLUTELY NO human presence, NO hands, NO fingers, NO arms, NO body parts in frame. The product/container rests completely alone on the surface and operates/unfolds automatically by itself.';
    case 'full':
      return 'Natural human faces and expressions are allowed, close-up lifestyle angles, high-end commercial style.';
    case 'chin_max':
      return "Show people ONLY from the nose down (lips, chin, jaw, neck, shoulders, hands); crop the head just below the eye line; no full face, no eyes, no eye contact.";
    case 'faceless':
    default:
      return 'No human faces or portraits; focus only on hands, the product and close-up details; no person visible from the neck up.';
  }
}

// Extra negative-prompt terms to reinforce the chosen mode.
function faceNegative(mode) {
  if (mode === 'no_people') return 'hands, human hands, fingers, arms, body parts, human, person, holding hand, touching';
  if (mode === 'chin_max') return 'eyes, forehead, full-face portrait, direct gaze';
  if (mode === 'faceless') return 'human faces, portraits, any person from the neck up';
  return '';
}

module.exports = { normalizeFaceMode, faceClause, faceNegative };
