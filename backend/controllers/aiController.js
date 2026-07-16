const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { getDb } = require('../db');
const { uploadsDir } = require('../config');

const LAYOUT_STYLES = [
  { value: 'cinematic_production', label: '1. Professional Film Production Storyboard (Gelap/Cinematic)' },
  { value: 'chalkboard_polaroid', label: '2. Chalkboard Polaroid Recipe Board (Kapur/Makanan)' },
  { value: 'fashion_moodboard', label: '3A. Minimalist Fashion Moodboard (Minimalis/Pakaian)' },
  { value: 'vintage_fashion', label: '3B. Vintage Fashion Scrapbook & Sketch (Retro/Pakaian)' },
  { value: 'influencer_journal', label: '4A. Social Creator Vlog Journal (Ceria/Talent UGC)' },
  { value: 'tech_vlog', label: '4B. Tech Vlog Viewfinder (Camera HUD) (Gelap/Reviewer Gadget)' },
  { value: 'unboxing_kraft', label: '5A. Unboxing Kraft Parcel Sheet (Kardus Cokelat/Unboxing)' },
  { value: 'gift_unboxing', label: '5B. Premium Gift Unboxing Jurnal (Minimalis Marmer/Unboxing)' },
  { value: 'pov_unboxing', label: '5C. POV Hands-On First Impression (POV/Taktil Unboxing)' },
  { value: 'blueprint_miniature', label: '6A. Architect\'s Drafting Blueprint (Biru Tua/Miniatur)' },
  { value: 'workbench_miniature', label: '6B. Vintage Mechanical Workbench (Kayu Gelap/Miniatur)' },
  { value: 'building_timelapse', label: '7A. Construction Progress Timeline Chart (Kuning Gading/Timelapse)' },
  { value: 'solar_transit', label: '7B. Solar Transit Hyperlapse (Day & Night) (Abu Arang/Timelapse)' },
  { value: 'shadow_play_timelapse', label: '8A. Shadow-Play Gallery Board (Leaf Shadows) (Semen/Timelapse Umum)' },
  { value: 'hanging_photo_timelapse', label: '8B. Hanging Photo Wire (Darkroom Style) (Bata Putih/Timelapse Umum)' },
  { value: 'cyberpunk_schematic', label: '9. Cyberpunk Tech Schematic (Neon HUD) (Cyberpunk/Futuristik)' },
  { value: 'retro_comic', label: '10. Retro Comic Book Pop-Art (Pop-Up Bubble) (Pop-Art/Komikal)' },
  { value: 'mystical_grimoire', label: '11. Mystical Apothecary Grimoire (Quill-Ink) (Vintage/Ramuan Sihir)' },
  { value: 'concrete_gallery', label: '12. Minimalist Concrete Gallery (3D Shadows) (Semen/Mewah)' },
  { value: 'watercolor_sketchbook', label: '13. Watercolor Artist\'s Sketchbook (Watercolor Splash) (Artistik/Cat Air)' }
];


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

