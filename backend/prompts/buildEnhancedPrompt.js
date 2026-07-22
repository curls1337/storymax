// buildEnhancedPrompt — thin orchestrator that replaces the old ~110-line
// if/else getEnhancedPrompt. It picks a style template, builds the shared
// context, and wraps it with the global reference clause (A7) and the
// per-style layout-stability clause (A2/A4). No duplicated opening preamble.
//
// Accepts an options object so new inputs (aspectRatio, model) are explicit
// rather than positional.

const { getGridLayoutDescription, formatTime } = require('./grid');
const { durationLabel, aspectRatioLabel, faceClause } = require('./labels');
const { referenceClause } = require('./referenceClause');
const { stabilityClause } = require('./layoutWrapper');
const templates = require('./templates');

function buildEnhancedPrompt(opts = {}) {
  const {
    style,
    userPrompt,
    gridCount = 6,
    showFace = false,
    startScene = 1,
    totalDuration = 60,
    secondsPerPage = 15,
    hasRefImage = false,
    containerShape = 'auto',
    aspectRatio = '1:1',
    model = '108',
  } = opts;

  // Truncate very long user prompts (kept from the original behaviour).
  const cleanUser = userPrompt && userPrompt.length > 1000
    ? userPrompt.substring(0, 1000) + '...'
    : (userPrompt || '');

  const gc = Number(gridCount) || 6;
  const endScene = startScene + gc - 1;
  const pageIdx = Math.floor((startScene - 1) / gc);
  const pageNum = pageIdx + 1;
  const startSec = pageIdx * secondsPerPage;
  const endSec = (pageIdx + 1) * secondsPerPage;

  const c = {
    startScene,
    endScene,
    pageNum,
    gridCount: gc,
    gridLayout: getGridLayoutDescription(gc, startScene),
    timeString: `${formatTime(startSec)} - ${formatTime(endSec)}`,
    finalPromptText: cleanUser,
    faceClause: faceClause(showFace),
    durasiLabel: durationLabel(totalDuration),        // A1
    rasioLabel: aspectRatioLabel(aspectRatio, model),  // A3
    containerShape,
  };

  const template = templates[style] || templates._default;
  const body = template(c);

  const ref = referenceClause(style, hasRefImage); // A7 (global, once)
  const refPart = ref ? `\n${ref}` : '';

  return `${body}${refPart}${stabilityClause(style)}`;
}

module.exports = { buildEnhancedPrompt };
