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
2. SUBJECT FIDELITY & MULTI-PAGE ANCHORING (highest priority) — EVERY page (Page 1, Page 2, Page 3, Page 4) MUST maintain 100% identical physical product features verbatim from SUBJECT_DESCRIPTOR: same button shape (e.g. square illuminated START/STOP LED button vs round power icon), same lid design, same base proportions, same branding/logo. NEVER alter, redesign, replace, or simplify ANY product detail between pages. Reference handling: (a) if PARAMS.hasReferenceImage is true AND PARAMS.stylizedReference is FALSE, this is an image-edit — every panel must reproduce the product EXACTLY as in the attached reference (same shape, proportions, colors, materials, logo/text); never rename, restyle, redesign, replace or add/remove features. (b) if PARAMS.stylizedReference is TRUE, use the reference ONLY as inspiration for the subject's identity and colors — do NOT copy it 1:1; re-render the subject TRANSFORMED into STYLE_SPEC's own form (cube/box, pod, toy, miniature, jelly, soundstage miniature), clearly recognizable with the same color identity but obviously stylized, never a photo-exact replica.
2b. CHARACTER IDENTITY ANCHOR — if CHARACTER_DESCRIPTOR is provided (non-null), that ONE human character's physical identity (gender, approximate age, ethnicity/skin tone, hair color/length/style, face shape, body type) MUST stay 100% IDENTICAL in EVERY panel on EVERY page, verbatim from CHARACTER_DESCRIPTOR. Only wardrobe, setting and activity may change per page to match that page's own CONCEPT. NEVER swap in a different-looking person between panels or pages. Place this CHARACTER identity description as its OWN short line IMMEDIATELY after the opening sheet/style description sentence — before the SUBJECT/product description — so it appears as early as possible in the final prompt text (earlier instructions get more weight from the image model); this placement matters most when PARAMS.independentScenes is TRUE, since each page's setting/wardrobe/activity is intentionally very different.
3. ONE global camera grammar from STYLE_SPEC.camera; keep background, palette & lighting identical across panels and vary only the shot per scene.
4. Number every scene starting at PARAMS.sceneStart and give each a short timecode derived from PARAMS.duration / PARAMS.panelCount. Use PARAMS.duration and PARAMS.aspectRatio verbatim; never invent other durations or ratios.
5. Progress the panels along STYLE_SPEC.arc and this page's CONCEPT. If PARAMS.totalPages > 1: when PARAMS.independentScenes is FALSE, CONTINUE the sequence for THIS page only (page 1 = the beginning; later pages continue and must NOT restart the opening). When PARAMS.independentScenes is TRUE, treat EACH page as its OWN separate everyday moment/activity for the SAME character/subject — do NOT force this page to continue the action from another page; only the character's identity/appearance must stay identical across pages, while setting, wardrobe and activity may differ per page to match that page's own CONCEPT.
6. Include a compact header banner + badges (from STYLE_SPEC.header) and tiny per-panel tags (CAM, LIGHT + a duration chip). Keep ALL on-sheet text short, minimal and correctly spelled — no paragraphs inside panels, no garbled text.
6b. TEXT ON SCREEN — if PARAMS.textOnScreen is TRUE, ALSO burn ONE stylized ON-SCREEN TEXT element into each panel (choose between a clean feature callout badge, a floating sticker caption bubble, or bold kinetic social lettering acting as a feature explanation, e.g. "Lembut macam awan", "Praktis & Hemat Tempat", "Ujung Runcing Menjangkau Sudut") with crisp high-contrast outlines and soft drop shadows, always correctly spelled. If PARAMS.textOnScreen is FALSE, do NOT add any decorative captions.
6c. VOICE OVER NOTE — if PARAMS.voiceOver is TRUE, print a small "Voiceover:" note under EACH panel with a VERY SHORT 2–4 word voice-over cue for that scene in PARAMS.voLanguage (super concise, 2-4 plain words, NO quotes, NO symbols like 'x' — e.g. "Solusi terbaik", "Praktis setiap hari", "Dapatkan sekarang"). If FALSE, do NOT add any VO note.
7. Apply FACE_RULE exactly, and end with ONE line starting "NEGATIVE:" built from STYLE_SPEC.negatives + FACE_NEGATIVE + "garbled text". When PARAMS.hasReferenceImage is true AND PARAMS.stylizedReference is FALSE, also lead the NEGATIVE with "different or redesigned product, altered or generic button shape, circular power button icon instead of original button, altered or garbled logo, changed colors, shape or proportions, inconsistent product features across pages". When PARAMS.stylizedReference is TRUE, do NOT add those exact-copy negatives (they forbid the intended transformation) — instead lead with "unrecognizable subject, wrong identity or colors vs the reference, a flat 1:1 copy that ignores the style's form". When CHARACTER_DESCRIPTOR is provided, ALSO add "the character's face, gender, ethnicity or body type changing between panels or pages" and "a different, unrelated person appearing in any panel" to the NEGATIVE line.
8. Keep the ENTIRE prompt under 1900 characters. Output ONLY the final prompt text — no explanation, no markdown fences.`;

// Word-boundary-safe trim: never cut the CONCEPT text mid-word/mid-sentence,
// which previously risked mangling the trailing continuity/handoff clause
// that the splitter appends (e.g. "...lanjut dari akhir Bagian 1" -> cut to
// "...lanjut dari akhir Bagi"). Falls back to a hard cut only if there is no
// reasonable space to break on near the limit.
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
      subject = 'the product', concept = '', faceMode = spec.faceMode || 'faceless',
      gridCount = 6, startScene = 1, totalDuration = 15, aspectRatio, model,
      pageNum = 1, pageCount = 1, hasRefImage = false, textOnScreen = false,
      voiceOver = false, voLanguage = 'Bahasa Indonesia', characterDescriptor = '',
    } = ctx;

    const photoreal = isPhotoreal(spec.id);
    // Creative transform styles use the reference only as inspiration (see masterPrompt.js).
    const stylized = !!hasRefImage && STYLIZED_REF_STYLES.has(spec.id);

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
