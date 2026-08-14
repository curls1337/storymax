// Style Spec library. Each style is compact structured DATA (not a giant
// hardcoded prompt string). The deterministic assembler (masterPrompt.js) and
// the LLM generator (masterPromptLLM.js) both consume these specs.
//
// Fields: id, name, desc, category, format, faceMode (default), bg, camera,
// lighting, header, arc (narrative beats), negatives.

const NEG = ['garbled or misspelled text', 'panels bleeding into the background', 'layout drifting between panels', 'the product changing design between panels'];

const STYLES = {
  // ── A. Transformasi & Reveal (Premium) ──
  mechanical_transform: {
    name: 'Mechanical Transformation', desc: 'Wadah mekanis premium (kubus/bola/silinder) mekar & morph mulus otomatis jadi produk. Kamera lebar, fotorealistis sinematik, fokus pada presisi mekanik.',
    category: 'Transformasi & Reveal', format: '9:16', faceMode: 'faceless', bg: 'light',
    layoutHint: 'a grid of {N} numbered panels on a clean catalog-style sheet; each panel features a "MECHANICAL DETAIL" badge and a duration chip',
    camera: 'cinematic photorealistic reveal on ONE stable, WIDE, locked-off camera; armored panels slide & telescope outward smoothly, mechanically connected, no loose parts; shallow DOF',
    lighting: 'natural cinematic light matched to the setting, realistic reflections, subtle bokeh', header: 'STORYBOARD — MECHANICAL TRANSFORM',
    arc: ['a premium mechanical container rests on a surface', 'the container activates as its panels begin to slide and unfold', 'panels telescope outward smoothly, revealing the inner mechanism', 'the mechanism seamlessly forms the product itself', 'the finished product in a premium hero shot'],
    negatives: NEG.concat(['humanoid robot / mecha / Transformer', 'exploding or detached parts', 'energy beams, glow or magic FX', 'CGI cartoon look']),
  },
  product_assembly: {
    name: 'Product Assembly', desc: 'Bagian-bagian produk beterbangan secara presisi dan menyatu menjadi produk utuh di tengah layar. Gaya futuristik & teknis.',
    category: 'Transformasi & Reveal', format: '9:16', faceMode: 'faceless', bg: 'dark',
    layoutHint: 'a grid of {N} numbered panels with a dark technical background; each panel includes "ASSEMBLY PHASE" tags',
    camera: 'static hero shot, exploded-view parts floating then converging to center',
    lighting: 'dramatic rim studio lighting, high contrast', header: 'STORYBOARD — PRODUCT ASSEMBLY',
    arc: ['exploded parts floating in space', 'parts drifting toward the center', 'components snapping together', 'the complete product fully assembled, glowing hero shot'],
    negatives: NEG.concat(['missing or extra parts', 'messy floating']),
  },
  liquid_splash: {
    name: 'Liquid / Splash Reveal', desc: 'Produk muncul secara dramatis dari cipratan cairan, asap, atau bubuk yang membeku di udara. Sangat artistik & segar.',
    category: 'Transformasi & Reveal', format: '9:16', faceMode: 'faceless', bg: 'dark',
    layoutHint: 'a grid of {N} panels with a sleek dark aesthetic; each panel features "HIGH-SPEED CAPTURE" annotations',
    camera: 'static high-speed macro capture of splash frozen in motion',
    lighting: 'high-contrast studio light with specular highlights', header: 'STORYBOARD — SPLASH REVEAL',
    arc: ['calm surface before impact', 'liquid or powder bursting upward', 'product emerging from within the splash', 'product settled, droplets suspended around it'],
    negatives: NEG.concat(['muddy or unclear splash', 'slow motion blur']),
  },
  unboxing: {
    name: 'Cinematic Unboxing', desc: 'Pembukaan kemasan dramatis dengan fokus pada pengalaman "first look", tekstur kotak, dan reveal produk.',
    category: 'Transformasi & Reveal', format: '9:16', faceMode: 'faceless', bg: 'light',
    layoutHint: 'a grid of {N} numbered panels ala premium lifestyle catalog; each panel has a "FIRST LOOK" badge',
    camera: 'handheld top-down and close-up shots with gentle natural movement',
    lighting: 'soft dramatic product studio light', header: 'STORYBOARD — UNBOXING',
    arc: ['sealed package resting on a surface', 'hands opening the box lid', 'lifting the product out of the packaging', 'macro close-up of product details', 'product placed upright in a clean hero angle'],
    negatives: NEG.concat(['distorted hands', 'messy background']),
  },
  asmr_unboxing_premium: {
    name: 'ASMR Unboxing Premium', desc: 'Unboxing kelas atas dengan sarung tangan hitam, fokus pada detail mikro (macro), tekstur material, dan bunyi mekanis yang memuaskan.',
    category: 'Transformasi & Reveal', format: '9:16', faceMode: 'faceless', bg: 'dark',
    layoutHint: 'a grid of {N} macro panels on a dark minimalist background; each panel features "TACTILE FOCUS" and "SOUND CUE" tags',
    camera: 'extreme macro (1:1) focus on textures, hands in black nitrile gloves, slow rhythmic movements, top-down and 45-degree angles',
    lighting: 'moody dark studio lighting, dramatic rim lights, sharp specular highlights on metallic/glossy parts', header: 'STORYBOARD — ASMR UNBOXING',
    arc: ['hands in black gloves gently touch the premium box', 'macro of the seal being sliced or peeled', 'slow reveal of the product nestled in foam', 'extreme close-up of a button click or wheel turn', 'product glowing under accent lights in a dark void'],
    negatives: NEG.concat(['bare hands', 'bright flat lighting', 'cluttered background', 'fast shaky camera']),
  },
  mechanic_transform_gauntlet: {
    name: 'Mechanic Transformation (Gauntlet)', desc: 'Transformasi mekanis kompleks dari pod kecil menjadi perangkat canggih (seperti sarung tangan mekanik). Fokus pada interlocking plates dan gir.',
    category: 'Transformasi & Reveal', format: '9:16', faceMode: 'faceless', bg: 'textured',
    layoutHint: 'a technical grid of {N} panels showing mechanical assembly; each panel includes "INTERLOCKING DETAIL" and "GEAR RATIO" notes',
    camera: 'locked-off top-down workshop perspective, focus on rapid unfolding of mechanical plates and gears sliding into place',
    lighting: 'cool industrial workshop lighting, metallic reflections, glowing internal power cores', header: 'STORYBOARD — MECHANIC TRANSFORM',
    arc: ['a compact mechanical pod sits on a workbench', 'a finger presses the central trigger core', 'plates burst open and gears begin to spin', 'the device telescopes and wraps around a hand/arm', 'the fully deployed mechanical gauntlet performs a movement'],
    negatives: NEG.concat(['organic shapes', 'magic or particle effects', 'humanoid robots', 'loose disconnected parts']),
  },
  before_after: {
    name: 'Before–After', desc: 'Perbandingan visual langsung antara masalah (sebelum) dan solusi produk (sesudah). Sangat efektif untuk bukti hasil.',
    category: 'Transformasi & Reveal', format: '9:16', faceMode: 'chin_max', bg: 'light',
    layoutHint: 'a grid of {N} panels; each panel is clearly split or paired with "BEFORE" and "AFTER" labels',
    camera: 'matched static framing so before and after align perfectly, split or side-by-side comparison',
    lighting: 'even neutral lighting for honest comparison', header: 'STORYBOARD — BEFORE / AFTER',
    arc: ['the BEFORE state / problem clearly shown', 'applying or using the product', 'transition wipe between states', 'the AFTER state highlighting the improvement'],
    negatives: NEG.concat(['mismatched framing', 'exaggerated results']),
  },

  // ── B. UGC & Social (Viral) ──
  ugc_creator: {
    name: 'UGC Creator Style', desc: 'Gaya influencer autentik berbicara ke kamera, demo produk di rumah, dan reaksi jujur. Relatable & terpercaya.',
    category: 'UGC & Social', format: '9:16', faceMode: 'chin_max', bg: 'light',
    layoutHint: 'a grid of {N} vertical panels like a TikTok/Reels feed; each panel has "CREATOR NOTES" and duration chips',
    camera: 'natural handheld selfie framing, close-up lifestyle angles, authentic influencer aesthetic',
    lighting: 'soft natural daylight, authentic everyday environment', header: 'STORYBOARD — UGC CREATOR',
    arc: ['relatable hook grabbing attention', 'introducing the product', 'demonstrating it in use', 'showing the satisfying result', 'call-to-action with a buy badge'],
    negatives: NEG.concat(['overly staged studio look', 'fake professional lighting']),
  },
  social_stylized_text: {
    name: 'Social Media (Stylized Text)', desc: 'Fokus pada teks overlay besar, stiker, dan balon penjelasan fitur (callout) yang artistik di dalam gambar. Sangat viral.',
    category: 'UGC & Social', format: '9:16', faceMode: 'chin_max', bg: 'light',
    layoutHint: 'a grid of {N} numbered panels; EACH panel features BOLD stylized captions, feature badges, and sticker-style callouts inside the scene',
    camera: 'clean cinematic product photography, ~35mm, shallow depth of field, ONE clear subject per panel',
    lighting: 'warm cinematic softbox light, appetizing & premium', header: 'STORYBOARD — SOCIAL STYLIZED',
    arc: ['scroll-stopping hook with bold text', 'reveal product feature with a stylized badge', 'action shot with floating feature text', 'social proof / result with sticker caption', 'clear CTA with a stylized button'],
    negatives: NEG.concat(['garbled text', 'cluttered overlapping text', 'boring plain subtitles']),
  },
  social_lifestyle: {
    name: 'Social Lifestyle (Independent)', desc: 'Satu karakter dalam berbagai aktivitas berbeda per halaman (lari, makan, gym, dll). Identitas tetap konsisten, momen berbeda.',
    category: 'UGC & Social', format: '9:16', faceMode: 'full', bg: 'light',
    independentScenes: true,
    layoutHint: 'a grid of {N} numbered lifestyle photo panels, like an Instagram feed preview',
    camera: 'candid handheld smartphone-camera framing, natural imperfect composition, amateur angles',
    lighting: 'real-world ambient lighting matched to the location (daylight, restaurant, gym, etc.)', header: 'STORYBOARD — LIFESTYLE',
    arc: ['candid opening moment of the activity', 'mid-action unposed moment', 'detail candid shot (expression or object)', 'relaxed closing moment of the activity'],
    negatives: NEG.concat(['plastic AI skin', 'glossy CGI look', 'character identity drift']),
  },
  jelly_character_asmr: {
    name: 'Jelly Character ASMR', desc: 'Figurin jeli transparan karakter yang digenggam; tubuh terisi cairan/gelembung saat "minum". Lucu & memuaskan.',
    category: 'UGC & Social', format: '9:16', faceMode: 'faceless', bg: 'textured',
    layoutHint: 'a grid of {N} macro panels with a soft aesthetic; each panel highlights "TACTILE DETAIL"',
    camera: 'intimate macro; figurine held in palm; soft shallow focus; whole figurine in frame',
    lighting: 'soft natural daylight, glossy specular highlights on translucent jelly', header: 'STORYBOARD — JELLY ASMR',
    arc: ['translucent jelly character in palm', 'playful anticipation with a mini prop', 'satisfying drink/fill with rising bubbles', 'happy expression and jelly wobble', 'satisfied character settles in palm'],
    negatives: NEG.concat(['opaque plastic', 'redesigned character', 'uncanny realism']),
  },

  // ── C. Proses & Edukasi (Informatif) ──
  timelapse_process: {
    name: 'Timelapse Process', desc: 'Proses dipercepat dari awal sampai hasil akhir dengan sudut kamera yang tidak berubah. Sangat memuaskan ditonton.',
    category: 'Proses & Edukasi', format: '16:9', faceMode: 'faceless', bg: 'light',
    layoutHint: 'a grid of {N} panels showing a fixed-angle progression; each panel has a "TIMELAPSE" timecode',
    camera: 'a static lock-off wide shot from the exact same fixed position; only the subject progresses',
    lighting: 'consistent daylight shifting subtly over time', header: 'STORYBOARD — TIMELAPSE',
    arc: ['the starting/empty state', 'early progress', 'mid-way build-up', 'the finished result'],
    negatives: NEG.concat(['viewpoint shifting between panels']),
  },
  professional_tutorial: {
    name: 'Professional Tutorial', desc: 'Panduan langkah demi langkah teknis dengan label nomor, durasi, dan fokus pada tangan/alat yang bekerja.',
    category: 'Proses & Edukasi', format: '9:16', faceMode: 'faceless', bg: 'light',
    layoutHint: 'a professional table-style layout with columns for "VISUAL", "ACTION", and "TOOLS"',
    camera: 'clean top-down and close-up on hands performing each step',
    lighting: 'bright even instructional lighting, clear and shadow-free', header: 'STORYBOARD — TUTORIAL',
    arc: ['tools/materials laid out', 'step 1 action', 'following steps in sequence', 'the finished result'],
    negatives: NEG.concat(['messy workspace', 'unclear steps']),
  },
  recipe_asmr: {
    name: 'Recipe & ASMR Cooking', desc: 'Langkah memasak dengan fokus pada tekstur makanan, uap, dan suara. Sangat menggugah selera.',
    category: 'Proses & Edukasi', format: '9:16', faceMode: 'faceless', bg: 'light',
    layoutHint: 'a grid of {N} macro panels; each panel includes "SOUND/SFX" notes and duration',
    camera: 'top-down and macro close-ups of cooking actions, steam and sizzle focus',
    lighting: 'warm appetizing food-studio light, rich colors', header: 'STORYBOARD — RECIPE ASMR',
    arc: ['fresh ingredients prepared', 'chopping / mixing step', 'cooking with sizzle and steam', 'plating the finished dish'],
    negatives: NEG.concat(['unappetizing colors', 'messy plating']),
  },
  infographic_explainer: {
    name: 'Infographic Explainer', desc: 'Menjelaskan konsep dengan ikon, diagram bersih, dan panah petunjuk. Cocok untuk produk edukasi/teknis.',
    category: 'Proses & Edukasi', format: '16:9', faceMode: 'faceless', bg: 'light',
    layoutHint: 'a grid of {N} infographic panels; each panel uses icons, arrows, and callouts to explain concepts',
    camera: 'flat clean graphic composition with icons, arrows and callouts',
    lighting: 'even flat lighting, vibrant infographic palette', header: 'STORYBOARD — EXPLAINER',
    arc: ['the concept introduced', 'breaking it into parts with icons', 'a concrete example', 'summary with key takeaway'],
    negatives: NEG.concat(['cluttered diagrams', 'unreadable small text']),
  },

  // ── D. Cinematic & Art (High-End) ──
  cinematic_ad: {
    name: 'Cinematic TV Commercial', desc: 'Gaya iklan TV premium dengan layout katalog bersih, tipografi elegan, dan fokus pada estetika produk kelas atas.',
    category: 'Cinematic & Art', format: '16:9', faceMode: 'full', bg: 'light',
    layoutHint: 'a professional magazine-style sheet with large hero images, elegant typography, and "VISUAL UTAMA" / "TEKS OVERLAY" sections',
    camera: 'cinematic coverage varying wide, medium and close-up shots with intentional composition',
    lighting: 'high-end commercial lighting, soft rim lights, shallow depth of field', header: 'STORYBOARD — CINEMATIC TVC',
    arc: ['atmospheric establishing shot', 'macro texture and detail shots', 'the product in a lifestyle context', 'the hero beauty shot', 'brand tag / CTA'],
    negatives: NEG.concat(['shaky camera', 'cheap amateur look']),
  },
  anime_manga: {
    name: 'Anime / Manga Storyboard', desc: 'Gaya ilustrasi tangan (Anime/Manga) dengan panel dinamis, action lines, dan ekspresi karakter yang kuat.',
    category: 'Cinematic & Art', format: '9:16', faceMode: 'full', bg: 'textured',
    layoutHint: 'a grid of dynamic comic panels with action lines, varied shot sizes, and ink-shaded borders',
    camera: 'dynamic comic panels with action lines and varied shot sizes',
    lighting: 'bold cel-shaded ink-and-tone rendering', header: 'STORYBOARD — ANIME / MANGA',
    arc: ['character intro panel', 'the conflict/challenge', 'the product as a dramatic turning point', 'triumphant resolution panel'],
    negatives: NEG.concat(['photorealistic look', 'garbled ink lines']),
  },
  kawaii_playful: {
    name: 'Kawaii / Playful Layout', desc: 'Gaya lucu dengan elemen stiker, warna pastel ceria, ikon imut, dan balon teks yang menyenangkan.',
    category: 'Cinematic & Art', format: '9:16', faceMode: 'full', bg: 'light',
    layoutHint: 'a playful grid of rounded numbered cards with cute mascots, star icons, and friendly callouts',
    camera: 'bright playful flat-illustrated composition with cute cartoon characters, big rounded shapes and friendly icons',
    lighting: 'bright cheerful even lighting, vibrant candy palette', header: 'STORYBOARD — KAWAII PLAYFUL',
    arc: ['cheerful mascot hook', 'introduce concept with cute icons', 'fun relatable example', 'benefit celebration', 'happy recap and CTA'],
    negatives: NEG.concat(['dark somber imagery', 'photorealistic look', 'serious tone']),
  },
  luxury_mood: {
    name: 'Luxury / Premium Mood', desc: 'Eksklusif, gelap, dramatis. Fokus pada kemewahan material dan pencahayaan yang misterius.',
    category: 'Cinematic & Art', format: '9:16', faceMode: 'faceless', bg: 'dark',
    layoutHint: 'a minimalist dark premium sheet with high-contrast panels and gold accents',
    camera: 'slow elegant push-ins, dramatic negative space, macro of premium materials',
    lighting: 'chiaroscuro low-key lighting, gold and deep tones', header: 'STORYBOARD — LUXURY MOOD',
    arc: ['dark atmospheric intro', 'product revealed in a pool of light', 'macro of premium materials', 'elegant logo close'],
    negatives: NEG.concat(['bright flat lighting', 'cheap plastic look']),
  },
  product_hero: {
    name: 'Product Hero Showcase', desc: 'Hero shot produk premium yang bersih dan fokus pada sudut pandang terbaik produk.',
    category: 'Cinematic & Art', format: '1:1', faceMode: 'faceless', bg: 'light',
    layoutHint: 'a clean product showcase grid with minimal annotations and pure white background',
    camera: 'static center-framed hero shots rotating angles of the product',
    lighting: 'clean premium studio light, soft reflections', header: 'STORYBOARD — PRODUCT HERO',
    arc: ['front hero angle', 'side profile', 'macro detail', 'top-down flat lay', 'lifestyle context'],
    negatives: NEG.concat(['busy backgrounds', 'unnatural shadows']),
  },
  cinematic_fpv_nature: {
    name: 'Cinematic FPV Nature', desc: 'Gaya drone FPV kecepatan tinggi melewati pemandangan alam (air terjun, hutan). Sangat dinamis, luas, dan petualang.',
    category: 'Cinematic & Art', format: '9:16', faceMode: 'faceless', bg: 'light',
    layoutHint: 'a dynamic grid of {N} landscape-oriented panels on a vertical sheet; each panel features "DRONE TRAJECTORY" and "SPEED" badges',
    camera: 'fast-paced FPV drone flight path, weaving through obstacles (trees, rocks), diving towards water, expansive wide vistas',
    lighting: 'vibrant natural sunlight, golden hour glow, rainbows in mist, realistic water reflections', header: 'STORYBOARD — FPV NATURE',
    arc: ['drone dives through a canopy of trees', 'skimming the surface of a rushing river', 'soaring over the edge of a massive waterfall', 'flying through a rainbow in the mist', 'pulling back to reveal a breathtaking mountain vista'],
    negatives: NEG.concat(['static camera', 'dull colors', 'urban environments', 'people in frame']),
  },
};

