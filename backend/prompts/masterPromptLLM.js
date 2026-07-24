// LLM master-prompt generator. Turns {subject + style spec + params} into ONE
// Freebeat prompt. Returns null on ANY failure so the caller falls back to the
// deterministic builder (masterPrompt.js) — the app never breaks.
const { chatCompletion } = require('./aiClient');
const { faceClause, faceNegative } = require('./faceMode');
const { fmtRatio, fmtDuration, isPhotoreal } = require('./masterPrompt');

const SYSTEM = `You are an expert commercial storyboard prompt engineer for the Freebeat GPT-Image model.
Produce ONE image-generation prompt that renders a SINGLE professional storyboard SHEET: one printed poster with numbered scene panels in a grid.
RULES:
1. RENDER MODE — render EVERY panel exactly as PARAMS.renderMode. If photorealistic, forbid sketch, line art, drawing, painting and cartoon/CGI looks; if illustrated, commit fully to that named style.
2. PRODUCT FIDELITY (highest priority) — repeat the SUBJECT_DESCRIPTOR almost verbatim in every panel; it is the identity anchor. Keep the product's shape, proportions, colors, materials and its logo/text IDENTICAL and correctly spelled across every panel; never rename, restyle, redesign, replace or add/remove features. If PARAMS.hasReferenceImage is true, state this is an image-edit and every panel must reproduce the product EXACTLY as in the attached reference.
3. ONE global camera grammar from STYLE_SPEC.camera; keep background, palette & lighting identical across panels and vary only the shot per scene.
4. Number every scene starting at PARAMS.sceneStart and give each a short timecode derived from PARAMS.duration / PARAMS.panelCount. Use PARAMS.duration and PARAMS.aspectRatio verbatim; never invent other durations or ratios.
5. Progress the panels along STYLE_SPEC.arc and this page's CONCEPT. If PARAMS.totalPages > 1, CONTINUE the sequence for THIS page only (page 1 = the beginning; later pages continue and must NOT restart the opening).
6. Include a compact header banner + badges (from STYLE_SPEC.header) and tiny per-panel tags (CAM, LIGHT + a duration chip). Keep ALL on-sheet text short, minimal and correctly spelled — no paragraphs inside panels, no garbled text.
7. Apply FACE_RULE exactly, and end with ONE line starting "NEGATIVE:" built from STYLE_SPEC.negatives + FACE_NEGATIVE + "garbled text" (and, when PARAMS.hasReferenceImage is true, also lead the NEGATIVE with "different or redesigned product, altered or garbled logo, changed colors, shape or proportions").
8. Keep the ENTIRE prompt under 1900 characters. Output ONLY the final prompt text — no explanation, no markdown fences.`;

async function generateMasterPromptWithAI(spec, ctx, db) {
  try {
    const {
      subject = 'the product', concept = '', faceMode = spec.faceMode || 'faceless',
      gridCount = 6, startScene = 1, totalDuration = 15, aspectRatio, model,
      pageNum = 1, pageCount = 1, hasRefImage = false,
    } = ctx;

    const photoreal = isPhotoreal(spec.id);

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
        negatives: spec.negatives,
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
