const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { getDb } = require('../db');
const { uploadsDir } = require('../config');

const LAYOUT_STYLES = [
  { value: 'cooking_grid', label: 'Cinematic Dark Storyboard Grid (Dark/Premium)' },
  { value: 'video_table', label: 'Clean Product Video Presentation Sheet (Cream/Editorial)' },
  { value: 'product_identity', label: 'Luxury Product Specs Infographic (Minimalist/Clean)' },
  { value: 'ugc_guide', label: 'Social UGC Action Storyboard (Vlog/Vibrant)' },
  { value: 'yellow_badge_storyboard', label: 'Yellow Badge Commercial Storyboard (Clean Yellow - School Bag)' },
  { value: 'female_editorial_table', label: 'Burgundy Editorial Script Table (Elegant Burgundy - Woman Shirt)' },
  { value: 'creative_diy_kids', label: 'Creative Kids Playful Storyboard (Playful/Colorful - Art Paint)' },
  { value: 'blue_pastel_asmr', label: 'Blue Pastel UGC ASMR Review (Aesthetic Blue - Aimilo)' },
  { value: 'minimalist_unboxing_grid', label: 'Minimalist Unboxing Rounded Grid (Clean Minimalist - Blender)' },
  { value: 'cinematic_overlay', label: 'Full Bleed Cinematic Storyboard (Cinematic Overlay - RC Train)' },
  { value: 'baking_timeline', label: 'Classic Cooking/Baking Timeline (Cream Timeline - Bread Homemade)' },
  { value: 'frame_strip', label: '3-Column Multi-Angle Progression Strip (Strip Grid - Tamagoyaki)' },
  { value: 'pencil_sketch', label: 'Vintage Crew Charcoal Pencil Sketch (Black and White Charcoal Sketch - Horror House)' },
  { value: 'animation_bible', label: '3D Animation Bible & Pitch Sheet (Pixar Blue - The Last Shot)' },
  { value: 'lego_diy', label: 'DIY Lego/Brick Assembly Storyboard (Lego Builder - RM Padang)' },
  { value: 'mecha_review', label: 'Tech Mecha Action Figure Review Columns (Tech Blue - Gundam ASMR)' },
  { value: 'anime_lego_storyboard', label: '2D Anime Lego Assembly Storyboard (Anime/Makoto Shinkai - Lego Beat)' },
  { value: 'toy_commercial', label: 'Toy Commercial Storyboard with Text Overlays (Blue Toy Car - Die-Cast)' },
  { value: 'cartoon_script_grid', label: 'Cute Cartoon Storyboard with Script Table (Cute 3D Cartoon - Housewife)' },
  { value: 'marketing_specs_timeline', label: 'Marketing Specs & Timeline Storyboard (Kimball Sos Cili)' },
  { value: 'ugc_asmr_table', label: 'UGC ASMR Script Table (Tomkins Sepatu Anak)' },
  { value: 'cinematic_commercial_pitch', label: 'Cinematic Commercial Pitch Sheet (Centella Ampoule)' },
  { value: 'handheld_product_specs', label: 'Handheld Product Specs & Storyboard (Mini Vacuum Cleaner)' },
  { value: 'character_concept_sheet', label: 'Character Design & Concept Tech Sheet (Echo Sentinel)' }
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
          content: `Ide Kasar: ${concept}`
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
      // Ensure selected layout is valid, fallback to 'cooking_grid'
      const selectedLayout = LAYOUT_STYLES.some(s => s.value === parsed.layout) ? parsed.layout : 'cooking_grid';
      return res.json({
        title: parsed.title || 'Untitled AI Project',
        description: parsed.description || concept,
        layout: selectedLayout
      });
    } catch (parseErr) {
      return res.json({
        title: concept.substring(0, 20) + '...',
        description: cleanText,
        layout: 'cooking_grid'
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

You are provided with ${panelImages.length} page images of a storyboard. Each page image contains exactly 4 panels arranged in a 2x2 grid (from top-left, top-right, bottom-left, to bottom-right). This means there are exactly ${totalScenes} scenes in total.

Your task is to analyze all the panels sequentially and write a distinct visual prompt and voiceover script for EACH of the ${totalScenes} scenes.

For each scene:
1. "imageToVideoPrompt": A highly dynamic, action-oriented Image-to-Video prompt in English (80-150 words) that explicitly directs the AI video model to animate the scene, starting from the visual layout of that specific panel. Describe the movement, action, and camera motion (e.g. "smooth tracking shot", "camera rotates around the subject", "fluid character gestures", "elements float in slow motion"). Keep it active.
2. "textToVideoPrompt": A comprehensive text-to-video prompt in English (80-150 words) describing the product details, scene setting, lighting, mood, camera style, and action from scratch for that scene, in case the user wants to generate it purely from text.
3. "narration": A voiceover narration script paragraph in the language: "${voLanguage || 'Bahasa Indonesia'}". ${toneClause} The narration must fit the scene duration.

You MUST return the output strictly in this JSON format (do not wrap in markdown \`\`\`json blocks):
{
  "scenes": [
    {
      "scene_idx": 0,
      "imageToVideoPrompt": "<English motion prompt for Scene 1>",
      "textToVideoPrompt": "<English full text prompt for Scene 1>",
      "narration": "<Voiceover script for Scene 1>"
    },
    ...
  ]
}
Ensure there are exactly ${totalScenes} items in the "scenes" array corresponding to the panels in sequence.`;
  } else {
    systemInstruction = `You are an expert AI Video Director and master video prompting engineer specializing in high-fidelity commercial video generation.
${durationClause}

You are provided with ${panelImages.length} page images of a storyboard. Each page image contains exactly 4 panels arranged in a 2x2 grid. This means there are exactly ${totalScenes} scenes in total.

Your task is to analyze all the panels sequentially and write a distinct visual prompt for EACH of the ${totalScenes} scenes.

For each scene:
1. "imageToVideoPrompt": A highly dynamic, action-oriented Image-to-Video prompt in English (80-150 words) that directs the AI model to animate the scene, starting from that panel's layout. Describe the movement, action, and camera motion.
2. "textToVideoPrompt": A comprehensive text-to-video prompt in English (80-150 words) describing the product details, scene setting, lighting, mood, camera style, and action from scratch for that scene.

You MUST return the output strictly in this JSON format (do not wrap in markdown \`\`\`json blocks):
{
  "scenes": [
    {
      "scene_idx": 0,
      "imageToVideoPrompt": "<English motion prompt for Scene 1>",
      "textToVideoPrompt": "<English full text prompt for Scene 1>",
      "narration": null
    },
    ...
  ]
}
Ensure there are exactly ${totalScenes} items in the "scenes" array corresponding to the panels in sequence.`;
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
