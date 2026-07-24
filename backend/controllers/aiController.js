const { AI_API_HOST, AI_API_TOKEN } = require('../config/secrets');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { getDb } = require('../db');
const { uploadsDir } = require('../config');

const LAYOUT_STYLES = require('../constants/layoutStyles');
const { resolveStyleId, getStyleSpec } = require('../prompts/styleLibrary');

// Styles whose VIDEO should get the full cinematic atmosphere (haze + subtle lens
// flare + shallow DOF). Every other style stays clean & crisp (DOF only, no
// haze/flare) so products/UGC/tutorials/comparisons read clearly and honestly.
const CINEMATIC_VIDEO_STYLES = new Set([
  'cube_box_transform', 'shape_morph_transform', 'short_story', 'cinematic_broll', 'luxury_mood',
  'product_assembly', 'liquid_splash', 'fashion_lookbook',
]);

// Styles where the subject changes SCALE or EXPANDS on screen (a cube/pod unfolds
// into a full product, parts converge into a product, a splash bursts). These crop
// easily when the camera sits too close, so the VIDEO prompt must be framed WIDE
// with margin for the LARGEST/final state of the motion — never tight on the small
// starting object.
const TRANSFORM_FRAMING_STYLES = new Set([
  'cube_box_transform', 'shape_morph_transform', 'asmr_toy_transform',
  'product_assembly', 'liquid_splash',
]);


function httpRequest(url, headers, body) {
  return new Promise((resolve, reject) => {
    const urlParsed = new URL(url);
    const client = url.startsWith('https') ? https : http;
    const port = urlParsed.port || (url.startsWith('https') ? 443 : 80);

    const options = {
      hostname: urlParsed.hostname,
      port: port,
      path: urlParsed.pathname + urlParsed.search,
      method: 'POST',
      headers: headers,
      timeout: 90000 // 90 seconds timeout for large vision payloads
    };

    const req = client.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          body: data
        });
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request Timeout (90s)'));
    });

    req.write(JSON.stringify(body));
    req.end();
  });
}

