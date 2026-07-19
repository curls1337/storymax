const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const { getDb } = require('../db');
const { scrapeTokopedia } = require('../lib/scrapers/tokopedia');
const { uploadsDir } = require('../config');

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

// In-memory active tasks logs storage
const activeTasks = {};

async function saveTaskState(db, storyboardId, taskState) {
  try {
    await db.run(
      'UPDATE storyboards SET active_task_data = ? WHERE id = ?',
      [JSON.stringify(taskState), storyboardId]
    );
  } catch (err) {
    console.error('Failed to save task state to DB:', err);
  }
}

async function checkAndDisableKeyIfOutofCredits(db, apiKeyId, errorText, taskObj) {
  if (!apiKeyId || !errorText) return;
  const lowerErr = errorText.toLowerCase();
  if (lowerErr.includes('credit') || lowerErr.includes('balance') || lowerErr.includes('insufficient') || lowerErr.includes('limit') || lowerErr.includes('depleted') || lowerErr.includes('payment') || lowerErr.includes('out of')) {
    console.log(`[Auto-Disable API Key] Key ID ${apiKeyId} is out of credits. Disabling key.`);
    try {
      await db.run('UPDATE api_keys SET is_active = 0 WHERE id = ?', [apiKeyId]);
      if (taskObj && taskObj.logs !== undefined) {
        taskObj.logs += `\n[SYSTEM] API Key ID ${apiKeyId} telah dinonaktifkan secara otomatis karena kehabisan/kurang kredit.\n`;
      }
    } catch (e) {
      console.error('Failed to auto-disable API key:', e);
    }
  }
}

function getGridLayoutDescription(gridCount, startScene = 1) {
  const endScene = startScene + gridCount - 1;
  if (gridCount === 4) return `2x2 grid of 4 numbered scenes (SCENE ${startScene} to SCENE ${endScene})`;
  if (gridCount === 6) return `3x2 grid of 6 numbered scenes (SCENE ${startScene} to SCENE ${endScene})`;
  if (gridCount === 8) return `4x2 grid of 8 numbered scenes (SCENE ${startScene} to SCENE ${endScene})`;
  if (gridCount === 9) return `3x3 grid of 9 numbered scenes (SCENE ${startScene} to SCENE ${endScene})`;
  if (gridCount === 12) return `4x3 grid of 12 numbered scenes (SCENE ${startScene} to SCENE ${endScene})`;
  return `grid of ${gridCount} numbered scenes (SCENE ${startScene} to SCENE ${endScene})`;
}

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function getInitialContainerDescription(finalPromptText, selectedShape = 'auto') {
  const promptLower = (finalPromptText || '').toLowerCase();
  
  let shapeKey = selectedShape;
  if (shapeKey === 'auto' || !shapeKey) {
    if (/\b(motor|bike|motorcycle|beat|vespa|xmax|nmax|scoopy|aerox|ninja|harley|ducati)\b/i.test(promptLower)) {
      shapeKey = 'rectangular_block';
    } else if (/\b(gedung|rumah|building|house|villa|office|apartment|hotel|arsitektur|architecture|room)\b/i.test(promptLower)) {
      shapeKey = 'cube';
    } else if (/\b(mobil|car|sedan|suv|civic|bmw|porsche|tesla|toyota|honda|ferrari|lamborghini)\b/i.test(promptLower)) {
      shapeKey = 'low_profile_box';
    } else {
      shapeKey = 'cylindrical_capsule';
    }
  }

  if (shapeKey === 'rectangular_block') {
    return {
      shapeEn: "a compact, sleek high-tech metallic container block (rectangular-shaped with rounded corners)",
      shapeId: "kotak balok ramping dengan sudut melengkung",
      unfoldingActionEn: "the rectangular container block starts opening its plates"
    };
  }
  if (shapeKey === 'cube') {
    return {
      shapeEn: "a solid geometric metallic cube pod",
      shapeId: "kotak kubus geometris kokoh",
      unfoldingActionEn: "the geometric cube starts unfolding its structural plates"
    };
  }
  if (shapeKey === 'low_profile_box') {
    return {
      shapeEn: "an aerodynamic, low-profile rectangular metallic capsule box",
      shapeId: "kotak kapsul ceper dengan sudut aerodinamis",
      unfoldingActionEn: "the low-profile rectangular box starts unlocking its panels"
    };
  }
  if (shapeKey === 'sphere') {
    return {
      shapeEn: "a futuristic high-tech metallic spherical pod",
      shapeId: "kubah bola bulat metalik futuristik",
      unfoldingActionEn: "the spherical pod starts opening its mechanical seams"
    };
  }
  
  // default cylindrical_capsule
  return {
    shapeEn: "a high-tech metallic capsule toy pod",
    shapeId: "kapsul mainan metalik silinder",
    unfoldingActionEn: "the capsule pod starts opening its seams"
  };
}

function getTransformationSteps(gridCount, startScene, finalPromptText, style, selectedShape = 'auto') {
  const isToss = style === 'capsule_toss_transform';
  const steps = [];

  const container = getInitialContainerDescription(finalPromptText, selectedShape);

  const staticCameraClause = "The camera is completely static and stationary, locked on a stable tripod. Absolutely no camera movement, no pans, no zoom, and no rotations. The camera remains 100% still, capturing from a three-quarter perspective angle to show the object's 3D depth and shadows. The white tabletop and background remain completely solid and unaffected.";
  const finalCameraClause = "Close-up shot of the finished product, showing the detailed paint finish, branding, and intricate mechanical joints in crisp detail.";
  const backgroundClause = "The white tabletop and background remain completely solid, static, and unaffected. Soft 3D ambient occlusion shadows are cast beneath the object onto the table surface.";

  if (gridCount <= 4) {
    steps.push(`- Panel ${startScene}: Close-up of a hand holding ${container.shapeEn} custom-designed with colors and branding elements of ${finalPromptText}.`);
    steps.push(`- Panel ${startScene+1}: A thumb presses the activation button on the container in the hand ${isToss ? 'and tosses it gently onto a white desk' : 'and places it on a white desk'}.`);
    steps.push(`- Panel ${startScene+2}: The container lands on the desk, slides to a stop. First phase of transformation: mechanical legs fold out from the bottom to lift it up, followed by torso expansion. ${staticCameraClause} ${backgroundClause}`);
    steps.push(`- Panel ${startScene+3}: The transformation completes, assembling into a highly detailed miniature 3D model version of ${finalPromptText} resting on the desk. ${finalCameraClause} ${backgroundClause}`);
  } else if (gridCount <= 6) {
    steps.push(`- Panel ${startScene}: Close-up of a hand holding ${container.shapeEn} custom-designed with colors and branding elements of ${finalPromptText}.`);
    steps.push(`- Panel ${startScene+1}: A thumb presses a small glowing brass activation button on the side of the container in the hand.`);
    steps.push(`- Panel ${startScene+2}: The container is ${isToss ? 'gently tossed onto a white desk, sliding smoothly and spinning to a stop' : 'placed calmly on a white desk'}. ${staticCameraClause} ${backgroundClause}`);
    steps.push(`- Panel ${startScene+3}: First phase of transformation: mechanical legs and feet unfold and extend from the bottom of the container, raising the object up. ${staticCameraClause} ${backgroundClause}`);
    steps.push(`- Panel ${startScene+4}: Second phase: the torso and body expand upwards, revealing moving internal gears and mechanisms. ${staticCameraClause} ${backgroundClause}`);
    steps.push(`- Panel ${startScene+5}: The fully transformed, highly detailed assembled miniature 3D model of ${finalPromptText} standing proudly on the white desk. ${finalCameraClause} ${backgroundClause}`);
  } else {
    steps.push(`- Panel ${startScene}: Close-up of a hand holding ${container.shapeEn} custom-designed with colors and branding elements of ${finalPromptText}.`);
    steps.push(`- Panel ${startScene+1}: A close-up of a thumb pressing a small glowing brass activation button on the side of the container in the hand.`);
    steps.push(`- Panel ${startScene+2}: The hand ${isToss ? 'gently tosses the container onto a white desk, sliding to a stop' : 'places the container on a white desk'}. ${staticCameraClause} ${backgroundClause}`);
    steps.push(`- Panel ${startScene+3}: First phase of transformation: mechanical legs and feet unfold and extend from the bottom of the container, raising the object up. ${staticCameraClause} ${backgroundClause}`);
    steps.push(`- Panel ${startScene+4}: Second phase: the torso and body expand upwards, exposing moving internal gears and joints. ${staticCameraClause} ${backgroundClause}`);
    steps.push(`- Panel ${startScene+5}: Third phase: arms, side panels, wheels, or additional mechanical components fold out and lock into place. ${staticCameraClause} ${backgroundClause}`);
    
    for (let i = 6; i < gridCount - 1; i++) {
      steps.push(`- Panel ${startScene+i}: The structure completes the transformation, body panels snapping shut, alignment of all joints finalized. ${staticCameraClause} ${backgroundClause}`);
    }
    steps.push(`- Panel ${startScene+gridCount-1}: The fully transformed, highly detailed assembled miniature 3D model of ${finalPromptText} standing proudly on the white desk. ${finalCameraClause} ${backgroundClause}`);
  }
  return steps.join('\n');
}