// Old (30+) style ids → new consolidated ids, so existing storyboards keep resolving.
const ALIASES = {
  cube_box_transform: 'mechanical_transform',
  shape_morph_transform: 'mechanical_transform',
  asmr_toy_transform: 'mechanical_transform',
  cube_morph_product: 'mechanical_transform',
  capsule_toss_transform: 'mechanical_transform',
  ugc_review: 'ugc_creator',
  talking_head: 'ugc_creator',
  skit_meme: 'ugc_creator',
  reaction: 'ugc_creator',
  pov: 'ugc_creator',
  grwm: 'ugc_creator',
  tiktok_text_ad: 'social_stylized_text',
  tutorial_steps: 'professional_tutorial',
  diy_build: 'professional_tutorial',
  diy_build_process: 'professional_tutorial',
  recipe_cooking: 'recipe_asmr',
  recipe_cooking_table: 'recipe_asmr',
  education_explainer: 'infographic_explainer',
  infographic_step_guide: 'infographic_explainer',
  kids_education: 'kawaii_playful',
  anime_comic: 'anime_manga',
  anime: 'anime_manga',
  short_story: 'cinematic_ad',
  cinematic_broll: 'cinematic_ad',
  premium_vertical_row: 'cinematic_ad',
  cinematic_matrix_grid: 'cinematic_ad',
  ugc_overlay_card_grid: 'social_stylized_text',
  ugc_overlay_dark_table: 'social_stylized_text',
  ugc_overlay_minimal_clean: 'social_stylized_text',
  unboxing_cinematic_grid: 'unboxing',
  ugc_product_showcase_grid: 'product_hero',
  single_premium_showcase: 'product_hero',
  character_design_turnaround: 'anime_manga',
  tiny_world: 'kawaii_playful',
  tiny_workers_miniature: 'kawaii_playful',
};

const DEFAULT_STYLE = 'product_hero';

function resolveStyleId(id) {
  if (!id) return DEFAULT_STYLE;
  if (STYLES[id]) return id;
  if (ALIASES[id] && STYLES[ALIASES[id]]) return ALIASES[id];
  return DEFAULT_STYLE;
}

function getStyleSpec(id) {
  const resolved = resolveStyleId(id);
  return Object.assign({ id: resolved }, STYLES[resolved]);
}

function listStyles() {
  return Object.keys(STYLES).map((id) => Object.assign({ id }, STYLES[id]));
}

module.exports = { STYLES, ALIASES, DEFAULT_STYLE, resolveStyleId, getStyleSpec, listStyles };