// Resolve any image reference (data URL, /uploads/ path, http URL, or raw base64)
// into a proper `data:image/...;base64,...` URL for the vision LLM. Without this, a
// path like "/uploads/refgen_x.png" gets sent as inline_data.data and the API fails
// with "Base64 decoding failed".
async function resolveImageDataUrl(src) {
  if (!src || typeof src !== 'string') return null;
  if (src.startsWith('data:image')) return src;
  // Local upload (relative /uploads/... or absolute URL containing /uploads/)
  if (src.includes('/uploads/')) {
    try {
      const idx = src.indexOf('/uploads/');
      const rel = src.substring(idx + '/uploads/'.length).split('?')[0];
      const full = path.join(uploadsDir, rel);
      if (fs.existsSync(full)) {
        const ext = (full.split('.').pop() || 'png').toLowerCase();
        const mime = (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg' : (ext === 'webp' ? 'image/webp' : 'image/png');
        return `data:${mime};base64,${fs.readFileSync(full).toString('base64')}`;
      }
    } catch (e) {}
    return null;
  }
  // Remote http(s)
  if (src.startsWith('http')) {
    try {
      const r = await fetch(src);
      if (r.ok) {
        const buf = Buffer.from(await r.arrayBuffer());
        return `data:image/png;base64,${buf.toString('base64')}`;
      }
    } catch (e) {}
    return null;
  }
  // Otherwise assume it is already raw base64 bytes.
  return `data:image/png;base64,${src}`;
}

async function writePrompt(req, res) {
  const { concept, style, videoEngine, gridCount, duration, aspectRatio, hasRefImage, refImage } = req.body;
  if (!concept) {
    return res.status(400).json({ message: 'Ide kasar (concept) harus diisi.' });
  }

  // Predefined diverse commercial themes to prevent LLM selection bias for random ideas
  const RANDOM_THEMES = [
    "Iklan parfum mewah aroma alam dengan suasana hutan berkabut pagi hari yang misterius dan premium.",
    "Iklan sepatu lari futuristik ultra-ringan dengan kilatan listrik neon dinamis di landasan pacu.",
    "Iklan lipstik merah ceri glossy dengan nuansa fashion moodboard retro dan transisi cepat ala reels.",
    "Iklan jam tangan mekanik mewah dengan detail roda gigi kuningan berputar lambat dan presisi tinggi.",
    "Iklan smartwatch olahraga tangguh yang sedang diuji di bawah cipratan air ekstrem dan lumpur.",
    "Iklan cokelat cair premium meleleh yang dituangkan perlahan ke atas kue tart stroberi segar.",
    "Iklan kopi espresso susu hangat (latte art) yang diracik barista di kafe estetik berkayu hangat.",
    "Iklan mainan action figure robot mecha futuristik yang sedang dirakit secara detail di meja kerja.",
    "Iklan keyboard mekanikal RGB kustom dengan keycaps warna pastel retro bergaya komik/pop-art.",
    "Iklan tas ransel petualangan outdoor anti-air yang dibawa mendaki menembus hujan di puncak gunung.",
    "Iklan lilin aromaterapi menenangkan dengan kepulan asap tipis di samping buku grimoire mistis hangat.",
    "Iklan minuman kaleng bersoda dingin yang menyegarkan dengan ledakan gelembung and es batu pecah.",
    "Iklan casing smartphone estetik dengan coretan tangan bergaya seni jalanan perkotaan (cyberpunk/pop-art).",
    "Iklan perhiasan kalung emas berlian elegan yang berkilau di leher model di galeri seni beton modern.",
    "Iklan kue kering kering mentega (cookies) yang baru matang diangkat dari oven dapur kayu pedesaan.",
    "Iklan paket perkakas kayu vintage (palu, penggaris logam) di atas meja tukang kayu berdebu estetik."
  ];

  let selectedConcept = concept;
  if (concept === 'minta_ide_acak') {
    const randomIndex = Math.floor(Math.random() * RANDOM_THEMES.length);
    selectedConcept = RANDOM_THEMES[randomIndex];
  }

  try {
    const db = getDb();
    const settings = await db.get('SELECT * FROM ai_settings LIMIT 1');
    
    // Default fallbacks if settings table is empty
    let apiHost = AI_API_HOST;
    let apiToken = AI_API_TOKEN;

    if (settings) {
      apiHost = settings.endpoint;
      apiToken = settings.api_key;
    }

    const layoutListText = LAYOUT_STYLES.map(s => `- "${s.value}": ${s.label}`).join('\n');

    let systemInstruction = '';
    const styleExists = style && LAYOUT_STYLES.some(s => s.value === style);
    
    if (styleExists) {
      systemInstruction = `Anda adalah seorang sutradara video iklan komersial profesional dan desainer storyboard.
Tugas Anda adalah menerima ide kasar dari pengguna, lalu menghasilkan:
1. Sebuah Judul Proyek yang elegan, padat, dan premium (maksimal 5 kata).
2. Sebuah Deskripsi Storyboard rinci yang siap digunakan sebagai prompt AI (berisi detail visual, gaya sinematik, sudut kamera, warna, dan pencahayaan) yang secara khusus ditulis agar serasi dan cocok dengan gaya layout storyboard: "${style}".
3. Key 'layout' harus bernilai "${style}" (karena pengguna telah memilih gaya ini).

PENTING: Tulis deskripsi secara ringkas, padat, dan sinematik. Total panjang teks untuk nilai 'description' HARUS DI BAWAH 1500 karakter agar muat saat digabung dengan master prompt. Jangan bertele-tele.

Anda harus mengembalikan respon hanya dalam format JSON mentah dengan key 'title', 'description', dan 'layout'. Jangan bungkus dalam markdown (jangan pakai \`\`\`json). Contoh output:
{
  "title": "Judul Elegan",
  "description": "Deskripsi visual rinci...",
  "layout": "${style}"
}`;
    } else {
      systemInstruction = `Anda adalah seorang sutradara video iklan komersial profesional dan desainer storyboard.
Tugas Anda adalah menerima ide kasar dari pengguna, lalu menghasilkan:
1. Sebuah Judul Proyek yang elegan, padat, dan premium (maksimal 5 kata).
2. Sebuah Deskripsi Storyboard rinci yang siap digunakan sebagai prompt AI (berisi detail visual, gaya sinematik, sudut kamera, warna, dan pencahayaan).
3. Memilih satu Gaya Layout Storyboard yang paling cocok untuk ide/konsep tersebut dari daftar gaya berikut:
${layoutListText}

PENTING: Tulis deskripsi secara ringkas, padat, dan sinematik. Total panjang teks untuk nilai 'description' HARUS DI BAWAH 1500 karakter agar muat saat digabung dengan master prompt. Jangan bertele-tele.

Anda harus mengembalikan respon hanya dalam format JSON mentah dengan key 'title', 'description', dan 'layout' (diisi dengan value/kode dari layout yang Anda pilih). Jangan bungkus dalam markdown (jangan pakai \`\`\`json). Contoh output:
{
  "title": "Judul Elegan",
  "description": "Deskripsi visual rinci...",
  "layout": "premium_vertical_row"
}`;
    }

    let userMessageContent = concept === 'minta_ide_acak'
      ? `Buatlah konsep ide video komersial lengkap yang menarik berdasarkan tema acak berikut: "${selectedConcept}"`
      : `Ide Kasar: ${concept}`;

    // Calculate pageCount and totalPanels based on video engine and duration
    let secondsPerPage = 15;
    const engine = videoEngine || 'seedance';
    if (engine === 'omni') {
      secondsPerPage = 10;
    } else if (engine === 'veo') {
      secondsPerPage = 8;
    }
    const durVal = duration ? Number(duration) : 15;
    const gCount = gridCount ? Number(gridCount) : 6;
    const pageCount = Math.max(1, Math.min(8, Math.ceil(durVal / secondsPerPage)));
    const totalPanels = pageCount * gCount;

    // Append context parameters if available to enrich LLM response
    let contextClause = "\n\nKonteks parameter tambahan untuk diselaraskan dalam prompt deskripsi:";
    if (videoEngine) contextClause += `\n- Video Engine yang digunakan: ${videoEngine}`;
    contextClause += `\n- Jumlah halaman storyboard: ${pageCount} Halaman`;
    contextClause += `\n- Jumlah panel per halaman: ${gCount} Panel`;
    contextClause += `\n- Total panel sekuensial secara keseluruhan: ${totalPanels} Panel`;
    if (duration) contextClause += `\n- Total durasi video: ${durVal} detik`;
    if (aspectRatio) contextClause += `\n- Ukuran gambar/Rasio aspek: ${aspectRatio}`;
    if (hasRefImage) {
      contextClause += `\n- Catatan: Pengguna mengunggah gambar referensi produk asli. Pastikan deskripsi prompt fokus untuk menjaga konsistensi produk/subjek dari gambar referensi (pertahankan detail produk tersebut di seluruh panel visual).`;
    }
    contextClause += `\n\nSesuaikan deskripsi visual agar selaras dengan parameter-parameter tersebut. Karena durasi video adalah ${durVal} detik dengan engine ${engine}, storyboard ini akan memiliki ${pageCount} halaman dengan ${gCount} panel per halaman (Total: ${totalPanels} panel sekuensial). Alur cerita dalam deskripsi Anda WAJIB merinci pembagian alur panel dari Panel 1 sampai Panel ${totalPanels} secara kronologis untuk mencakup seluruh durasi tersebut agar gambar di setiap halaman tidak berulang.`;

    userMessageContent += contextClause;

    let userMessagePayload = [];
    const refDataUrl = (hasRefImage && refImage) ? await resolveImageDataUrl(refImage) : null;
    if (refDataUrl) {
      userMessagePayload = [
        {
          type: 'text',
          text: userMessageContent
        },
        {
          type: 'image_url',
          image_url: {
            url: refDataUrl
          }
        }
      ];
    } else {
      // No usable reference image -> text-only (avoids sending an invalid path as base64).
      userMessagePayload = userMessageContent;
    }

    const payload = {
      model: settings?.model || 'gemini-3-flash',
      messages: [
        {
          role: 'system',
          content: systemInstruction
        },
        {
          role: 'user',
          content: userMessagePayload
        }
      ],
      temperature: 0.7
    };

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiToken}`
    };

    const response = await httpRequest(`${apiHost}/chat/completions`, headers, payload);

    if (response.statusCode !== 200) {
      return res.status(500).json({ message: 'Gagal menghubungi server AI.', error: response.body });
    }

    const resJson = JSON.parse(response.body);
    const content = resJson.choices?.[0]?.message?.content || '';
    
    // Parse response content robustly
    let cleanText = content.trim();
    if (cleanText.startsWith('```')) {
      cleanText = cleanText.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '');
    }

    try {
      const parsed = JSON.parse(cleanText.trim());
      // Ensure selected layout is valid, fallback to 'premium_vertical_row'
      const selectedLayout = LAYOUT_STYLES.some(s => s.value === parsed.layout) ? parsed.layout : 'premium_vertical_row';
      return res.json({
        title: parsed.title || 'Untitled AI Project',
        description: parsed.description || concept,
        layout: selectedLayout
      });
    } catch (parseErr) {
      return res.json({
        title: concept.substring(0, 20) + '...',
        description: cleanText,
        layout: 'premium_vertical_row'
      });
    }

  } catch (error) {
    return res.status(500).json({ message: 'Terjadi kesalahan sistem saat memproses AI.', error: error.message });
  }
}

