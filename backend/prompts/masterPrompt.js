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
const ILLUSTRATION_STYLES = new Set(['anime_comic', 'stop_motion', 'tiny_world', 'education_explainer', 'kids_education']);

// Creative "transform" styles where a reference image is only INSPIRATION for the
// subject's identity & colors — the output is re-rendered into the style's own form
// (cube, pod, toy, miniature, jelly, soundstage miniature), NOT a 1:1 copy of the
// reference. Every OTHER style keeps STRICT reference fidelity (exact reproduction).
const STYLIZED_REF_STYLES = new Set([
  'cube_box_transform', 'shape_morph_transform', 'asmr_toy_transform',
  'bts_practical_fx', 'mini_restoration_asmr', 'jelly_character_asmr',
]);

// Shared helper so the LLM generator applies the SAME photo/illustration decision.
function isPhotoreal(styleId) {
  return styleId ? !ILLUSTRATION_STYLES.has(styleId) : true;
}

// Character budgets. Generous caps; the priority-based fitter shrinks the
// least-critical parts first so the total always fits Freebeat's limit.
// Reference-fidelity first: users almost always upload a product photo and need
// the panels to reproduce it EXACTLY, so the identity anchor is kept rich and is
// the LAST thing trimmed — whether or not a reference image is present.
const SUBJECT_MAX = 340;       // rich product descriptor (type, brand/logo text, colors, proportions)
const SUBJECT_FLOOR = 200;     // never trim the identity anchor below this
const CONCEPT_MAX = 450;       // was 200 — the 200 cap cut per-page story mid-sentence
const ARC_MAX = 460;
const NEG_MAX = 380;           // cap the NEGATIVE list; product-integrity negatives are placed first
const LIMIT = 1950;            // stay under Freebeat's 2000 hard cap (builder guarantees total <= LIMIT)

