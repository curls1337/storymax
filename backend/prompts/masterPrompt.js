// Deterministic master-prompt assembler.
// Composes ONE Freebeat prompt from a Style Spec + context (subject, faceMode,
// params). This is the safe, fully-tested core and also the fallback whenever
// the LLM generator (masterPromptLLM.js) is unavailable.
//
// Design goals: param-driven (duration/aspect from input, never hardcoded),
// explicit consistency (subject repeated + locked camera), faceMode-aware,
// and comfortably under Freebeat's 2000-character limit.

const { faceClause, faceNegative } = require('./faceMode');

function fmtDuration(totalDuration) {
  const d = Number(totalDuration);
  return `${Number.isFinite(d) && d > 0 ? d : 15}s`;
}

// For model 108 the real output size comes from a --resolution mapping, so the
// label mirrors that; other models use the raw ratio.
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

function buildMasterPrompt(spec, ctx = {}) {
  const {
    subject = 'the product',
    concept = '',
    faceMode = spec.faceMode || 'faceless',
    gridCount = 6,
    startScene = 1,
    totalDuration = 15,
    aspectRatio,
    model,
    pageNum = 1,
    pageCount = 1,
    hasRefImage = false,
  } = ctx;

  const gc = Number(gridCount) || 6;
  const endScene = startScene + gc - 1;
  const ratio = fmtRatio(aspectRatio || spec.format, model);
  const dur = fmtDuration(totalDuration);
  // Distribute the style arc across ALL pages so each page shows a DIFFERENT
  // part of the sequence (fixes multi-page repeating the same beats every page).
  const totalScenes = (Number(pageCount) || 1) * gc;
  let pageArc = (spec.arc && spec.arc.length) ? spec.arc.slice() : [];
  if (pageArc.length && (Number(pageCount) || 1) > 1) {
    const M = pageArc.length;
    let bStart = Math.floor(((startScene - 1) / totalScenes) * M);
    let bEnd = Math.ceil((endScene / totalScenes) * M);
    bStart = Math.max(0, Math.min(bStart, M - 1));
    bEnd = Math.max(bStart + 1, Math.min(bEnd, M));
    pageArc = spec.arc.slice(bStart, bEnd);
  }
  const arc = pageArc.length ? pageArc.join(' → ') : 'introduce → develop → reveal → call to action';
  const face = faceClause(faceMode);
  const fneg = faceNegative(faceMode);
  const negatives = [].concat(spec.negatives || [], fneg ? [fneg] : []).join(', ');
  const layout = (spec.layoutHint || 'a grid of {N} numbered panels on one sheet').replace('{N}', String(gc));
  const partLabel = pageCount > 1 ? ` PART ${pageNum}/${pageCount}` : '';
  const refNote = hasRefImage ? ' The attached reference image defines the exact subject appearance — keep it identical.' : '';
  const conceptText = concept ? String(concept).slice(0, 200) : '';
  const pageScope = pageCount > 1
    ? `IMPORTANT: this is PAGE ${pageNum} OF ${pageCount} (scenes ${startScene}-${endScene} of the overall story) — show ONLY this part of the sequence, do NOT repeat the other pages. `
    : '';
  const assemble = (ct) => {
    const cl = ct
      ? `${pageScope}SCENES on this page — based on: "${ct}" — progressing across the panels as: ${arc}.`
      : `${pageScope}SCENES progress across the panels as: ${arc}.`;
    return (
`A professional ${spec.name} storyboard sheet, ${ratio} layout, ${bgClause(spec.bg)}.
HEADER: a banner reading '${spec.header}${partLabel}' with the product title and badges 'STYLE: ${spec.name}', 'ASPECT RATIO: ${ratio}', 'DURATION: ${dur}'.
SUBJECT (keep IDENTICAL in every panel): ${String(subject || 'the product').slice(0, 160)}.${refNote}
LAYOUT: ${layout}; number panels SCENE ${startScene}–${endScene}, each with a number badge (top-left) + timecode (top-right).
${cl}
CAMERA (identical every panel): ${spec.camera}. ${spec.lighting}. Keep background, framing, subject look, color & branding identical across panels.
${face}
NEGATIVE: ${negatives}.`
    );
  };

  // Keep within Freebeat's limit by trimming the (least-critical) concept text
  // first, so the style / consistency / NEGATIVE clauses always survive.
  const LIMIT = 1900;
  let out = assemble(conceptText);
  if (out.length > LIMIT && conceptText) {
    const over = out.length - LIMIT;
    out = assemble(conceptText.slice(0, Math.max(0, conceptText.length - over - 1)));
  }
  return out;
}

module.exports = { buildMasterPrompt, fmtRatio, fmtDuration };
