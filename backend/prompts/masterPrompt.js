// Deterministic master-prompt assembler.
// Composes ONE Freebeat prompt from a Style Spec + context (subject, faceMode,
// params). This is the safe, fully-tested core and also the fallback whenever
// the LLM generator (masterPromptLLM.js) is unavailable.
//
// Design goals: param-driven (duration/aspect from input, never hardcoded),
// explicit consistency (subject repeated + locked camera), faceMode-aware,
// and comfortably under Freebeat's 2000-character limit — while NEVER destroying
// the prompt structure (every section always survives, only its content shrinks).

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

// Case-insensitive de-duplication that preserves original casing & order. Used to
// collapse the negative list (style negatives + anti-sketch + face-negative often
// repeat "hands, fingers, person…"), which keeps the protected tail small.
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

// Styles that are INTENTIONALLY illustrated (not photographic). Every other style
// should render as photorealistic PHOTO panels — not sketches / concept art. The
// word "storyboard" biases image models toward rough sketches, so photo styles get
// an explicit photorealism directive + anti-sketch negatives.
const ILLUSTRATION_STYLES = new Set(['anime_comic', 'stop_motion', 'tiny_world', 'education_explainer']);

// Shared helper so the LLM generator applies the SAME photo/illustration decision.
function isPhotoreal(styleId) {
  return styleId ? !ILLUSTRATION_STYLES.has(styleId) : true;
}