// Enhance prompt based on selected template, custom grid count, and start scene
function getEnhancedPrompt(style, userPrompt, gridCount = 6, showFace = false, startScene = 1, totalDuration = 60, secondsPerPage = 15, hasRefImage = false, containerShape = 'auto') {
  // Truncate userPrompt to 1000 characters to prevent final prompt exceeding Freebeat's 2000 character limit
  userPrompt = userPrompt && userPrompt.length > 1000 ? userPrompt.substring(0, 1000) + '...' : (userPrompt || '');
  const endScene = startScene + gridCount - 1;
  const gridLayout = getGridLayoutDescription(gridCount, startScene);
  
  const pageIdx = Math.floor((startScene - 1) / gridCount);
  const startSec = pageIdx * secondsPerPage;
  const endSec = (pageIdx + 1) * secondsPerPage;
  const timeString = `${formatTime(startSec)} - ${formatTime(endSec)}`;
  const pageNum = pageIdx + 1;

  let gridDesc = '';
  if (gridCount === 4) gridDesc = `2x2 grid of 4 panels showing scenes ${startScene} to ${endScene}`;
  else if (gridCount === 6) gridDesc = `3x2 grid of 6 panels showing scenes ${startScene} to ${endScene}`;
  else if (gridCount === 8) gridDesc = `4x2 grid of 8 panels showing scenes ${startScene} to ${endScene}`;
  else if (gridCount === 9) gridDesc = `3x3 grid of 9 panels showing scenes ${startScene} to ${endScene}`;
  else if (gridCount === 12) gridDesc = `4x3 grid of 12 panels showing scenes ${startScene} to ${endScene}`;
  else gridDesc = `grid of ${gridCount} panels showing scenes ${startScene} to ${endScene}`;

  const faceClause = showFace
    ? "featuring natural human faces and character expressions, close-up lifestyle angles, high-end commercial style"
    : "no human faces, faceless, no portraits, focus only on hands, details and product";

  let refClause = '';
  if (style === 'cube_morph_product') {
    refClause = "The reference image shows the main subject/product. Throughout all the storyboard panels, accurately maintain the visual appearance, details, branding, and color of the subject/product from the reference image. The first image prompt must show the mechanical cube customized with the colors and metallic theme of this product, and the second image prompt must show the final product itself.";
  } else {
    refClause = "The reference image shows the main subject/product. Throughout all the storyboard panels, accurately maintain the visual appearance, details, branding, and color of the subject/product from the reference image. If the product/subject in the reference image is red, paint it red in the panels; do not paint the product yellow. The color yellow should ONLY be used for labels, numbers, borders, and UI text elements outside the panels.";
  }
  const finalPromptText = hasRefImage ? `${userPrompt}. (Note: ${refClause})` : userPrompt;

  let resultPrompt = '';

  if (style === 'cube_morph_product') {
    resultPrompt = `A professional 3D Cube Morph & Product Transition storyboard presentation sheet, vertical layout, clean dark-charcoal background. At the top header, a prominent gold-and-white header banner reading 'STORYBOARD - 3D CUBE MORPH TRANSITION' and the bold target product name in center with 'PART ${pageNum}', a 3D isometric cube wireframe diagram on the right, and metadata badges showing 'STYLE : 3D TRANSITION', 'ROTATION : MULTI-AXIS', 'ASPECT RATIO : 9:16'. The main content is a structured comparison layout displaying scenes ${startScene} to ${endScene}: ${finalPromptText}. For each scene, it shows three distinct prompt blocks:
1. 'FIRST IMAGE PROMPT' detailing: a highly detailed close-up shot of a futuristic mechanical cube sitting flat on a worn dirty white tabletop. The cube has a dark matte metallic finish, angular panel lines, and circular button core. NO hands are holding the cube. The camera angle is straight-on, low-profile horizontal perspective.
2. 'SECOND IMAGE PROMPT' detailing: a highly detailed close-up of the target product (matching the scene description) sitting flat on the exact same worn dirty white tabletop, with the exact same straight-on, low-profile horizontal camera perspective, matching background details and soft lighting. NO hands in the scene.
3. 'IMAGE TO VIDEO PROMPT' detailing: extreme close-up of the mechanical cube on the white tabletop. Internal mechanisms activate: panels split, rotate, and extend with visible pistons, gears, and hinges. Components dynamically reassemble into the final target product within 5 seconds with a smooth, seamless, high-precision morph transformation. The camera remains completely static on a tripod, maintaining a consistent tabletop ground plane and background throughout.
At the bottom, a technical rendering spec footer detailing 'TRANSITION CURVES', 'MOTION BLUR SPECS', '3D ENGINE RENDER', and 'AUDIO CLICK TIMING'. High-contrast design, clean borders, professional tech look. ${faceClause}. --ar 3:4`;
  }
  else if (style === 'tiny_workers_miniature') {
    resultPrompt = `A professional Pixar-style 3D animated storyboard presentation sheet, vertical layout. At the top header, a prominent brand logo on the left, a bold title 'STORYBOARD - Tiny Workers' with the scene description in center with 'PART ${pageNum}', a widescreen Pixar 3D illustration of a workshop or themed studio scene on the right, and metadata badges showing 'DURASI 15-20s', 'ASPECT RATIO 9:16 Vertical', 'GAYA Pixar-style 3D Animation'. The main content is a structured 2x3 (6-panel) grid layout displaying scenes ${startScene} to ${endScene}: ${finalPromptText}. Each panel displays a widescreen 3D animated scene showing tiny toy workers (Lego/Pixar style) in yellow builder helmets crafting miniature objects, a dark-green square scene number badge (${startScene}, ${startScene+1}, ${startScene+2}...) at the top-left, a duration badge (e.g. '0-3s') at the top-right, and a clean text description card below with a tiny outline icon on the left (e.g. leaf, bowl, fire, drop, star icon). At the bottom, a prominent aesthetic spec footer detailing 'WARNA UTAMA' (color swatches), 'SUASANA', 'PERSEKITARAN', 'PENCAHAYAAN : Kuning hangat', dan 'FOKUS : Proses penyediaan'. Cute 3D animation style, warm cozy lighting, clean cartoon aesthetic. ${faceClause}. --ar 3:4`;
  }
  else if (style === 'diy_build_process') {
    resultPrompt = `A professional DIY build process and miniature crafting storyboard sheet, vertical layout stack. At the top header, a clean black-and-gold outline banner reading 'STORYBOARD – DIY BUILD PROCESS' with product fields showing 'DIY ITEM', 'STYLE : MINIATURE HOUSE', 'COMPLEXITY : SIMPLE'. The body features stacked scene rows for scenes ${startScene} to ${endScene}: ${finalPromptText}. Each row displays: on the left, a large gold scene number (${startScene < 10 ? '0' + startScene : startScene}, ${(startScene+1) < 10 ? '0' + (startScene+1) : (startScene+1)}...) and timestamp (e.g. '0:00-0:02'); in the center, a widescreen 16:9 illustration of the miniature building step; on the right, a detailed technical metadata block with 6 rows: 'VISUAL SHOT', 'CAMERA MOVEMENT', 'ACTION', 'DETAIL FOCUS', 'SFX / ASMR', and 'TRANSITION'. At the bottom, a prominent footer detailing 'GLOBAL VISUAL PROMPT', 'GLOBAL ASMR PROMPT', a 'CAMERA DISTRIBUTION' pie chart, a 'SHOT LIST SUMMARY' table, and a 'SHOT HIGHLIGHTS' sub-footer bar. Elegant technical DIY design, gold/orange accents, clean dark borders. ${faceClause}. --ar 3:4`;
  }
  else if (style === 'clean_step_card_grid') {
    resultPrompt = `A professional e-commerce product step-by-step usage storyboard poster, vertical layout, clean bright white background with a modern purple accent theme. At the top header, a clean white banner reading 'STORYBOARD – [PRODUCT TITLE] | Cara Guna Mudah & Praktikal' on the left, a purple rounded pill badge on the right reading 'DURASI : 10s', with thin gray separator lines. The main content is a structured 5x2 (10-panel) grid layout of clean rounded white card panels displaying scenes ${startScene} to ${endScene}: ${finalPromptText}. Each card panel displays a widescreen 16:9 product usage photo, a purple square scene number badge (${startScene}, ${startScene+1}, ${startScene+2}...) at the top-left, a purple pill timestamp badge (e.g. '0:00-1s') at the top-right of the photo, and a text block below with a bold purple title (e.g. 'UNBOXING', 'LANGKAH 1') and a 1-2 sentence description of the action. At the bottom, a prominent dark purple footer banner reading '📢 MESEJ UTAMA: Mudah digunakan, praktikal & berkualiti tinggi!' on the left, and a brand official store logo on the right. High-contrast clean design, sharp sans-serif typography, bright studio lighting. ${faceClause}. --ar 3:4`;
  }
  else if (style === 'recipe_cooking_table') {
    resultPrompt = `A professional recipe and cooking tutorial script table presentation sheet, vertical layout. At the top header, a prominent dark banner reading 'RECIPE STORYBOARD & ASMR TUTORIAL' and the bold food dish/recipe title in center with 'PART ${pageNum}', and metadata fields showing 'TOTAL TIME : 10 DETIK', 'SCENE COUNT : ${endScene}', 'ASPECT RATIO : 16:9'. Below is a high-contrast 8-column storyboard table containing columns titled: 'TIME', 'SCENE', 'VISUAL DESCRIPTION', 'CAMERA', 'CONTINUITY', 'ASMR AUDIO', 'TRANSITION', and 'NOTES'. The table rows display scenes ${startScene} to ${endScene} showing: ${finalPromptText}. Column 1 shows time intervals (e.g. '00:00 - 00:01'). Column 2 shows the recipe preparation and cooking steps. Column 3 displays widescreen 16:9 cooking photos with a short visual action description. Column 4 shows camera shot angles (e.g. 'Close-up (Slow Push In)', 'Close-up (Macro)', 'Close-up (Top Angle)'). Column 5 describes continuity status. Column 6 specifies detailed recipe ASMR sounds (such as chopping, sizzling, baking, or boiling sounds matching the step description). Column 7 shows transition types (e.g. 'Match cut', 'Cut on action'). Column 8 displays technical notes. Professional food studio lighting, clean table borders, high contrast. ${faceClause}. --ar 3:4`;
  }
  else if (style === 'character_design_turnaround') {
    resultPrompt = `A professional character and mecha design concept turnaround sheet, vertical layout sheet. At the top header, a bold red-and-white header banner reading 'STORYBOARD - CHARACTER DESIGN' and 'HENSHIN SEQUENCE SHEET' with the product/character title, an illustration of 'DRIVER BELT' or transformation device, and metadata boxes detailing 'THEME CONCEPT', 'HENSHIN CODE', 'GENRE', and 'ASPECT RATIO : 16:9'. The main body is a structured 4x4 (16-panel) sequence grid displaying scenes ${startScene} to ${endScene}: ${finalPromptText}. Each sequence panel contains a grunged hand-drawn anime sketch illustration showing parts attaching or turnaround views (Front/Back/Side View), a red square scene number badge (${startScene}, ${startScene+1}, ${startScene+2}...) at top-left, a bold scene title, description text, and diagram pointer callouts (e.g. 'FRONT WING', 'NOSE CONE', 'GLOWING VISOR'). At the bottom, a prominent technical breakdown spec footer detailing 'PARTS BREAKDOWN TO ARMOR' with individual parts slots, a 'SPEC DATA' table (Height, Weight, Punch/Kick Power, Max Speed), and a 'FINISHER' layout box. High-contrast sketch design, sharp typography, technical concept art style. ${faceClause}. --ar 3:4`;
  }
  else if (style === 'comic_grunge_storyboard') {
    resultPrompt = `A professional short story comic storyboard presentation sheet, vertical layout, heavily stylized with a textured grunged/dirty paper aesthetic. At the top header, a prominent red-brown banner showing 'STORYBOARD FILM PENDEK' and 'COMIC STORY' on the left, a giant bold comic title in center with 'PART ${pageNum}', a ripped cardboard note box showing 'KONSEP CERITA', and metadata labels showing 'GENRE : STORYBOARD', 'DURASI : 10 DETIK', 'ASPEK RASIO : 16:9', 'GAYA VISUAL : GRUNGED ANIME STYLE'. The main content is a structured 3x3 (9-panel) comic grid displaying scenes ${startScene} to ${endScene}: ${finalPromptText}. Each comic panel features a grunged hand-drawn anime/manga sketch illustration, a black square scene number badge (${startScene}, ${startScene+1}, ${startScene+2}...) at the top-left, a timestamp badge (e.g. '0:00 - 0:01') at the top-right, a sketchy Speech Bubble with cartoon text, a bottom-aligned 'TEKS OVERLAY: [Handwritten Bold Text]' block, and a bottom 'VOICE OVER: [Narration Quote]' black strip. At the bottom, a heavy grunged footer banner displaying 'CATATAN VISUAL', 'PALET WARNA' (with color swatch blocks), 'ELEMEN VISUAL' (with icons for coretan, stiker robek, noda cat, stempel), 'GAYA TEKS OVERLAY' (Handwritten, grunge highlight), and a giant yellow badge showing 'DURASI TOTAL: 10 DETIK'. Grungy manga sketch style, hand-drawn aesthetic, high-contrast shadows. ${faceClause}. --ar 3:4`;
  }
  else if (style === 'ugc_product_showcase_grid') {
    resultPrompt = `A professional UGC product showcase commercial storyboard sheet, vertical layout, clean bright white and pastel-colored background. At the top header, a clean pink/red accent banner reading 'STORYBOARD - UGC PRODUCT VIDEO' and the bold product title in center with 'PART ${pageNum}', and metadata fields showing 'DURASI TOTAL : 10 DETIK', 'JUMLAH SCENE : ${endScene}', 'ASPECT RATIO : 16:9'. The main content is a structured 3x3 (9-shot) grid layout displaying scenes ${startScene} to ${endScene}: ${finalPromptText}. Each grid panel displays a widescreen 16:9 bright product B-roll photo, a pink/light-red square scene number badge (${startScene}, ${startScene+1}, ${startScene+2}...) at the top-left, a pink timestamp badge (e.g. '0.0 - 1.0 DETIK') at the top-right, and a structured metadata block below with 3 fields: 'VISUAL : [Description]', 'AKSI : [Action Description]', and 'KAMERA : [Camera Movement]'. At the bottom, a prominent 5-box technical summary footer detailing 'INFORMASI TEKNIS', 'CAMERA MOVEMENT' (with icons for WIDE SHOT, MEDIUM SHOT, CLOSE-UP, TOP-DOWN, PAN RIGHT, TILT DOWN, SLOW PUSH IN), 'VISUAL STYLE : Soft natural lighting, warm pastel tones, cozy aesthetic', 'NOTES FOR VIDEO GENERATION', and 'NEGATIVE PROMPT (HINDARI)'. Highly structured light layout, sharp typography, soft natural indoor lighting. ${faceClause}. --ar 3:4`;
  }
  else if (style === 'unboxing_cinematic_grid') {
    resultPrompt = `A professional product unboxing commercial storyboard sheet, vertical layout, clean dark-charcoal background. At the top header, a prominent dark banner reading 'STORYBOARD - UNBOXING' and the bold product title in center with 'PART ${pageNum}', and metadata fields showing 'DURASI TOTAL : 10 DETIK', 'JUMLAH SCENE : ${endScene}', 'ASPECT RATIO : 16:9'. The main content is a structured 3x3 (9-shot) grid layout displaying scenes ${startScene} to ${endScene}: ${finalPromptText}. Each grid panel displays a widescreen 16:9 unboxing photo, a red/black square scene number badge (${startScene}, ${startScene+1}, ${startScene+2}...) at the top-left, a red timestamp badge (e.g. '0.0 - 1.0 DETIK') at the top-right, and a structured metadata block below with 3 fields: 'VISUAL : [Description]', 'AKSI : [Action Description]', and 'KAMERA : [Camera Movement]'. At the bottom, a prominent 5-box technical summary footer detailing 'INFORMASI TEKNIS', 'CAMERA MOVEMENT' (with icons for WIDE SHOT, MEDIUM SHOT, CLOSE-UP, TOP-DOWN, LOW ANGLE, TRACKING, PUSH-IN, HANDHELD), 'VISUAL STYLE', 'NOTES FOR VIDEO GENERATION', and 'NEGATIVE PROMPT (HINDARI)'. Highly structured dark layout, sharp typography, professional product studio lighting. ${faceClause}. --ar 3:4`;
  }
  else if (style === 'ugc_overlay_card_grid') {
    resultPrompt = `A professional beauty/skincare UGC commercial script sheet, vertical layout. At the top header, a large bold product title banner with subtitle, and a top-right metadata card showing 'PLATFORM', 'DURASI', 'STYLE : BEAUTY INFLUENCER', 'HOOK STYLE : RELATABLE PROBLEM'. The body features stacked scene rows for scenes ${startScene} to ${endScene}: ${finalPromptText}. Each row displays on the left a 16:9 influencer visual panel with a dark 'SCENE [N]' badge at top-left, a timestamp badge at bottom-left ('00:00 - 00:02'), and a rounded white pill text overlay speech bubble badge at bottom-right of the image (e.g. 'Unboxing yuk! ✨'). On the right of each row is a clean metadata card box with 4 fields: 'SCENE TITLE', 'VISUAL', 'TEXT OVERLAY', and 'VOICE OVER'. At the bottom, 3 callout footer boxes: 'KENAPA HARUS [PRODUCT]?', 'INGAT!', and 'BELI SEKARANG!' with shopping cart icon. Clean aesthetic, soft studio lighting, sharp typography. ${faceClause}. --ar 3:4`;
  }
  else if (style === 'ugc_overlay_dark_table') {
    resultPrompt = `A high-impact dark tech review UGC commercial script table sheet, vertical layout. At the top header, a heavy dark banner with bold product title, tagline, and top-right metadata box ('PLATFORM: YOUTUBE SHORTS', 'DURASI: 10 DETIK', 'GAYA: TECH REVIEW', 'HOOK STYLE: QUESTION'). Below is a gold-accented 4-column script table titled: 'SCENE', 'VISUAL & AKSI', 'TEXT OVERLAY', and 'VOICE OVER'. Rows display scenes ${startScene} to ${endScene}: ${finalPromptText}. Column 1 shows giant gold scene numbers (${startScene}, ${startScene+1}, ${startScene+2}...), timestamp, and scene stage badges ('HOOK', 'INTRO', 'KELEBIHAN', 'DEMO FITUR', 'VERDICT + CTA'). Column 2 shows high-res influencer demonstration photos. Column 3 shows bold sticker-style graphic overlay text ('WORTH IT ATAU ENGGAK?', 'PERFORMA AJIB!', 'CHECK OUT SEKARANG!'). Column 4 shows voiceover dialogue. At the bottom, a dark product showcase footer banner titled 'CATATAN PRODUK'. High-contrast dark theme, bold typography, professional lighting. ${faceClause}. --ar 3:4`;
  }
  else if (style === 'ugc_overlay_minimal_clean') {
    resultPrompt = `A clean aesthetic talking head UGC commercial script sheet, vertical layout. At the top header, a hero product image frame on the left, bold title & italic tagline in center, and top-right metadata row with icons ('Platform', 'Duration', 'Style Talking Head', 'Hook Style Authority'). Below is a clean 6-column script table titled: 'SCENE', 'TIME', 'SCENE TITLE', 'VISUAL', 'TEXT OVERLAY', and 'VOICE OVER'. Rows display scenes ${startScene} to ${endScene}: ${finalPromptText}. Column 1 displays circular scene badges (${startScene}, ${startScene+1}, ${startScene+2}...) over presenter photos. Column 2 shows time interval ('00:00 - 00:02'). Column 3 shows scene title badges ('HOOK AWAL', 'ALASAN 1', 'RINGKASAN & CTA'). Column 4 shows visual description. Column 5 displays soft pastel rounded highlight overlay text badges ('3 Alasan Wajib Punya!', '1. Desain Elegant', 'Check Out Sekarang! 🛒'). Column 6 shows voiceover text. At the bottom, a clean lightbulb tip banner ('💡 TIPS: Gunakan tone ramah dan ekspresi natural'). Clean modern aesthetic, soft studio lighting. ${faceClause}. --ar 3:4`;
  }
  else if (style === 'cinematic_matrix_grid') {
    resultPrompt = `A professional B-Roll Film & TVC Storyboard Matrix Grid presentation sheet, vertical layout sheet. At the top header, a clean black-and-white header banner reading 'STORYBOARD - B-ROLL COMMERCIAL' and 'PART ${pageNum}' with a metadata line: 'DURATION : ± 30-40 DETIK | STYLE : CINEMATIC B-ROLL | ASPECT RATIO : 16:9'. The main content is a structured 5-column matrix grid layout showing scenes ${startScene} to ${endScene}: ${finalPromptText}. Each grid panel contains a clean top header bar with numbered scene titles starting from scene ${startScene} up to ${endScene}, a 16:9 cinematic image panel, and a clean text metadata block underneath with 4 structured rows: 'CAMERA : [Shot Type]', 'FOCUS : [Focus Target]', 'ACTION : [Motion & Action]', and 'NOTES : [Lighting & Audio Notes]'. At the very bottom, a clean 4-box technical summary footer detailing 'VISUAL STYLE', 'MOOD & TONE', 'MUSIC & SOUND', and 'TOTAL DURATION & PLATFORM'. High-contrast director storyboard matrix grid, clean line borders, sharp typography, cinematic sketch studio lighting. ${faceClause}. --ar 3:4`;
  }
  else if (style === 'tiktok_script_table') {
    resultPrompt = `A professional TikTok/Reels commercial script table sheet presentation, vertical layout. At the top header, a prominent dark banner showing '10-SECOND TIKTOK AD STORYBOARD' and 'STORYBOARD PART ${pageNum}' with giant bold product title, tagline, 3 key benefit badges, and a prominent top-right hero product showcase box with a yellow starburst callout badge. Below the header is a high-contrast 5-column script table containing columns titled: 'SCENE', 'DURASI', 'VISUAL', 'VO / DIALOG', and 'TEXT ON SCREEN'. The table rows display scenes ${startScene} to ${endScene} showing: ${finalPromptText}. Column 1 shows bold scene index numbers (${startScene}, ${startScene+1}, ${startScene+2}...) and scene role labels ('PROBLEM / HOOK', 'PRODUCT INTRODUCTION', 'TRANSFORMATION', 'PRODUCT DETAILS', 'RECOMMENDATION / CTA'). Column 2 shows duration (e.g. '2 SEC'). Column 3 displays high-fidelity visual panels with zoom-in circle badges. Column 4 displays voiceover narration quotes. Column 5 displays bold text-on-screen graphic overlays and red call-to-action button badges ('BELI SEKARANG!'). At the very bottom, a clean footer bar with feature icon badges. Highly structured social ad table layout, sharp typography, professional studio lighting. ${faceClause}. --ar 3:4`;
  }
  else if (style === 'infographic_step_guide') {
    resultPrompt = `A professional step-by-step commercial infographic poster, vertical layout sheet. At the top header, a prominent title banner showing 'STORYBOARD PART ${pageNum}' in bold vibrant colors. The layout is organized into ${gridLayout} with prominent green/gold circular numbered badges starting from ${startScene} up to ${endScene} placed at the top-left of every panel indicating each step/scene in sequence. The panels show: ${finalPromptText}. Includes clear step-by-step tutorial text overlays, feature callouts, before-and-after curved transformation arrows, and product benefit checkmarks. At the very bottom, a clean footer bar with 3 circular feature icon badges ('Formula Extra Power', 'Natural Extraction', 'Safe & Tested'). Highly organized infographic poster layout, clean typography, vibrant studio lighting. ${faceClause}. --ar 3:4`;
  }
  else if (style === 'premium_vertical_row') {
    resultPrompt = `A professional video storyboard presentation sheet, vertical layout, clean dark-charcoal background. At the top, there is a prominent header titled 'STORYBOARD PART ${pageNum}' in bold yellow and white sans-serif font, with a yellow-bordered details box showing 'DURASI', 'RASIO', 'LOKASI', and 'TEMA'. The main content is a vertical stack of widescreen video panels (rows) showing: ${finalPromptText}. Each row features a clean separation: on the left side, there is a dark column with a yellow square panel index number (e.g., '${startScene}', '${startScene+1}') and shot name, description, and ASMR sound details in clean white and yellow text. On the right side is the widescreen panel image. At the very bottom, a horizontal yellow arrow transition bar showing 'TRANSISI / ENDING'. Highly structured, clean typography, high-contrast, cinematic lighting. ${faceClause}. --ar 3:4`;
  }
  else {
    resultPrompt = `A professional video storyboard presentation sheet, vertical layout, clean dark-charcoal background. At the top, there is a prominent header titled 'STORYBOARD PART ${pageNum}' in bold yellow and white sans-serif font, with a yellow-bordered details box showing 'DURASI', 'RASIO', 'LOKASI', and 'TEMA'. The main content is a vertical stack of widescreen video panels (rows) showing: ${finalPromptText}. Each row features a clean separation: on the left side, there is a dark column with a yellow square panel index number (e.g., '${startScene}', '${startScene+1}') and shot name, description, and ASMR sound details in clean white and yellow text. On the right side is the widescreen panel image. At the very bottom, a horizontal yellow arrow transition bar showing 'TRANSISI / ENDING'. Highly structured, clean typography, high-contrast, cinematic lighting. ${faceClause}. --ar 3:4`;
  }

  // Prepend and append strict background containment clauses to lock layout style & prevent content bleed/drift!
  const isDark = ['cube_morph_product', 'premium_vertical_row', 'unboxing_cinematic_grid', 'ugc_overlay_dark_table'].includes(style);
  
  const layoutStyleStart = isDark 
    ? "A professional storyboard presentation sheet, vertical layout, clean solid flat dark-charcoal background. "
    : "A professional storyboard presentation sheet, vertical layout, clean solid flat bright white background. ";

  const layoutStyleEnd = isDark
    ? `\nCRITICAL LAYOUT STABILITY REQUIREMENT: The background of the entire poster sheet MUST be a 100% solid flat dark-charcoal color. The action, visual elements, steam, glow, or colors described inside the widescreen panels MUST remain strictly contained within their respective panel borders and MUST NOT bleed, leak, or affect the surrounding dark-charcoal background, header, or text layout. The layout structure, dark borders, and header design MUST remain completely identical to the previous pages.`
    : `\nCRITICAL LAYOUT STABILITY REQUIREMENT: The background of the entire poster sheet MUST be a 100% solid flat clean white color. The action, visual elements, steam, glow, or colors described inside the widescreen panels MUST remain strictly contained within their respective panel borders and MUST NOT bleed, leak, or affect the surrounding white background, header, or text layout. The layout structure, clean borders, and header design MUST remain completely identical to the previous pages.`;

  return `${layoutStyleStart}${resultPrompt}${layoutStyleEnd}`;
}