async function writePrompt(req, res) {
  const { concept } = req.body;
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
    "Iklan minuman kaleng bersoda dingin yang menyegarkan dengan ledakan gelembung dan es batu pecah.",
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
    let apiHost = 'http://localhost:8045/v1';
    let apiToken = 'ag_api_55bd6bfe5c3b771a';

    if (settings) {
      apiHost = settings.endpoint;
      apiToken = settings.api_key;
    }

    const layoutListText = LAYOUT_STYLES.map(s => `- "${s.value}": ${s.label}`).join('\n');

    const payload = {
      model: settings?.model || 'gemini-3-flash',
      messages: [
        {
          role: 'system',
          content: `Anda adalah seorang sutradara video iklan komersial profesional dan desainer storyboard.
Tugas Anda adalah menerima ide kasar dari pengguna, lalu menghasilkan:
1. Sebuah Judul Proyek yang elegan, padat, dan premium (maksimal 5 kata).
2. Sebuah Deskripsi Storyboard rinci yang siap digunakan sebagai prompt AI (berisi detail visual, gaya sinematik, sudut kamera, warna, dan pencahayaan).
3. Memilih satu Gaya Layout Storyboard yang paling cocok untuk ide/konsep tersebut dari daftar gaya berikut:
${layoutListText}

Anda harus mengembalikan respon hanya dalam format JSON mentah dengan key 'title', 'description', dan 'layout' (diisi dengan value/kode dari layout yang Anda pilih). Jangan bungkus dalam markdown (jangan pakai \`\`\`json). Contoh output:
{
  "title": "Judul Elegan",
  "description": "Deskripsi visual rinci...",
  "layout": "baking_timeline"
}`
        },
        {
          role: 'user',
          content: concept === 'minta_ide_acak'
            ? `Buatlah konsep ide video komersial lengkap yang menarik berdasarkan tema acak berikut: "${selectedConcept}"`
            : `Ide Kasar: ${concept}`
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
      // Ensure selected layout is valid, fallback to 'cinematic_production'
      const selectedLayout = LAYOUT_STYLES.some(s => s.value === parsed.layout) ? parsed.layout : 'cinematic_production';
      return res.json({
        title: parsed.title || 'Untitled AI Project',
        description: parsed.description || concept,
        layout: selectedLayout
      });
    } catch (parseErr) {
      return res.json({
        title: concept.substring(0, 20) + '...',
        description: cleanText,
        layout: 'cinematic_production'
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
  
  let apiHost = 'http://localhost:8045/v1';
  let apiToken = 'ag_api_55bd6bfe5c3b771a';

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
    if (imgPath.startsWith('/uploads/')) {
      const relativeFilename = imgPath.replace(/^\/?uploads\//, '');
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
      }
    } else if (imgPath.startsWith('http')) {
      imageParts.push({
        type: 'image_url',
        image_url: {
          url: imgPath
        }
      });
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
  if (gridCount === 4) gridDescText = "exactly 4 panels arranged in a 2x2 grid (from top-left, top-right, bottom-left, to bottom-right)";
  else if (gridCount === 6) gridDescText = "exactly 6 panels arranged in a 3x2 grid (3 columns, 2 rows)";
  else if (gridCount === 8) gridDescText = "exactly 8 panels arranged in a 4x2 grid (4 columns, 2 rows)";
  else if (gridCount === 9) gridDescText = "exactly 9 panels arranged in a 3x3 grid (3 columns, 3 rows)";
  else if (gridCount === 12) gridDescText = "exactly 12 panels arranged in a 4x3 grid (4 columns, 3 rows)";

  let durationClause = '';
  const durVal = videoDuration || 'auto';
  if (durVal === 'auto') {
    if (targetType === 'image-to-video') {
      durationClause = `Each individual scene/panel video has a target duration of: Kling/SeedDance/Luma: 15 seconds, Omni: 10 seconds, Gemini: 8 seconds. Adjust the length of each scene's narration to fit these bounds (roughly 2.5 to 3 words per second, e.g. ~24 words for 8s, ~30 words for 10s, ~45 words for 15s).`;
    } else {
      durationClause = `Each individual scene/panel video has a target duration of: 15 seconds. If Voiceover (VO) is enabled, the narration for each scene should be roughly 45 words.`;
    }
  } else {
    const seconds = Number(durVal);
    const targetWords = Math.round(seconds * 2.8);
    durationClause = `Each individual scene/panel video has a target duration of: ${seconds} seconds. If Voiceover (VO) is enabled, the narration for each scene must contain approximately ${targetWords} words.`;
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
      'dramatic': 'Gaya bahasa DRAMATIS, TEGANG, MISTERIUS, penuh penekanan (suspenseful), seolah ada rahasia besar atau sesuatu yang luar biasa akan terjadi.'
    };
    const toneDesc = toneRules[voTone] || voTone;
    toneClause = `Crucial: The tone and writing style of the voiceover script MUST strictly follow this style (in the narration language): "${toneDesc}". You must rewrite the narration using vocabulary, slang, emotional triggers, or structural patterns that perfectly match this style. For example, if it is casual or comedy, use slang and conversational Indonesian.`;
  }

  let systemInstruction = '';
  if (enableVo) {
    systemInstruction = `You are an expert AI Video Director and master video prompting engineer specializing in high-fidelity commercial video generation.
${durationClause}

You are provided with ${panelImages.length} page images of a storyboard. Each page image contains ${gridDescText}. This means there are exactly ${totalScenes} pages (scenes) in total.

Your task is to analyze all the pages sequentially and write a distinct visual prompt and voiceover script for EACH of the ${totalScenes} pages.

For each page (scene):
1. "imageToVideoPrompt": A highly dynamic, action-oriented Image-to-Video prompt in English (80-150 words) that explicitly directs the AI video model to animate the scene, starting from the visual layout of that specific page. Crucial: The prompt must instruct the video AI model to animate the sequence of panels chronologically (from top-left to bottom-right) to form a cohesive, flowing narrative video clip for that page. Describe the actions, transitions, and camera movement (e.g. "smooth tracking shot", "fluid transitions between panels", "sequential animation of the product demonstration"). Keep it active.
2. "textToVideoPrompt": A comprehensive text-to-video prompt in English (80-150 words) describing the product details, scene setting, lighting, mood, camera style, and chronological action sequence across all the panels on that page from scratch.
3. "narration": A voiceover narration script paragraph in the language: "${voLanguage || 'Bahasa Indonesia'}". ${toneClause} The narration must fit the page duration and align with the chronological visual action of that page.

You MUST return the output strictly in this JSON format (do not wrap in markdown \`\`\`json blocks):
{
  "scenes": [
    {
      "scene_idx": 0,
      "imageToVideoPrompt": "<English motion prompt for Page 1>",
      "textToVideoPrompt": "<English full text prompt for Page 1>",
      "narration": "<Voiceover script for Page 1>"
    },
    ...
  ]
}
Ensure there are exactly ${totalScenes} items in the "scenes" array corresponding to the pages in sequence.`;
  } else {
    systemInstruction = `You are an expert AI Video Director and master video prompting engineer specializing in high-fidelity commercial video generation.
${durationClause}

You are provided with ${panelImages.length} page images of a storyboard. Each page image contains ${gridDescText}. This means there are exactly ${totalScenes} pages (scenes) in total.

Your task is to analyze all the pages sequentially and write a distinct visual prompt for EACH of the ${totalScenes} pages.

For each page (scene):
1. "imageToVideoPrompt": A highly dynamic, action-oriented Image-to-Video prompt in English (80-150 words) that directs the AI model to animate the scene, starting from that page's layout. Crucial: The prompt must instruct the video AI model to animate the sequence of panels chronologically (from top-left to bottom-right) to form a cohesive, flowing narrative video clip for that page. Describe the actions, transitions, and camera movement.
2. "textToVideoPrompt": A comprehensive text-to-video prompt in English (80-150 words) describing the product details, scene setting, lighting, mood, camera style, and chronological action sequence across all the panels on that page from scratch.

You MUST return the output strictly in this JSON format (do not wrap in markdown \`\`\`json blocks):
{
  "scenes": [
    {
      "scene_idx": 0,
      "imageToVideoPrompt": "<English motion prompt for Page 1>",
      "textToVideoPrompt": "<English full text prompt for Page 1>",
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
    throw new Error('Respon dari AI kosong.');
  }

  // Validate and parse the structured output
  let finalJsonStr = '';
  try {
    const parsed = JSON.parse(cleanText);
    if (parsed && Array.isArray(parsed.scenes)) {
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
        narration: enableVo ? `Narasi voiceover untuk Scene ${idx + 1}` : null
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
