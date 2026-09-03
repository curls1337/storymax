// Deterministic master-prompt assembler.
// Composes ONE Freebeat/Scenario prompt from a Style Spec + context (subject, faceMode,
// params). This is the safe, fully-tested core and also the fallback whenever
// the LLM generator (masterPromptLLM.js) is unavailable.

const {
  ILLUSTRATION_STYLES,
  STYLIZED_REF_STYLES,
  isPhotoreal,
  fmtDuration,
  fmtRatio,
  bgClause,
  getCharacterAnchor,
  getReferenceProseNote,
  buildRenderingConstraints,
  faceClause,
} = require('./promptRules');

const SUBJECT_MAX = 320;       // rich product descriptor (type, brand/logo text, colors, proportions)
const SUBJECT_FLOOR = 160;     // never trim the identity anchor below this unless as a last resort
const CONCEPT_MAX = 420;       // protected story budget per page
const ARC_MAX = 360;
const LIMIT = 1950;            // stay under Freebeat / GPT Image character limits

// Word-boundary-safe cap: never cut CONCEPT/SUBJECT mid-word.
function capAtWordBoundary(str, maxLen) {
  const s = String(str || '');
  if (s.length <= maxLen) return s;
  const cut = s.slice(0, maxLen);
  const sp = cut.lastIndexOf(' ');
  return sp > maxLen - 120 ? cut.slice(0, sp) : cut;
}