// Download image from URL helper with User-Agent and Timeout support
function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    // If it's a relative path on the local server, copy it directly
    if (url.startsWith('/uploads/')) {
      const relativeFilename = url.replace(/^\/?uploads\//, '');
      const srcPath = path.join(uploadsDir, relativeFilename);
      try {
        fs.copyFileSync(srcPath, destPath);
        resolve();
      } catch (err) {
        reject(err);
      }
      return;
    }

    const file = fs.createWriteStream(destPath);
    let urlParsed;
    try {
      urlParsed = new URL(url);
    } catch (e) {
      reject(new Error('Invalid URL: ' + url));
      return;
    }

    const options = {
      hostname: urlParsed.hostname,
      path: urlParsed.pathname + urlParsed.search,
      headers: {
        'User-Agent': UA
      },
      timeout: 15000 // 15s timeout
    };

    const client = url.startsWith('https') ? https : http;
    const req = client.get(options, (response) => {
      // Handle redirects (e.g. status code 301, 302)
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        file.on('close', () => {
          fs.unlink(destPath, () => {});
          // Recurse to follow redirect URL
          let redirectUrl = response.headers.location;
          if (!redirectUrl.startsWith('http')) {
            const origin = urlParsed.origin;
            redirectUrl = origin + (redirectUrl.startsWith('/') ? '' : '/') + redirectUrl;
          }
          downloadFile(redirectUrl, destPath).then(resolve).catch(reject);
        });
        file.close();
        return;
      }

      if (response.statusCode !== 200) {
        file.close();
        fs.unlink(destPath, () => {});
        reject(new Error(`Failed to download image. Status code: ${response.statusCode}`));
        return;
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close(resolve);
      });
    });

    req.on('timeout', () => {
      req.destroy();
      file.close();
      fs.unlink(destPath, () => {});
      reject(new Error('Image download timed out.'));
    });

    req.on('error', (err) => {
      file.close();
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

async function splitStoryboardPromptWithAI(concept, pageCount, db) {
  try {
    const settings = await db.get('SELECT * FROM ai_settings LIMIT 1');
    if (!settings || !settings.api_key) {
      console.log('[AI Split] No AI key configured. Using raw prompt fallback.');
      return Array(pageCount).fill(concept);
    }

    const apiHost = settings.endpoint || 'http://localhost:8045/v1';
    const apiToken = settings.api_key;
    const model = settings.model || 'gemini-3-flash';

    const payload = {
      model: model,
      messages: [
        {
          role: 'system',
          content: `Anda adalah asisten sutradara video komersial.
Tugas Anda adalah memecah konsep cerita iklan produk dari pengguna menjadi ${pageCount} bagian cerita/tahapan visual yang saling berurutan dan berkelanjutan (sekuensial).
Setiap bagian mewakili satu halaman storyboard berdurasi 15 detik.
Pastikan:
- Halaman 1: Pengenalan produk, unboxing, atau awal mula penggunaan.
- Halaman berikutnya: Tahap demi tahap pengerjaan/penggunaan secara detail dan fokus pada keunggulan.
- Halaman terakhir: Hasil akhir yang memuaskan, penyajian, atau call to action visual.
Berikan deskripsi detail visual yang singkat dan padat untuk masing-masing halaman (1 paragraf ringkas per halaman).

PENTING UNTUK GAYA CUBE MORPH TRANSITION (cube_morph_product):
Jika konsep cerita menggunakan transisi kubus (cube morph/cube transformation):
1. Anda HARUS menjelaskan detail fisik kubus mekanis di Halaman 1 (misal: "futuristic mechanical cube, dark matte metallic finish, angular panel lines, glowing circular button core") dan meminta peletakan di atas meja putih.
2. Anda HARUS menjelaskan proses perubahan mekanis di Halaman tengah.
3. Anda HARUS mendeskripsikan secara spesifik produk akhir yang muncul di Halaman terakhir dengan warna, merek, dan bentuk yang persis seperti yang diinginkan pengguna di atas meja putih yang sama.

PENTING UNTUK KONSISTENSI VISUAL (CHARACTER/PRODUCT CONSISTENCY):
1. Identifikasi karakter utama (jika ada) dan produk utama dari konsep cerita pengguna.
2. Buat deskripsi fisik yang sangat spesifik untuk karakter tersebut (misal: "pria Asia 25 tahun, rambut hitam pendek acak, memakai hoodie abu-abu polos") dan produk tersebut (misal: "botol tumbler stainless steel warna hijau toska").
3. Anda WAJIB menuliskan deskripsi fisik yang KONSISTEN dan SAMA PERSIS ini di setiap paragraf halaman (Halaman 1, Halaman 2, dst.). Jangan hanya menulis "pria itu" atau "tas itu", tetapi ulangi deskripsi fisiknya secara lengkap agar gambar dari satu halaman ke halaman berikutnya tidak meleset modelnya.

Anda harus mengembalikan respon hanya dalam format JSON mentah dengan key 'pages' berupa array string berukuran ${pageCount}. Jangan pakai pembungkus markdown (jangan pakai \`\`\`json).
Contoh output untuk 2 halaman:
{
  "pages": [
    "Seorang wanita muda Asia berusia 24 tahun berambut cokelat panjang memakai kemeja putih sedang unboxing tas ransel kulit hitam minimalis dari kotak cokelat di atas meja kayu.",
    "Wanita muda Asia berusia 24 tahun berambut cokelat panjang memakai kemeja putih berjalan di koridor kampus memakai tas ransel kulit hitam minimalis di pundaknya."
  ]
}`
        },
        {
          role: 'user',
          content: `Konsep Kasar Cerita: ${concept}`
        }
      ],
      temperature: 0.7
    };

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiToken}`
    };

    const response = await new Promise((resolve, reject) => {
      const urlParsed = new URL(`${apiHost}/chat/completions`);
      const client = urlParsed.protocol === 'https:' ? https : http;
      const port = urlParsed.port || (urlParsed.protocol === 'https:' ? 443 : 80);

      const options = {
        hostname: urlParsed.hostname,
        port: port,
        path: urlParsed.pathname + urlParsed.search,
        method: 'POST',
        headers: headers,
        timeout: 45000 // 45 seconds for cloud environments like Railway
      };

      const req = client.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Timeout'));
      });

      req.write(JSON.stringify(payload));
      req.end();
    });

    if (response.statusCode !== 200) {
      console.warn('[AI Split] API failed with status:', response.statusCode, response.body);
      return Array(pageCount).fill(concept);
    }

    const resJson = JSON.parse(response.body);
    const content = resJson.choices?.[0]?.message?.content || '';
    let cleanText = content.trim();
    if (cleanText.startsWith('```')) {
      cleanText = cleanText.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '');
    }

    const parsed = JSON.parse(cleanText.trim());
    if (parsed && Array.isArray(parsed.pages) && parsed.pages.length === pageCount) {
      console.log('[AI Split] Successfully split prompts:', parsed.pages);
      return parsed.pages;
    }

    return Array(pageCount).fill(concept);
  } catch (err) {
    console.warn('[AI Split] Error splitting prompt:', err.message);
    return Array(pageCount).fill(concept);
  }
}

