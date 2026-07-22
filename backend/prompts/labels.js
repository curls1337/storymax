// Human-readable labels injected into prompt templates.
// Fixes:
//  A1 - duration label derived from the user's chosen duration (not hardcoded).
//  A3 - aspect-ratio label reflects the ratio actually used for the model.
//  A6 - Indonesian locale kept consistent (no mixed Malay).

// Map the user-selected aspect ratio to the label that matches what the model
// will actually output. For model 108 the real size comes from a --resolution
// mapping (see services/freebeat/cli.js), so we mirror that here truthfully.
function aspectRatioLabel(aspectRatio, model) {
  const ar = String(aspectRatio || '1:1');
  if (String(model) === '108') {
    if (ar === '16:9') return '16:9';
    if (ar === '9:16') return '9:16';
    return '1:1';
  }
  return ar;
}

// A1: single source of truth for the visible duration text.
function durationLabel(totalDuration) {
  const d = Number(totalDuration);
  const safe = Number.isFinite(d) && d > 0 ? d : 15;
  return `${safe} DETIK`;
}

function faceClause(showFace) {
  return showFace
    ? 'featuring natural human faces and character expressions, close-up lifestyle angles, high-end commercial style'
    : 'no human faces, faceless, no portraits, focus only on hands, details and product';
}

module.exports = { aspectRatioLabel, durationLabel, faceClause };
