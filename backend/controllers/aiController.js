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
async function generateVideoPromptsInternal({ storyboardId, promptType, regenerate, enableVo, voLanguage }) {
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

  let durationClause = '';
  const durVal = videoDuration || 'auto';
  if (durVal === 'auto') {
    if (targetType === 'image-to-video') {
      durationClause = `The target video duration is: Kling/SeedDance/Luma: 15 seconds, Omni: 10 seconds, Gemini: 8 seconds. If Voiceover (VO) is enabled, you MUST adjust the length of the narration paragraph so it matches these durations (roughly 2.5 to 3 words per second, e.g. ~24 words for Gemini (8s), ~30 words for Omni (10s), ~45 words for Kling/SeedDance (15s)).`;
    } else {
      durationClause = `The target video duration is: 15 seconds. If Voiceover (VO) is enabled, you MUST adjust the length of the narration paragraph to match this duration (roughly 2.5 to 3 words per second, e.g. ~45 words).`;
    }
  } else {
    const seconds = Number(durVal);
    const targetWords = Math.round(seconds * 2.8);
    durationClause = `The target video duration is: ${seconds} seconds. If Voiceover (VO) is enabled, you MUST adjust the length of the narration paragraph so it fits exactly within this duration (roughly 2.5 to 3 words per second, meaning the narration MUST contain approximately ${targetWords} words).`;
  }

  let systemInstruction = '';
  if (targetType === 'image-to-video') {
    if (enableVo) {
      systemInstruction = `You are an expert AI Video Director and master video prompting engineer specializing in high-fidelity commercial image-to-video generation (for Kling, Luma, Runway, SeedDance, Omni, etc. where an image is used as the starting frame reference).
${durationClause}
Your task is to analyze the provided storyboard or product showcase image sheet visually, matching them with the project title and narrative description to write:
1. One single, highly-detailed, and comprehensive commercial motion and camera movement prompt in English (150-250 words) describing how the elements in the image should move, zoom, tilt, splash or slide. Do not describe static elements from scratch, focus on camera action and animation motion.
2. A voiceover narration script paragraph in the language: "${voLanguage || 'Bahasa Indonesia'}". The narration should flow naturally to match the motion and action.

You MUST return the output strictly in this JSON format (do not wrap in markdown \`\`\`json blocks):
{
  "prompt": "<English motion and camera prompt>",
  "narration": "<Voiceover narration script in the requested language>"
}`;
    } else {
      systemInstruction = `You are an expert AI Video Director and master video prompting engineer specializing in high-fidelity commercial image-to-video generation (for Kling, Luma, Runway, SeedDance, Omni, etc. where an image is used as the starting frame reference).
${durationClause}
Your task is to analyze the provided storyboard or product showcase image sheet visually, matching them with the project title and narrative description to write:
1. One single, highly-detailed, and comprehensive commercial motion and camera movement prompt in English (150-250 words) describing how the elements in the image should move, zoom, tilt, splash or slide. Do not describe static elements from scratch, focus on camera action and animation motion.

You MUST return the output strictly in this JSON format (do not wrap in markdown \`\`\`json blocks):
{
  "prompt": "<English motion and camera prompt>",
  "narration": null
}`;
    }
  } else { // text-to-video
    if (enableVo) {
      systemInstruction = `You are an expert AI Video Director and master video prompting engineer specializing in high-fidelity commercial text-to-video generation (for Kling, Luma, Runway, Sora, etc. to create videos purely from text).
${durationClause}
Your task is to analyze the provided storyboard or product showcase image sheet visually, matching them with the project title and narrative description to write:
1. One single, highly-detailed, and comprehensive text-to-video scene prompt in English (150-250 words) describing the product details, scene setting, lighting, mood, camera style, and scene progression in full detail from scratch.
2. A voiceover narration script paragraph in the language: "${voLanguage || 'Bahasa Indonesia'}". The narration should flow naturally to match the scene.

You MUST return the output strictly in this JSON format (do not wrap in markdown \`\`\`json blocks):
{
  "prompt": "<English text-to-video scene prompt>",
  "narration": "<Voiceover narration script in the requested language>"
}`;
    } else {
      systemInstruction = `You are an expert AI Video Director and master video prompting engineer specializing in high-fidelity commercial text-to-video generation (for Kling, Luma, Runway, Sora, etc. to create videos purely from text).
${durationClause}
Your task is to analyze the provided storyboard or product showcase image sheet visually, matching them with the project title and narrative description to write:
1. One single, highly-detailed, and comprehensive text-to-video scene prompt in English (150-250 words) describing the product details, scene setting, lighting, mood, camera style, and scene progression in full detail from scratch.

You MUST return the output strictly in this JSON format (do not wrap in markdown \`\`\`json blocks):
{
  "prompt": "<English text-to-video scene prompt>",
  "narration": null
}`;
    }
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

Please analyze the provided image sheet(s) carefully. Generate the requested JSON output containing prompt (and narration if enabled).`
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

  let finalPrompt = '';
  try {
    const parsed = JSON.parse(cleanText);
    const mainPrompt = parsed.prompt || cleanText;
    if (parsed.narration) {
      const heading = targetType === 'image-to-video' ? 'Camera & Motion Prompt' : 'Video Prompt';
      finalPrompt = `${heading}:\n${mainPrompt}\n\nVoiceover (${voLanguage}):\n${parsed.narration}`;
    } else {
      finalPrompt = mainPrompt;
    }
  } catch (err) {
    finalPrompt = cleanText;
  }

  if (targetType === 'image-to-video') {
    currentPrompts.imageToVideoPrompt = finalPrompt;
  } else {
    currentPrompts.textToVideoPrompt = finalPrompt;
  }

  const finalJsonStr = JSON.stringify(currentPrompts);

  // Save to DB as JSON string
  await db.run('UPDATE storyboards SET video_prompts = ? WHERE id = ?', [finalJsonStr, storyboardId]);
  return finalJsonStr;
}

async function generateVideoPrompts(req, res) {
  const { storyboardId, promptType, regenerate, enableVo, voLanguage } = req.body;
  if (!storyboardId) {
    console.error('[AI Video Prompts] Missing storyboardId in request');
    return res.status(400).json({ message: 'Storyboard ID harus diisi.' });
  }

  console.log(`[AI Video Prompts] Processing request for storyboard ID: ${storyboardId} (type: ${promptType}, regenerate: ${!!regenerate}, enableVo: ${!!enableVo}, voLanguage: ${voLanguage || 'N/A'})`);

  try {
    const finalJsonStr = await generateVideoPromptsInternal({ storyboardId, promptType, regenerate, enableVo, voLanguage });
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