function safeClampPrompt(promptStr, limit = 2000) {
  const trimmed = promptStr.trim();
  if (trimmed.length <= limit) return trimmed;

  // Find if there is an aspect ratio parameter or other params at the end (e.g., --ar 3:4)
  const paramRegex = /\s*(--ar\s+\d+:\d+|\s+--\S+(\s+\S+)?)*$/i;
  const match = trimmed.match(paramRegex);
  
  let suffix = '';
  let mainBody = trimmed;
  
  if (match && match[0].trim()) {
    suffix = ' ' + match[0].trim();
    mainBody = trimmed.substring(0, trimmed.length - match[0].length);
  }
  
  const allowedLength = limit - suffix.length;
  const truncatedBody = mainBody.substring(0, allowedLength).trim();
  
  return truncatedBody + suffix;
}

async function getUserStoryboards(req, res) {
  try {
    const db = getDb();
    const storyboards = await db.all(
      'SELECT * FROM storyboards WHERE user_id = ? ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json(storyboards);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching storyboards.', error: error.message });
  }
}

async function getAvailableApiKey(db) {
  const activeKeys = await db.all('SELECT * FROM api_keys WHERE is_active = 1');
  if (activeKeys.length === 0) return null;

  // Filter out keys that are currently busy in activeTasks
  const busyKeyIds = Object.values(activeTasks)
    .filter(task => task.status === 'processing')
    .map(task => parseInt(task.apiKeyId));

  const freeKeys = activeKeys.filter(k => !busyKeyIds.includes(parseInt(k.id)));
  if (freeKeys.length > 0) {
    return freeKeys[0];
  }
  return activeKeys[0];
}

