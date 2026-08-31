// LLM master-prompt generator. Turns {subject + style spec + params} into ONE
// Freebeat / Scenario prompt. Returns null on ANY failure so the caller falls back to the
// deterministic builder (masterPrompt.js) — the app never breaks.
const { chatCompletion } = require('./aiClient');
const {
  fmtRatio,
  fmtDuration,
  isPhotoreal,
  STYLIZED_REF_STYLES,
  faceClause,
  buildRenderingConstraints,
} = require('./promptRules');

const SYSTEM = `You are an expert commercial storyboard prompt engineer for modern image generation models (Freebeat, Scenario, GPT Image 2).
Produce ONE image-generation prompt that renders a SINGLE professional storyboard SHEET: one printed poster with numbered scene panels in a grid.
RULES:
1. RENDER MODE — render EVERY panel exactly as PARAMS.renderMode. If photorealistic, state real photography with sharp optical focus and realistic materials (no sketch, drawing, painting or cartoon/CGI looks); if illustrated, commit fully to that named art style.
2. SUBJECT FIDELITY & MULTI-PAGE ANCHORING (highest priority) — EVERY page (Page 1, Page 2, Page 3, Page 4) MUST maintain 100% identical physical product features verbatim from SUBJECT_DESCRIPTOR: same button shape, same lid design, same base proportions, same branding/logo. NEVER alter, redesign, replace, or simplify ANY product detail between pages. Reference handling: (a) if PARAMS.hasReferenceImage is true AND PARAMS.stylizedReference is FALSE, this is an image-edit — every panel must reproduce the product EXACTLY as in the attached reference (same shape, proportions, colors, materials, logo/text); never rename, restyle, redesign, replace or add/remove features. (b) if PARAMS.stylizedReference is TRUE, use the reference ONLY as inspiration for the subject's identity and colors — do NOT copy it 1:1; re-render the subject TRANSFORMED into STYLE_SPEC's own form (cube/box, pod, toy, miniature, jelly, soundstage miniature), clearly recognizable with the same color identity but obviously stylized, never a photo-exact replica.
2b. CHARACTER IDENTITY ANCHOR — if CHARACTER_DESCRIPTOR is provided (non-null), that ONE human character's physical identity (gender, approximate age, ethnicity/skin tone, hair color/length/style, face shape, body type) MUST stay 100% IDENTICAL in EVERY panel on EVERY page, verbatim from CHARACTER_DESCRIPTOR. Only wardrobe, setting and activity may change per page to match that page's own CONCEPT. NEVER swap in a different-looking person between panels or pages. Place this CHARACTER identity description as its OWN short line IMMEDIATELY after the opening sheet/style description sentence — before the SUBJECT/product description — so it appears as early as possible in the final prompt text.
3. ONE global camera grammar from STYLE_SPEC.camera; keep background, palette & lighting identical across panels and vary only the shot per scene.
4. Number every scene starting at PARAMS.sceneStart and give each a short timecode derived from PARAMS.duration / PARAMS.panelCount. Use PARAMS.duration and PARAMS.aspectRatio verbatim; never invent other durations or ratios.
5. VISUAL CONTINUITY & PROGRESSION — Progress the panels along STYLE_SPEC.arc and this page's CONCEPT. If PARAMS.totalPages > 1: when PARAMS.independentScenes is FALSE, this page is a DIRECT CONTINUATION of the sequence. You MUST maintain absolute consistency in background setting, lighting, and character wardrobe from previous pages — DO NOT restart or change the environment. When PARAMS.independentScenes is TRUE, each page is a standalone moment, but the character's core identity, face, and personal aesthetic must remain 100% identical across all pages.
6. OVERALL STRUCTURE — You MUST follow STYLE_SPEC.layoutHint to define the sheet's geometry. If it mentions "magazine", use a high-end catalog layout with varied large hero images; if "table", use a strict professional production table with columns; if "infographic" or "playful", use a dynamic layout with varied panel sizes and decorative icons. DO NOT default to a basic 2x3 grid. Include a compact header banner + badges (from STYLE_SPEC.header) and tiny per-panel tags (CAM, LIGHT + a duration chip). Keep ALL on-sheet text short, minimal and correctly spelled — no paragraphs inside panels, no garbled text.
6b. TEXT ON SCREEN — if PARAMS.textOnScreen is TRUE, ALSO burn ONE stylized ON-SCREEN TEXT element into each panel (choose between a clean feature callout badge, a floating sticker caption bubble, or bold kinetic social lettering acting as a feature explanation, e.g. "Lembut macam awan", "Praktis & Hemat Tempat", "Ujung Runcing Menjangkau Sudut") with crisp high-contrast outlines and soft drop shadows, always correctly spelled. If PARAMS.textOnScreen is FALSE, do NOT add any decorative captions.
6c. VOICE OVER NOTE — if PARAMS.voiceOver is TRUE, print a small "Voiceover:" note under EACH panel with a VERY SHORT 2–4 word voice-over cue for that scene in PARAMS.voLanguage (super concise, 2-4 plain words, NO quotes, NO symbols like 'x' — e.g. "Solusi terbaik", "Praktis setiap hari", "Dapatkan sekarang"). If FALSE, do NOT add any VO note.
7. RENDERING QUALITY & CONSTRAINTS (NO 'NEGATIVE:' KEYWORD) — Do NOT write a literal "NEGATIVE:" tag or negative-prompt line anywhere in the output. Instead, conclude with ONE clear sentence starting "RENDERING QUALITY & CONSTRAINTS:" that weaves all quality and restriction directives into natural positive sentences (following RENDERING_CONSTRAINTS_DIRECTIVE): strictly forbid sketch/drawing/CGI looks (if photoreal), enforce exact FACE_RULE, forbid garbled text inside panels, and (if hasReferenceImage is true and not stylized) enforce 100% physical product fidelity without alterations. When CHARACTER_DESCRIPTOR is provided, ensure character identity never drifts.
8. Keep the ENTIRE prompt under 1900 characters. Output ONLY the final prompt text — no explanation, no markdown fences.`;

