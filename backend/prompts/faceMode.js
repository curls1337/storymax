// 3-way face handling.
// 'chin_max' keeps human presence only BELOW the eye line so the Seedance video
// engine (which refuses recognizable faces) can still animate the result.

// Accepts an explicit faceMode, or falls back to the legacy boolean showFace.
function normalizeFaceMode(faceMode, showFace) {
  if (faceMode === 'faceless' || faceMode === 'chin_max' || faceMode === 'full') return faceMode;
  if (showFace === true) return 'full';
  return 'faceless';
}

function faceClause(mode) {
  switch (mode) {
    case 'full':
      return 'Natural human faces and expressions are allowed, close-up lifestyle angles, high-end commercial style.';
    case 'chin_max':
      return "Show people ONLY from the nose down — lips, chin, jawline, neck, shoulders and hands are visible; frame every shot so the top edge crops the head just below the eye line (lower-face / mouth-level framing); no recognizable face and no eye contact.";
    case 'faceless':
    default:
      return 'No human faces or portraits; focus only on hands, the product and close-up details; no person visible from the neck up.';
  }
}

// Extra negative-prompt terms to reinforce the chosen mode.
function faceNegative(mode) {
  if (mode === 'chin_max') return 'eyes, forehead, full-face portrait, direct gaze';
  if (mode === 'faceless') return 'human faces, portraits, any person from the neck up';
  return '';
}

module.exports = { normalizeFaceMode, faceClause, faceNegative };