async function generateStoryboard(req, res) {
  const { title, prompt, style, apiKeyId, refImageBase64, refImageUrl, refImages, gridCount, model, duration, showFace, aspectRatio, enableVo, voLanguage, voTone, videoEngine, containerShape } = req.body;

  if (!title || !prompt || !style || !apiKeyId) {
    return res.status(400).json({ message: 'Title, prompt, style, and API Key ID are required.' });
  }

  const db = getDb();
  let keyRecord = null;
  if (apiKeyId && apiKeyId !== 'auto') {
    keyRecord = await db.get('SELECT * FROM api_keys WHERE id = ? AND is_active = 1', [apiKeyId]);
    if (!keyRecord) {
      return res.status(400).json({ message: 'API Key terpilih tidak aktif atau tidak valid.' });
    }
    
    const isKeyBusy = Object.values(activeTasks).some(task => 
      task.status === 'processing' && parseInt(task.apiKeyId) === parseInt(keyRecord.id)
    );
    if (isKeyBusy) {
      return res.status(409).json({ message: 'API Key ini sedang digunakan oleh proses lain. Silakan pilih API Key lain atau tunggu beberapa saat.' });
    }
  } else {
    keyRecord = await getAvailableApiKey(db);
    if (!keyRecord) {
      return res.status(400).json({ message: 'Tidak ada API Key Freebeat yang aktif.' });
    }
  }

  const parsedApiKeyId = keyRecord.id;
  const selectedModel = model ? String(model) : '108';
  const totalDuration = duration ? Number(duration) : 15;
  const selectedEngine = videoEngine || 'seedance';

  let secondsPerPage = 15;
  if (selectedEngine === 'omni') {
    secondsPerPage = 10;
  } else if (selectedEngine === 'veo') {
    secondsPerPage = 8;
  }

  const pageCount = Math.max(1, Math.min(8, Math.ceil(totalDuration / secondsPerPage)));

  const generationParams = JSON.stringify({
    style,
    gridCount: gridCount || 6,
    model: selectedModel,
    aspectRatio: aspectRatio || '1:1',
    showFace: !!showFace,
    duration: totalDuration,
    enableVo: !!enableVo,
    voLanguage: voLanguage || 'Bahasa Indonesia',
    voTone: voTone || 'casual',
    videoEngine: selectedEngine,
    containerShape: containerShape || 'auto'
  });

  // Create unique task ID immediately
  const taskId = 'task_' + Date.now();
  let storyboardId = null;

  const initialTaskState = {
    status: 'processing',
    apiKeyId: parsedApiKeyId,
    storyboardId: null, // set below
    logs: '=== INVENTARISASI GENERATOR STORYBOARD MULTI-PAGE ===\n\n' +
          `[1/4] Menyiapkan parameter...\n` +
          `Judul Proyek : ${title}\n` +
          `Gaya Layout  : ${style}\n` +
          `Jumlah Grid  : ${gridCount || 6} Panel\n` +
          `Model Gambar : ${selectedModel}\n` +
          `Ukuran Gambar: ${aspectRatio || '1:1'}\n` +
          `Engine Video : ${selectedEngine.toUpperCase()}\n` +
          `Durasi Video : ${totalDuration} Detik (${pageCount} Halaman)\n\n`,
    result: null,
    error: null,
    
    // Recovery properties
    pageCount,
    secondsPerPage,
    totalDuration,
    aspectRatio,
    selectedModel,
    style,
    gridCount: gridCount || 6,
    showFace: !!showFace,
    containerShape: containerShape || 'auto',
    prompt,
    title,
    enableVo: !!enableVo,
    voLanguage: voLanguage || 'Bahasa Indonesia',
    voTone: voTone || 'casual',
    videoEngine: selectedEngine,
    subPrompts: null,
    refImages: refImages || [],
    refImageBase64: refImageBase64 || '',
    refImageUrl: refImageUrl || '',
    finalRefImagePath: undefined,
    imagePaths: [],
    totalCreditsUsed: 0,
    currentPageIdx: 0,
    currentTaskInfo: null
  };

  try {
    const insertResult = await db.run(
      'INSERT INTO storyboards (user_id, title, prompt, image_path, used_credits, api_key_id, status, generation_params, task_id, active_task_data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [req.user.id, title, prompt, '[]', 0, parsedApiKeyId, 'processing', generationParams, taskId, JSON.stringify(initialTaskState)]
    );
    storyboardId = insertResult.lastID;
    initialTaskState.storyboardId = storyboardId;
    activeTasks[taskId] = initialTaskState;
    await saveTaskState(db, storyboardId, initialTaskState);
  } catch (dbErr) {
    console.error('Failed to create initial storyboard record:', dbErr);
    return res.status(500).json({ message: 'Gagal membuat rekam storyboard awal.', error: dbErr.message });
  }

  // Respond immediately with taskId and storyboardId to prevent blocking HTTP timeouts
  res.json({ taskId, storyboardId, status: 'processing' });

  // Run the process completely in background
  runStoryboardGeneratorBackground(taskId, storyboardId);
}