// Word-boundary-safe trim
function trimToWordBoundary(str, maxLen) {
  const s = String(str || '');
  if (s.length <= maxLen) return s;
  const cut = s.slice(0, maxLen);
  const sp = cut.lastIndexOf(' ');
  return sp > maxLen - 120 ? cut.slice(0, sp) : cut;
}

async function generateMasterPromptWithAI(spec, ctx, db) {
  try {
    const {
      subject = 'the product', concept = '', faceMode = spec.faceMode || 'full',
      gridCount = 6, startScene = 1, totalDuration = 15, aspectRatio, model,
      pageNum = 1, pageCount = 1, hasRefImage = false, textOnScreen = false,
      voiceOver = false, voLanguage = 'Bahasa Indonesia', characterDescriptor = '',
    } = ctx;

    const photoreal = isPhotoreal(spec.id);
    const stylized = !!hasRefImage && STYLIZED_REF_STYLES.has(spec.id);

    const renderingConstraints = buildRenderingConstraints({
      spec,
      faceMode,
      hasRefImage: !!hasRefImage,
      looseRef: stylized,
      characterDescriptor,
      photoreal,
    });

    const payload = {
      SUBJECT_DESCRIPTOR: subject,
      CHARACTER_DESCRIPTOR: characterDescriptor || null,
      CONCEPT: trimToWordBoundary(concept, 500),
      STYLE_SPEC: {
        name: spec.name,
        header: spec.header,
        background: spec.bg,
        layout: (spec.layoutHint || 'a grid of {N} numbered panels on one sheet').replace('{N}', String(gridCount)),
        camera: spec.camera,
        lighting: spec.lighting,
        arc: spec.arc,
      },
      FACE_RULE: faceClause(faceMode),
      RENDERING_CONSTRAINTS_DIRECTIVE: renderingConstraints,
      PARAMS: {
        renderMode: photoreal
          ? 'a PHOTOREALISTIC photograph (real camera, real lighting, sharp focus, lifelike materials; NOT a sketch, drawing, painting or CGI-cartoon)'
          : `a stylized ${spec.name} illustration, fully committed to that art style`,
        aspectRatio: fmtRatio(aspectRatio || spec.format, model),
        duration: fmtDuration(totalDuration),
        panelCount: gridCount,
        sceneStart: startScene,
        page: pageNum,
        totalPages: pageCount,
        hasReferenceImage: !!hasRefImage,
        stylizedReference: stylized,
        independentScenes: !!spec.independentScenes,
        textOnScreen: !!textOnScreen,
        voiceOver: !!voiceOver,
        voLanguage,
      },
    };

    const messages = [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: 'Build the storyboard prompt from this JSON:\n' + JSON.stringify(payload) },
    ];

    const out = await chatCompletion(messages, { db, temperature: 0.7 });
    if (out && out.length > 80) {
      // strip accidental markdown fences, clamp to Freebeat / Scenario limit
      const cleaned = out.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '').trim();
      return cleaned.slice(0, 1950);
    }
    return null;
  } catch (e) {
    return null;
  }
}

module.exports = { generateMasterPromptWithAI };
