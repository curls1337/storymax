// LLM master-prompt generator. Turns {subject + style spec + params} into ONE
// Freebeat / Scenario / Magica prompt using the SKILL.md director instructions.
// Returns null on ANY failure so the caller falls back to the deterministic builder
// (masterPrompt.js) — the app never breaks.
const fs = require('fs');
const path = require('path');
const { chatCompletion } = require('./aiClient');
const {
  fmtRatio,
  fmtDuration,
  isPhotoreal,
  STYLIZED_REF_STYLES,
  faceClause,
  buildRenderingConstraints,
} = require('./promptRules');

const SKILL_FILE_PATH = path.join(__dirname, 'skills', 'storyboard-director', 'SKILL.md');
let cachedSkillInstruction = null;

function getSkillInstruction() {
  if (cachedSkillInstruction) return cachedSkillInstruction;
  try {
    if (fs.existsSync(SKILL_FILE_PATH)) {
      cachedSkillInstruction = fs.readFileSync(SKILL_FILE_PATH, 'utf-8');
      return cachedSkillInstruction;
    }
  } catch (e) {}
  return 'You are an expert commercial storyboard director and prompt engineer. Render a strict symmetrical grid of equal rectangular panels with clean borders.';
}

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
      characterName = '', secondsPerPage,
    } = ctx;

    const gc = Number(gridCount) || 6;
    const ratio = fmtRatio(aspectRatio || spec.format, model);
    const cols = (gc === 6 && (ratio === '9:16' || spec.format === '9:16')) ? 2 : (gc === 4 ? 2 : (gc === 8 ? 4 : 3));
    const rows = Math.ceil(gc / cols);

    const photoreal = isPhotoreal(spec.id);
    const stylized = !!hasRefImage && STYLIZED_REF_STYLES.has(spec.id);

    const perPage = Number(secondsPerPage) > 0
      ? Number(secondsPerPage)
      : (pageCount > 1 ? Math.max(1, Math.round(Number(totalDuration || 15) / pageCount)) : Number(totalDuration || 15));
    const winStart = (pageNum - 1) * perPage;
    const winEnd = winStart + perPage;
    const pageDuration = perPage;

    const renderingConstraints = buildRenderingConstraints({
      spec,
      faceMode,
      hasRefImage: !!hasRefImage,
      looseRef: stylized,
      characterDescriptor,
      characterName,
      photoreal,
    });

    const continuityDirective = pageCount > 1
      ? (pageNum === 1
          ? `PART 1/${pageCount} (Scenes ${startScene}-${startScene + gc - 1}) — START of sequence. Set master symmetrical ${cols}x${rows} grid of ${gc} equal panels, neutral background, and clean visual tone.`
          : `PART ${pageNum}/${pageCount} (Scenes ${startScene}-${startScene + gc - 1}) — DIRECT CONTINUATION from Part ${pageNum - 1}. MUST MATCH THE EXACT SAME symmetrical ${cols}x${rows} grid layout, identical panel aspect ratios, identical clean background, and lighting palette of Part 1. Continue the story seamlessly.`)
      : `Single storyboard sheet: strict symmetrical ${cols}x${rows} grid of ${gc} equal panels.`;

    const payload = {
      SUBJECT_DESCRIPTOR: subject,
      CHARACTER_NAME: characterName || null,
      CHARACTER_DESCRIPTOR: characterDescriptor || (characterName ? `human model/creator ${characterName}` : null),
      BRAND_SAFETY_DIRECTIVE: characterName
        ? `CRITICAL: "${characterName}" is the personal name of the HUMAN MODEL / CREATOR, NOT the product brand. Under NO circumstances should "${characterName}" be printed, embossed, or written onto the product packaging, bottle, label, or logo.`
        : null,
      CONCEPT: trimToWordBoundary(concept, 500),
      GRID_GEOMETRY: {
        totalPanels: gc,
        columns: cols,
        rows: rows,
        structureDirective: `Strict symmetrical ${cols}x${rows} grid of ${gc} equal rectangular panels with clean borders and gutters, no overlapping, no varied panel sizes.`,
      },
      CONTINUITY_DIRECTIVE: continuityDirective,
      STYLE_SPEC: {
        name: spec.name,
        header: spec.header,
        background: spec.bg,
        layout: `a strict symmetrical ${cols}x${rows} grid of ${gc} equal numbered rectangular panels on a clean sheet`,
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
        aspectRatio: ratio,
        duration: fmtDuration(pageDuration),
        timeWindow: `${winStart}-${winEnd}s`,
        totalProjectDuration: fmtDuration(totalDuration),
        panelCount: gc,
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

    const systemPrompt = getSkillInstruction();

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: 'Build the storyboard prompt adhering to SKILL.md guidelines from this JSON:\n' + JSON.stringify(payload) },
    ];

    const out = await chatCompletion(messages, { db, temperature: 0.5 });
    if (out && out.length > 80) {
      // strip accidental markdown fences, clamp to provider limit
      const cleaned = out.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '').trim();
      return cleaned.slice(0, 1950);
    }
    return null;
  } catch (e) {
    return null;
  }
}

module.exports = { generateMasterPromptWithAI };
