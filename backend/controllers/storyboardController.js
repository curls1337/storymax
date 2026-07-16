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

// Enhance prompt based on selected template, custom grid count, and start scene
function getEnhancedPrompt(style, userPrompt, gridCount = 6, showFace = false, startScene = 1, totalDuration = 60, secondsPerPage = 15, hasRefImage = false) {
  // Truncate userPrompt to 350 characters to prevent final prompt exceeding Freebeat's 2000 character limit
  userPrompt = userPrompt && userPrompt.length > 350 ? userPrompt.substring(0, 350) + '...' : (userPrompt || '');
  const endScene = startScene + gridCount - 1;
  const gridLayout = getGridLayoutDescription(gridCount, startScene);
  
  const pageIdx = Math.floor((startScene - 1) / gridCount);
  const startSec = pageIdx * secondsPerPage;
  const endSec = (pageIdx + 1) * secondsPerPage;
  const timeString = `${formatTime(startSec)} - ${formatTime(endSec)}`;

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

  const refClause = "The reference image shows the main subject/product. Throughout all the storyboard panels, accurately maintain the visual appearance, details, and branding of the subject/product from the reference image.";
  const finalPromptText = hasRefImage ? `${userPrompt}. (Note: ${refClause})` : userPrompt;

  if (style === 'cinematic_production') {
    return `A professional video storyboard presentation sheet. Vertical 3:4 aspect ratio, clean minimal dark-mode design with solid black background. Top header with title 'PRODUCTION STORYBOARD' in clean bold sans-serif font. Main grid: A neat ${gridDesc} with fine white borders. Each frame shows: ${finalPromptText}, rendered with cinematic lighting, high-contrast shadows, dramatic side-lighting, and rich film-grain textures. Below each frame, there are small white text labels for 'SHOT TYPE', 'CAMERA ACTION', and 'VOICE-OVER'. ${faceClause}. Shot on 8k cinema camera. --ar 3:4`;
  }
  if (style === 'chalkboard_polaroid') {
    return `A creative storyboard layout. Blackboard chalk background. Polaroid photo panels showing: ${finalPromptText} are arranged on the board. Around the polaroids, there are subtle hand-drawn chalk lines and annotations. Below the photos, there are handwritten chalk text fields showing 'SCENE:', 'ACTION:', and 'AUDIO:' for scenes ${startScene} to ${endScene}. Cozy chalkboard polaroid aesthetic. ${faceClause}. --ar 3:4`;
  }
  if (style === 'fashion_moodboard') {
    return `A creative minimalist lookbook storyboard layout. Flat lay of neutral-tone cards and paper tags on a clean light-beige linen texture background. The layout features elegant card panels showing: ${finalPromptText}, separated by fine grey borders. Thin elegant sans-serif text labels below the cards display 'PANEL DETAIL', 'CAMERA ANGLE', and 'AUDIO / VO' for scenes ${startScene} to ${endScene}. Clean minimal design, elegant typography. ${faceClause}. --ar 3:4`;
  }
  if (style === 'vintage_fashion') {
    return `A highly creative vintage scrapbook storyboard layout. Light brown kraft paper background. The layout features torn polaroid photos showing: ${finalPromptText}, combined with hand-drawn pencil sketches. Black ink handwritten labels for 'SCENE DETAIL', 'CAMERA MOTION', and 'AUDIO' are written below each panel for scenes ${startScene} to ${endScene}, with hand-drawn sketch borders and stitching lines connecting the elements. Cozy vintage sketchbook aesthetic. ${faceClause}. --ar 3:4`;
  }
  if (style === 'influencer_journal') {
    return `A highly creative storyboard journal layout. White dotted grid notebook paper background. The layout features square card panels showing: ${finalPromptText} with bright studio lighting for scenes ${startScene} to ${endScene}. Colorful sticky note tape boxes next to the panels show handwritten labels for 'ACTION' and 'VOICE OVER'. Small hand-drawn doodle stars and annotations decorate the empty spaces. Fun, authentic creator journal style. ${faceClause}. --ar 3:4`;
  }
  if (style === 'tech_vlog') {
    return `A professional video camera monitor storyboard sheet. Solid dark-gray background. The layout features widescreen video panels styled with thin camera viewfinder HUD overlays (red REC dot, audio meters) showing: ${finalPromptText} for scenes ${startScene} to ${endScene}. Below each panel, there are small clean white text labels: 'SHOT TYPE', 'CAMERA ANGLE', and 'VOICE OVER / GFX'. High-tech, minimal editing monitor style. ${faceClause}. --ar 3:4`;
  }
  if (style === 'unboxing_kraft') {
    return `A highly creative storyboard layout. Corrugated brown cardboard texture background. Widescreen panels framed inside brown paper shipping tape borders show: ${finalPromptText} for scenes ${startScene} to ${endScene}. Shipping label sticker boxes next to the panels display 'SCENE STEP', 'ACTION', and 'VOICE OVER' in typewriter font. Rustic, organic delivery package aesthetic. ${faceClause}. --ar 3:4`;
  }
  if (style === 'gift_unboxing') {
    return `A highly creative storyboard layout. Clean white marble tabletop background with subtle ribbon accents. The layout features elegant soft-cornered square panels showing: ${finalPromptText} for scenes ${startScene} to ${endScene}. Below each panel, there are small elegant minimal labels for 'SCENE DETAIL', 'VISUAL FOCUS', and 'VO / MUSIC'. Soft, luxury, elegant minimalist aesthetic. ${faceClause}. --ar 3:4`;
  }
  if (style === 'pov_unboxing') {
    return `A professional POV storyboard sheet. Clean studio background with soft out-of-focus shelves. Widescreen panels showing first-person POV views of: ${finalPromptText} for scenes ${startScene} to ${endScene}. Below each panel, there is a clean layout with small sans-serif labels for 'POV ACTION', 'SHOT SCALE', and 'VOICE OVER'. Professional pre-production log sheet style. ${faceClause}. --ar 3:4`;
  }
  if (style === 'blueprint_miniature') {
    return `A highly creative blueprint storyboard layout. Dark blue blueprint paper texture background with thin white grid lines. Widescreen panels framed inside dashed white outlines, decorated with technical drawing symbols and dimension lines, show: ${finalPromptText} for scenes ${startScene} to ${endScene}. Below each panel, there are white technical text fields for 'SCENE STEP', 'MEASURES / VALUES', and 'AUDIO / VO' in a clean blueprint font. Architectural drafting desk style. ${faceClause}. --ar 3:4`;
  }
  if (style === 'workbench_miniature') {
    return `A creative vintage workbench storyboard layout. Rustic dark wood workbench tabletop background. Widescreen panels showing: ${finalPromptText} for scenes ${startScene} to ${endScene} are styled as hanging manila paper tags with tiny metal paperclips. Below each panel, there are typewriter-style text boxes for 'SCENE TASK', 'ACTION DETAILS', and 'VO / SFX'. Industrial, mechanical crafting aesthetic. ${faceClause}. --ar 3:4`;
  }
  if (style === 'building_timelapse') {
    return `A creative timelapse progress storyboard layout. Ivory millimeter graph paper background. Widescreen 16:9 panels showing stages of: ${finalPromptText}, arranged along a horizontal timeline path for scenes ${startScene} to ${endScene}. Below the panels, there are small text fields for 'TIMELINE INDEX', 'TIME ELAPSED', and 'CAMERA MOTION' with thin timeline arrows connecting the panels. Professional progress ledger style. ${faceClause}. --ar 3:4`;
  }
  if (style === 'solar_transit') {
    return `A professional timelapse storyboard sheet. Solid dark charcoal background. Widescreen 16:9 panels showing stages of: ${finalPromptText}, featuring dramatic daylight transitions from sunrise, bright noon, golden sunset, to glowing night skyline for scenes ${startScene} to ${endScene}. Digital orange timestamps are displayed above the panels. Below the panels, there are small white labels for 'SCENE PHASE', 'LIGHTING TRANSIT', and 'HYPERLAPSE SPEED'. High-contrast modern hyperlapse style. ${faceClause}. --ar 3:4`;
  }
  if (style === 'shadow_play_timelapse') {
    return `A highly creative minimalist storyboard layout. Smooth light gray concrete tabletop background with realistic shadows of window frames and tree leaves falling across the board. Matte photo print panels showing chronological stages of: ${finalPromptText} for scenes ${startScene} to ${endScene}. Below each panel, there are small elegant grey labels for 'SCENE TIMELINE', 'ACTION CHANGE', and 'CAMERA SHOT & ANGLE'. Modern art gallery catalog style, clean and highly realistic. ${faceClause}. --ar 3:4`;
  }
  if (style === 'hanging_photo_timelapse') {
    return `A creative storyboard layout. Clean white brick studio wall background. Polaroid photos showing stages of: ${finalPromptText} for scenes ${startScene} to ${endScene} are hanging sequentially from a thin steel wire using small wooden clothespins. Below the wire, there are small neat white labels attached to the wall for 'PHOTO LOG', 'SCENE ACTION', and 'EXPOSURE SETTINGS'. Cozy, artistic darkroom style with realistic soft shadows. ${faceClause}. --ar 3:4`;
  }
  if (style === 'cyberpunk_schematic') {
    return `A creative cyberpunk tech schematic storyboard layout. Dark neon blue blueprint grid background with glowing circuit line patterns. Widescreen panels styled as floating holographic terminal grids show: ${finalPromptText} for scenes ${startScene} to ${endScene}. Below the panels, there are terminal-style text boxes for 'SCENE STAGE', 'HUD INTERFACE', and 'AUDIO SPECTRUM' with neon blue digital text. Futuristic, cyberpunk style. ${faceClause}. --ar 3:4`;
  }
  if (style === 'retro_comic') {
    return `A creative retro comic book pop-art storyboard layout. Vintage half-tone yellowed comic paper background. The panels are styled as thick black comic strip boxes showing: ${finalPromptText} in a pop-art cartoon style for scenes ${startScene} to ${endScene}. Below the panels, there are yellow narrator caption boxes containing text fields for 'SCENE ACTION', 'SOUND FX', and 'VIBES'. Fun, energetic retro comic book style. ${faceClause}. --ar 3:4`;
  }
  if (style === 'mystical_grimoire') {
    return `A creative mystical apothecary grimoire storyboard layout. Weathered ancient parchment paper texture background with faint star charts. Widescreen panels showing watercolor drawings of: ${finalPromptText} are drawn on the page for scenes ${startScene} to ${endScene}. Cursive quill-ink calligraphy labels next to the drawings display 'RITUAL STEP', 'ALCHEMY ELEMENTS', and 'AUDIO CHANT'. Magical, cozy witchy ledger style. ${faceClause}. --ar 3:4`;
  }
  if (style === 'concrete_gallery') {
    return `A creative minimalist concrete gallery storyboard layout. Dark industrial raw concrete background. Widescreen panels showing: ${finalPromptText} are styled as floating acrylic glass frames with strong 3D shadows for scenes ${startScene} to ${endScene}. Below each panel, there are small matte black steel labels with white text for 'SPATIAL LAYOUT', 'SCENE DETAIL', and 'AMBIENT SOUND'. High-end, premium minimalist portfolio style. ${faceClause}. --ar 3:4`;
  }
  if (style === 'watercolor_sketchbook') {
    return `A creative watercolor artist's sketchbook storyboard layout. Rough watercolor sketch paper background. The panels show watercolor painted scenes of: ${finalPromptText} for scenes ${startScene} to ${endScene}. Below each panel, there are handwritten pencil notes for 'ARTISTIC SCENE', 'COLOR PALETTE', and 'AUDIO MOOD'. Artistic, cozy watercolor album style. ${faceClause}. --ar 3:4`;
  }
  if (style === 'capsule_transform') {
    return `A professional video storyboard presentation sheet. Clean minimal design on a solid dark-gray background. Widescreen panels showing chronological stages of a mechanical capsule toy transforming on a white tabletop.
- Panel ${startScene}: A compact, sleek high-tech metallic capsule toy pod resting on a white desk, with color accents and design details inspired by ${finalPromptText}.
- Panel ${startScene+1}: A finger presses a small glowing activation button on the side of the capsule pod.
- Panel ${startScene+2}: The capsule pod is placed on the desk and begins to hum, glowing with bright orange/gold LED line accents as thin seams and joints start opening.
- Panel ${startScene+3}: The capsule pod mechanically unfolds, gears, joints, and micro-parts expanding outwards on the desk surface.
- Panel ${startScene+4}: The structure rapidly transforms, building the chassis, body panels, and exact shape of ${finalPromptText} with satisfying mechanical movements.
- Panel ${startScene+5}: The fully transformed, highly detailed assembled version of ${finalPromptText} standing proudly on the white desk.
Below each panel, there are small white text labels for 'TRANSFORMATION STAGE', 'SFX / AUDIO', and 'CAMERA ANGLE'. Cozy ASMR toy transformation style. ${faceClause}. --ar 3:4`;
  }

  return userPrompt + ", " + faceClause; // Default fallback
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
        timeout: 20000
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
  const { title, prompt, style, apiKeyId, refImageBase64, refImageUrl, refImages, gridCount, model, duration, showFace, aspectRatio, enableVo, voLanguage, voTone, videoEngine } = req.body;

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
    videoEngine: selectedEngine
  });

  // Create unique task ID immediately
  const taskId = 'task_' + Date.now();
  let storyboardId = null;
  try {
    const insertResult = await db.run(
      'INSERT INTO storyboards (user_id, title, prompt, image_path, used_credits, api_key_id, status, generation_params) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [req.user.id, title, prompt, '[]', 0, parsedApiKeyId, 'processing', generationParams]
    );
    storyboardId = insertResult.lastID;
  } catch (dbErr) {
    console.error('Failed to create initial storyboard record:', dbErr);
    return res.status(500).json({ message: 'Gagal membuat rekam storyboard awal.', error: dbErr.message });
  }

  activeTasks[taskId] = {
    status: 'processing',
    apiKeyId: parsedApiKeyId,
    storyboardId,
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
    error: null
  };

  // Respond immediately with taskId and storyboardId to prevent blocking HTTP timeouts
  res.json({ taskId, storyboardId, status: 'processing' });

  // Run the process completely in background
  (async () => {
    let totalCreditsUsed = 0;
    try {
      const db = getDb();
      
      if (!keyRecord) {
        activeTasks[taskId].status = 'failed';
        activeTasks[taskId].error = 'Selected API Key is invalid or inactive.';
        activeTasks[taskId].logs += '[ERROR] Selected API Key is invalid or inactive.\n';
        await db.run('UPDATE storyboards SET status = ? WHERE id = ?', ['failed', storyboardId]);
        return;
      }

      // Split the storyboard prompt into chronological parts using AI
      activeTasks[taskId].logs += `[1.2/4] Menganalisis konsep cerita dan memecah menjadi ${pageCount} segmen visual kronologis menggunakan AI...\n`;
      const subPrompts = await splitStoryboardPromptWithAI(prompt, pageCount, db);
      const isFallback = subPrompts.every(p => p === prompt);
      if (isFallback && pageCount > 1) {
        activeTasks[taskId].logs += `  [INFO] Layanan AI Split sedang mengalami gangguan (HTTP 503/RTO). Menggunakan konsep cerita asli untuk setiap halaman (fallback).\n`;
      } else {
        for (let i = 0; i < subPrompts.length; i++) {
          activeTasks[taskId].logs += `  Halaman ${i+1}: ${subPrompts[i].substring(0, 100)}...\n`;
        }
      }
      activeTasks[taskId].logs += `\n`;

      const localCliPath = path.join(__dirname, '..', 'node_modules', 'freebeat-cli', 'dist', 'index.js');
      const hasLocalCli = fs.existsSync(localCliPath);

      // Save Reference Images (Base64 or URL)
      const savedRefImagePaths = [];
      let refImagesList = refImages || [];
      if (refImagesList.length === 0) {
        if (refImageBase64) {
          refImagesList.push({ base64: refImageBase64 });
        } else if (refImageUrl) {
          refImagesList.push({ url: refImageUrl });
        }
      }

      const publicDir = uploadsDir;
      if (refImagesList.length > 0 && !fs.existsSync(publicDir)) {
        fs.mkdirSync(publicDir, { recursive: true });
      }

      for (let i = 0; i < refImagesList.length; i++) {
        const item = refImagesList[i];
        let refImagePath = '';
        if (item.base64) {
          activeTasks[taskId].logs += `Mengolah gambar referensi [${i+1}] (Base64)...\n`;
          const matches = item.base64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
          if (matches && matches.length === 3) {
            const buffer = Buffer.from(matches[2], 'base64');
            const refFilename = `ref_${Date.now()}_${i}.png`;
            refImagePath = path.join(publicDir, refFilename);
            fs.writeFileSync(refImagePath, buffer);
          }
        } else if (item.url) {
          activeTasks[taskId].logs += `Mengunduh gambar referensi [${i+1}] dari URL: ${item.url}...\n`;
          try {
            const refFilename = `ref_${Date.now()}_${i}.png`;
            refImagePath = path.join(publicDir, refFilename);
            await downloadFile(item.url, refImagePath);
            activeTasks[taskId].logs += `Gambar referensi [${i+1}] berhasil diunduh secara lokal.\n`;
          } catch (err) {
            console.warn('Could not download reference image from URL:', err.message);
            activeTasks[taskId].logs += `[WARNING] Gagal mengunduh gambar referensi [${i+1}]: ${err.message}. Melanjutkan tanpa gambar referensi ini.\n`;
            refImagePath = '';
          }
        }
        if (refImagePath) {
          try {
            const sharp = require('sharp');
            const buffer = fs.readFileSync(refImagePath);
            const outputPngPath = refImagePath.replace(/\.png$/, '_converted.png');
            await sharp(buffer)
              .png()
              .toFile(outputPngPath);
            if (fs.existsSync(refImagePath)) {
              fs.unlinkSync(refImagePath);
            }
            refImagePath = outputPngPath;
          } catch (sharpErr) {
            console.warn(`[sharp] failed to convert reference image to png: ${sharpErr.message}`);
          }
          savedRefImagePaths.push(refImagePath.replace(/\\/g, '/'));
        }
      }

      let finalRefImagePath = '';
      if (savedRefImagePaths.length === 1) {
        finalRefImagePath = savedRefImagePaths[0];
        activeTasks[taskId].logs += `Ref Gambar   : ${path.basename(finalRefImagePath)}\n\n`;
      } else if (savedRefImagePaths.length > 1) {
        activeTasks[taskId].logs += `Ref Gambar Asli: ${savedRefImagePaths.map(p => path.basename(p)).join(', ')}\n`;
        activeTasks[taskId].logs += `[1.5/4] Menggabungkan ${savedRefImagePaths.length} gambar referensi menjadi 1 kolase side-by-side untuk Freebeat...\n`;
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
          activeTasks[taskId].logs += `Kolase referensi berhasil dibuat: ${combinedFilename}\n\n`;
        } catch (stitchErr) {
          console.error('Failed to stitch reference images:', stitchErr);
          activeTasks[taskId].logs += `[WARNING] Gagal menggabungkan gambar referensi: ${stitchErr.message}. Menggunakan gambar pertama sebagai fallback.\n\n`;
          finalRefImagePath = savedRefImagePaths[0];
        }
      } else {
        activeTasks[taskId].logs += `Ref Gambar   : Tidak ada\n\n`;
      }
      activeTasks[taskId].logs += `[2/4] Mengirim perintah generate ke Freebeat (Batching: Maks. 2 Halaman secara paralel dengan jeda 5 detik)...\n`;

      const imagePaths = [];
      let currentError = null;

      // Process in batches of 2 pages
      const batchSize = 2;
      for (let batchStart = 0; batchStart < pageCount; batchStart += batchSize) {
        const batchPages = [];
        for (let j = 0; j < batchSize && (batchStart + j) < pageCount; j++) {
          batchPages.push(batchStart + j);
        }

        activeTasks[taskId].logs += `\n[Batch] Memproses Halaman [${batchPages.map(p => p+1).join(', ')}] dari ${pageCount}...\n`;

        const launchedTasks = [];

        // 1. Launch pages in the current batch sequentially with a 5-second delay
        for (let i = 0; i < batchPages.length; i++) {
          const pageIdx = batchPages[i];
          const pageNum = pageIdx + 1;
          const startSec = (pageNum - 1) * secondsPerPage;
          const endSec = pageNum * secondsPerPage;
          const startScene = (pageNum - 1) * Number(gridCount) + 1;
          const endScene = pageNum * Number(gridCount);

          const pageConcept = (subPrompts && subPrompts[pageIdx]) ? subPrompts[pageIdx] : prompt;
          let pagePrompt = getEnhancedPrompt(style, pageConcept, Number(gridCount) || 6, showFace, startScene, totalDuration, secondsPerPage, !!finalRefImagePath);
          pagePrompt = pagePrompt.replace(/"/g, "'");
          if (style !== 'single_premium_showcase') {
            pagePrompt = `Page ${pageNum} of ${pageCount}, Scenes ${startScene}-${endScene} (time segment ${formatTime(startSec)} to ${formatTime(endSec)}). ` + pagePrompt;
          }
          pagePrompt = safeClampPrompt(pagePrompt, 1995);

          activeTasks[taskId].logs += `[Halaman ${pageNum}] Memulai pendaftaran task...\n`;
          activeTasks[taskId].logs += `[Halaman ${pageNum}] Prompt: ${pagePrompt.substring(0, 120)}...\n`;

          let spawnCmd;
          let spawnArgs;

          if (hasLocalCli) {
            spawnCmd = 'node';
            spawnArgs = [
              localCliPath,
              '--api-key', keyRecord.key_value
            ];
          } else {
            spawnCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
            spawnArgs = [
              '-p', 'freebeat-cli',
              'freebeat',
              '--api-key', keyRecord.key_value
            ];
          }

          let sizeArgs = [];
          const reqAspectRatio = aspectRatio ? String(aspectRatio) : '1:1';
          if (selectedModel === '108') {
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

          const pageRefPath = finalRefImagePath;

          if (pageRefPath) {
            spawnArgs.push(
              'image', 'edit',
              '--model', selectedModel,
              '--image', pageRefPath,
              '--prompt', pagePrompt,
              '--count', '1',
              '--json',
              ...sizeArgs
            );
          } else {
            spawnArgs.push(
              'image', 'generate',
              '--model', selectedModel,
              '--prompt', pagePrompt,
              '--count', '1',
              '--json',
              ...sizeArgs
            );
          }

          try {
            const taskInfo = await new Promise((resolve, reject) => {
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
                  activeTasks[taskId].logs += `\n[Freebeat CLI Error - Halaman ${pageNum}]\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}\n`;
                  await checkAndDisableKeyIfOutofCredits(db, parsedApiKeyId, errMsg || stdout || stderr, activeTasks[taskId]);
                  return reject(new Error(`CLI Halaman ${pageNum} gagal: ${errMsg || code}`));
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

            launchedTasks.push(taskInfo);
            activeTasks[taskId].logs += `[Halaman ${pageNum}] Pendaftaran sukses (BatchID: ${taskInfo.batchId}).\n`;

            // Delay 5 seconds before starting next task launch in the same batch
            if (i < batchPages.length - 1) {
              activeTasks[taskId].logs += `Menunggu 5 detik sebelum mendaftarkan halaman berikutnya di batch ini...\n`;
              await new Promise(r => setTimeout(r, 5000));
            }
          } catch (launchErr) {
            currentError = launchErr.message;
            break;
          }
        }

        if (currentError) {
          break;
        }

        // 2. Poll all launched tasks in this batch in parallel
        if (launchedTasks.length > 0) {
          activeTasks[taskId].logs += `[Batch] Semua halaman di batch ini berhasil didaftarkan. Memulai polling status paralel...\n`;

          const pollPromises = launchedTasks.map((taskInfo) => {
            const { pageNum, batchId, serialNo } = taskInfo;
            
            return new Promise((resolve, reject) => {
              let pollCount = 0;
              const maxPolls = 120;
              const pollInterval = setInterval(() => {
                pollCount++;
                activeTasks[taskId].logs += `[Halaman ${pageNum}] Memeriksa status render (${pollCount}/${maxPolls})...\n`;

                let statusCmd;
                let statusArgs;

                if (hasLocalCli) {
                  statusCmd = 'node';
                  statusArgs = [
                    localCliPath,
                    '--api-key', keyRecord.key_value
                  ];
                } else {
                  statusCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
                  statusArgs = [
                    '-p', 'freebeat-cli',
                    'freebeat',
                    '--api-key', keyRecord.key_value
                  ];
                }

                statusArgs.push('task', 'status', batchId, '--json');
                if (serialNo) statusArgs.push('--serial-no', serialNo);

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
                    activeTasks[taskId].logs += `\n[Freebeat Status Check Error - Halaman ${pageNum}]\nSTDOUT:\n${statusStdout}\nSTDERR:\n${statusStderr}\n`;
                    await checkAndDisableKeyIfOutofCredits(db, parsedApiKeyId, errMsg || statusStdout || statusStderr, activeTasks[taskId]);
                    activeTasks[taskId].logs += `[WARNING][Halaman ${pageNum}] Gagal memeriksa status: ${errMsg || statusCode}\n`;
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
                        activeTasks[taskId].logs += `[Halaman ${pageNum}] Sukses! Link asli: ${remoteUrl} (Kredit: ${credits})\n`;
                        imagePaths[pageNum - 1] = remoteUrl;
                        resolve(credits);
                      } else if (renderStatus === 'FAILED' || renderStatus === 'ERROR' || renderStatus === 'failed') {
                        clearInterval(pollInterval);
                        const errMsg = item.errorMessage || `Gagal render Halaman ${pageNum}`;
                        activeTasks[taskId].logs += `\n[Freebeat Render Error - Halaman ${pageNum}]\nError Message: ${errMsg}\n`;
                        await checkAndDisableKeyIfOutofCredits(db, parsedApiKeyId, errMsg, activeTasks[taskId]);
                        reject(new Error(errMsg));
                      }
                    }
                  } catch (err) {
                    // Ignore intermediate parsing errors
                  }

                  if (pollCount >= maxPolls) {
                    clearInterval(pollInterval);
                    reject(new Error(`Timeout render Halaman ${pageNum}`));
                  }
                });
              }, 15000);
            });
          });

          try {
            const batchCredits = await Promise.all(pollPromises);
            batchCredits.forEach(credits => {
              totalCreditsUsed += (Number(credits) || 0);
            });
            activeTasks[taskId].logs += `[Batch] Halaman [${batchPages.map(p => p+1).join(', ')}] selesai diproses!\n`;
          } catch (pollErr) {
            currentError = pollErr.message;
            break;
          }
        }
      }

      if (currentError) {
        activeTasks[taskId].status = 'failed';
        activeTasks[taskId].error = currentError;
        activeTasks[taskId].logs += `[ERROR] Kesalahan fatal dalam proses generasi: ${currentError}\n`;
        await db.run('UPDATE storyboards SET status = ? WHERE id = ?', ['failed', storyboardId]);
        return;
      }

      // Success! Update DB
      const dbPathString = JSON.stringify(imagePaths);
      await db.run(
        'UPDATE storyboards SET image_path = ?, used_credits = ?, status = ? WHERE id = ?',
        [dbPathString, totalCreditsUsed, 'success', storyboardId]
      );
      
      const newStoryboardId = storyboardId;

      activeTasks[taskId].logs += `[AI Video Prompts] Men-generate otomatis prompt video Image-to-Video ${enableVo ? 'dan voiceover ' : ''}di latar belakang...\n`;
      try {
        const { generateVideoPromptsInternal } = require('./aiController');
        await generateVideoPromptsInternal({
          storyboardId: newStoryboardId,
          promptType: 'image-to-video',
          regenerate: true,
          enableVo: !!enableVo,
          voLanguage: enableVo ? voLanguage : undefined,
          voTone: enableVo ? voTone : undefined,
          videoDuration: totalDuration
        });
        activeTasks[taskId].logs += `[AI Video Prompts] Prompt video berhasil di-generate secara otomatis.\n`;
      } catch (promptErr) {
        console.error('Failed to auto-generate video prompt for new storyboard:', promptErr.message);
        activeTasks[taskId].logs += `[WARNING] Gagal menulis prompt video otomatis: ${promptErr.message}. Anda bisa membuatnya secara manual di Dashboard.\n`;
      }

      activeTasks[taskId].status = 'success';
      activeTasks[taskId].result = {
        id: newStoryboardId,
        title,
        prompt,
        image_path: dbPathString
      };
      activeTasks[taskId].logs += `\n=== SEMUA PROSES BERHASIL SELESAI ===\n`;

    } catch (bgError) {
      activeTasks[taskId].status = 'failed';
      activeTasks[taskId].error = bgError.message;
      activeTasks[taskId].logs += `[ERROR] Kesalahan fatal background task: ${bgError.message}\n`;
      try {
        const db = getDb();
        await db.run('UPDATE storyboards SET status = ? WHERE id = ?', ['failed', storyboardId]);
      } catch (e) {}
    }
  })();
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
        let pagePrompt = getEnhancedPrompt(style, pageConcept, Number(gridCount) || 6, showFace, startScene, genParams.duration || (pageCount * secondsPerPage), secondsPerPage);
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

async function cleanProcessingStoryboardsOnStartup() {
  try {
    const { getDb } = require('../db');
    const db = getDb();
    const result = await db.run('UPDATE storyboards SET status = "failed" WHERE status = "processing"');
    if (result.changes > 0) {
      console.log(`[Startup Cleanup] Marked ${result.changes} orphaned/stuck processing storyboard(s) as failed.`);
    }
  } catch (err) {
    console.error('Failed to cleanup processing storyboards:', err);
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
  cleanProcessingStoryboardsOnStartup,
  activeTasks
};