// Character budgets. Generous caps; the priority-based fitter shrinks the
// least-critical parts first so the total always fits Freebeat's limit.
const SUBJECT_MAX_NOREF = 300; // text is the ONLY identity anchor → keep it rich (was a flat 140)
const SUBJECT_MAX_REF = 180;   // a reference image carries identity → the text can be leaner
const SUBJECT_FLOOR = 120;     // never trim the text identity anchor below this (no ref image)
const SUBJECT_FLOOR_REF = 64;  // with a reference image the picture is the anchor → text can be leaner
const CONCEPT_MAX = 450;       // was 200 — the 200 cap cut per-page story mid-sentence
const ARC_MAX = 460;
const NEG_MAX = 340;           // cap the NEGATIVE list so heavy styles don't starve the body
const LIMIT = 1950;            // stay under Freebeat's 2000 hard cap (builder guarantees total <= LIMIT)

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
  if (arc.length > ARC_MAX) {
    const cut = arc.lastIndexOf(' ', ARC_MAX);
    arc = arc.slice(0, cut > ARC_MAX - 120 ? cut : ARC_MAX);
  }

  const face = faceClause(faceMode);
  const fneg = faceNegative(faceMode);

  // Photo styles: force photorealism (defeat the "storyboard = sketch" bias).
  const photoreal = isPhotoreal(spec.id);
  const realNote = photoreal
    ? ' Render every panel as a PHOTOREALISTIC PHOTOGRAPH — real camera, real lighting, sharp focus, lifelike materials — never a sketch, drawing, painting or concept art.'
    : '';
  const antiSketch = photoreal
    ? ['sketch', 'line art', 'pencil or ink drawing', 'concept art', 'cartoon or anime drawing', 'flat clay or low-detail CGI render']
    : [];

  // Merge + de-dupe every negative source so the tail never repeats phrases, then
  // cap its length. A 500+ char negative list (e.g. cube) would dominate the whole
  // budget; the most important, style-specific terms come first, and the strongest
  // no-people / anti-sketch guarantees are ALSO carried by the face clause + realNote.
  let negatives = dedupeList(
    []
      .concat(spec.negatives || [])
      .concat(antiSketch)
      .concat(fneg ? String(fneg).split(',') : [])
      .concat(['text paragraphs inside panels'])
  ).join(', ');
  if (negatives.length > NEG_MAX) {
    const cut = negatives.lastIndexOf(', ', NEG_MAX);
    negatives = negatives.slice(0, cut > NEG_MAX - 140 ? cut : NEG_MAX);
  }

  const layout = (spec.layoutHint || 'a grid of {N} numbered panels on one sheet').replace('{N}', String(gc));
  const partLabel = pageCount > 1 ? ` PART ${pageNum}/${pageCount}` : '';
  const refNote = hasRefImage
    ? ' Copy the product from the reference EXACTLY — same shape, colors, logo & text; never redesign it.'
    : '';
  const pageScope = pageCount > 1
    ? (pageNum === 1
        ? `IMPORTANT: PAGE 1/${pageCount} (scenes ${startScene}-${endScene}) — show only the BEGINNING; the sequence continues on later pages. `
        : `IMPORTANT: PAGE ${pageNum}/${pageCount} (scenes ${startScene}-${endScene}) — CONTINUE from page ${pageNum - 1} (do NOT restart the opening); show only later stages & the final result. `)
    : '';

  // Protected tail: the FOOTER, the face-mode clause, and the NEGATIVE line must
  // ALWAYS survive — they carry shooting notes, enforce faceless/chin-crop, and
  // block glow/robot/garbled text. Held out of the fitter and appended last.
  const tail = `FOOTER: a slim 'PRODUCTION NOTES' bar (camera, FPS, lighting, audio).
${face}
NEGATIVE: ${negatives}.`;

  // ── Fixed structural lines (content is fixed; always present) ──
  const L1 = `A professional ${spec.name} storyboard sheet — ONE printed poster, ${ratio} layout, ${bgClause(spec.bg)}.${realNote}`;
  const L2 = `HEADER: banner '${spec.header}${partLabel}' + product name + badges 'DURATION ${dur}' 'SCENES ${gc}' 'RATIO ${ratio}'.`;
  const L4 = `Layout: ${layout}, numbered SCENE ${startScene}–${endScene}; each panel: a short SCENE TITLE, one-line action, tiny 'CAM'/'LIGHT' tags + a duration chip. Keep on-sheet text short & correctly spelled; vary the camera per scene; keep card layout, palette & background identical.`;
  const L5 = `Base camera: ${spec.camera}; light: ${spec.lighting}.`;

  // ── Variable lines (content shrinks to fit) ──
  const subjLine = (s) => `SUBJECT (identical in every panel): ${s}.${refNote}`;
  const scenesLine = (ct, ar) => {
    if (ct) {
      const prog = ar ? `progressing across the panels as: ${ar}` : 'progressing sequentially across the numbered panels';
      return `${pageScope}SCENES on this page — based on: "${ct}" — ${prog}.`;
    }
    const prog = ar ? `progress across the panels as: ${ar}` : 'progress sequentially across the numbered panels';
    return `${pageScope}SCENES ${prog}.`;
  };

  const assemble = (s, ct, ar) => [L1, L2, subjLine(s), L4, L5, scenesLine(ct, ar)].join('\n');

  // Priority (kept longest): protected tail > SUBJECT identity anchor > structure
  // > per-page CONCEPT > style ARC. Under pressure we trim in reverse: concept,
  // then arc, then the subject toward its floor — every section stays present.
  const subjCap = hasRefImage ? SUBJECT_MAX_REF : SUBJECT_MAX_NOREF;
  const subjFloor = hasRefImage ? SUBJECT_FLOOR_REF : SUBJECT_FLOOR;
  let subj = String(subject || 'the product').slice(0, subjCap);
  let conceptText = concept ? String(concept).slice(0, CONCEPT_MAX) : '';

  const TAIL_RESERVE = tail.length + 1;
  const trimTail = (str, over) => {
    const cut = str.slice(0, Math.max(0, str.length - over - 1));
    const sp = cut.lastIndexOf(' ');
    return sp > 0 ? cut.slice(0, sp) : cut;
  };
  const overBy = () => (assemble(subj, conceptText, arc).length + TAIL_RESERVE) - LIMIT;

  // Sacrifice order: per-page CONCEPT → style ARC → SUBJECT (only down to its floor).
  // subjCap already biases identity richness by whether a reference image exists,
  // so the identity anchor is the last thing to shrink. The arc never re-inflates.
  if (overBy() > 0 && conceptText) conceptText = trimTail(conceptText, overBy());
  if (overBy() > 0 && arc) arc = trimTail(arc, overBy());
  if (overBy() > 0 && subj.length > subjFloor) {
    subj = subj.slice(0, Math.max(subjFloor, subj.length - overBy() - 1));
  }

  let body = assemble(subj, conceptText, arc);
  // Absolute safety net: clamp the BODY only — the tail (face clause + NEGATIVE) is
  // sacred and always appended in full. In practice the trims above already fit.
  const room = LIMIT - TAIL_RESERVE;
  if (body.length > room) {
    body = body.slice(0, Math.max(0, room));
    const sp = body.lastIndexOf(' ');
    if (sp > room - 160) body = body.slice(0, sp);
  }
  return body + '\n' + tail;
}

module.exports = { buildMasterPrompt, fmtRatio, fmtDuration, ILLUSTRATION_STYLES, isPhotoreal };
