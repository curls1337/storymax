// LLM master-prompt generator. Turns {subject + style spec + params} into ONE
// Freebeat prompt. Returns null on ANY failure so the caller falls back to the
// deterministic builder (masterPrompt.js) — the app never breaks.
const { chatCompletion } = require('./aiClient');
const { faceClause, faceNegative } = require('./faceMode');
const { fmtRatio, fmtDuration, isPhotoreal, STYLIZED_REF_STYLES } = require('./masterPrompt');

const SYSTEM = `You are an expert commercial storyboard prompt engineer for the Freebeat GPT-Image model.
Produce ONE image-generation prompt that renders a SINGLE professional storyboard SHEET: one printed poster with numbered scene panels in a grid.
RULES:
1. RENDER MODE — render EVERY panel exactly as PARAMS.renderMode. If photorealistic, forbid sketch, line art, drawing, painting and cartoon/CGI looks; if illustrated, commit fully to that named style.
2. SUBJECT FIDELITY (highest priority) — repeat the SUBJECT_DESCRIPTOR almost verbatim in every panel; it is the identity anchor; keep it correctly spelled and consistent across every panel. Reference handling: (a) if PARAMS.hasReferenceImage is true AND PARAMS.stylizedReference is FALSE, this is an image-edit — every panel must reproduce the product EXACTLY as in the attached reference (same shape, proportions, colors, materials, logo/text); never rename, restyle, redesign, replace or add/remove features. (b) if PARAMS.stylizedReference is TRUE, use the reference ONLY as inspiration for the subject's identity and colors — do NOT copy it 1:1; re-render the subject TRANSFORMED into STYLE_SPEC's own form (cube/box, pod, toy, miniature, jelly, soundstage miniature), clearly recognizable with the same color identity but obviously stylized, never a photo-exact replica.
3. ONE global camera grammar from STYLE_SPEC.camera; keep background, palette & lighting identical across panels and vary only the shot per scene.
4. Number every scene starting at PARAMS.sceneStart and give each a short timecode derived from PARAMS.duration / PARAMS.panelCount. Use PARAMS.duration and PARAMS.aspectRatio verbatim; never invent other durations or ratios.
5. Progress the panels along STYLE_SPEC.arc and this page's CONCEPT. If PARAMS.totalPages > 1, CONTINUE the sequence for THIS page only (page 1 = the beginning; later pages continue and must NOT restart the opening).
6. Include a compact header banner + badges (from STYLE_SPEC.header) and tiny per-panel tags (CAM, LIGHT + a duration chip). Keep ALL on-sheet text short, minimal and correctly spelled — no paragraphs inside panels, no garbled text.
6b. TEXT ON SCREEN — if PARAMS.textOnScreen is TRUE, ALSO burn ONE punchy on-screen caption INTO each panel (a few words up to a short 1–2 line phrase, in the subject's language, e.g. "Upgrade ke Novilla", "3 SAIZ · KEDAP", "Lagi Flash Sale!", "WOW!") as BOLD high-contrast social-video lettering with a clean outline/shadow — VARY the font, color, accent word and placement per panel to fit the mood and this style, always correctly spelled (like viral TikTok captions). If PARAMS.textOnScreen is FALSE, do NOT add any decorative captions.
7. Apply FACE_RULE exactly, and end with ONE line starting "NEGATIVE:" built from STYLE_SPEC.negatives + FACE_NEGATIVE + "garbled text". When PARAMS.hasReferenceImage is true AND PARAMS.stylizedReference is FALSE, also lead the NEGATIVE with "different or redesigned product, altered or garbled logo, changed colors, shape or proportions". When PARAMS.stylizedReference is TRUE, do NOT add those exact-copy negatives (they forbid the intended transformation) — instead lead with "unrecognizable subject, wrong identity or colors vs the reference, a flat 1:1 copy that ignores the style's form".
8. Keep the ENTIRE prompt under 1900 characters. Output ONLY the final prompt text — no explanation, no markdown fences.`;

async function generateMasterPromptWithAI(spec, ctx, db) {
  try {
    const {
      subject = 'the product', concept = '', faceMode = spec.faceMode || 'faceless',
      gridCount = 6, startScene = 1, totalDuration = 15, aspectRatio, model,
      pageNum = 1, pageCount = 1, hasRefImage = false, textOnScreen = false,
    } = ctx;

    const photoreal = isPhotoreal(spec.id);
    // Creative transform styles use the reference only as inspiration (see masterPrompt.js).
    const stylized = !!hasRefImage && STYLIZED_REF_STYLES.has(spec.id);

    const payload = {
      SUBJECT_DESCRIPTOR: subject,
      CONCEPT: String(concept || '').slice(0, 500),
      STYLE_SPEC: {
        name: spec.name,
        header: spec.header,
        background: spec.bg,
        layout: (spec.layoutHint || 'a grid of {N} numbered panels on one sheet').replace('{N}', String(gridCount)),
        camera: spec.camera,
        lighting: spec.lighting,
        arc: spec.arc,
        negatives: stylized
          ? (spec.negatives || []).filter((n) => !/redesign|rename|keep the reference|matches the reference|1:1/i.test(String(n)))
          : spec.negatives,
      },
      FACE_RULE: faceClause(faceMode),
      FACE_NEGATIVE: faceNegative(faceMode),
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
        textOnScreen: !!textOnScreen,
      },
    };

    const messages = [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: 'Build the storyboard prompt from this JSON:\n' + JSON.stringify(payload) },
    ];

    const out = await chatCompletion(messages, { db, temperature: 0.7 });
    if (out && out.length > 80) {
      // strip accidental markdown fences, clamp to Freebeat limit
      const cleaned = out.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '').trim();
      return cleaned.slice(0, 1950);
    }
    return null;
  } catch (e) {
    return null;
  }
}

module.exports = { generateMasterPromptWithAI };
