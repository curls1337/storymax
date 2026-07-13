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
async function generateVideoPromptsInternal({ storyboardId, regenerate, enableVo, voLanguage }) {
  const db = getDb();
  
  // Retrieve storyboard
  const storyboard = await db.get('SELECT * FROM storyboards WHERE id = ?', [storyboardId]);
  if (!storyboard) {
    throw new Error('Storyboard tidak ditemukan.');
  }

  // If prompt already exists and not forcing regeneration, return it directly
  if (storyboard.video_prompts && !regenerate) {
    return storyboard.video_prompts;
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

  let systemInstruction = '';
  if (enableVo) {
    systemInstruction = `You are an expert AI Video Director and master video prompting engineer specializing in high-fidelity commercial video generation (for video tools like Kling, Luma, Runway, SeedDance, Omni, Sora, etc.).
Your task is to analyze the provided storyboard or product showcase image sheet visually, matching them with the project title and narrative description to write:
1. One single, highly-detailed, and comprehensive commercial motion and camera movement prompt in English (150-250 words) named "imageToVideoPrompt". This is for image-to-video tools (like Kling, SeedDance, Omni) where the generated storyboard image is used as the reference frame. Focus on describing how the elements in the image should move, zoom, tilt, splash or slide (motion and camera action). Do not describe static elements from scratch.
2. One single, highly-detailed, and comprehensive commercial text-to-video prompt in English (150-250 words) named "textToVideoPrompt". This describes the product details, scene setting, lighting, mood, camera style, and scene progression in full detail from scratch (for creating video purely from text).
3. A voiceover narration script paragraph in the language: "${voLanguage || 'Bahasa Indonesia'}" named "narration". The narration should flow naturally to match the visual scenes.

You MUST return the output strictly in this JSON format (do not wrap in markdown \`\`\`json blocks):
{
  "imageToVideoPrompt": "<English motion and camera prompt>",
  "textToVideoPrompt": "<English text-to-video scene prompt>",
  "narration": "<Voiceover narration script in the requested language>"
}`;
  } else {
    systemInstruction = `You are an expert AI Video Director and master video prompting engineer specializing in high-fidelity commercial video generation (for video tools like Kling, Luma, Runway, SeedDance, Omni, Sora, etc.).
Your task is to analyze the provided storyboard or product showcase image sheet visually, matching them with the project title and narrative description to write:
1. One single, highly-detailed, and comprehensive commercial motion and camera movement prompt in English (150-250 words) named "imageToVideoPrompt". This is for image-to-video tools (like Kling, SeedDance, Omni) where the generated storyboard image is used as the reference frame. Focus on describing how the elements in the image should move, zoom, tilt, splash or slide (motion and camera action). Do not describe static elements from scratch.
2. One single, highly-detailed, and comprehensive commercial text-to-video prompt in English (150-250 words) named "textToVideoPrompt". This describes the product details, scene setting, lighting, mood, camera style, and scene progression in full detail from scratch (for creating video purely from text).

You MUST return the output strictly in this JSON format (do not wrap in markdown \`\`\`json blocks):
{
  "imageToVideoPrompt": "<English motion and camera prompt>",
  "textToVideoPrompt": "<English text-to-video scene prompt>",
  "narration": null
}`;
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

Please analyze the provided image sheet(s) carefully. Generate the requested JSON output containing imageToVideoPrompt, textToVideoPrompt (and narration if enabled).`
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

  let finalJsonStr = '';
  try {
    const parsed = JSON.parse(cleanText);
    if (parsed && typeof parsed === 'object' && 'imageToVideoPrompt' in parsed && 'textToVideoPrompt' in parsed) {
      finalJsonStr = JSON.stringify(parsed);
    } else if (parsed && typeof parsed === 'object' && 'visualPrompt' in parsed) {
      // Map old visualPrompt to textToVideoPrompt
      finalJsonStr = JSON.stringify({
        imageToVideoPrompt: null,
        textToVideoPrompt: parsed.visualPrompt,
        narration: parsed.narration
      });
    } else {
      finalJsonStr = JSON.stringify({
        imageToVideoPrompt: null,
        textToVideoPrompt: cleanText,
        narration: null
      });
    }
  } catch (err) {
    finalJsonStr = JSON.stringify({
      imageToVideoPrompt: null,
      textToVideoPrompt: cleanText,
      narration: null
    });
  }

  // Save to DB as JSON string
  await db.run('UPDATE storyboards SET video_prompts = ? WHERE id = ?', [finalJsonStr, storyboardId]);
  return finalJsonStr;
}

async function generateVideoPrompts(req, res) {
  const { storyboardId, regenerate, enableVo, voLanguage } = req.body;
  if (!storyboardId) {
    console.error('[AI Video Prompts] Missing storyboardId in request');
    return res.status(400).json({ message: 'Storyboard ID harus diisi.' });
  }

  console.log(`[AI Video Prompts] Processing request for storyboard ID: ${storyboardId} (regenerate: ${!!regenerate}, enableVo: ${!!enableVo}, voLanguage: ${voLanguage || 'N/A'})`);

  try {
    const finalJsonStr = await generateVideoPromptsInternal({ storyboardId, regenerate, enableVo, voLanguage });
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