function buildMasterPrompt(spec, ctx = {}) {
  const {
    subject = 'the product',
    concept = '',
    faceMode = spec.faceMode || 'full',
    gridCount = 6,
    startScene = 1,
    totalDuration = 15,
    aspectRatio,
    model,
    pageNum = 1,
    pageCount = 1,
    hasRefImage = false,
    secondsPerPage,
    textOnScreen = false,
    voiceOver = false,
    voLanguage = 'Bahasa Indonesia',
    characterDescriptor = '',
    characterName = '',
  } = ctx;

  const gc = Number(gridCount) || 6;
  const endScene = startScene + gc - 1;
  const ratio = fmtRatio(aspectRatio || spec.format, model);

  const perPage = Number(secondsPerPage) > 0
    ? Number(secondsPerPage)
    : (pageCount > 1 ? Math.max(1, Math.round(Number(totalDuration || 15) / pageCount)) : Number(totalDuration || 15));
  const winStart = (pageNum - 1) * perPage;
  const winEnd = winStart + perPage;
  const dur = fmtDuration(pageCount > 1 ? perPage : (totalDuration || perPage));
  const windowBadge = pageCount > 1 ? ` 'TIME ${winStart}-${winEnd}s'` : '';
  const independentScenes = !!spec.independentScenes;

  // Distribute the style arc across ALL pages
  const totalScenes = (Number(pageCount) || 1) * gc;
  let pageArc = (spec.arc && spec.arc.length) ? spec.arc.slice() : [];
  if (pageArc.length && (Number(pageCount) || 1) > 1 && !independentScenes) {
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
  const photoreal = isPhotoreal(spec.id);
  const realNote = photoreal ? ' Photorealistic photo panels.' : '';

  const looseRef = hasRefImage && STYLIZED_REF_STYLES.has(spec.id);

  const layout = (spec.layoutHint || 'a grid of {N} numbered panels on one sheet').replace('{N}', String(gc));
  const partLabel = pageCount > 1 ? ` PART ${pageNum}/${pageCount}` : '';

  const cols = (gc === 6 && (ratio === '9:16' || spec.format === '9:16')) ? 2 : (gc === 4 ? 2 : (gc === 8 ? 4 : 3));
  const rows = Math.ceil(gc / cols);
  const layoutStructure = ` OVERALL STRUCTURE: A strict symmetrical ${cols}x${rows} grid of ${gc} equal numbered rectangular panels with clean borders, no overlapping.`;

  const refNote = getReferenceProseNote(hasRefImage, looseRef);

  const CONT = independentScenes
    ? "VISUAL CONTINUITY: Keep SAME character identity 100% consistent across pages."
    : "VISUAL CONTINUITY: Keep SAME setting, lighting, wardrobe & palette, and exact same symmetrical grid structure across pages.";

  const pageScope = pageCount > 1
    ? (independentScenes
        ? `PAGE ${pageNum}/${pageCount} (scenes ${startScene}-${endScene}) — Standalone moment for SAME character. ${CONT} `
        : (pageNum === 1
            ? `PAGE 1/${pageCount} (scenes ${startScene}-${endScene}) — START of sequence. ${CONT} `
            : `PAGE ${pageNum}/${pageCount} (scenes ${startScene}-${endScene}) — DIRECT CONTINUATION from Page ${pageNum - 1}. ${CONT} `))
    : '';

  const characterClause = getCharacterAnchor(characterDescriptor, characterName);

  const renderingConstraints = buildRenderingConstraints({
    spec,
    faceMode,
    hasRefImage,
    looseRef,
    characterDescriptor,
    characterName,
    photoreal,
  });

  // Protected tail: Footer, face mode clause, and natural rendering constraints
  const tail = `FOOTER: a slim 'PRODUCTION NOTES' bar (camera, FPS, lighting, audio).
${face}
${renderingConstraints}`;

  // Structural lines
  const L1 = `A professional ${spec.name} storyboard sheet — ONE printed poster, ${ratio} layout, ${bgClause(spec.bg)}.${realNote}${layoutStructure}${looseRef ? " The reference is ONLY inspiration — re-form the subject into THIS style's own shape (recognizable, same colors), do NOT copy it 1:1." : ''}`;
  const L1c = characterClause;
  const L2 = `HEADER: banner '${spec.header}${partLabel}' + product name + badges 'DURATION ${dur}'${windowBadge} 'SCENES ${gc}' 'RATIO ${ratio}'.`;

  const textClause = textOnScreen
    ? " ALSO burn ONE stylized ON-SCREEN TEXT element into each panel — choose between a clean feature callout badge, a floating sticker caption bubble, or bold kinetic social lettering (e.g. 'Lembut macam awan', 'Praktis & Hemat Tempat', 'Ujung Runcing Menjangkau Sudut') rendered with crisp high-contrast outlines, soft drop shadows, and varied sticker shapes per panel to act as clear product feature explanations, perfectly spelled."
    : '';

  const voClause = voiceOver
    ? ` Also print a small 'Voiceover:' note under each panel — a VERY SHORT 2-4 word voice-over cue for that scene in ${voLanguage} (super concise, 2-4 plain words, NO quotes, NO symbols like 'x', e.g. 'Langkah awal', 'Kualitas terbaik', 'Dapatkan sekarang').`
    : '';

  const L4 = `Layout: ${layout}, numbered SCENE ${startScene}–${endScene}; each panel: a short SCENE TITLE, one-line action, tiny 'CAM'/'LIGHT' tags + a duration chip. Keep on-sheet text short & correctly spelled; vary the camera per scene; keep card layout, palette & background identical.${textClause}${voClause}`;
  let cameraText = spec.camera ? capAtWordBoundary(spec.camera, 140) : 'cinematic coverage';
  let lightText = spec.lighting ? capAtWordBoundary(spec.lighting, 100) : 'clean studio light';

  const subjLine = (s, rn) => `SUBJECT (${looseRef ? 'kept recognizable & consistent across panels' : 'identical in every panel'}): ${s}.${rn}`;
  const scenesLine = (ct, ar) => {
    const prog = ar ? `progressing across panels as: ${ar}` : 'progressing sequentially across numbered panels';
    const conceptPart = ct ? ` — based on: "${ct}"` : '';
    return `${pageScope}SCENES on this page${conceptPart} — ${prog}.`;
  };

  const assemble = (s, ct, ar, rn, cam, lgt) => [
    L1,
    L1c,
    L2,
    subjLine(s, rn),
    L4,
    `Base camera: ${cam}; light: ${lgt}.`,
    scenesLine(ct, ar),
  ].filter(Boolean).join('\n');

  const subjCap = SUBJECT_MAX;
  const subjFloor = SUBJECT_FLOOR;

  let subj = capAtWordBoundary(String(subject || 'the product'), subjCap);
  let conceptText = concept ? capAtWordBoundary(String(concept), CONCEPT_MAX) : '';
  let refNoteCur = refNote;

  const TAIL_RESERVE = tail.length + 1;
  const trimTail = (str, over) => {
    const cut = str.slice(0, Math.max(0, str.length - over - 1));
    const sp = cut.lastIndexOf(' ');
    return sp > 0 ? cut.slice(0, sp) : cut;
  };
  const overBy = () => (assemble(subj, conceptText, arc, refNoteCur, cameraText, lightText).length + TAIL_RESERVE) - LIMIT;

  // Truncation Priority Order (Requirement 3):
  // 1. Generic style ARC (generic, shared by every page, least critical)
  if (overBy() > 0 && arc) arc = trimTail(arc, overBy());

  // 2. Prose reference clause for non-stylized styles (fidelity is still secured by rendering constraints & rich subject)
  if (overBy() > 0 && refNoteCur && !looseRef) refNoteCur = '';

  // 3. SUBJECT description down to floor (160 characters)
  if (overBy() > 0 && subj.length > subjFloor) {
    const targetLen = Math.max(subjFloor, subj.length - overBy() - 1);
    subj = capAtWordBoundary(subj, targetLen);
  }

  // 4. Stylized transform reference note
  if (overBy() > 0 && refNoteCur) refNoteCur = '';

  // 5. Per-page CONCEPT is trimmed LAST and least, protecting unique per-page storytelling and preventing repetitive panels
  if (overBy() > 0 && conceptText) conceptText = trimTail(conceptText, overBy());

  // 6. Last resort safety fallbacks: trim camera/lighting and subject further
  if (overBy() > 0 && cameraText.length > 50) {
    cameraText = capAtWordBoundary(cameraText, Math.max(50, cameraText.length - overBy() - 1));
  }
  if (overBy() > 0 && subj.length > 50) {
    subj = capAtWordBoundary(subj, Math.max(50, subj.length - overBy() - 1));
  }
  if (overBy() > 0 && conceptText) {
    conceptText = trimTail(conceptText, overBy());
  }

  let body = assemble(subj, conceptText, arc, refNoteCur, cameraText, lightText);
  let res = body + '\n' + tail;
  if (res.length > LIMIT) {
    const { safeClampPrompt } = require('./clamp');
    res = safeClampPrompt(res, LIMIT);
  }
  return res;
}

module.exports = {
  buildMasterPrompt,
  fmtRatio,
  fmtDuration,
  ILLUSTRATION_STYLES,
  isPhotoreal,
  STYLIZED_REF_STYLES,
};