async function runStoryboardGeneratorBackground(taskId, storyboardId) {
  const db = getDb();
  const task = activeTasks[taskId];
  if (!task) return;

  try {
    const keyRecord = await db.get('SELECT * FROM api_keys WHERE id = ?', [task.apiKeyId]);
    if (!keyRecord || !keyRecord.is_active) {
      task.status = 'failed';
      task.error = 'Selected API Key is invalid or inactive.';
      task.logs += '[ERROR] Selected API Key is invalid or inactive.\n';
      await db.run('UPDATE storyboards SET status = ? WHERE id = ?', ['failed', storyboardId]);
      await saveTaskState(db, storyboardId, task);
      return;
    }

    const parsedApiKeyId = keyRecord.id;
    let currentKeyRecord = keyRecord;
    const localCliPath = path.join(__dirname, '..', 'node_modules', 'freebeat-cli', 'dist', 'index.js');
    const hasLocalCli = fs.existsSync(localCliPath);
    const publicDir = uploadsDir;

    // 1. Split the storyboard prompt into chronological parts using AI if starting fresh
    if (task.subPrompts === null) {
      task.logs += `[1.2/4] Menganalisis konsep cerita dan memecah menjadi ${task.pageCount} segmen visual kronologis menggunakan AI...\n`;
      await saveTaskState(db, storyboardId, task);
      
      const subPrompts = await splitStoryboardPromptWithAI(task.prompt, task.pageCount, db);
      task.subPrompts = subPrompts;
      
      const isFallback = subPrompts.every(p => p === task.prompt);
      if (isFallback && task.pageCount > 1) {
        task.logs += `  [INFO] Layanan AI Split sedang mengalami gangguan (HTTP 503/RTO). Menggunakan konsep cerita asli untuk setiap halaman (fallback).\n`;
      } else {
        for (let i = 0; i < subPrompts.length; i++) {
          task.logs += `  Halaman ${i+1}: ${subPrompts[i].substring(0, 100)}...\n`;
        }
      }
      task.logs += `\n`;
      await saveTaskState(db, storyboardId, task);
    }

    // 2. Save Reference Images if starting fresh
    if (task.finalRefImagePath === undefined) {
      const savedRefImagePaths = [];
      let refImagesList = task.refImages || [];
      if (refImagesList.length === 0) {
        if (task.refImageBase64) {
          refImagesList.push({ base64: task.refImageBase64 });
        } else if (task.refImageUrl) {
          refImagesList.push({ url: task.refImageUrl });
        }
      }

      if (refImagesList.length > 0 && !fs.existsSync(publicDir)) {
        fs.mkdirSync(publicDir, { recursive: true });
      }

      for (let i = 0; i < refImagesList.length; i++) {
        const item = refImagesList[i];
        let refImagePath = '';
        if (item.base64) {
          task.logs += `Mengolah gambar referensi [${i+1}] (Base64)...\n`;
          const matches = item.base64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
          if (matches && matches.length === 3) {
            const buffer = Buffer.from(matches[2], 'base64');
            const refFilename = `ref_${Date.now()}_${i}.png`;
            refImagePath = path.join(publicDir, refFilename);
            fs.writeFileSync(refImagePath, buffer);
          }
        } else if (item.url) {
          task.logs += `Mengunduh gambar referensi [${i+1}] dari URL: ${item.url}...\n`;
          try {
            const refFilename = `ref_${Date.now()}_${i}.png`;
            refImagePath = path.join(publicDir, refFilename);
            await downloadFile(item.url, refImagePath);
            task.logs += `Gambar referensi [${i+1}] berhasil diunduh secara lokal.\n`;
          } catch (err) {
            console.warn('Could not download reference image from URL:', err.message);
            task.logs += `[WARNING] Gagal mengunduh gambar referensi [${i+1}]: ${err.message}. Melanjutkan tanpa gambar referensi ini.\n`;
            refImagePath = '';
          }
        }
        if (refImagePath) {
          try {
            const sharp = require('sharp');
            const buffer = fs.readFileSync(refImagePath);
            const outputPngPath = refImagePath.replace(/\.png$/, '_converted.png');
            
            // Read metadata to check dimensions
            const image = sharp(buffer);
            const metadata = await image.metadata();
            
            let pipeline = image;
            // Downscale extremely large images to speed up processing and prevent size limit errors
            if (metadata.width > 2560 || metadata.height > 2560) {
              pipeline = pipeline.resize({
                width: metadata.width > metadata.height ? 2048 : undefined,
                height: metadata.height >= metadata.width ? 2048 : undefined,
                fit: 'inside',
                withoutEnlargement: true
              });
            }
            
            await pipeline
              .png({ quality: 90, compressionLevel: 8 })
              .toFile(outputPngPath);
            
            // Check final file size and convert to optimized JPEG if still over 10MB
            const stats = fs.statSync(outputPngPath);
            if (stats.size > 10 * 1024 * 1024) {
              const outputJpgPath = outputPngPath.replace(/_converted\.png$/, '_converted.jpg');
              await sharp(outputPngPath)
                .jpeg({ quality: 80, mozjpeg: true })
                .toFile(outputJpgPath);
              
              if (fs.existsSync(outputPngPath)) fs.unlinkSync(outputPngPath);
              if (fs.existsSync(refImagePath)) fs.unlinkSync(refImagePath);
              refImagePath = outputJpgPath;
            } else {
              if (fs.existsSync(refImagePath)) {
                fs.unlinkSync(refImagePath);
              }
              refImagePath = outputPngPath;
            }
          } catch (sharpErr) {
            console.warn(`[sharp] failed to process reference image: ${sharpErr.message}`);
          }
          savedRefImagePaths.push(refImagePath.replace(/\\/g, '/'));
        }
      }

      let finalRefImagePath = '';
      if (savedRefImagePaths.length === 1) {
        finalRefImagePath = savedRefImagePaths[0];
        task.logs += `Ref Gambar   : ${path.basename(finalRefImagePath)}\n\n`;
      } else if (savedRefImagePaths.length > 1) {
        task.logs += `Ref Gambar Asli: ${savedRefImagePaths.map(p => path.basename(p)).join(', ')}\n`;
        task.logs += `[1.5/4] Menggabungkan ${savedRefImagePaths.length} gambar referensi menjadi 1 kolase side-by-side untuk Freebeat...\n`;
        try {
          const combinedFilename = `combined_ref_${Date.now()}.png`;
          const combinedPath = path.join(publicDir, combinedFilename);
          
          const { Jimp } = require('jimp');
          const images = await Promise.all(savedRefImagePaths.map(p => Jimp.read(p)));
          
          const targetHeight = 600;
          let totalWidth = 0;
          for (const img of images) {
            img.resize({ h: targetHeight });
            totalWidth += img.width;
          }

          const canvas = new Jimp({ width: totalWidth, height: targetHeight, color: 0xFFFFFFFF });
          let currentX = 0;
          for (const img of images) {
            canvas.composite(img, currentX, 0);
            currentX += img.width;
          }

          await canvas.write(combinedPath);
          finalRefImagePath = combinedPath.replace(/\\/g, '/');
          task.logs += `Kolase referensi berhasil dibuat: ${combinedFilename}\n\n`;
        } catch (stitchErr) {
          console.error('Failed to stitch reference images:', stitchErr);
          task.logs += `[WARNING] Gagal menggabungkan gambar referensi: ${stitchErr.message}. Menggunakan gambar pertama sebagai fallback.\n\n`;
          finalRefImagePath = savedRefImagePaths[0];
        }
      } else {
        task.logs += `Ref Gambar   : Tidak ada\n\n`;
      }
      task.finalRefImagePath = finalRefImagePath;
      await saveTaskState(db, storyboardId, task);
    }

    task.logs += `[2/4] Mengirim perintah generate ke Freebeat secara sekuensial (Satu per satu)...\n`;
    await saveTaskState(db, storyboardId, task);

    let currentError = null;

    for (let pageIdx = task.currentPageIdx; pageIdx < task.pageCount; pageIdx++) {
      task.currentPageIdx = pageIdx;
      await saveTaskState(db, storyboardId, task);

      const pageNum = pageIdx + 1;
      const startSec = pageIdx * task.secondsPerPage;
      const endSec = (pageIdx + 1) * task.secondsPerPage;
      const startScene = pageIdx * Number(task.gridCount) + 1;
      const endScene = (pageIdx + 1) * Number(task.gridCount);

      task.logs += `\n[Halaman ${pageNum}] Memulai proses generasi Halaman ${pageNum} dari ${task.pageCount}...\n`;
      await saveTaskState(db, storyboardId, task);

       // Resolve reference image for this page
       // ALWAYS use the clean original reference image (if provided) to maintain product/model consistency.
       // NEVER combine or use the previous generated page (prevPagePath) as a reference for any style,
       // as passing a fully formatted storyboard sheet with headers, grids, and old panels causes
       // severe layout leakage and visual bleeding (inception) of previous scenes into the new panels.
       let pageRefPath = task.finalRefImagePath || '';

      // Check if we already have batch information (resume scenario)
      let taskInfo = task.currentTaskInfo;
      if (!taskInfo) {
        const pageConcept = (task.subPrompts && task.subPrompts[pageIdx]) ? task.subPrompts[pageIdx] : task.prompt;
        let pagePrompt = getEnhancedPrompt(task.style, pageConcept, Number(task.gridCount) || 6, task.showFace, startScene, task.totalDuration, task.secondsPerPage, !!pageRefPath, task.containerShape);
        pagePrompt = pagePrompt.replace(/"/g, "'");
        if (task.style !== 'single_premium_showcase') {
          pagePrompt = `Page ${pageNum} of ${task.pageCount}, Scenes ${startScene}-${endScene} (time segment ${formatTime(startSec)} to ${formatTime(endSec)}). ` + pagePrompt;
        }
        pagePrompt = safeClampPrompt(pagePrompt, 1995);

        task.logs += `[Halaman ${pageNum}] Prompt: ${pagePrompt.substring(0, 120)}...\n`;
        await saveTaskState(db, storyboardId, task);

        taskInfo = null;
        let submitSuccess = false;

        while (!submitSuccess) {
          let spawnCmd;
          let spawnArgs;

          if (hasLocalCli) {
            spawnCmd = 'node';
            spawnArgs = [
              localCliPath,
              '--api-key', currentKeyRecord.key_value
            ];
          } else {
            spawnCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
            spawnArgs = [
              '-p', 'freebeat-cli',
              'freebeat',
              '--api-key', currentKeyRecord.key_value
            ];
          }

          let sizeArgs = [];
          const reqAspectRatio = task.aspectRatio ? String(task.aspectRatio) : '1:1';
          if (task.selectedModel === '108') {
            if (reqAspectRatio === '16:9') {
              sizeArgs = ['--resolution', '1920x1088'];
            } else if (reqAspectRatio === '9:16') {
              sizeArgs = ['--resolution', '1024x1536'];
            } else {
              sizeArgs = ['--resolution', '1024x1024'];
            }
          } else {
            sizeArgs = ['--size', reqAspectRatio];
          }

          if (pageRefPath) {
            spawnArgs.push(
              'image', 'edit',
              '--model', task.selectedModel,
              '--image', pageRefPath,
              '--prompt', pagePrompt,
              '--count', '1',
              '--json',
              ...sizeArgs
            );
          } else {
            spawnArgs.push(
              'image', 'generate',
              '--model', task.selectedModel,
              '--prompt', pagePrompt,
              '--count', '1',
              '--json',
              ...sizeArgs
            );
          }

          try {
            taskInfo = await new Promise((resolve, reject) => {
              const child = spawn(spawnCmd, spawnArgs);
              let stdout = '';
              let stderr = '';
              child.stdout.on('data', (d) => stdout += d.toString());
              child.stderr.on('data', (d) => stderr += d.toString());
              child.on('close', async (code) => {
                if (code !== 0) {
                  let errMsg = stderr.trim();
                  if (!errMsg && stdout) {
                    try {
                      const parsed = JSON.parse(stdout.trim());
                      errMsg = parsed.message || parsed.msg || parsed.error?.message || stdout.trim();
                    } catch (e) {
                      errMsg = stdout.trim();
                    }
                  }
                  
                  const lowerErr = (errMsg || '').toLowerCase() + (stdout || '').toLowerCase() + (stderr || '').toLowerCase();
                  const isCreditErr = lowerErr.includes('credit') || lowerErr.includes('balance') || lowerErr.includes('insufficient') || lowerErr.includes('limit') || lowerErr.includes('depleted') || lowerErr.includes('payment') || lowerErr.includes('out of');
                  
                  if (isCreditErr) {
                    task.logs += `\n[Auto-Disable] API Key ID ${currentKeyRecord.id} (${currentKeyRecord.label}) kehabisan kredit. Menonaktifkan key.\n`;
                    await db.run('UPDATE api_keys SET is_active = 0 WHERE id = ?', [currentKeyRecord.id]);
                    reject({ type: 'credit', message: errMsg || 'Credits are not enough' });
                  } else {
                    task.logs += `\n[Freebeat CLI Error - Halaman ${pageNum}]\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}\n`;
                    reject(new Error(`CLI Halaman ${pageNum} gagal: ${errMsg || code}`));
                  }
                  return;
                }
                
                try {
                  const genJson = JSON.parse(stdout.trim());
                  const batchId = genJson.data?.batchId || genJson.batchId;
                  const serialNo = genJson.data?.items?.[0]?.serialNo || (genJson.items && genJson.items[0] && genJson.items[0].serialNo);
                  if (!batchId) {
                    return reject(new Error(`Batch ID tidak ditemukan pada Halaman ${pageNum}`));
                  }
                  resolve({ pageNum, batchId, serialNo });
                } catch (e) {
                  const batchMatch = stdout.match(/"batchId"\s*:\s*"([^"]+)"/);
                  const serialMatch = stdout.match(/"serialNo"\s*:\s*"([^"]+)"/);
                  if (batchMatch && batchMatch[1]) {
                    resolve({ pageNum, batchId: batchMatch[1], serialNo: serialMatch ? serialMatch[1] : undefined });
                  } else {
                    reject(new Error(`Gagal mengurai respon Halaman ${pageNum}: ${stdout}`));
                  }
                }
              });
            });

            submitSuccess = true;
          } catch (err) {
            if (err && err.type === 'credit') {
              const nextKey = await db.get('SELECT * FROM api_keys WHERE is_active = 1 LIMIT 1');
              if (nextKey) {
                task.logs += `[SYSTEM] Beralih secara otomatis ke API Key alternatif: ${nextKey.label}...\n`;
                await saveTaskState(db, storyboardId, task);
                currentKeyRecord = nextKey;
                task.apiKeyId = nextKey.id;
                await db.run('UPDATE storyboards SET api_key_id = ? WHERE id = ?', [nextKey.id, storyboardId]);
              } else {
                currentError = 'Semua API Key Freebeat yang aktif telah kehabisan kredit.';
                break;
              }
            } else {
              const errStr = String(err.message || err).toLowerCase();
              const isNetworkErr = errStr.includes('network') || errStr.includes('econnreset') || errStr.includes('timeout') || errStr.includes('socket') || errStr.includes('connection');
              
              if (isNetworkErr) {
                task.pageRetries = task.pageRetries || {};
                task.pageRetries[pageNum] = (task.pageRetries[pageNum] || 0) + 1;
                
                if (task.pageRetries[pageNum] <= 3) {
                  task.logs += `[SYSTEM] Terdeteksi gangguan koneksi Freebeat (${err.message || err}). Melakukan uji coba ulang (Retry ${task.pageRetries[pageNum]}/3) dalam 3 detik...\n`;
                  await saveTaskState(db, storyboardId, task);
                  await new Promise(r => setTimeout(r, 3000));
                  continue;
                }
              }
              
              currentError = err.message || err;
              break;
            }
          }
        }

        if (currentError) {
          break;
        }

        task.currentTaskInfo = taskInfo;
        task.logs += `[Halaman ${pageNum}] Pendaftaran sukses (BatchID: ${taskInfo.batchId}). Memulai polling status...\n`;
        await saveTaskState(db, storyboardId, task);
      } else {
        task.logs += `[Halaman ${pageNum}] Melanjutkan pemantauan status tugas render (BatchID: ${taskInfo.batchId})...\n`;
        await saveTaskState(db, storyboardId, task);
      }

      // 2. Poll status for this page
      try {
        const creditsUsed = await new Promise((resolve, reject) => {
          let pollCount = 0;
          const maxPolls = 120;
          const pollInterval = setInterval(() => {
            pollCount++;
            task.logs += `[Halaman ${pageNum}] Memeriksa status render (${pollCount}/${maxPolls})...\n`;
            saveTaskState(db, storyboardId, task).catch(() => {});

            let statusCmd;
            let statusArgs;

            if (hasLocalCli) {
              statusCmd = 'node';
              statusArgs = [
                localCliPath,
                '--api-key', currentKeyRecord.key_value
              ];
            } else {
              statusCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
              statusArgs = [
                '-p', 'freebeat-cli',
                'freebeat',
                '--api-key', currentKeyRecord.key_value
              ];
            }

            statusArgs.push('task', 'status', taskInfo.batchId, '--json');
            if (taskInfo.serialNo) statusArgs.push('--serial-no', taskInfo.serialNo);

            const childStatus = spawn(statusCmd, statusArgs);

            let statusStdout = '';
            let statusStderr = '';
            childStatus.stdout.on('data', (d) => statusStdout += d.toString());
            childStatus.stderr.on('data', (d) => statusStderr += d.toString());

            childStatus.on('close', async (statusCode) => {
              if (statusCode !== 0) {
                let errMsg = statusStderr.trim();
                if (!errMsg && statusStdout) {
                  try {
                    const parsed = JSON.parse(statusStdout.trim());
                    errMsg = parsed.message || parsed.msg || parsed.error?.message || statusStdout.trim();
                  } catch (e) {
                    errMsg = statusStdout.trim();
                  }
                }
                task.logs += `\n[Freebeat Status Check Error - Halaman ${pageNum}]\nSTDOUT:\n${statusStdout}\nSTDERR:\n${statusStderr}\n`;
                await checkAndDisableKeyIfOutofCredits(db, parsedApiKeyId, errMsg || statusStdout || statusStderr, task);
                task.logs += `[WARNING][Halaman ${pageNum}] Gagal memeriksa status: ${errMsg || statusCode}\n`;
                if (pollCount >= maxPolls) {
                  clearInterval(pollInterval);
                  reject(new Error(`Timeout pada Halaman ${pageNum}`));
                }
                return;
              }

              try {
                const statusJson = JSON.parse(statusStdout.trim());
                const dataObj = statusJson.data || statusJson;
                const item = dataObj?.items?.[0] || (dataObj?.results && dataObj?.results[0]);

                if (item) {
                  const renderStatus = item.status || dataObj.status;
                  if (renderStatus === 'SUCCESS' || renderStatus === 'COMPLETED' || renderStatus === 'completed') {
                    clearInterval(pollInterval);
                    let remoteUrl = item.imageUrl || 
                                    item.image_url || 
                                    item.videoUrl || 
                                    item.video_url || 
                                    item.url || 
                                    item.image_path || 
                                    item.imagePath || 
                                    dataObj.imageUrl || 
                                    dataObj.image_url || 
                                    dataObj.url || 
                                    dataObj.videoUrl || 
                                    dataObj.video_url;

                    if (!remoteUrl) {
                      const editImgs = item.editImages || item.edit_images || dataObj.editImages || dataObj.edit_images;
                      if (editImgs) {
                        if (Array.isArray(editImgs) && editImgs.length > 0) {
                          remoteUrl = editImgs[0];
                        } else if (typeof editImgs === 'string') {
                          remoteUrl = editImgs;
                        }
                      }
                    }

                    if (!remoteUrl) {
                      const imgs = item.images || item.generateImages || item.generate_images || dataObj.images || dataObj.generateImages || dataObj.generate_images;
                      if (imgs) {
                        if (Array.isArray(imgs) && imgs.length > 0) {
                          remoteUrl = imgs[0];
                        } else if (typeof imgs === 'string') {
                          remoteUrl = imgs;
                        }
                      }
                    }

                    if (!remoteUrl) {
                      console.error('[status check] SUCCESS but no URL found. Item:', JSON.stringify(item), 'DataObj:', JSON.stringify(dataObj));
                      return reject(new Error(`URL hasil Halaman ${pageNum} tidak ditemukan.`));
                    }
                    
                    const credits = item.usedCredits || item.needCredits || 23;
                    task.logs += `[Halaman ${pageNum}] Sukses! Link asli: ${remoteUrl} (Kredit: ${credits})\n`;
                    task.imagePaths[pageIdx] = remoteUrl;
                    resolve(credits);
                  } else if (renderStatus === 'FAILED' || renderStatus === 'ERROR' || renderStatus === 'failed') {
                    clearInterval(pollInterval);
                    const errMsg = item.errorMessage || `Gagal render Halaman ${pageNum}`;
                    task.logs += `\n[Freebeat Render Error - Halaman ${pageNum}]\nError Message: ${errMsg}\n`;
                    await checkAndDisableKeyIfOutofCredits(db, parsedApiKeyId, errMsg, task);
                    reject(new Error(errMsg));
                  }
                }
              } catch (err) {
                // Ignore parsing errors
              }

              if (pollCount >= maxPolls) {
                clearInterval(pollInterval);
                reject(new Error(`Timeout render Halaman ${pageNum}`));
              }
            });
          }, 15000);
        });
        
        task.totalCreditsUsed += (Number(creditsUsed) || 0);
        task.currentTaskInfo = null; // Clear page's task info as it completed successfully!
        task.logs += `[Halaman ${pageNum}] Selesai diproses!\n`;
        await saveTaskState(db, storyboardId, task);

      } catch (pollErr) {
        currentError = pollErr.message;
        break;
      }
    }

    if (currentError) {
      task.status = 'failed';
      task.error = currentError;
      task.logs += `[ERROR] Kesalahan fatal dalam proses generasi: ${currentError}\n`;
      await db.run('UPDATE storyboards SET status = ? WHERE id = ?', ['failed', storyboardId]);
      await saveTaskState(db, storyboardId, task);
      return;
    }

    // Success! Update DB
    const dbPathString = JSON.stringify(task.imagePaths);
    await db.run(
      'UPDATE storyboards SET image_path = ?, used_credits = ?, status = ? WHERE id = ?',
      [dbPathString, task.totalCreditsUsed, 'success', storyboardId]
    );
    
    task.logs += `[AI Video Prompts] Men-generate otomatis prompt video Image-to-Video ${task.enableVo ? 'dan voiceover ' : ''}di latar belakang...\n`;
    await saveTaskState(db, storyboardId, task);
    try {
      const { generateVideoPromptsInternal } = require('./aiController');
      await generateVideoPromptsInternal({
        storyboardId: storyboardId,
        promptType: 'image-to-video',
        regenerate: true,
        enableVo: !!task.enableVo,
        voLanguage: task.enableVo ? task.voLanguage : undefined,
        voTone: task.enableVo ? task.voTone : undefined,
        videoDuration: task.totalDuration
      });
      task.logs += `[AI Video Prompts] Prompt video berhasil di-generate secara otomatis.\n`;
    } catch (promptErr) {
      console.error('Failed to auto-generate video prompt for new storyboard:', promptErr.message);
      task.logs += `[WARNING] Gagal menulis prompt video otomatis: ${promptErr.message}. Anda bisa membuatnya secara manual di Dashboard.\n`;
    }

    task.status = 'success';
    task.result = {
      id: storyboardId,
      title: task.title,
      prompt: task.prompt,
      image_path: dbPathString
    };
    task.logs += `\n=== SEMUA PROSES BERHASIL SELESAI ===\n`;
    await saveTaskState(db, storyboardId, task);

  } catch (bgError) {
    task.status = 'failed';
    task.error = bgError.message;
    task.logs += `[ERROR] Kesalahan fatal background task: ${bgError.message}\n`;
    try {
      await db.run('UPDATE storyboards SET status = ? WHERE id = ?', ['failed', storyboardId]);
      await saveTaskState(db, storyboardId, task);
    } catch (e) {}
  }
}

