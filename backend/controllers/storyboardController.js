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

function getGridLayoutDescription(gridCount, startScene = 1) {
  const endScene = startScene + gridCount - 1;
  if (gridCount === 4) return `2x2 grid of 4 numbered scenes (SCENE ${startScene} to SCENE ${endScene})`;
  if (gridCount === 6) return `3x2 grid of 6 numbered scenes (SCENE ${startScene} to SCENE ${endScene})`;
  if (gridCount === 8) return `4x2 grid of 8 numbered scenes (SCENE ${startScene} to SCENE ${endScene})`;
  if (gridCount === 9) return `3x3 grid of 9 numbered scenes (SCENE ${startScene} to SCENE ${endScene})`;
  if (gridCount === 12) return `4x3 grid of 12 numbered scenes (SCENE ${startScene} to SCENE ${endScene})`;
  return `grid of ${gridCount} numbered scenes (SCENE ${startScene} to SCENE ${endScene})`;
}

// Enhance prompt based on selected template, custom grid count, and start scene
function getEnhancedPrompt(style, userPrompt, gridCount = 6, showFace = false, startScene = 1) {
  // Truncate userPrompt to 350 characters to prevent final prompt exceeding Freebeat's 2000 character limit
  userPrompt = userPrompt && userPrompt.length > 350 ? userPrompt.substring(0, 350) + '...' : (userPrompt || '');
  const endScene = startScene + gridCount - 1;
  const gridLayout = getGridLayoutDescription(gridCount, startScene);
  
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

  if (style === 'cooking_grid') {
    return `An ultra-premium cinematic storyboard sheet. Vertical 3:4 aspect ratio, clean minimal dark-mode design with solid black background. The layout features a neat ${gridLayout} separated by fine white borders. Content: Each frame shows an extreme close-up of ${userPrompt} with warm cinematic lighting, high-contrast shadows, and sharp details. ${faceClause}. Each frame has a small translucent yellow badge on the top-right indicating the scene number. Aesthetic, modern typography, shot on 8k RED cinema camera. --ar 3:4`;
  }
  if (style === 'video_table') {
    return `A professional video storyboard presentation sheet, vertical table design, aesthetic light-cream background. Top header with title 'STORYBOARD - PRODUCT SHOWCASE' in clean sans-serif font. Main grid: A neat ${gridCount}-panel grid layout showing vertical 9:16 video frame previews of ${userPrompt} at various high-end commercial angles (hero shot, close-up details, lifestyle action) representing scenes ${startScene} to ${endScene}. ${faceClause}. Thin grid lines, elegant minimalist composition, flat colors, clean professional look. --ar 3:4`;
  }
  if (style === 'product_identity') {
    const panelsCount = Math.max(1, gridCount - 1);
    return `An aesthetic clean Product Spec Infographic sheet. Clean white background. Features a large central hero shot of ${userPrompt} with thin black pointer lines pointing to minimalist specification text. Surrounding the center are ${panelsCount} smaller square panels showing close-up texture detail, side angle, front angle, and packaging. ${faceClause}. Modern editorial design, luxury catalog layout, minimal typography, soft neutral color palette. --ar 3:4`;
  }
  if (style === 'ugc_guide') {
    return `A modern social media UGC video concept storyboard, vertical layout. A clean grid featuring ${gridCount} panels. Each panel contains a bright, well-lit lifestyle image of using ${userPrompt} with a small circular badge containing numbers ${startScene} to ${endScene}. ${faceClause}. Aesthetic casual vlog style, high contrast, clean borders, minimal text labels. --ar 3:4`;
  }
  if (style === 'yellow_badge_storyboard') {
    return `An ultra-premium clean video storyboard presentation sheet. Vertical 3:4 aspect ratio, clean white background. Top header with title 'STORYBOARD VIDEO - ${userPrompt}' in bold uppercase on the left, and 'DURASI TOTAL: 60 DETIK | RASIO: 9:16' on the right in minimalist sans-serif font. Main grid: A neat multi-row grid layout featuring ${gridCount} vertical 9:16 panels. Each panel contains a bright, aesthetic product showcase frame of ${userPrompt} with a small yellow circular badge on the top-left showing the scene number and pacing time. Under each panel is a clear bold uppercase scene title, a visual action description, and a sound cue prefix 'Suara: ' for scenes ${startScene} to ${endScene}. Focus on high-end commercial close-up angles. ${faceClause}. Clean editorial design, minimal typography, sharp edges. --ar 3:4`;
  }
  if (style === 'female_editorial_table') {
    return `An ultra-premium vertical video storyboard script sheet. Vertical 3:4 aspect ratio, clean white background. Top header with title 'STORYBOARD IKLAN - ${userPrompt}' in bold burgundy color, and subheader 'Konsep: Elegan | Showcase: Detail & Fitur'. Main body is a professional table layout with ${gridCount} rows corresponding to scenes ${startScene} to ${endScene}, with columns: 'WAKTU', 'VISUAL (SHOT)', 'ADEGAN & ARAHAN', and 'VOICE OVER (VO)'. The VISUAL column shows vertical 9:16 product angles. The adegan column has bullet points. The VO column has italicized voiceover scripts. Bottom footer features three columns: 'TIPS VISUAL', 'NASKAH VO', and 'MUSIK & TONE'. Clean editorial grid, minimal typography. ${faceClause}. --ar 3:4`;
  }
  if (style === 'creative_diy_kids') {
    return `A colorful creative storyboard sheet. Vertical 3:4 aspect ratio, white background. Top header is highly colorful, cartoonish and playful with graphics, titled 'STORYBOARD DIY ART - ${userPrompt}' in bold bubbly text. The rows feature a red side-badge indicating the scene number and time from scene ${startScene} to ${endScene}. Columns: 'SHOT TYPE / CAMERA', 'ACTION', 'TRANSISI', 'AUDIO / SFX', 'TUJUAN & EMOSI'. Under each row is 'LIGHTING' and 'KONTINUITAS'. Bottom footer has 'RINGKASAN STORY' and 'TOTAL DURATION'. Bubbly, fun, vibrant colors, playful look. ${faceClause}. --ar 3:4`;
  }
  if (style === 'blue_pastel_asmr') {
    return `A premium clean UGC ASMR review storyboard sheet. Vertical 3:4 aspect ratio, soft blue pastel color theme. Top header features title 'STORYBOARD - UGC ASMR REVIEW' with cute hand-drawn doodles of stars, books, and pencils. The layout has columns: 'DURASI', 'VISUAL', 'DETAIL SCENE'. Durasi column has blue pill badges for timestamp. Visual column shows ${gridCount} horizontal 4:3 aesthetic pastel screenshots of ${userPrompt} with hands. Detail Scene column shows bullet points for Aksi, ASMR, and Manfaat. Soft pastel colors, cute doodles, highly aesthetic. ${faceClause}. --ar 3:4`;
  }
  if (style === 'minimalist_unboxing_grid') {
    return `A classic minimalist unboxing grid storyboard sheet. Vertical 3:4 aspect ratio, clean white background. Top header with title 'STORYBOARD: UNBOXING & CARA GUNA' in clean bold sans-serif. The layout features a neat ${gridDesc} with rounded corners. Each panel has a small black circular badge in the top-left showing the scene number from ${startScene} to ${endScene}, and below the panel shows the timestamp, a bold title, and a short description. Minimalist design, clean typography, neutral aesthetic. ${faceClause}. --ar 3:4`;
  }

  // Brand New Layout Styles based on additional batch
  if (style === 'cinematic_overlay') {
    return `An ultra-premium cinematic full-bleed storyboard sheet. Vertical 3:4 aspect ratio, dark atmospheric cinematic mood. Features a grid of ${gridCount} panels showing scenes ${startScene} to ${endScene} of ${userPrompt}. There are no separation margins or borders between images. Inside each frame, there is a small translucent yellow badge on the top-left showing the scene number and time, white bold text description overlay on the top-left, and a black semi-transparent capsule at the bottom showing camera angles and SFX cues. Cinematic lighting, high-contrast dramatic tones. ${faceClause}. --ar 3:4`;
  }
  if (style === 'baking_timeline') {
    return `A premium classic timeline list storyboard sheet. Vertical 3:4 aspect ratio, cream/beige color scheme. The layout is arranged as a vertical list featuring ${gridCount} scenes. The left column shows large numbers for each scene from ${startScene} to ${endScene} with the duration below (e.g. '1 Detik'). The center column contains clean horizontal image panels with rounded corners showing ${userPrompt}. The right column contains text details with a bold uppercase title, followed by 'Visual: ', 'Camera: ', and 'SFX: '. Bottom footer contains visual tips. Aesthetic minimal editorial catalog layout. ${faceClause}. --ar 3:4`;
  }
  if (style === 'frame_strip') {
    return `A unique multi-angle step progression strip storyboard sheet. Vertical 3:4 aspect ratio, clean white background. For each scene row, the left column has a dark sidebar with scene number, title, and timestamp. The right section of the row features 3 horizontal square frames side-by-side showing the action of ${userPrompt} from different camera angles or step-by-step progress. There are ${gridCount} rows in total representing scenes ${startScene} to ${endScene}. Focus on details, close-ups, and hands. Aesthetic clean editorial catalog layout. ${faceClause}. --ar 3:4`;
  }
  if (style === 'pencil_sketch') {
    return `A classic film crew pencil sketch storyboard sheet. Vertical 3:4 aspect ratio, vintage grid paper texture background. Top header with title 'STORYBOARD' and project metadata. The layout is a table with ${gridCount} rows for scenes ${startScene} to ${endScene}, with columns: 'NO.', 'TIME', 'VISUAL / SHOT', 'ACTION / DIALOG', 'CAMERA / SHOT TYPE', 'AUDIO / SOUND'. IMPORTANT: Every cell in every row must be filled with actual written text — the VISUAL column shows hand-drawn charcoal pencil sketch of the scene, ACTION/DIALOG column has actual dialog or action text, CAMERA column has actual shot type (e.g. 'ECU', 'OTS', 'Wide'), AUDIO column has actual sound description. The VISUAL column shows large hand-drawn charcoal pencil sketch drawings of ${userPrompt}. The CAMERA column shows small thumbnail pencil drawings of the camera angle. Vintage hand-drawn sketch art style, black and white pencil render. ${faceClause}. --ar 3:4`;
  }

  // Animation, Lego, and Mecha styles
  if (style === 'animation_bible') {
    return `A professional animation pitch presentation bible and storyboard sheet. Vertical 3:4 aspect ratio, dark navy background. Top header with title '${userPrompt}' in huge bold white, and sub-header 'A Cinematic Showcase' in gold. Main grid: ${gridCount} vertical image panels showing distinct cinematic scenes ${startScene} to ${endScene} of ${userPrompt}. IMPORTANT: Below each panel, all text fields must be fully written out with real content — 'ACTION:' followed by a short action description, 'CAMERA:' followed by a camera angle name, 'LIGHTING:' followed by a lighting description, 'AUDIO:' followed by a sound description. These fields must never be left blank. Middle section shows character design sheet turnaround poses and environment layout sketches. Bottom section shows color palette swatches, specs table, and camera movement icons. Pixar/Disney style, highly detailed. ${faceClause}. --ar 3:4`;
  }
  if (style === 'lego_diy') {
    return `A playful toy assembly block builder storyboard sheet. Vertical 3:4 aspect ratio, bright creative building blocks theme. Top header titled 'STORYBOARD DIY BRICK TOY - ${userPrompt}' in colorful bubbly text, with main ingredients box and mini-instruction graphics. Main grid: A neat ${gridDesc} showing steps of assembling ${userPrompt} with hands. Comic text overlay bubbles like 'TAP!', 'KLIK!', or 'SNAP!' inside frames. Bottom section shows a large reveal frame of the completed brick toy. Fun, vibrant, colorful. ${faceClause}. --ar 3:4`;
  }
  if (style === 'mecha_review') {
    return `A high-end product review storyboard sheet. Vertical 3:4 aspect ratio, clean tech-blue outline dark-mode theme. Top header titled 'STORYBOARD - ${userPrompt}' in clean sans-serif. Main body is a ${gridCount}-column layout representing Scenes ${startScene} to ${endScene}. Each column features text fields that MUST be filled with actual written content: 'PURPOSE:' [describe scene purpose], 'ASMR ACTION:' [describe touch or sound action], 'CAMERA:' [describe angle], 'SOUND FOCUS:' [describe sound]. Below the text fields are 3 vertical square image panels showing detailed close-up angles of ${userPrompt}. Bottom features a visual details summary. Tech editorial, highly professional. ${faceClause}. --ar 3:4`;
  }

  // Newly Uploaded Styles
  if (style === 'anime_lego_storyboard') {
    return `A professional 2D anime style storyboard sheet, inspired by Makoto Shinkai art style. Vertical 3:4 aspect ratio, dark starry sky header titled 'STORYBOARD - ${userPrompt}' with subtitle '2D ANIME STYLE • DURASI 60 DETIK • FORMAT 9:16'. Main body features ${gridCount} horizontal rows. Each row has a dark blue pill badge for scene number & time (e.g. '${String(startScene).padStart(2, '0')} 0:00 - 0:01.5'), a bold yellow/gold uppercase title, and detailed icons for camera, action and sound cues. On the right side is a beautiful horizontal wide cinematic anime image of ${userPrompt}. Bottom features a creator tips footer. Rich aesthetic sunset lighting, highly detailed. ${faceClause}. --ar 3:4`;
  }
  if (style === 'toy_commercial') {
    return `A professional product commercial storyboard sheet. Vertical 3:4 aspect ratio, dark blue outline theme. Top header titled 'STORYBOARD IKLAN ${userPrompt}' with subtitle 'DURASI 60 DETIK'. The layout features ${gridCount} horizontal rows. Each row has the scene name and timestamp in the left column representing scenes ${startScene} to ${endScene}. The center column is a horizontal wide cinematic preview image of ${userPrompt} with bold comic overlay text in yellow and white, and round feature icons at the bottom of the image. The right column lists 'VISUAL' and 'TEKS/VO' descriptions. ${faceClause}. --ar 3:4`;
  }
  if (style === 'cartoon_script_grid') {
    return `A cute 3D cartoon style storyboard and script sheet. Vertical 3:4 aspect ratio, clean white background. Top header with title 'STORYBOARD - ${userPrompt}'. The layout features a ${gridCount}-panel grid of horizontal 3D cartoon character images of ${userPrompt} representing scenes ${startScene} to ${endScene} with timestamps below each frame. Below the grid is an aesthetic quotes/narrative block. The bottom section features a detailed script table with columns: 'No', 'Time', 'Visual', 'Narasi', 'Suara / Musik', 'Keterangan'. ${faceClause}. --ar 3:4`;
  }
  if (style === 'single_premium_showcase') {
    return `An ultra-premium commercial studio product photograph of ${userPrompt}. Minimalist clean background with elegant soft studio lighting, delicate shadows, professional catalog style. Crisp details, sharp focus, professional color grading, high-end advertisement look. ${faceClause}. Shot on 8k RED camera, high-end editorial design. --ar 3:4`;
  }
  if (style === 'marketing_specs_timeline') {
    return `A professional product marketing storyboard presentation sheet. Vertical 3:4 aspect ratio, clean white background with red accents. Top section: Left column has title 'MARKETING ANGLE 🔥' in red bold uppercase, a large tagline quote, and 4 green checkmark bullet points; Middle column has a large vertical cutout hero image of ${userPrompt} standing; Right column has a clean specs box listing 'PRODUK: ${userPrompt}', 'JENIS VIDEO: Promosi', 'DURASI: 10 Detik', 'TARGET AUDIENCE: General', and 'OBJECTIVE: Tarik Perhatian'. Middle section: Title 'STORYBOARD ${gridCount} SCENE' in bold red uppercase. Bottom section: A horizontal row of ${gridCount} square storyboard panels showing scenes ${startScene} to ${endScene} of ${userPrompt} with red circular number badges on top. Below each panel are clear written text fields: 'VISUAL:', 'CAMERA:', and 'ACTION:'. Clean high-end corporate presentation layout, minimal typography. ${faceClause}. --ar 3:4`;
  }
  if (style === 'ugc_asmr_table') {
    return `A professional UGC ASMR video storyboard script table sheet. Vertical 3:4 aspect ratio, dark navy blue color scheme. Top Header: Left has title 'STORYBOARD VIDEO 10 DETIK' and subtitle '${userPrompt}'; Middle has a large product cutout photo; Right has a box with icons for duration, orientation, and audience. Main body is a detailed script table with header row: 'SCENE', 'DURASI', 'VISUAL PREVIEW', 'TEKS ON-SCREEN', 'CATATAN / ARAHAN', 'ASMR FOCUS'. The VISUAL PREVIEW column shows horizontal 4:3 image panels of ${userPrompt} at various action steps from scene ${startScene} to ${endScene}. The SCENE column has bold numbers. The CATATAN column contains written visual directions. The ASMR FOCUS column lists touch or sound cues. Bottom section features a dark blue panel with three columns: 'KONTINUITAS VISUAL' with checkmarks, 'TRANSISI ANTAR SCENE', and 'ASMR DETAIL'. Footer has production metadata icons. Highly professional unboxing script layout, clean table borders. ${faceClause}. --ar 3:4`;
  }
  if (style === 'cinematic_commercial_pitch') {
    return `An ultra-premium cinematic product commercial pitch storyboard sheet. Vertical 3:4 aspect ratio, dark charcoal/black background. Top header with centered title 'STORYBOARD – ${userPrompt}' in elegant serif font, and subtitle 'CINEMATIC PRODUCT COMMERCIAL | PREMIUM SHOWCASE'. Main layout features scene blocks (e.g. 'SCENE 1') with a gold sidebar badge, title, and visual concept on the left, and a specs box with 'MOOD & TONE' and 'CAMERA' on the right. Below the header, there is a horizontal grid of square cinematic preview frames showing scenes ${startScene} to ${endScene} of ${userPrompt} with small white square number badges. Under each frame is a title, action description, and 'CAMERA:' details. Bottom footer features three columns: 'NOTES' on lighting/style, 'COLOR PALETTE' showing 5 colored squares, and 'SOUND (SUGGESTED)' audio cues. Cinematic soft key lighting, luxury dark mood, elegant typography. ${faceClause}. --ar 3:4`;
  }
  if (style === 'handheld_product_specs') {
    return `A professional product marketing specification and storyboard sheet. Vertical 3:4 aspect ratio, clean white/gray background. Top Section: Left has bold title 'PORTABLE HANDHELD MINI VACUUM CLEANER' and subtitle '${userPrompt}', with 4 feature icons (powerful suction, rechargeable, mini compact, lightweight); Center has a large 3D rendered product cutout image; Right has a 'WHAT'S INCLUDED' box listing accessories with icons. Middle Section: A wide horizontal table summarizing creative direction, category, key benefits, emotional tone, and environment. Main Body: A professional storyboard table with rows for scenes ${startScene} to ${endScene}, columns: 'SCENE', 'TIME', 'DURATION', 'VISUAL (SHOT DESCRIPTION)'. The VISUAL column shows landscape widescreen image panels of ${userPrompt} in use. The right column lists 'SHOT TYPE', 'CAMERA', 'ACTION', 'TRANSITION'. Bottom Footer features 4 icons and a bold tagline block. Modern technical product spec sheet layout, clean margins. ${faceClause}. --ar 3:4`;
  }
  if (style === 'character_concept_sheet') {
    return `A professional character design sheet and tech sheet layout. Vertical 3:4 aspect ratio, clean light-blue tech outline and grid boundaries on a light-gray background. Top Header: Left has title 'CHARACTER DESIGN SHEET' in small text, followed by bold uppercase project title '${userPrompt}', and subheader 'CLASS : ADVANCED COMBAT UNIT'; Middle has 'CHARACTER OVERVIEW' text paragraph; Right has 'PALETTE' showing 6 color swatches with hex codes, and 'SPESIFIKASI' specs list. Main Body: Left panel has 'TURNAROUND' showing 4 standing character poses (front view, left side view, back view, right side view) of ${userPrompt}; Center panel has 'HEAD DETAIL' (front, side, rear views), 'CHEST DETAIL', and 'WEAPON DETAIL' showing gun/weapon views; Right panel has 'MATERIAL & TEXTURE' with square thumbnails, and 'ACCESSORY & GEAR' detailing utility belt, pouch, energy cell, and boots. Bottom Section: Left has 'POSE REFERENCE' showing 3 action poses of ${userPrompt}, and 'COLOR VARIATION' showing 4 color variation renders; Right has 'DETAIL CLOSE UP' showing 6 square close-up panels. High-tech sci-fi industrial concept design sheet, extremely detailed. ${faceClause}. --ar 3:4`;
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
Anda harus mengembalikan respon hanya dalam format JSON mentah dengan key 'pages' berupa array string berukuran ${pageCount}. Jangan pakai pembungkus markdown (jangan pakai \`\`\`json).
Contoh output untuk 2 halaman:
{
  "pages": [
    "Unboxing produk, memperlihatkan kemasan luar yang premium, lalu menuangkan air ke panci untuk mendidih",
    "Memasukkan bahan-bahan ke panci yang mendidih, mengaduk dengan sendok kayu, lalu menyajikan masakan lezat di atas meja"
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

async function generateStoryboard(req, res) {
  const { title, prompt, style, apiKeyId, refImageBase64, refImageUrl, refImages, gridCount, model, duration, showFace, aspectRatio, enableVo, voLanguage, voTone } = req.body;

  if (!title || !prompt || !style || !apiKeyId) {
    return res.status(400).json({ message: 'Title, prompt, style, and API Key ID are required.' });
  }

  const parsedApiKeyId = parseInt(apiKeyId);
  const isKeyBusy = Object.values(activeTasks).some(task => 
    task.status === 'processing' && parseInt(task.apiKeyId) === parsedApiKeyId
  );

  if (isKeyBusy) {
    return res.status(409).json({ message: 'API Key ini sedang digunakan oleh proses lain. Silakan pilih API Key lain atau tunggu beberapa saat.' });
  }

  const selectedModel = model ? String(model) : '108';
  const totalDuration = duration ? Number(duration) : 15;
  const pageCount = Math.max(1, Math.min(4, Math.ceil(totalDuration / 15)));

  // Create unique task ID immediately
  const taskId = 'task_' + Date.now();
  let storyboardId = null;
  try {
    const db = getDb();
    const insertResult = await db.run(
      'INSERT INTO storyboards (user_id, title, prompt, image_path, used_credits, api_key_id, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [req.user.id, title, prompt, '[]', 0, parsedApiKeyId, 'processing']
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
      
      // Retrieve API key from DB
      const keyRecord = await db.get('SELECT * FROM api_keys WHERE id = ? AND is_active = 1', [apiKeyId]);
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
          const startSec = (pageNum - 1) * 15;
          const endSec = pageNum * 15;
          const startScene = (pageNum - 1) * Number(gridCount) + 1;
          const endScene = pageNum * Number(gridCount);

          const pageConcept = (subPrompts && subPrompts[pageIdx]) ? subPrompts[pageIdx] : prompt;
          let pagePrompt = getEnhancedPrompt(style, pageConcept, Number(gridCount) || 6, showFace, startScene);
          pagePrompt = pagePrompt.replace(/"/g, "'");
          if (style !== 'single_premium_showcase') {
            pagePrompt = `Page ${pageNum} of ${pageCount}, Scenes ${startScene}-${endScene} (time segment ${startSec}s to ${endSec}s). ` + pagePrompt;
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
              child.on('close', (code) => {
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
                        reject(new Error(item.errorMessage || `Gagal render Halaman ${pageNum}`));
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
    const isLocal = url.startsWith('/uploads/');
    const isFreebeat = url.startsWith('https://') && url.includes('freebeat.ai');

    if (!isLocal && !isFreebeat) {
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

module.exports = {
  getUserStoryboards,
  generateStoryboard,
  deleteStoryboard,
  getActiveKeys,
  getTaskStatus,
  scrapeProductUrl,
  getActiveTasksDebug,
  downloadProxy,
  activeTasks
};