// Core internal function to generate video prompts using vision model (can be called by controller endpoints or background task)
async function generateVideoPromptsInternal({ storyboardId, promptType, regenerate, enableVo, voLanguage, voTone, videoDuration }) {
  const db = getDb();
  
  // Retrieve storyboard
  const storyboard = await db.get('SELECT * FROM storyboards WHERE id = ?', [storyboardId]);
  if (!storyboard) {
    throw new Error('Storyboard tidak ditemukan.');
  }

  // Parse existing prompts to preserve other fields
  let currentPrompts = { imageToVideoPrompt: null, textToVideoPrompt: null };
  if (storyboard.video_prompts) {
    try {
      const parsed = JSON.parse(storyboard.video_prompts);
      if (parsed && typeof parsed === 'object') {
        if ('imageToVideoPrompt' in parsed || 'textToVideoPrompt' in parsed) {
          currentPrompts = {
            imageToVideoPrompt: parsed.imageToVideoPrompt || null,
            textToVideoPrompt: parsed.textToVideoPrompt || null
          };
        } else if ('visualPrompt' in parsed) {
          currentPrompts = {
            imageToVideoPrompt: null,
            textToVideoPrompt: parsed.visualPrompt || null
          };
        }
      }
    } catch (e) {}
  }

  const targetType = promptType === 'text-to-video' ? 'text-to-video' : 'image-to-video';

  // If specific prompt already exists and not forcing regeneration, return it directly
  if (targetType === 'image-to-video' && currentPrompts.imageToVideoPrompt && !regenerate) {
    return JSON.stringify(currentPrompts);
  }
  if (targetType === 'text-to-video' && currentPrompts.textToVideoPrompt && !regenerate) {
    return JSON.stringify(currentPrompts);
  }

  const settings = await db.get('SELECT * FROM ai_settings LIMIT 1');
  
  let apiHost = AI_API_HOST;
  let apiToken = AI_API_TOKEN;

  if (settings) {
    apiHost = settings.endpoint;
    apiToken = settings.api_key;
  }

  // Convert all storyboard panels/images to Base64 to send to vision model
  let panelImages = [];
  try {
    if (storyboard.image_path && storyboard.image_path.startsWith('[')) {
      panelImages = JSON.parse(storyboard.image_path);
    } else {
      panelImages = storyboard.image_path ? [storyboard.image_path] : [];
    }
  } catch (e) {
    panelImages = storyboard.image_path ? [storyboard.image_path] : [];
  }

  const imageParts = [];
  for (let i = 0; i < panelImages.length; i++) {
    const imgPath = panelImages[i];
    
    // Check if it's a local upload (either relative /uploads/ or absolute URL containing /uploads/)
    if (imgPath.includes('/uploads/')) {
      const idx = imgPath.indexOf('/uploads/');
      const relativeFilename = imgPath.substring(idx + '/uploads/'.length);
      const fullPath = path.join(uploadsDir, relativeFilename);
      if (fs.existsSync(fullPath)) {
        const imgBuffer = fs.readFileSync(fullPath);
        const base64 = imgBuffer.toString('base64');
        imageParts.push({
          type: 'image_url',
          image_url: {
            url: `data:image/png;base64,${base64}`
          }
        });
        continue;
      }
    }

    // Otherwise, if it starts with http, download and convert to base64
    if (imgPath.startsWith('http')) {
      try {
        const res = await fetch(imgPath);
        if (res.ok) {
          const arrayBuffer = await res.arrayBuffer();
          const imgBuffer = Buffer.from(arrayBuffer);
          const base64 = imgBuffer.toString('base64');
          imageParts.push({
            type: 'image_url',
            image_url: {
              url: `data:image/png;base64,${base64}`
            }
          });
        } else {
          console.error(`Failed to fetch remote image from ${imgPath}, status: ${res.status}`);
        }
      } catch (err) {
        console.error(`Error downloading remote image ${imgPath}:`, err);
      }
    }
  }

  const totalScenes = panelImages.length;

  let gridCount = 6;
  if (storyboard.generation_params) {
    try {
      const params = JSON.parse(storyboard.generation_params);
      if (params.gridCount) {
        gridCount = Number(params.gridCount);
      }
    } catch (e) {}
  }

  let gridDescText = `exactly ${gridCount} panels`;
  if (storyboard.style === 'premium_vertical_row') {
    gridDescText = `exactly ${gridCount} widescreen panels arranged in a vertical stack (from top to bottom)`;
  } else {
    if (gridCount === 4) gridDescText = "exactly 4 panels arranged in a 2x2 grid (from top-left, top-right, bottom-left, to bottom-right)";
    else if (gridCount === 6) gridDescText = "exactly 6 panels arranged in a 3x2 grid (3 columns, 2 rows)";
    else if (gridCount === 8) gridDescText = "exactly 8 panels arranged in a 4x2 grid (4 columns, 2 rows)";
    else if (gridCount === 9) gridDescText = "exactly 9 panels arranged in a 3x3 grid (3 columns, 3 rows)";
    else if (gridCount === 12) gridDescText = "exactly 12 panels arranged in a 4x3 grid (4 columns, 3 rows)";
  }

  let durationClause = '';
  const durVal = videoDuration || 'auto';
  if (durVal === 'auto') {
    if (targetType === 'image-to-video') {
      durationClause = `Each individual scene/panel video has a target duration of: Kling/SeedDance/Luma: 15 seconds, Omni: 10 seconds, Gemini: 8 seconds. Size each scene's narration to FILL most of the scene at a natural ~1.5 words/second pace (clear, not rushed, but no long silent gaps): about 9-12 words for 8s, 12-15 for 10s, and 18-23 for 15s (hard max 23).`;
    } else {
      durationClause = `Each individual scene/panel video has a target duration of: 15 seconds. If Voiceover (VO) is enabled, size the narration to FILL most of the ~15s scene at a natural pace — about 18-23 words (hard max 23) — not rushed and not sparse.`;
    }
  } else {
    const seconds = Number(durVal);
    const maxWords = Math.min(23, Math.round(seconds * 1.5));
    const minWords = Math.max(4, Math.round(seconds * 1.1));
    durationClause = `Each individual scene/panel video has a target duration of: ${seconds} seconds. If Voiceover (VO) is enabled, size the narration to FILL most of the scene at a natural pace — about ${minWords}-${maxWords} words (hard max ${maxWords}) — not rushed and not sparse.`;
  }

  let toneClause = '';
  if (enableVo && voTone) {
    const toneRules = {
      'casual': 'Gaya bahasa SANTAI, AKRAB, GAUL, menggunakan kata-kata sehari-hari seperti "kamu", "yuk", "nih", "lho", layaknya berbicara dengan teman akrab. Hindari kata-kata formal.',
      'comedy': 'Gaya bahasa LUCU, HUMORIS, PENUH CANDAAN, dan MENGHIBUR. Gunakan plesetan ringan atau ekspresi jenaka agar audiens tertawa.',
      'excited': 'Gaya bahasa SANGAT ANTUSIAS, BERSEMANGAT, PROMOSIONAL (SELLING), bernada tinggi, persuasif, menarik perhatian (clickbait-style), penuh energi untuk jualan/promo.',
      'formal': 'Gaya bahasa RESMI, SERIUS, EDUKATIF, profesional, menggunakan tata bahasa yang baik dan benar (EYD/PUEBI), informatif dan berwibawa.',
      'emotional': 'Gaya bahasa MENYENTUH HATI, EMOSIONAL, EMPATIS, HANGAT, puitis, dan penuh perasaan agar menyentuh sisi kemanusiaan atau perasaan terdalam audiens.',
      'storytelling': 'Gaya bahasa BERCERITA (Storytelling), naratif, mengalir seperti mendongeng, membuat penasaran dengan alur cerita yang memikat.',
      'dramatic': 'Gaya bahasa DRAMATIS, TEGANG, MISTERIUS, penuh penekanan (suspenseful), seolah ada rahasia besar atau sesuatu yang luar biasa akan terjadi.',
      'soft_spoken': 'Gaya bahasa LEMBUT, TENANG, BISIKAN ASMR, santai, menenangkan jiwa, ritme perlahan dan sangat rileks.',
      'luxury_premium': 'Gaya bahasa ELEGAN, MEWAH, EKSLUSIF, mahal, sinematik, menggunakan diksi kelas tinggi yang menggambarkan prestise dan kemewahan.',
      'poetic_aesthetic': 'Gaya bahasa PUITIS, ESTETIK, ARTISTIK, penuh estetika visual, kata-kata indah yang puitis dan memanjakan imajinasi.',
      'news_anchor': 'Gaya bahasa REPORTER BERITA, Breaking News, lugas, cepat, berdasarkan fakta menarik, berwibawa seperti pembawa acara berita internasional.',
      'motivator_inspirational': 'Gaya bahasa MOTIVASI, INSPIRATIF, MEMBAKAR SEMANGAT, membangkitkan percaya diri dan dorongan positif yang kuat.',
      'review_honest': 'Gaya bahasa REVIEWER JUJUR, objektif, tanpa basa-basi, langsung pada poin plus-minus produk, seperti ulasan influencer tepercaya.',
      'cinematic_trailer': 'Gaya bahasa MOVIE TRAILER HOLLYWOOD, epik, megah, bernada dalam dan berwibawa seperti narasi trailer film box-office.',
      'sarcastic_witty': 'Gaya bahasa WITTY & SINDRAN HALUS, cerdas, sinis relatable, sarkasme lucu yang menyindir masalah sehari-hari dengan jenaka.',
      'kids_playful': 'Gaya bahasa CERIA & DUNIA ANAK, gembira, energik, komunikatif, penuh kegembiraan dunia mainan dan petualangan seru.'
    };
    const toneDesc = toneRules[voTone] || voTone;
    toneClause = `Crucial: The tone and writing style of the voiceover script MUST strictly follow this style (in the narration language): "${toneDesc}". You must rewrite the narration using vocabulary, slang, emotional triggers, or structural patterns that perfectly match this style. For example, if it is casual or comedy, use slang and conversational Indonesian.`;
  }

  // Resolve legacy/aliased ids to the canonical style so old storyboards
  // (cube_morph_product, capsule_toss_transform) get the CURRENT rules.
  const resolvedStyle = resolveStyleId(storyboard.style);
  let capsuleStyleClause = '';
  if (resolvedStyle === 'cube_box_transform') {
    // Cube transformation reveal (photorealistic viral cube -> subject).
    capsuleStyleClause = `
CRITICAL CUBE TRANSFORMATION VIDEO RULES (photorealistic viral cube-reveal — NOT a glowing humanoid Transformer robot):
1. PHOTOREALISTIC and cinematic. A small hyper-detailed mechanical cube (armored panels, fine seams, subtle glowing accents or the product's brand emblem) rests statically on a fitting real surface/table. Smooth motion move as the cube expands, shallow depth of field. NOT a CGI cartoon.
2. The cube's panels UNFOLD, slide and telescope outward SMOOTHLY and satisfyingly (like a premium precision transforming toy) — mechanically CONNECTED, no loose or detached parts — and build/reshape into the subject at its natural scale — the product itself, a scaled collectible of it, or a full-scale structure/scene for a place/vehicle/building. NO hands visible in frame. NO exploding/flying/detached parts, NO energy beams, NO glow-energy magic, and it does NOT become a humanoid robot/mecha/Transformer.
3. Keep the subject's EXACT identity, branding and colors. NO human hands in frame (automatic mechanical unfolding). End on the finished photorealistic result in a cinematic hero shot.
I2V FIELD NOTE: in the "imageToVideoPrompt" field, convey all of this ONLY as camera + the unfolding MOTION (framed WIDE so the fully-formed subject is never cropped) — do NOT write "build/create the product" or re-describe the product there; the full build/identity description belongs to the "textToVideoPrompt" field.`;
  }

  if (resolvedStyle === 'asmr_toy_transform') {
    // Static-camera ASMR toy transform on a tabletop.
    capsuleStyleClause = `
CRITICAL ASMR TOY TRANSFORM VIDEO RULES (LOCKED camera, tabletop, ASMR — no camera effects):
1. The CAMERA IS COMPLETELY LOCKED/STATIC on a tripod over a real worn white table, framed at a COMFORTABLE, slightly WIDE top-down distance with clear empty margin around the toy — wide enough that the FULLY-UNFOLDED finished die-cast toy stays entirely in frame and is NEVER cropped. ABSOLUTELY NO camera movement — no pan, tilt, zoom, orbit, dolly, push-in or shake (do NOT move to keep up with the toy; the starting framing must already fit the final result). ONLY the toy moves. Ignore any 'CAM:' tag that implies movement; keep the shot perfectly still.
2. A small armored cube rests statically on the table and SMOOTHLY, mechanically UNFOLDS by itself — panels slide, hinge and telescope out step by step — into a highly detailed miniature die-cast collectible of the product on the SAME table. Photorealistic; mechanically connected; NO human hands visible in frame; NO flying/detaching parts; NO glow/energy; NOT a humanoid robot/mecha.
3. AUDIO = satisfying ASMR mechanical transformation sounds ONLY (soft clicks, servo whirs, panels locking into place). No music-over.
4. Keep the exact same worn white table and the product's exact identity throughout; end on the finished mini die-cast toy resting still on the table.
I2V FIELD NOTE: in the "imageToVideoPrompt" field, express this ONLY as the locked WIDE framing + the unfolding MOTION and sounds — do NOT re-describe or "build" the product there; the full identity/build description belongs to the "textToVideoPrompt" field.`;
  }

  if (resolvedStyle === 'shape_morph_transform') {
    const { getInitialContainerDescription } = require('../prompts/containerShapes');
    const containerObj = getInitialContainerDescription(storyboard.prompt || storyboard.title, 'auto');
    const shapeDesc = containerObj.shapeEn;

    // Adaptive Shape transformation reveal — STRICT SINGLE SHAPE.
    capsuleStyleClause = `
CRITICAL ADAPTIVE SHAPE TRANSFORMATION VIDEO RULES (photorealistic single container reveal — NOT a glowing humanoid Transformer robot):
1. PHOTOREALISTIC and cinematic. The scene MUST start from a SINGLE precision high-tech mechanical pod (${shapeDesc}) resting statically on a fitting surface. Smooth motion move as the container expands, shallow depth of field.
2. STRICT SINGLE SHAPE RULE: DO NOT change or cycle through other container shapes (NO spheres, NO cubes, NO cylinders if the container is a box). The SAME single ${shapeDesc} unfolds mechanically into the target subject.
3. The container's panels UNFOLD, slide and telescope outward SMOOTHLY and satisfyingly — mechanically CONNECTED, no loose or detached parts — and build/reshape into the target subject at its natural scale. NO hands visible in frame. NO exploding/flying/detached parts, NO energy beams, NO glow-energy magic.
4. Keep the subject's EXACT identity, branding and colors. NO human hands in frame (automatic mechanical unfolding). End on the finished photorealistic result in a cinematic hero shot.
I2V FIELD NOTE: in the "imageToVideoPrompt" field, convey all of this ONLY as camera + the unfolding MOTION (framed WIDE so the fully-formed subject is never cropped) — do NOT write "build/create the product" or re-describe the product there; the full build/identity description belongs to the "textToVideoPrompt" field.`;
  }

  // Make the generated video FOLLOW the directions printed inside the storyboard
  // (applies to EVERY style — the storyboard is the director's sheet).
  const followBoardClause = `FOLLOW THE STORYBOARD'S OWN DIRECTIONS: every panel/card prints production tags — 'CAM:' (camera angle/movement), 'LIGHT:' (lighting) and 'AUDIO:' (music/SFX) — plus a scene title and a one-line action. READ those printed tags in EACH panel and make your "imageToVideoPrompt" (camera + motion + atmosphere) FOLLOW them precisely: e.g. a panel tagged 'CAM: low-angle tracking' -> a low-angle tracking move; 'CAM: static'/'locked' -> a locked tripod shot; 'CAM: push-in' -> a slow push-in; match the mood to the 'LIGHT:' tag and let the motion match the panel's written action. NEVER contradict a panel's printed camera/lighting/action — the storyboard directs the video.
SUBJECT CONSISTENCY (CRITICAL): every page/scene depicts the SAME product/subject/dish shown across the panels. Keep that exact subject identical in EVERY scene's prompt — never switch to a different product, dish, ingredient, or theme partway through (e.g. if early scenes cook noodles, later scenes are the SAME noodles, not vegetables). Only the stage/action/camera changes, not the subject.`;

  // Style-aware atmosphere: cinematic styles get haze + subtle lens flare + DOF;
  // clean styles stay crisp (DOF only, no haze/flare) so the product/scene is clear.
  const atmo = CINEMATIC_VIDEO_STYLES.has(resolvedStyle)
    ? 'cinematic haze, subtle anamorphic lens flare, moderate depth of field (keep the subject sharp — only mild background separation, avoid heavy bokeh), volumetric lighting, gentle motion blur'
    : 'clean, crisp, true-to-life lighting, sharp focus on the subject, mostly deep focus with only subtle background separation (NO heavy bokeh, NO cinematic haze, NO lens flare — keep the product/scene clear and honest)';

  // Idea 1: anchor the video to the CHOSEN layout style (ALL styles, not just transforms),
  // so the result doesn't drift away from the storyboard's look.
  const styleSpec = getStyleSpec(storyboard.style);
  const styleClause = `MATCH THE CHOSEN LAYOUT STYLE: "${styleSpec.name}"${styleSpec.desc ? ` — ${styleSpec.desc}` : ''}. Base camera grammar for this style: ${styleSpec.camera}. Base lighting: ${styleSpec.lighting}. Keep the video's camera language, motion, pacing and mood consistent with THIS style AND with each storyboard panel — never drift into a different look.`;

  // Idea 2: camera discipline — consistent framing, no erratic/extreme moves.
  const cameraDisciplineClause = `CAMERA DISCIPLINE: keep a sensible, CONSISTENT shot scale that matches each panel's framing; use gentle, controlled moves (slow push-in, pan, tilt or orbit). Do NOT cut to extreme close-ups, do NOT use big or abrupt zooms, and avoid disorienting or jittery motion — UNLESS a panel's printed 'CAM:' tag explicitly calls for it. Keep the main subject/product fully in frame with a little margin and clearly visible throughout — never let it touch or spill past the edges. If the subject changes size or moves, frame for its LARGEST state so it is never cropped.`;

  // Idea 3: anti-crop framing for styles where the subject expands / changes scale
  // on screen (cube/pod unfolds, parts converge, splash bursts). The camera being
  // too close is exactly why the transformation gets cut off by the frame edges.
  const isTransformFraming = TRANSFORM_FRAMING_STYLES.has(resolvedStyle);
  const framingClause = isTransformFraming
    ? `FRAMING — DO NOT CROP THE TRANSFORMATION (critical for this style): the subject changes scale on screen (a small object unfolds/expands into the full subject, parts converge, or a splash bursts). Frame for the LARGEST/FINAL state, NOT the small starting object: begin on a MEDIUM-WIDE to WIDE shot and keep the camera pulled back with clear empty margin/headroom on ALL sides, so the ENTIRE object and its complete expansion stay fully inside the frame at every moment and are NEVER cut off by the edges. Do NOT push in, zoom in, or sit tight during the change; if anything, ease slightly WIDER as it grows. Only move closer for the final hero beat once the subject is complete and fully visible.`
    : '';

  let systemInstruction = '';
  if (enableVo) {
    systemInstruction = `You are an expert AI Video Director and master video prompting engineer specializing in high-fidelity commercial video generation.
${durationClause}
${capsuleStyleClause}
${styleClause}
${cameraDisciplineClause}
${framingClause}
${followBoardClause}

You are provided with ${panelImages.length} page images of a storyboard. Each page image contains ${gridDescText}. This means there are exactly ${totalScenes} pages (scenes) in total.

Your task is to analyze all the pages sequentially and write a distinct visual prompt and voiceover script for EACH of the ${totalScenes} pages.

For each page (scene):
1. "imageToVideoPrompt": ONLY a camera-direction, lighting and motion prompt in English (60-120 words) for Image-to-Video models that ALREADY SEE this exact storyboard image. Treat it as notes to a camera operator + gaffer for a shot that ALREADY EXISTS — NOT a description of anything to create.
   - IT MUST CONTAIN ONLY: (a) camera work — shot scale/distance, angle & movement (e.g. "slow push-in", "cinematic pan down", "smooth orbit", "locked tripod"); (b) how the elements ALREADY in the image move (e.g. "panels slide and unfold smoothly", "liquid splashes upward"); (c) lighting behaviour/atmosphere ("${atmo}").
   - ABSOLUTELY FORBIDDEN: do NOT tell the model to create, build, generate, assemble, add, place or reveal any NEW object/product/scene, and do NOT (re)describe the subject's appearance, colours, materials, logo, packaging or setting — the image already contains ALL of that. No scene-building or product-description words; only direct the camera, the light, and the motion of what is already there.
   - FOLLOW THE STORYBOARD: derive the camera move, framing and motion from THIS panel's printed 'CAM:'/'LIGHT:' tags and its drawn action — never invent a different shot or drift from what the panel actually shows.
   - FRAMING: choose a shot scale that keeps the whole subject AND its full motion/transformation inside the frame with margin — never frame so tight that the action gets cut off by the edges.
   - FOR TRANSFORMATIONS (Cube/ASMR/Shape): NO human hands, NO fingers, NO human interaction — the object unfolds automatically by itself on the surface.
   - Purely visual: DO NOT include any narration script or "narrator speaks:" tags inside this field.

2. "textToVideoPrompt": A full, self-contained Text-to-Video prompt in English (110-180 words). OPPOSITE of the I2V field: the model has NO image, so describe EVERYTHING in THIS storyboard panel from words alone — leave nothing out.
   - Describe EXACTLY what the panel shows: the main subject/product faithfully (type, shape, exact colors, materials, logo/branding & any visible text), the setting/background, props, composition & framing, the lighting/mood and ${atmo} — THEN the chronological action and camera movement across the panel's scenes. Be concrete and visual so the generated video matches the storyboard panel.
   - STRICT RULE FOR TRANSFORMATIONS (Cube/ASMR/Shape): ABSOLUTELY NO human hands, NO fingers, NO human interaction in the prompt. The object/cube unfolds completely automatically by itself on the surface!
   - STRICT RULE: DO NOT include any narration script text or "narrator speaks:" tags inside this visual prompt field. Keep it purely visual!

3. "narration": A voiceover narration script paragraph in the language: "${voLanguage || 'Bahasa Indonesia'}". ${toneClause} The narration must fit the page duration and align with the chronological visual action of that page.

CRITICAL SPEECH PACING, TEMPO & WORD COUNT RULES (Strictly prevents fast, rushed, garbled, or mismatched voiceover):
- TEMPO & PACING: Write narration to be spoken at a clear, relaxed, natural conversational pace (about 1.5 words per second) that FILLS most of the scene — continuous enough to avoid long silent gaps, but never rushed or crammed. Insert commas & periods between short phrases for natural breathing pauses.
- WORD COUNT PER SCENE (fill most of the scene — not too few, not too many):
  * For ~5-second scene: about 6 to 8 words TOTAL.
  * For ~8-second scene: about 9 to 12 words TOTAL.
  * For ~10-second scene: about 12 to 15 words TOTAL.
  * For ~15-second scene: about 18 to 23 words TOTAL (hard max 23).
- Fill most of the scene and finish about 1-2 seconds before it ends — do NOT leave long silent gaps, and never cram or rush. Keep phrases short, rhythmic, and well-spaced.

CRITICAL NARRATION FLOW & STRUCTURE:
The voiceover narrations across all the ${totalScenes} pages must combine to form one single, continuously flowing script from the first page to the last. Do not treat each page as a standalone video!
- Page 1 (scene_idx = 0): Must start with the opening hook to grab attention. Strictly DO NOT include any conclusion, promo details, or Call to Action (CTA) phrases like "klik keranjang kuning" or "checkout sekarang" here.
- Middle Pages (scene_idx between 1 and ${totalScenes - 2}): Focus strictly on detailed features, demonstrations, or benefits. Ensure the sentences connect naturally from the previous page. DO NOT write any CTA or ending here.
- Final Page (scene_idx = ${totalScenes - 1}): This is the absolute ending of the video. Conclude the narrative smoothly:
  * For commercial/product ads: End with a strong, natural Call to Action (CTA) tailored to the product (e.g. "Dapatkan sekarang sebelum promo berakhir!", "Pesan milikmu hari ini!").
  * For Action, Cinematic, Drama, Storytelling, Animation, or Educational videos: End with a powerful cinematic climax, dramatic punchline, or satisfying story resolution (DO NOT include any sales pitch, shop link, or commercial CTA).
  Adapt the ending naturally to match the genre and tone of the user's prompt.
This prevents premature endings and duplicate CTAs in the middle of the storyboard flow.

You MUST return the output strictly in this JSON format (do not wrap in markdown \`\`\`json blocks):
{
  "scenes": [
    {
      "scene_idx": 0,
      "imageToVideoPrompt": "<English motion-only camera & motion prompt for Page 1 — purely visual, NO narration or timing text>",
      "textToVideoPrompt": "<English full descriptive text prompt for Page 1>",
      "narration": "<Voiceover script for Page 1>"
    },
    ...
  ]
}
Ensure there are exactly ${totalScenes} items in the "scenes" array corresponding to the pages in sequence.`;
  } else {
    systemInstruction = `You are an expert AI Video Director and master video prompting engineer specializing in high-fidelity commercial video generation.
${durationClause}
${capsuleStyleClause}
${styleClause}
${cameraDisciplineClause}
${framingClause}
${followBoardClause}

You are provided with ${panelImages.length} page images of a storyboard. Each page image contains ${gridDescText}. This means there are exactly ${totalScenes} pages (scenes) in total.

Your task is to analyze all the pages sequentially and write a distinct visual prompt for EACH of the ${totalScenes} pages.

For each page (scene):
1. "imageToVideoPrompt": ONLY a camera-direction, lighting and motion prompt in English (50-100 words) for Image-to-Video models that ALREADY SEE this exact storyboard image. Treat it as notes to a camera operator + gaffer for a shot that ALREADY EXISTS — NOT a description of anything to create.
   - IT MUST CONTAIN ONLY: (a) camera work — shot scale/distance, angle & movement (e.g. "slow tracking shot", "cinematic pan down", "locked tripod"); (b) how the elements ALREADY in the image move (e.g. "panels unfold smoothly", "fluid water splashes"); (c) lighting behaviour/atmosphere ("${atmo}").
   - ABSOLUTELY FORBIDDEN: do NOT tell the model to create, build, generate, assemble, add, place or reveal any NEW object/product/scene, and do NOT (re)describe the subject's appearance, colours, materials, logo, packaging or setting — the image already contains ALL of that. Only direct the camera, the light, and the motion of what is already there.
   - FOLLOW THE STORYBOARD: derive the camera move, framing and motion from THIS panel's printed 'CAM:'/'LIGHT:' tags and its drawn action — never invent a different shot or drift from what the panel actually shows.
   - FRAMING: choose a shot scale that keeps the whole subject AND its full motion/transformation inside the frame with margin — never frame so tight that the action gets cut off by the edges.
   - Voiceover is DISABLED for this project. DO NOT include any voiceover timing or narration text in this prompt!

2. "textToVideoPrompt": A full, self-contained Text-to-Video prompt in English (110-180 words). OPPOSITE of the I2V field: the model has NO image, so describe EVERYTHING in THIS storyboard panel from words alone — leave nothing out.
   - Describe EXACTLY what the panel shows: the main subject/product faithfully (type, shape, exact colors, materials, logo/branding & any visible text), the setting/background, props, composition & framing, the lighting/mood and ${atmo} — THEN the chronological action and camera movement across the panel's scenes. Be concrete and visual so the generated video matches the storyboard panel.

You MUST return the output strictly in this JSON format (do not wrap in markdown \`\`\`json blocks):
{
  "scenes": [
    {
      "scene_idx": 0,
      "imageToVideoPrompt": "<English motion-only prompt for Page 1>",
      "textToVideoPrompt": "<English full descriptive text prompt for Page 1>",
      "narration": null
    },
    ...
  ]
}
Ensure there are exactly ${totalScenes} items in the "scenes" array corresponding to the pages in sequence.`;
  }

  const payload = {
    model: settings?.model || 'gemini-3-flash',
    messages: [
      {
        role: 'system',
        content: systemInstruction
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Project Title: ${storyboard.title}
Main Project Description: ${storyboard.prompt}

Please analyze the provided image sheet(s) carefully. Generate the requested JSON output containing scenes array.`
          },
          ...imageParts
        ]
      }
    ],
    temperature: 0.7
  };

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiToken}`
  };

  const response = await httpRequest(`${apiHost}/chat/completions`, headers, payload);

  if (response.statusCode !== 200) {
    throw new Error(`Vision API Error (status ${response.statusCode}): ${response.body}`);
  }

  const resJson = JSON.parse(response.body);
  const content = resJson.choices?.[0]?.message?.content || '';
  
  let cleanText = content.trim();
  if (cleanText.startsWith('```')) {
    cleanText = cleanText.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '');
  }
  cleanText = cleanText.trim();

  if (!cleanText) {
    console.error('[AI Video Prompts Debug] Empty response content. Full response:', JSON.stringify(resJson, null, 2));
    throw new Error('Respon dari AI kosong. Hal ini biasanya terjadi jika gambar referensi atau teks prompt terdeteksi sensitif/diblokir oleh filter keamanan (safety filter) AI model. Silakan coba ganti dengan gambar lain.');
  }

  // Validate and parse the structured output
  let finalJsonStr = '';
  try {
    const parsed = JSON.parse(cleanText);
    if (parsed && Array.isArray(parsed.scenes)) {
      // Calculate max words allowed per scene based on video duration
      let maxWordsAllowed = 23; // default (auto ≈ 15s scenes): fill the scene, cap at 23
      if (videoDuration && videoDuration !== 'auto') {
        const sec = Number(videoDuration);
        if (sec <= 5) maxWordsAllowed = 8;
        else if (sec <= 8) maxWordsAllowed = 12;
        else if (sec <= 10) maxWordsAllowed = 15;
        else if (sec <= 15) maxWordsAllowed = 23;
        else maxWordsAllowed = Math.round(sec * 1.5);
      }

      const { stripSpeechLeak } = require('../prompts/sanitizeVideoPrompt');
      parsed.scenes = parsed.scenes.map(s => {
        let i2v = s.imageToVideoPrompt || '';
        let t2v = s.textToVideoPrompt || '';
        let narr = s.narration || '';

        if (['cube_box_transform', 'asmr_toy_transform', 'shape_morph_transform', 'cube_morph_product', 'capsule_toss_transform'].includes(resolvedStyle)) {
          i2v = i2v.replace(/(?:A|a)\s+hand\s+gently\s+interacts\s+with/gi, 'The object automatically unfolds on');
          i2v = i2v.replace(/(?:A|a)\s+hand\s+gently\s+opens/gi, 'The object automatically opens');
          i2v = i2v.replace(/(?:A|a)\s+hand\s+(?:gently\s+)?(?:touches|holds|presses|interacts\s+with|interacts)/gi, 'The mechanical mechanism');
          i2v = i2v.replace(/\b(?:hands?|fingers?|human\s+hands?)\b/gi, 'mechanical panels');

          t2v = t2v.replace(/(?:A|a)\s+hand\s+gently\s+interacts\s+with/gi, 'The object automatically unfolds on');
          t2v = t2v.replace(/(?:A|a)\s+hand\s+gently\s+opens/gi, 'The object automatically opens');
          t2v = t2v.replace(/(?:A|a)\s+hand\s+(?:gently\s+)?(?:touches|holds|presses|interacts\s+with|interacts)/gi, 'The mechanical mechanism');
          t2v = t2v.replace(/\b(?:hands?|fingers?|human\s+hands?)\b/gi, 'mechanical panels');
        }

        // Bug C: the image-to-video prompt must be PURELY visual — strip any leaked
        // narration / VO / timecode text (keep camera + motion + atmosphere only).
        i2v = stripSpeechLeak(i2v);

        // Automatic Narration Truncation: ensure voiceover script never exceeds max words
        if (narr && typeof narr === 'string') {
          const words = narr.trim().split(/\s+/);
          if (words.length > maxWordsAllowed) {
            let truncated = words.slice(0, maxWordsAllowed).join(' ');
            // Ensure proper punctuation ending
            if (!/[.!?]$/.test(truncated)) {
              truncated += '.';
            }
            narr = truncated;
          }
        }

        return { ...s, imageToVideoPrompt: i2v, textToVideoPrompt: t2v, narration: narr };
      });
      finalJsonStr = JSON.stringify(parsed);
    } else {
      throw new Error("Invalid structure from AI");
    }
  } catch (err) {
    console.error("Failed to parse AI scenes JSON, constructing fallback:", err);
    const fallbackScenes = [];
    for (let idx = 0; idx < totalScenes; idx++) {
      fallbackScenes.push({
        scene_idx: idx,
        imageToVideoPrompt: `Camera motion for Scene ${idx + 1}: ${cleanText.substring(0, 200)}...`,
        textToVideoPrompt: `Visual prompt for Scene ${idx + 1}: ${cleanText.substring(0, 200)}...`,
        // Bug B: never fabricate a VO placeholder here — a literal string like
        // "Narasi voiceover untuk Scene 1" would be read aloud by the TTS. Leave empty.
        narration: null
      });
    }
    finalJsonStr = JSON.stringify({ scenes: fallbackScenes });
  }

  // Save to DB as JSON string
  await db.run('UPDATE storyboards SET video_prompts = ? WHERE id = ?', [finalJsonStr, storyboardId]);
  return finalJsonStr;
}

async function generateVideoPrompts(req, res) {
  const { storyboardId, promptType, regenerate, enableVo, voLanguage, voTone, videoDuration } = req.body;
  if (!storyboardId) {
    console.error('[AI Video Prompts] Missing storyboardId in request');
    return res.status(400).json({ message: 'Storyboard ID harus diisi.' });
  }

  console.log(`[AI Video Prompts] Processing request for storyboard ID: ${storyboardId} (type: ${promptType}, regenerate: ${!!regenerate}, enableVo: ${!!enableVo}, voLanguage: ${voLanguage || 'N/A'}, voTone: ${voTone || 'N/A'}, videoDuration: ${videoDuration})`);

  try {
    const finalJsonStr = await generateVideoPromptsInternal({ storyboardId, promptType, regenerate, enableVo, voLanguage, voTone, videoDuration });
    return res.json({ videoPrompts: finalJsonStr });
  } catch (error) {
    console.error('[AI Video Prompts Critical Error]:', error);
    return res.status(500).json({ message: 'Terjadi kesalahan sistem saat menulis prompt video.', error: error.message });
  }
}

module.exports = {
  writePrompt,
  generateVideoPrompts,
  generateVideoPromptsInternal
};