// Word-boundary-safe cap: never cut CONCEPT/SUBJECT mid-word. Used for the
// initial length cap, mirroring trimTail's boundary logic below.
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
    faceMode = spec.faceMode || 'faceless',
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
  } = ctx;

  const gc = Number(gridCount) || 6;
  const endScene = startScene + gc - 1;
  const ratio = fmtRatio(aspectRatio || spec.format, model);
  // Per-page segment length + absolute time window, so a multi-page video reads as
  // one continuous timeline (page 2/4 = 15-30s, etc.). Falls back gracefully when
  // secondsPerPage isn't provided.
  const perPage = Number(secondsPerPage) > 0
    ? Number(secondsPerPage)
    : (pageCount > 1 ? Math.max(1, Math.round(Number(totalDuration || 15) / pageCount)) : Number(totalDuration || 15));
  const winStart = (pageNum - 1) * perPage;
  const winEnd = winStart + perPage;
  const dur = fmtDuration(pageCount > 1 ? perPage : (totalDuration || perPage));
  const windowBadge = pageCount > 1 ? ` 'TIME ${winStart}-${winEnd}s'` : '';
  // Independent-scenes styles (e.g. social lifestyle/IG-TikTok-Shorts): each page is
  // its OWN standalone everyday moment/activity for the SAME character, not a single
  // continuous narrative — so page-to-page continuity/arc-splitting must NOT apply.
  const independentScenes = !!spec.independentScenes;

  // Distribute the style arc across ALL pages so each page shows a DIFFERENT
  // part of the sequence (fixes multi-page repeating the same beats every page).
  // Skipped for independent-scenes styles: every page gets the FULL arc, since each
  // page's own panels progress through that page's own standalone activity.
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
  const fneg = faceNegative(faceMode);

  // Photo styles: force photorealism (defeat the "storyboard = sketch" bias).
  const photoreal = isPhotoreal(spec.id);
  const realNote = photoreal
    ? ' Render every panel as a PHOTOREALISTIC PHOTOGRAPH — real camera, real lighting, sharp focus, lifelike materials — never a sketch, drawing, painting or concept art.'
    : '';
  const antiSketch = photoreal
    ? ['sketch', 'line art', 'pencil or ink drawing', 'concept art', 'cartoon or anime drawing', 'flat clay or low-detail CGI render']
    : [];

  // Creative transform styles: the reference is only inspiration and the subject is
  // deliberately re-formed into the style's shape, so exact 1:1 fidelity must NOT be
  // enforced (that would forbid the transformation). All other styles stay strict.
  const looseRef = hasRefImage && STYLIZED_REF_STYLES.has(spec.id);

  // Reference-fidelity negatives LEAD the list (so they survive the NEG_MAX cap)
  // when editing from a reference image; otherwise keep a light cross-panel one.
  const fidelityNeg = hasRefImage
    ? (looseRef
        ? ['unrecognizable subject or wrong identity/colors vs the reference', "a flat 1:1 photo copy of the reference that ignores this style's form"]
        : ['different or redesigned product', 'altered or generic button shape', 'circular power icon button instead of original button', 'altered or garbled logo/brand text', 'changed colors, shape or proportions', 'inconsistent product features across panels/pages'])
    : ['the main product looking different between panels'];

  // A13: when a saved "Consistent Character" is used, explicitly forbid the
  // character's identity from drifting between pages — this is on top of (not
  // instead of) the CHARACTER anchor line appended near the top of the prompt.
  const characterNeg = characterDescriptor
    ? ["the character's face, gender, ethnicity, hair or body type changing between panels or pages", 'a different, unrelated person appearing in any panel or page']
    : [];

  // Merge + de-dupe every negative source so the tail never repeats phrases, then
  // cap its length. A 500+ char negative list (e.g. cube) would dominate the whole
  // budget; product-integrity + style terms come first, and the strongest no-people
  // / anti-sketch guarantees are ALSO carried by the face clause + realNote.
  // In loose mode, drop any style negative that would forbid re-forming the subject
  // ("redesigned/renamed", "keep the reference exactly", "1:1") — those fight the transform.
  const styleNegs = looseRef
    ? (spec.negatives || []).filter((n) => !/redesign|rename|keep the reference|matches the reference|1:1/i.test(String(n)))
    : (spec.negatives || []);

  let negatives = dedupeList(
    []
      .concat(fidelityNeg)
      .concat(characterNeg)
      .concat(styleNegs)
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
  // Force total layout structural overhaul based on layoutHint.
  // If layoutHint mentions "magazine", "table", or "infographic", enforce that structural geometry.
  const layoutStructure = layout.toLowerCase().includes('magazine')
    ? 'OVERALL STRUCTURE: A high-end MAGAZINE CATALOG layout with large hero images and elegant typography; do NOT use a basic 2x3 grid.'
    : (layout.toLowerCase().includes('table')
        ? 'OVERALL STRUCTURE: A professional PRODUCTION TABLE layout with strict columns for Visual, Duration, and Camera; do NOT use a basic 2x3 grid.'
        : (layout.toLowerCase().includes('infographic') || layout.toLowerCase().includes('playful')
            ? 'OVERALL STRUCTURE: A dynamic PLAYFUL INFOGRAPHIC layout with varied panel sizes, rounded corners, and decorative icons; do NOT use a basic 2x3 grid.'
            : `OVERALL STRUCTURE: ${layout}.`));

  // Strict styles get the full "reproduce exactly" clause here; stylized styles carry
  // their (short, always-present) "re-form" instruction in L1 instead, so refNote stays
  // empty for them and never competes for the trimmable budget.
  const refNote = (hasRefImage && !looseRef)
    ? ' Every panel shows the SAME product as the reference — identical shape, proportions, colors and logo/text (verbatim); never redesign, rename or replace it.'
    : '';
  const CONT = independentScenes
    ? "VISUAL CONTINUITY: Keep the SAME character identity (face, body, style) 100% consistent across all pages. While the setting/activity changes per page, ensure the character's core appearance and personal aesthetic remain identical."
    : "VISUAL CONTINUITY: You MUST keep the EXACT SAME background setting, lighting, character wardrobe, and color palette from the previous page. Every detail must match perfectly to ensure a seamless narrative flow.";
  const pageScope = pageCount > 1
    ? (independentScenes
        ? `IMPORTANT: PAGE ${pageNum}/${pageCount} (scenes ${startScene}-${endScene}) — This is a standalone moment for the SAME character. ${CONT} `
        : (pageNum === 1
            ? `IMPORTANT: PAGE 1/${pageCount} (scenes ${startScene}-${endScene}) — This is the START of the sequence. Establish the setting and character look that MUST be followed in later pages. ${CONT} `
            : `IMPORTANT: PAGE ${pageNum}/${pageCount} (scenes ${startScene}-${endScene}) — This is a DIRECT CONTINUATION from Page ${pageNum - 1}. DO NOT restart the scene. Maintain absolute visual consistency with the established setting and character wardrobe. ${CONT} `))
    : '';

  // A13/A15: CHARACTER identity anchor — separate from the PRODUCT-only SUBJECT
  // line below. Previously nothing in the actual image prompt locked the human
  // character's physical appearance across pages (only the reference image +
  // the AI splitter's per-page text carried it, both of which can drift), so a
  // page could render a completely different-looking person while the product
  // stayed consistent. This clause is placed IMMEDIATELY after the opening line
  // (see L1c below) — as early as possible in the prompt — instead of at the
  // very end, since it is the single highest-priority identity signal and
  // image-generation models tend to weight earlier instructions more heavily.
  // This matters most for independent-scenes styles (e.g. "Konten Sosial"),
  // which deliberately vary wardrobe/setting/activity a lot page to page. Kept
  // out of the fitter (never trimmed) so it survives on every page regardless
  // of character-budget pressure.
  const characterClause = characterDescriptor
    ? `CHARACTER (SAME physical identity in EVERY panel & page — face, gender, ethnicity, hair color/style and body type must NEVER change; only wardrobe, setting & activity may vary): ${characterDescriptor}.`
    : '';

  // Protected tail: the FOOTER, the face-mode clause, and the NEGATIVE line
  // must ALWAYS survive — they carry shooting notes, enforce faceless/chin-crop,
  // and block glow/robot/garbled text. Held out of the fitter and appended last.
  const tail = `FOOTER: a slim 'PRODUCTION NOTES' bar (camera, FPS, lighting, audio).
${face}
NEGATIVE: ${negatives}.`;

  // ── Fixed structural lines (content is fixed; always present) ──
  const L1 = `A professional ${spec.name} storyboard sheet — ONE printed poster, ${ratio} layout, ${bgClause(spec.bg)}.${realNote}${layoutStructure}${looseRef ? " The reference is ONLY inspiration — re-form the subject into THIS style's own shape (recognizable, same colors), do NOT copy it 1:1." : ''}`;
  // A15: CHARACTER identity anchor placed immediately after the opening line —
  // as early as possible in the prompt (empty string when no character, so it
  // is dropped by the assemble()'s filter(Boolean) below).
  const L1c = characterClause;
  const L2 = `HEADER: banner '${spec.header}${partLabel}' + product name + badges 'DURATION ${dur}'${windowBadge} 'SCENES ${gc}' 'RATIO ${ratio}'.`;
  // Opt-in ON-SCREEN TEXT: when enabled, each panel also carries ONE short punchy
  // caption/callout drawn INTO the scene (comic/kinetic social-video style), with the
  // font, color & placement VARIED per panel to fit the mood & this layout's vibe.
  // Kept short (1–4 words) so the image model renders it cleanly (no garble).
  const textClause = textOnScreen
    ? " ALSO burn ONE stylized ON-SCREEN TEXT element into each panel — choose between a clean feature callout badge, a floating sticker caption bubble, or bold kinetic social lettering (e.g. 'Lembut macam awan', 'Praktis & Hemat Tempat', 'Ujung Runcing Menjangkau Sudut') rendered with crisp high-contrast outlines, soft drop shadows, and varied sticker shapes per panel to act as clear product feature explanations, perfectly spelled."
    : '';
  // Opt-in VOICE OVER note: when the storyboard has VO on, print a small 'VO' cue under
  // each panel (a SHORT one-line narration cue in the VO language) so the storyboard itself
  // carries the voice-over instruction. Kept short so the image model renders it cleanly.
  const voClause = voiceOver
    ? ` Also print a small 'Voiceover:' note under each panel — a VERY SHORT 2-4 word voice-over cue for that scene in ${voLanguage} (super concise, 2-4 plain words, NO quotes, NO symbols like 'x', e.g. 'Langkah awal', 'Kualitas terbaik', 'Dapatkan sekarang').`
    : '';
  const L4 = `Layout: ${layout}, numbered SCENE ${startScene}–${endScene}; each panel: a short SCENE TITLE, one-line action, tiny 'CAM'/'LIGHT' tags + a duration chip. Keep on-sheet text short & correctly spelled; vary the camera per scene; keep card layout, palette & background identical.${textClause}${voClause}`;
  const L5 = `Base camera: ${spec.camera}; light: ${spec.lighting}.`;

  // ── Variable lines (content shrinks to fit) ──
  const subjLine = (s, rn) => `SUBJECT (${looseRef ? 'kept recognizable & consistent across panels' : 'identical in every panel'}): ${s}.${rn}`;
  const scenesLine = (ct, ar) => {
    if (ct) {
      const prog = ar ? `progressing across the panels as: ${ar}` : 'progressing sequentially across the numbered panels';
      return `${pageScope}SCENES on this page — based on: "${ct}" — ${prog}.`;
    }
    const prog = ar ? `progress across the panels as: ${ar}` : 'progress sequentially across the numbered panels';
    return `${pageScope}SCENES ${prog}.`;
  };

  const assemble = (s, ct, ar, rn) => [L1, L1c, L2, subjLine(s, rn), L4, L5, scenesLine(ct, ar)].filter(Boolean).join('\n');

  const subjCap = SUBJECT_MAX;
  const subjFloor = SUBJECT_FLOOR;
  // Word-boundary-safe initial caps (previously a raw .slice() could cut the
  // subject descriptor or per-page concept mid-word).
  let subj = capAtWordBoundary(String(subject || 'the product'), subjCap);
  let conceptText = concept ? capAtWordBoundary(String(concept), CONCEPT_MAX) : '';
  let refNoteCur = refNote;

  const TAIL_RESERVE = tail.length + 1;
  const trimTail = (str, over) => {
    const cut = str.slice(0, Math.max(0, str.length - over - 1));
    const sp = cut.lastIndexOf(' ');
    return sp > 0 ? cut.slice(0, sp) : cut;
  };
  const overBy = () => (assemble(subj, conceptText, arc, refNoteCur).length + TAIL_RESERVE) - LIMIT;

  // Sacrifice order (least → most important to keep): style ARC (generic, shared
  // by every page) → per-page CONCEPT (carries the actual page-specific story AND
  // the handoff/continuity cue — this is what makes page 2+ look like a sequel
  // instead of a repeat, so it is now trimmed AFTER the arc, not before) → the
  // prose reference clause (fidelity is STILL enforced by the leading NEGATIVE
  // terms + the rich SUBJECT) → SUBJECT down to its floor. Every structural line —
  // including SCENES and camera — ALWAYS stays present; we never slice a whole line.
  if (overBy() > 0 && arc) arc = trimTail(arc, overBy());
  if (overBy() > 0 && conceptText) conceptText = trimTail(conceptText, overBy());
  // Strict styles: drop the (long) reference clause here — fidelity is still carried
  // by the leading NEGATIVE terms + the rich SUBJECT. Stylized styles KEEP their short
  // "re-form" note as long as possible (it is the core instruction), dropping it only
  // as a later resort below.
  if (overBy() > 0 && refNoteCur && !looseRef) refNoteCur = '';
  if (overBy() > 0 && subj.length > subjFloor) {
    subj = subj.slice(0, Math.max(subjFloor, subj.length - overBy() - 1));
  }
  // Stylized styles: only now, if still over, drop the re-form note.
  if (overBy() > 0 && refNoteCur) refNoteCur = '';
  // Last resort for pathologically heavy styles: shrink the subject below its floor
  // rather than EVER dropping a structural line.
  if (overBy() > 0) subj = subj.slice(0, Math.max(0, subj.length - overBy() - 1));

  let body = assemble(subj, conceptText, arc, refNoteCur);
  // Final guard (should not trigger in practice): clamp the BODY only — the tail
  // (face clause + NEGATIVE) is sacred and always appended in full.
  const room = LIMIT - TAIL_RESERVE;
  if (body.length > room) body = trimTail(body, body.length - room);
  return body + '\n' + tail;
}

module.exports = { buildMasterPrompt, fmtRatio, fmtDuration, ILLUSTRATION_STYLES, isPhotoreal, STYLIZED_REF_STYLES };