async function getTaskStatus(req, res) {
  const { taskId } = req.params;
  const task = activeTasks[taskId];
  if (!task) {
    return res.status(404).json({ message: 'Task tidak ditemukan.' });
  }
  res.json(task);
}

async function deleteStoryboard(req, res) {
  const { id } = req.params;

  try {
    const db = getDb();
    
    // Ensure the storyboard belongs to this user (isolasi data)
    const sb = await db.get('SELECT * FROM storyboards WHERE id = ? AND user_id = ?', [id, req.user.id]);
    if (!sb) {
      return res.status(404).json({ message: 'Storyboard not found or access denied.' });
    }

    // Delete local files (supports JSON array or string)
    try {
      if (sb.image_path.startsWith('[')) {
        const arr = JSON.parse(sb.image_path);
        arr.forEach(img => {
          if (img.startsWith('/uploads/')) {
            const relativeFilename = img.replace(/^\/?uploads\//, '');
            const filePath = path.join(uploadsDir, relativeFilename);
            fs.unlink(filePath, () => {});
          }
        });
      } else if (sb.image_path.startsWith('/uploads/')) {
        const relativeFilename = sb.image_path.replace(/^\/?uploads\//, '');
        const filePath = path.join(uploadsDir, relativeFilename);
        fs.unlink(filePath, () => {});
      }
    } catch (e) {
      console.error('Error deleting local files:', e.message);
    }

    await db.run('DELETE FROM storyboards WHERE id = ?', [id]);
    res.json({ message: 'Storyboard deleted successfully.' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting storyboard.', error: error.message });
  }
}

async function getActiveKeys(req, res) {
  try {
    const db = getDb();
    const keys = await db.all(`
      SELECT k.id, k.label,
             (COALESCE((SELECT SUM(s.used_credits) FROM storyboards s WHERE s.api_key_id = k.id), 0) +
              COALESCE((SELECT SUM(v.used_credits) FROM generated_videos v WHERE v.api_key_id = k.id), 0)) AS total_credits
      FROM api_keys k
      WHERE k.is_active = 1
    `);
    
    // Map each key to check if it's currently in use
    const mappedKeys = keys.map(k => {
      const isBusy = Object.values(activeTasks).some(task => 
        task.status === 'processing' && parseInt(task.apiKeyId) === parseInt(k.id)
      );
      return {
        id: k.id,
        label: k.label,
        in_use: isBusy,
        total_credits: k.total_credits
      };
    });
    
    res.json(mappedKeys);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching active API keys.', error: error.message });
  }
}

async function scrapeProductUrl(req, res) {
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ message: 'URL Tokopedia wajib diisi.' });
  }

  try {
    console.log(`Scraping product from URL: ${url}`);
    const data = await scrapeTokopedia(url);
    res.json(data);
  } catch (error) {
    console.error('Scraping failed:', error.message);
    res.status(500).json({ message: 'Gagal mengambil data produk Tokopedia. Pastikan URL valid.', error: error.message });
  }
}

function getActiveTasksDebug(req, res) {
  res.json(activeTasks);
}

async function downloadProxy(req, res) {
  const { url } = req.query;
  if (!url) {
    return res.status(400).json({ message: 'URL is required.' });
  }

  try {
    const isLocal = url.startsWith('/uploads/') || url.startsWith('uploads/');
    const isRemote = url.startsWith('https://') || url.startsWith('http://');

    if (!isLocal && !isRemote) {
      return res.status(400).json({ message: 'Invalid download source.' });
    }

    const filename = path.basename(url.split('?')[0]);

    // Normalize URL path to relative local format to match database entries
    let dbPathKey = url;
    if (isRemote) {
      // If it's a remote URL, see if we can extract local relative path if hosted locally
      try {
        const parsed = new URL(url);
        if (parsed.pathname.includes('/uploads/')) {
          dbPathKey = parsed.pathname.substring(parsed.pathname.indexOf('/uploads/'));
        }
      } catch (e) {}
    }
    const normUrl = dbPathKey.startsWith('/') ? dbPathKey : '/' + dbPathKey;

    // Log the file download in downloaded_files table
    try {
      const db = getDb();
      const existing = await db.get('SELECT * FROM downloaded_files WHERE file_path = ?', [normUrl]);
      if (existing) {
        await db.run('UPDATE downloaded_files SET download_count = download_count + 1, last_downloaded_at = CURRENT_TIMESTAMP WHERE file_path = ?', [normUrl]);
      } else {
        await db.run('INSERT INTO downloaded_files (file_path, download_count) VALUES (?, 1)', [normUrl]);
      }
    } catch (dbErr) {
      console.error('Error logging file download to database:', dbErr);
    }

    if (isLocal) {
      const relativeFilename = url.replace(/^\/?uploads\//, '');
      const fullPath = path.join(uploadsDir, relativeFilename);
      if (fs.existsSync(fullPath)) {
        return res.download(fullPath, filename);
      } else {
        return res.status(404).json({ message: 'File not found.' });
      }
    }

    const protocol = url.startsWith('https') ? https : http;
    const options = {
      headers: {
        'User-Agent': UA
      }
    };
    protocol.get(url, options, (stream) => {
      if (stream.statusCode !== 200) {
        return res.status(stream.statusCode).json({ message: 'Failed to retrieve file from CDN.' });
      }
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Type', stream.headers['content-type'] || 'image/png');
      stream.pipe(res);
    }).on('error', (err) => {
      res.status(500).json({ message: 'Download error.', error: err.message });
    });
  } catch (err) {
    res.status(500).json({ message: 'Download failed.', error: err.message });
  }
}

async function regenerateStoryboardPage(req, res) {
  const { id } = req.params;
  const { pageIdx } = req.body;

  if (pageIdx === undefined || pageIdx === null) {
    return res.status(400).json({ message: 'Indeks halaman (pageIdx) wajib disertakan.' });
  }

  try {
    const db = getDb();
    
    // Retrieve storyboard
    const storyboard = await db.get('SELECT * FROM storyboards WHERE id = ? AND user_id = ?', [id, req.user.id]);
    if (!storyboard) {
      return res.status(404).json({ message: 'Storyboard tidak ditemukan.' });
    }

    // Parse image paths
    let imagePaths = [];
    try {
      if (storyboard.image_path && storyboard.image_path.startsWith('[')) {
        imagePaths = JSON.parse(storyboard.image_path);
      } else {
        imagePaths = storyboard.image_path ? [storyboard.image_path] : [];
      }
    } catch (e) {
      imagePaths = storyboard.image_path ? [storyboard.image_path] : [];
    }

    if (pageIdx < 0 || pageIdx >= imagePaths.length) {
      return res.status(400).json({ message: 'Indeks halaman di luar batas jangkauan.' });
    }

    // Resolve generation params with defaults
    let genParams = {};
    try {
      if (storyboard.generation_params) {
        genParams = JSON.parse(storyboard.generation_params);
      }
    } catch (e) {}

    const style = genParams.style || 'anime';
    const gridCount = genParams.gridCount || 6;
    const model = genParams.model || '108';
    const aspectRatio = genParams.aspectRatio || '1:1';
    const showFace = genParams.showFace !== undefined ? genParams.showFace : false;
    const videoEngine = genParams.videoEngine || 'seedance';

    let secondsPerPage = 15;
    if (videoEngine === 'omni') {
      secondsPerPage = 10;
    } else if (videoEngine === 'veo') {
      secondsPerPage = 8;
    }
    const pageCount = imagePaths.length;

    // Retrieve API Key
    let keyRecord = null;
    if (storyboard.api_key_id) {
      keyRecord = await db.get('SELECT * FROM api_keys WHERE id = ? AND is_active = 1', [storyboard.api_key_id]);
    }
    if (!keyRecord) {
      // Dynamic fallback
      const activeKeys = await db.all('SELECT * FROM api_keys WHERE is_active = 1');
      if (activeKeys.length > 0) {
        keyRecord = activeKeys[0];
      }
    }

    if (!keyRecord) {
      return res.status(400).json({ message: 'Tidak ada API Key Freebeat yang aktif atau valid untuk regenerasi.' });
    }

    // Create background task ID
    const taskId = 'task_regen_' + Date.now();
    res.json({ taskId, message: 'Proses regenerasi halaman dimulai di background.', status: 'processing' });

    // Spawn background execution
    (async () => {
      try {
        activeTasks[taskId] = {
          status: 'processing',
          logs: `=== REGENERASI STORYBOARD PANEL (HALAMAN ${pageIdx + 1}) ===\n\n` +
                `Judul Proyek : ${storyboard.title}\n` +
                `Indeks Page  : Halaman ${pageIdx + 1}\n` +
                `Model Gambar : ${model}\n` +
                `Gaya Layout  : ${style}\n\n` +
                `[1/3] Memisahkan kembali konsep cerita dengan AI...\n`,
          result: null,
          error: null
        };

        const subPrompts = await splitStoryboardPromptWithAI(storyboard.prompt, pageCount, db);
        const pageConcept = (subPrompts && subPrompts[pageIdx]) ? subPrompts[pageIdx] : storyboard.prompt;
        
        const startScene = pageIdx * Number(gridCount) + 1;
        let pagePrompt = getEnhancedPrompt(style, pageConcept, Number(gridCount) || 6, showFace, startScene, genParams.duration || (pageCount * secondsPerPage), secondsPerPage, false, genParams.containerShape);
        pagePrompt = pagePrompt.replace(/"/g, "'");

        activeTasks[taskId].logs += `[2/3] Mengirimkan perintah generate ke Freebeat...\n` +
                                     `Prompt Halaman: ${pagePrompt}\n\n`;

        // Spawn Freebeat CLI
        const spawnCmd = 'node';
        const cliPath = path.join(__dirname, '..', 'node_modules', 'freebeat-cli', 'dist', 'index.js');
        const spawnArgs = [
          cliPath,
          '--api-key', keyRecord.key_value,
          'image', 'generate',
          '--model', model,
          '--prompt', pagePrompt,
          '--size', '1024x1024',
          '--json'
        ];

        const child = spawn(spawnCmd, spawnArgs);
        let stdoutData = '';
        let stderrData = '';

        child.stdout.on('data', (data) => {
          stdoutData += data.toString();
        });
        child.stderr.on('data', (data) => {
          stderrData += data.toString();
        });

        child.on('close', async (code) => {
          if (code !== 0) {
            const errorMsg = (stderrData.trim() || stdoutData.trim() || `Exit code ${code}`);
            activeTasks[taskId].status = 'failed';
            activeTasks[taskId].error = errorMsg;
            activeTasks[taskId].logs += `\n[Freebeat CLI Error - Halaman ${pageIdx + 1}]\nSTDOUT:\n${stdoutData}\nSTDERR:\n${stderrData}\n`;
            activeTasks[taskId].logs += `[ERROR] Gagal mengirim perintah ke Freebeat: ${errorMsg}\n`;
            await checkAndDisableKeyIfOutofCredits(db, keyRecord.id, errorMsg || stdoutData || stderrData, activeTasks[taskId]);
            return;
          }

          try {
            const jsonLines = stdoutData.split('\n').filter(line => line.trim().startsWith('{') || line.trim().startsWith('['));
            let submitResponse = null;
            for (const line of jsonLines) {
              try {
                const parsed = JSON.parse(line.trim());
                if (parsed.success && parsed.data) {
                  submitResponse = parsed.data;
                  break;
                }
              } catch (e) {}
            }

            if (!submitResponse && stdoutData.trim().startsWith('{')) {
              try {
                const parsed = JSON.parse(stdoutData.trim());
                if (parsed.success && parsed.data) {
                  submitResponse = parsed.data;
                }
              } catch (e) {}
            }

            if (!submitResponse) {
              throw new Error('Respon submit dari Freebeat CLI tidak valid.');
            }

            const batchId = submitResponse.batchId;
            if (!batchId) {
              throw new Error('Gagal mendapatkan Batch ID.');
            }

            activeTasks[taskId].logs += `[3/3] Sukses submit! Batch ID: ${batchId}. Mulai polling status...\n`;

            // Poll status until success
            let attempt = 0;
            const maxAttempts = 120;
            const interval = setInterval(async () => {
              attempt++;
              activeTasks[taskId].logs += `[Halaman ${pageIdx + 1}] Memeriksa status render (${attempt}/120)...\n`;
              if (attempt > maxAttempts) {
                clearInterval(interval);
                activeTasks[taskId].status = 'failed';
                activeTasks[taskId].error = 'Timeout waiting for image generation.';
                activeTasks[taskId].logs += `[ERROR] Waktu tunggu habis (Timeout).\n`;
                return;
              }

              try {
                const statusArgs = [
                  cliPath,
                  '--api-key', keyRecord.key_value,
                  'task', 'status',
                  batchId,
                  '--json'
                ];
                const statusChild = spawn(spawnCmd, statusArgs);
                let statusStdout = '';
                statusChild.stdout.on('data', (d) => {
                  statusStdout += d.toString();
                });

                statusChild.on('close', async (statusCode) => {
                  if (statusCode !== 0) {
                    activeTasks[taskId].logs += `\n[Freebeat Status Check Error - Halaman ${pageIdx + 1}]\nSTDOUT:\n${statusStdout}\n`;
                    await checkAndDisableKeyIfOutofCredits(db, keyRecord.id, statusStdout, activeTasks[taskId]);
                    return;
                  }
                  try {
                    const parsedStatus = JSON.parse(statusStdout.trim());
                    if (parsedStatus.success && parsedStatus.data) {
                      const dataObj = parsedStatus.data;
                      const item = dataObj?.items?.[0] || dataObj?.results?.[0];
                      if (item) {
                        const status = item.status || dataObj.status;
                        if (status === 'SUCCESS' || status === 'COMPLETED' || status === 'completed') {
                          clearInterval(interval);
                          
                          let remoteUrl = item.imageUrl || item.image_url || item.url || dataObj.imageUrl || dataObj.image_url;
                          if (!remoteUrl && item.images && item.images.length > 0) {
                            remoteUrl = item.images[0];
                          }

                          if (!remoteUrl) {
                            activeTasks[taskId].status = 'failed';
                            activeTasks[taskId].error = 'No image URL returned.';
                            activeTasks[taskId].logs += `[ERROR] Respon sukses tetapi URL Gambar kosong.\n`;
                            return;
                          }

                          activeTasks[taskId].logs += `[Status] Render Halaman ${pageIdx + 1} Sukses! Mengunduh gambar...\n`;

                          // Download image locally
                          const filename = `storyboard_${storyboard.id}_page_${pageIdx}_regen_${Date.now()}.png`;
                          const destPath = path.join(uploadsDir, filename);
                          
                          await downloadFile(remoteUrl, destPath);

                          const localUrl = `/uploads/${filename}`;
                          imagePaths[pageIdx] = localUrl;

                          // Update database
                          const updatedPathsString = JSON.stringify(imagePaths);
                          await db.run('UPDATE storyboards SET image_path = ? WHERE id = ?', [updatedPathsString, storyboard.id]);

                          activeTasks[taskId].status = 'success';
                          activeTasks[taskId].logs += `=== REGENERASI SELESAI ===\nHalaman ${pageIdx + 1} berhasil diperbarui!\n`;
                          activeTasks[taskId].result = {
                            id: storyboard.id,
                            image_path: updatedPathsString
                          };
                        } else if (status === 'FAILED' || status === 'failed') {
                          clearInterval(interval);
                          const errMsg = item.errorMessage || 'Render failed.';
                          activeTasks[taskId].status = 'failed';
                          activeTasks[taskId].error = errMsg;
                          activeTasks[taskId].logs += `\n[Freebeat Render Error - Halaman ${pageIdx + 1}]\nError Message: ${errMsg}\n`;
                          activeTasks[taskId].logs += `[ERROR] Render di Freebeat gagal.\n`;
                          await checkAndDisableKeyIfOutofCredits(db, keyRecord.id, errMsg, activeTasks[taskId]);
                        }
                      }
                    }
                  } catch (e) {}
                });
              } catch (e) {}
            }, 6000);

          } catch (jsonErr) {
            activeTasks[taskId].status = 'failed';
            activeTasks[taskId].error = jsonErr.message;
            activeTasks[taskId].logs += `[ERROR] Gagal memproses respon submit: ${jsonErr.message}\n`;
          }
        });

      } catch (err) {
        activeTasks[taskId].status = 'failed';
        activeTasks[taskId].error = err.message;
        activeTasks[taskId].logs += `[ERROR] Kesalahan fatal: ${err.message}\n`;
      }
    })();

  } catch (error) {
    res.status(500).json({ message: 'Gagal memulai regenerasi halaman.', error: error.message });
  }
}

async function resumeProcessingStoryboardsOnStartup() {
  try {
    const { getDb } = require('../db');
    const db = getDb();
    
    // Fetch all storyboards with status 'processing'
    const storyboards = await db.all('SELECT * FROM storyboards WHERE status = "processing"');
    if (storyboards.length === 0) return;
    
    console.log(`[Startup Resume] Found ${storyboards.length} storyboards in 'processing' status. Attempting to resume...`);
    
    for (const sb of storyboards) {
      if (!sb.active_task_data) {
        console.log(`[Startup Resume] Storyboard ID ${sb.id} has no task data. Marking as failed.`);
        await db.run('UPDATE storyboards SET status = "failed" WHERE id = ?', [sb.id]);
        continue;
      }
      
      try {
        const taskState = JSON.parse(sb.active_task_data);
        const taskId = sb.task_id || ('task_resume_' + sb.id);
        
        taskState.logs += `\n[SYSTEM] Server direstart/deploy. Menyambungkan kembali pemantauan dan melanjutkan proses...\n`;
        activeTasks[taskId] = taskState;
        
        // Start background process to resume this task
        runStoryboardGeneratorBackground(taskId, sb.id);
      } catch (parseErr) {
        console.error(`[Startup Resume] Failed to parse task data for storyboard ID ${sb.id}:`, parseErr);
        await db.run('UPDATE storyboards SET status = "failed" WHERE id = ?', [sb.id]);
      }
    }
  } catch (err) {
    console.error('[Startup Resume] Error during startup recovery:', err);
  }
}

module.exports = {
  getUserStoryboards,
  generateStoryboard,
  deleteStoryboard,
  getActiveKeys,
  getTaskStatus,
  scrapeProductUrl,
  getActiveTasksDebug,
  downloadProxy,
  regenerateStoryboardPage,
  resumeProcessingStoryboardsOnStartup,
  activeTasks
};
