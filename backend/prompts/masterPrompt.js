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
  let arc = pageArc.length ? pageArc.join(' → ') : 'introduce → develop → reveal → call to action';
  // Cap arc length so a very long narrative can never crowd out the footer / face
  // / NEGATIVE clauses (cut at a word boundary).
  if (arc.length > 520) {
    const cut = arc.lastIndexOf(' ', 520);
    arc = arc.slice(0, cut > 400 ? cut : 520);
  }
  const face = faceClause(faceMode);
  const fneg = faceNegative(faceMode);
  const negatives = [].concat(spec.negatives || [], fneg ? [fneg] : []).join(', ');
  const layout = (spec.layoutHint || 'a grid of {N} numbered panels on one sheet').replace('{N}', String(gc));
  const partLabel = pageCount > 1 ? ` PART ${pageNum}/${pageCount}` : '';
  const refNote = hasRefImage ? ' CRITICAL: in every panel copy the product EXACTLY from the reference — same shape, size, colors, logo & text; do NOT redesign or rename it.' : '';
  const conceptText = concept ? String(concept).slice(0, 200) : '';
  const pageScope = pageCount > 1
    ? (pageNum === 1
        ? `IMPORTANT: PAGE 1/${pageCount} (scenes ${startScene}-${endScene}) — show only the BEGINNING; it continues on later pages. `
        : `IMPORTANT: PAGE ${pageNum}/${pageCount} (scenes ${startScene}-${endScene}) — CONTINUE from the previous page; the opening ALREADY happened, do NOT restart it (no cube) — show only later stages / the finished result in new angles. `)
    : '';
  const negLine = `NEGATIVE: ${negatives}, garbled text.`;
  const assembleBody = (ct) => {
    const cl = ct
      ? `${pageScope}SCENES on this page — based on: "${ct}" — progressing across the panels as: ${arc}.`
      : `${pageScope}SCENES progress across the panels as: ${arc}.`;
    return (
`A professional ${spec.name} storyboard sheet, ${ratio} layout, ${bgClause(spec.bg)}.
HEADER: banner '${spec.header}${partLabel}' + product name + badges 'DURATION ${dur}', 'SCENES ${gc}', 'RATIO ${ratio}'.
SUBJECT (identical in every card): ${String(subject || 'the product').slice(0, 140)}.${refNote}
Lay out ${layout}, numbered SCENE ${startScene}–${endScene}. EACH card shows: the panel image, a short SCENE TITLE, a one-line action, and tiny production tags 'CAM: <angle>', 'LIGHT: <lighting>', 'AUDIO: <music/sfx>' + a duration chip; vary the camera per scene; keep card layout & background consistent.
${cl}
Base camera: ${spec.camera}; light: ${spec.lighting}.
FOOTER: a 'PRODUCTION NOTES' bar with recommended camera, FPS, lighting & shooting style.
${face}`
    );
  };

  // Keep within Freebeat's 2000-char limit. Reserve room for the NEGATIVE line so
  // it (the guard against glow/robot/garbled text) ALWAYS survives: trim the
  // least-critical concept text first, then hard-clamp only the BODY — never the
  // NEGATIVE line, which is re-appended last.
  const NEG_RESERVE = negLine.length + 1; // +1 for the joining newline
  const LIMIT = 1900;
  let body = assembleBody(conceptText);
  if (body.length + NEG_RESERVE > LIMIT && conceptText) {
    const over = (body.length + NEG_RESERVE) - LIMIT;
    body = assembleBody(conceptText.slice(0, Math.max(0, conceptText.length - over - 1)));
  }
  const HARD = 1990 - NEG_RESERVE;
  if (body.length > HARD) {
    body = body.slice(0, HARD);
    const sp = body.lastIndexOf(' ');
    if (sp > HARD - 120) body = body.slice(0, sp);
  }
  return body + '\n' + negLine;
}

module.exports = { buildMasterPrompt, fmtRatio, fmtDuration };
