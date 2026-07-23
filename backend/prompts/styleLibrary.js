// Style Spec library. Each style is compact structured DATA (not a giant
// hardcoded prompt string). The deterministic assembler (masterPrompt.js) and
// the LLM generator (masterPromptLLM.js) both consume these specs.
//
// Fields: id, name, desc, category, format, faceMode (default), bg, camera,
// lighting, header, arc (narrative beats), negatives.

const NEG = ['garbled or misspelled text', 'panels bleeding into the background', 'layout drifting between panels'];

const STYLES = {
  // ── A. Transformasi & Reveal ──
  cube_box_transform: {
    name: 'Cube Box Transformation', desc: 'Kubus mekanis presisi diletakkan di permukaan (panel logam, sambungan mikro & engsel; logo produk di sisi atas) → otomatis mengembang & morph mulus jadi produk/model (mekanis, tersambung, tanpa bagian lepas) → hero shot. Fotorealistis sinematik, ala video viral.',
    category: 'Transformasi & Reveal', format: '9:16', faceMode: 'no_people', bg: 'light',
    camera: 'cinematic photorealistic reveal; static surface shot then a smooth move as the cube expands; shallow DOF (NOT CGI, NOT a glowing robot)',
    lighting: 'natural cinematic light matched to the setting, realistic reflections, subtle bokeh', header: 'STORYBOARD — CUBE TRANSFORM',
    arc: ['a small hyper-detailed mechanical cube rests statically on a surface (metal panels, micro seams & hinges; product logo on top)', 'the mechanical cube activates as its armored panels begin to automatically slide and unfold smoothly', 'the cube panels UNFOLD, slide & telescope outward SMOOTHLY — mechanically connected, no loose parts', 'the mechanism seamlessly forms the subject itself (the product, or a scaled model/structure of it)', 'the finished subject in a premium hero shot'],
    negatives: NEG.concat(['humanoid robot / mecha / Transformer (it becomes the product, not a robot)', 'exploding, flying or detached parts', 'energy beams, glow or magic FX', 'CGI cartoon or anime look', 'redesigned or renamed product', 'hands, human hands, fingers, holding hand, person, human']),
  },
  shape_morph_transform: {
    name: 'Adaptive Shape Transformation', desc: 'Wadah mekanis presisi (bentuk otomatis menyesuaikan subjek: bola, kubus, silinder, prisma segitiga, atau balok) diletakkan di permukaan → mekar & morph mulus otomatis jadi produk/model (mekanis, tersambung, tanpa bagian lepas) → hero shot. Fotorealistis sinematik.',
    category: 'Transformasi & Reveal', format: '9:16', faceMode: 'no_people', bg: 'light',
    camera: 'cinematic photorealistic reveal; static surface shot then a smooth move as the container expands; shallow DOF (NOT CGI)',
    lighting: 'natural cinematic light matched to the setting, realistic reflections, subtle bokeh', header: 'STORYBOARD — ADAPTIVE SHAPE TRANSFORM',
    arc: ['a high-tech mechanical pod/container (spherical orb, cube, cylinder, triangular prism, or block matching the subject) rests statically on a surface', 'the pod activates as its armored panels begin to automatically slide and unfold smoothly', 'the panels UNFOLD, slide & telescope outward SMOOTHLY — mechanically connected, no loose parts', 'the mechanism seamlessly forms the subject itself (the product, or a scaled model/structure of it)', 'the finished subject in a premium hero shot'],
    negatives: NEG.concat(['exploding, flying or detached parts', 'energy beams, glow or magic FX', 'CGI cartoon or anime look', 'redesigned or renamed product', 'hands, human hands, fingers, holding hand, person, human']),
  },
  asmr_toy_transform: {
    name: 'ASMR Toy Transform (Static)', desc: 'Kubus diletakkan di meja lalu membuka sendiri jadi mainan die-cast mini — kamera DIAM total, suara ASMR mekanis, gerak smooth.',
    category: 'Transformasi & Reveal', format: '9:16', faceMode: 'no_people', bg: 'light',
    camera: 'LOCKED static tripod, fixed close top-down over a real worn white table — no pan, zoom, orbit or shake; ONLY the toy moves',
    lighting: 'plain natural indoor light on a worn white table, realistic soft shadows', header: 'STORYBOARD — ASMR TOY TRANSFORM',
    arc: ['a small armored cube (product emblem/button on top) rests statically on a worn white table', 'the cube rests still, then its panels begin to UNFOLD by themselves — smooth, satisfying mechanical motion', 'panels slide, hinge and telescope out step by step, building the shape (ASMR clicks & servo whirs)', 'it forms a highly detailed miniature die-cast collectible of the product on the same table', 'the finished glossy mini die-cast toy rests on the table, held static'],
    negatives: NEG.concat(['any camera movement, pan, zoom, orbit or shake', 'exploding or flying parts', 'glow or energy', 'life-size (must be a small tabletop toy)', 'hands, human hands, fingers, holding hand, person, human']),
  },
  unboxing: {
    name: 'Unboxing', desc: 'Buka kemasan dramatis, reveal produk, close-up detail.',
    category: 'Transformasi & Reveal', format: '9:16', faceMode: 'faceless', bg: 'dark',
    camera: 'handheld top-down and close-up shots with gentle natural movement',
    lighting: 'soft dramatic product studio light', header: 'STORYBOARD — UNBOXING',
    arc: ['sealed package resting on a surface', 'hands opening the box lid', 'lifting the product out of the packaging', 'macro close-up of product details and texture', 'product placed upright in a clean hero angle'],
    negatives: NEG.concat(['distorted hands']),
  },
  before_after: {
    name: 'Before–After', desc: 'Perbandingan sebelum vs sesudah memakai produk.',
    category: 'Transformasi & Reveal', format: '9:16', faceMode: 'chin_max', bg: 'light',
    camera: 'matched static framing so before and after align perfectly, split or side-by-side comparison',
    lighting: 'even neutral lighting for honest comparison', header: 'STORYBOARD — BEFORE / AFTER',
    arc: ['the BEFORE state / problem clearly shown', 'applying or using the product', 'transition wipe between states', 'the AFTER state highlighting the improvement'],
    negatives: NEG.concat(['mismatched framing between before and after']),
  },
  product_assembly: {
    name: 'Product Assembly', desc: 'Bagian-bagian beterbangan menyatu jadi produk.',
    category: 'Transformasi & Reveal', format: '9:16', faceMode: 'faceless', bg: 'dark',
    camera: 'static hero shot, exploded-view parts floating then converging to center',
    lighting: 'dramatic rim studio lighting', header: 'STORYBOARD — PRODUCT ASSEMBLY',
    arc: ['exploded parts floating in space', 'parts drifting toward the center', 'components snapping together', 'the complete product fully assembled, glowing hero shot'],
    negatives: NEG.concat(['missing or extra parts']),
  },
  liquid_splash: {
    name: 'Liquid / Splash Reveal', desc: 'Produk muncul dari cipratan cairan / asap.',
    category: 'Transformasi & Reveal', format: '9:16', faceMode: 'faceless', bg: 'dark',
    camera: 'static high-speed macro capture of splash frozen in motion',
    lighting: 'high-contrast studio light with specular highlights', header: 'STORYBOARD — SPLASH REVEAL',
    arc: ['calm surface before impact', 'liquid or powder bursting upward', 'product emerging from within the splash', 'product settled, droplets suspended around it'],
    negatives: NEG.concat(['muddy or unclear splash']),
  },

  // ── B. UGC & Social ──
  ugc_review: {
    name: 'UGC Review', desc: 'Gaya influencer autentik: hook → demo → ajakan beli.',
    category: 'UGC & Social', format: '9:16', faceMode: 'chin_max', bg: 'light',
    camera: 'natural handheld selfie framing, close-up lifestyle angles',
    lighting: 'soft natural daylight, authentic influencer aesthetic', header: 'STORYBOARD — UGC REVIEW',
    arc: ['relatable hook grabbing attention', 'introducing the product', 'demonstrating it in use', 'showing the satisfying result', 'call-to-action with a buy badge'],
    negatives: NEG.concat(['overly staged studio look']),
  },
  pov: {
    name: 'POV', desc: 'Sudut pandang orang pertama memakai produk.',
    category: 'UGC & Social', format: '9:16', faceMode: 'chin_max', bg: 'light',
    camera: 'first-person POV, arms and hands reaching into frame',
    lighting: 'natural ambient light', header: 'STORYBOARD — POV',
    arc: ['POV noticing the product', 'reaching for and picking it up', 'using it from first-person view', 'POV enjoying the result'],
    negatives: NEG.concat(['third-person angles']),
  },
  talking_head: {
    name: 'Talking-Head', desc: 'Bicara ke kamera memperkenalkan produk.',
    category: 'UGC & Social', format: '9:16', faceMode: 'chin_max', bg: 'light',
    camera: 'centered close-up, subject addressing the camera (lower face only)',
    lighting: 'soft key light, clean background', header: 'STORYBOARD — TALKING HEAD',
    arc: ['opening hook to camera', 'explaining the key benefit', 'holding up the product', 'closing recommendation and CTA'],
    negatives: NEG,
  },
  grwm: {
    name: 'GRWM (Get Ready With Me)', desc: 'Rutinitas persiapan sambil pakai produk.',
    category: 'UGC & Social', format: '9:16', faceMode: 'chin_max', bg: 'light',
    camera: 'handheld vanity/mirror framing, close-ups on application',
    lighting: 'bright flattering vanity light', header: 'STORYBOARD — GRWM',
    arc: ['starting the routine', 'applying the product step by step', 'close-up of the finish', 'final look and CTA'],
    negatives: NEG,
  },
  skit_meme: {
    name: 'Skit / Meme', desc: 'Komedi singkat relatable seputar produk.',
    category: 'UGC & Social', format: '9:16', faceMode: 'chin_max', bg: 'light',
    camera: 'handheld comedic framing, punchy quick cuts',
    lighting: 'natural everyday light', header: 'STORYBOARD — SKIT',
    arc: ['relatable problem set-up', 'exaggerated struggle', 'product as the punchline solution', 'happy payoff and CTA'],
    negatives: NEG,
  },
  reaction: {
    name: 'Reaction / Duet', desc: 'Reaksi terhadap produk atau hasil.',
    category: 'UGC & Social', format: '9:16', faceMode: 'chin_max', bg: 'light',
    camera: 'split-screen or side reaction framing, close-up',
    lighting: 'natural light', header: 'STORYBOARD — REACTION',
    arc: ['seeing the product for the first time', 'trying it out', 'genuine reaction to the result', 'verdict and CTA'],
    negatives: NEG,
  },

  // ── C. Proses, Tutorial & Edukasi ──
  timelapse_process: {
    name: 'Timelapse Proses', desc: 'Proses dipercepat dari awal sampai hasil akhir.',
    category: 'Proses & Edukasi', format: '16:9', faceMode: 'faceless', bg: 'light',
    camera: 'a static lock-off wide shot from the exact same fixed position; only the subject progresses',
    lighting: 'consistent daylight shifting subtly over time', header: 'STORYBOARD — TIMELAPSE',
    arc: ['the starting/empty state', 'early progress', 'mid-way build-up', 'the finished result'],
    negatives: NEG.concat(['viewpoint shifting between panels']),
  },
  tutorial_steps: {
    name: 'Tutorial Langkah', desc: 'Panduan how-to langkah demi langkah bernomor.',
    category: 'Proses & Edukasi', format: '9:16', faceMode: 'chin_max', bg: 'light',
    camera: 'clean top-down and close-up on hands performing each step',
    lighting: 'bright even instructional lighting', header: 'STORYBOARD — TUTORIAL',
    arc: ['tools/materials laid out', 'step 1 action', 'following steps in sequence', 'the finished result'],
    negatives: NEG,
  },
  recipe_cooking: {
    name: 'Resep & Masakan', desc: 'Langkah memasak + ASMR, cocok kuliner/F&B.',
    category: 'Proses & Edukasi', format: '9:16', faceMode: 'faceless', bg: 'light',
    camera: 'top-down and macro close-ups of cooking actions',
    lighting: 'warm appetizing food-studio light', header: 'STORYBOARD — RECIPE / ASMR',
    arc: ['fresh ingredients prepared', 'chopping / mixing step', 'cooking with sizzle and steam', 'plating the finished dish'],
    negatives: NEG.concat(['unappetizing colors']),
  },
  education_explainer: {
    name: 'Edukasi Explainer', desc: 'Menjelaskan konsep/fitur dengan ikon & diagram bersih.',
    category: 'Proses & Edukasi', format: '16:9', faceMode: 'faceless', bg: 'light',
    camera: 'flat clean graphic composition with icons, arrows and callouts',
    lighting: 'even flat lighting, vibrant infographic palette', header: 'STORYBOARD — EXPLAINER',
    arc: ['the concept/question introduced', 'breaking it into parts with icons', 'a concrete example', 'summary with key takeaway'],
    negatives: NEG.concat(['cluttered unreadable diagrams']),
  },
  diy_build: {
    name: 'DIY / Build', desc: 'Rakit atau kerajinan miniatur langkah demi langkah.',
    category: 'Proses & Edukasi', format: '9:16', faceMode: 'faceless', bg: 'light',
    camera: 'close-up on hands building, occasional top-down',
    lighting: 'clean workshop light', header: 'STORYBOARD — DIY BUILD',
    arc: ['raw materials and tools', 'assembling the base', 'adding details', 'the finished build revealed'],
    negatives: NEG,
  },

  // ── D. Sinematik & Branding ──
  short_story: {
    name: 'Cerita Pendek Sinematik', desc: 'Iklan bernarasi dengan alur cerita sinematik.',
    category: 'Sinematik & Branding', format: '16:9', faceMode: 'full', bg: 'dark',
    camera: 'cinematic coverage varying wide, medium and close-up shots with intentional composition',
    lighting: 'moody cinematic lighting with depth', header: 'STORYBOARD — SHORT FILM',
    arc: ['setup establishing the character/world', 'a problem or desire emerges', 'the product enters as the turning point', 'satisfying resolution', 'brand tag / CTA'],
    negatives: NEG,
  },
  cinematic_broll: {
    name: 'Cinematic B-Roll', desc: 'Potongan sinematik estetik untuk iklan/TVC.',
    category: 'Sinematik & Branding', format: '16:9', faceMode: 'faceless', bg: 'dark',
    camera: 'slow deliberate cinematic moves — slider, push-in, macro detail shots',
    lighting: 'high-end commercial lighting, shallow depth of field', header: 'STORYBOARD — B-ROLL',
    arc: ['atmospheric establishing shot', 'macro texture and detail shots', 'the product in a lifestyle context', 'the hero beauty shot'],
    negatives: NEG,
  },
  product_hero: {
    name: 'Product Hero Showcase', desc: 'Hero shot produk premium yang bersih.',
    category: 'Sinematik & Branding', format: '1:1', faceMode: 'faceless', bg: 'light',
    camera: 'static center-framed hero shots rotating angles of the product',
    lighting: 'clean premium studio light, soft reflections', header: 'STORYBOARD — PRODUCT HERO',
    arc: ['front hero angle', 'three-quarter angle', 'macro detail of a key feature', 'product with logo and CTA'],
    negatives: NEG,
  },
  luxury_mood: {
    name: 'Luxury / Premium Mood', desc: 'Mewah, gelap, dramatis, eksklusif.',
    category: 'Sinematik & Branding', format: '9:16', faceMode: 'faceless', bg: 'dark',
    camera: 'slow elegant push-ins, dramatic negative space',
    lighting: 'chiaroscuro low-key lighting, gold and deep tones', header: 'STORYBOARD — LUXURY',
    arc: ['dark atmospheric intro', 'product revealed in a pool of light', 'macro of premium materials', 'elegant logo close'],
    negatives: NEG,
  },
  fashion_lookbook: {
    name: 'Fashion Lookbook', desc: 'Busana / OOTD bergaya editorial.',
    category: 'Sinematik & Branding', format: '9:16', faceMode: 'full', bg: 'light',
    camera: 'editorial full-body and detail shots, confident poses',
    lighting: 'clean fashion-editorial lighting', header: 'STORYBOARD — LOOKBOOK',
    arc: ['full-look reveal', 'walking / movement shot', 'close-up of fabric and details', 'final pose with brand tag'],
    negatives: NEG,
  },

  // ── E. Artistik / Niche ──
  asmr_satisfying: {
    name: 'ASMR / Satisfying', desc: 'Fokus tekstur & suara, visual memuaskan.',
    category: 'Artistik / Niche', format: '9:16', faceMode: 'faceless', bg: 'dark',
    camera: 'extreme macro, slow tactile close-ups',
    lighting: 'soft directional light emphasizing texture', header: 'STORYBOARD — ASMR',
    arc: ['tactile close-up intro', 'a satisfying action (press, peel, pour)', 'the most satisfying peak moment', 'calm resolved final frame'],
    negatives: NEG,
  },
  stop_motion: {
    name: 'Stop-Motion', desc: 'Animasi frame-by-frame yang playful.',
    category: 'Artistik / Niche', format: '9:16', faceMode: 'faceless', bg: 'light',
    camera: 'locked static frame with objects nudged between frames, handmade feel',
    lighting: 'even craft-table lighting', header: 'STORYBOARD — STOP MOTION',
    arc: ['objects arranged at start', 'playful incremental movement', 'objects forming the product/message', 'final composed frame'],
    negatives: NEG.concat(['motion blur (should look frame-stepped)']),
  },
  tiny_world: {
    name: 'Miniature / Tiny World', desc: 'Gaya Pixar 3D dengan pekerja/objek mini.',
    category: 'Artistik / Niche', format: '9:16', faceMode: 'faceless', bg: 'light',
    camera: 'macro tilt-shift look making things feel miniature',
    lighting: 'warm cozy 3D-animation lighting', header: 'STORYBOARD — TINY WORLD',
    arc: ['tiny characters arriving at the product', 'working on/around it', 'a playful build or fix', 'celebrating the finished result'],
    negatives: NEG,
  },
  anime_comic: {
    name: 'Anime / Komik', desc: 'Gaya manga/komik bercerita (ilustrasi).',
    category: 'Artistik / Niche', format: '9:16', faceMode: 'full', bg: 'textured',
    camera: 'dynamic comic panels with action lines and varied shot sizes',
    lighting: 'bold cel-shaded ink-and-tone rendering', header: 'STORYBOARD — COMIC',
    arc: ['character intro panel', 'the conflict/challenge', 'the product as a dramatic turning point', 'triumphant resolution panel'],
    negatives: NEG,
  },
};

// Old (16) style ids → new ids, so existing storyboards keep resolving.
const ALIASES = {
  premium_vertical_row: 'cinematic_broll',
  infographic_step_guide: 'education_explainer',
  tiktok_script_table: 'ugc_review',
  cinematic_matrix_grid: 'cinematic_broll',
  ugc_overlay_card_grid: 'ugc_review',
  ugc_overlay_dark_table: 'ugc_review',
  ugc_overlay_minimal_clean: 'ugc_review',
  unboxing_cinematic_grid: 'unboxing',
  ugc_product_showcase_grid: 'product_hero',
  comic_grunge_storyboard: 'anime_comic',
  character_design_turnaround: 'anime_comic',
  recipe_cooking_table: 'recipe_cooking',
  clean_step_card_grid: 'tutorial_steps',
  diy_build_process: 'diy_build',
  tiny_workers_miniature: 'tiny_world',
  cube_morph_product: 'cube_box_transform',
  capsule_toss_transform: 'cube_box_transform',
  single_premium_showcase: 'product_hero',
  anime: 'anime_comic',
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
