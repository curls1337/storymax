const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const { getDb } = require('../db');
const { scrapeTokopedia } = require('../lib/scrapers/tokopedia');

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

// In-memory active tasks logs storage
const activeTasks = {};

function getGridLayoutDescription(gridCount) {
  if (gridCount === 4) return '2x2 grid of 4 numbered scenes (SCENE 1 to SCENE 4)';
  if (gridCount === 6) return '3x2 grid of 6 numbered scenes (SCENE 1 to SCENE 6)';
  if (gridCount === 8) return '4x2 grid of 8 numbered scenes (SCENE 1 to SCENE 8)';
  if (gridCount === 9) return '3x3 grid of 9 numbered scenes (SCENE 1 to SCENE 9)';
  if (gridCount === 12) return '4x3 grid of 12 numbered scenes (SCENE 1 to SCENE 12)';
  return `grid of ${gridCount} numbered scenes (SCENE 1 to SCENE ${gridCount})`;
}

// Enhance prompt based on selected template and custom grid count
function getEnhancedPrompt(style, userPrompt, gridCount = 6, showFace = false) {
  const gridLayout = getGridLayoutDescription(gridCount);
  
  let gridDesc = '';
  if (gridCount === 4) gridDesc = '2x2 grid of 4 panels';
  else if (gridCount === 6) gridDesc = '3x2 grid of 6 panels';
  else if (gridCount === 8) gridDesc = '4x2 grid of 8 panels';
  else if (gridCount === 9) gridDesc = '3x3 grid of 9 panels';
  else if (gridCount === 12) gridDesc = '4x3 grid of 12 panels';
  else gridDesc = `grid of ${gridCount} panels`;

  const faceClause = showFace
    ? "featuring natural human faces and character expressions, close-up lifestyle angles, high-end commercial style"
    : "no human faces, faceless, no portraits, focus only on hands, details and product";

  if (style === 'cooking_grid') {
    return `An ultra-premium cinematic food cooking tutorial storyboard sheet. Vertical 3:4 aspect ratio, clean minimal dark-mode design with solid black background. The layout features a neat ${gridLayout} separated by fine white borders. Content: Each frame shows an extreme close-up of ${userPrompt} preparation step with warm cinematic lighting, steam, and sharp details. ${faceClause}. Each frame has a small translucent yellow badge on the top-right indicating the scene number. Aesthetic, modern typography, shot on 8k RED cinema camera. --ar 3:4`;
  }
  if (style === 'video_table') {
    return `A professional product video storyboard presentation sheet, vertical table design, aesthetic light-cream background. Top header with title 'STORYBOARD - PRODUCT SHOWCASE' in clean sans-serif font. Main grid: A neat ${gridCount}-panel grid layout showing vertical 9:16 video frame previews of ${userPrompt} at various high-end commercial angles (hero shot, close-up details, lifestyle action). ${faceClause}. Thin grid lines, elegant minimalist composition, flat colors, clean professional look. --ar 3:4`;
  }
  if (style === 'product_identity') {
    const panelsCount = Math.max(1, gridCount - 1);
    return `An aesthetic clean Product Spec Sheet infographic. Clean white background. Features a large central hero shot of ${userPrompt} with thin black pointer lines pointing to minimalist specification text. Surrounding the center are ${panelsCount} smaller square panels showing close-up texture detail, side angle, front angle, and packaging. ${faceClause}. Modern editorial design, luxury cosmetic layout, minimal typography, soft neutral color palette. --ar 3:4`;
  }
  if (style === 'ugc_guide') {
    return `A modern social media UGC video concept storyboard, vertical layout. A clean grid featuring ${gridCount} panels. Each panel contains a bright, well-lit lifestyle image of using ${userPrompt} with a small circular badge containing numbers 1 to ${gridCount}. ${faceClause}. Aesthetic casual vlog style, high contrast, clean borders, minimal text labels. --ar 3:4`;
  }
  if (style === 'yellow_badge_storyboard') {
    return `An ultra-premium clean video storyboard presentation sheet. Vertical 3:4 aspect ratio, clean white background. Top header with title 'STORYBOARD VIDEO - ${userPrompt}' in bold uppercase on the left, and 'DURASI TOTAL: 10 DETIK | RASIO: 9:16' on the right in minimalist sans-serif font. Main grid: A neat multi-row grid layout featuring ${gridCount} vertical 9:16 panels. Each panel contains a bright, aesthetic product showcase frame of ${userPrompt} with a small yellow circular badge on the top-left showing the scene number and pacing time (e.g. '1 0:00 - 0:01'). Under each panel is a clear bold uppercase scene title, a visual action description, and a sound cue prefix 'Suara: '. Focus on high-end commercial close-up angles. ${faceClause}. Clean editorial design, minimal typography, sharp edges. --ar 3:4`;
  }
  if (style === 'female_editorial_table') {
    return `An ultra-premium vertical video storyboard script sheet. Vertical 3:4 aspect ratio, clean white background. Top header with title 'STORYBOARD IKLAN - ${userPrompt}' in bold burgundy color, and subheader 'Konsep: Elegan | Produk: ${userPrompt} | Model: Hijab/Modern Style'. Main body is a professional table layout with ${gridCount} rows corresponding to scenes 1 to ${gridCount}, with columns: 'WAKTU', 'VISUAL (SHOT)', 'ADEGAN & ARAHAN', and 'VOICE OVER (VO)'. The VISUAL column shows vertical 9:16 product angles. The adegan column has bullet points with a lightbulb icon. The VO column has italicized voiceover scripts. Bottom footer features three columns: 'TIPS VISUAL', 'NASKAH VO', and 'MUSIK & TONE'. Clean editorial grid, minimal typography. ${faceClause}. --ar 3:4`;
  }
  if (style === 'creative_diy_kids') {
    return `A colorful creative DIY kids storyboard sheet. Vertical 3:4 aspect ratio, white background. Top header is highly colorful, cartoonish and playful with graphics of paint splatters and toy truck, titled 'STORYBOARD DIY ART - ${userPrompt}' in bold bubbly text. The rows feature a red side-badge indicating the scene number and time from scene 1 to ${gridCount}. Columns: 'SHOT TYPE / CAMERA', 'ACTION', 'TRANSISI', 'AUDIO / SFX', 'TUJUAN & EMOSI'. Under each row is 'LIGHTING' and 'KONTINUITAS'. Bottom footer has 'RINGKASAN STORY' and 'TOTAL DURATION'. Bubbly, fun, vibrant primary colors, playful look. ${faceClause}. --ar 3:4`;
  }
  if (style === 'blue_pastel_asmr') {
    return `A premium clean UGC ASMR review storyboard sheet. Vertical 3:4 aspect ratio, soft blue pastel color theme. Top header features title 'STORYBOARD - UGC ASMR REVIEW' with cute hand-drawn doodles of stars, books, and pencils. The layout has columns: 'DURASI', 'VISUAL', 'DETAIL SCENE'. Durasi column has blue pill badges for timestamp. Visual column shows ${gridCount} horizontal 4:3 aesthetic pastel screenshots of ${userPrompt} with hands. Detail Scene column shows bullet points for Aksi, ASMR, and Manfaat. Soft pastel colors, cute doodles, highly aesthetic. ${faceClause}. --ar 3:4`;
  }
  if (style === 'minimalist_unboxing_grid') {
    return `A classic minimalist unboxing grid storyboard sheet. Vertical 3:4 aspect ratio, clean white background. Top header with title 'STORYBOARD: UNBOXING & CARA GUNA' in clean bold sans-serif. The layout features a neat ${gridDesc} with rounded corners. Each panel has a small black circular badge in the top-left showing the scene number from 1 to ${gridCount}, and below the panel shows the timestamp, a bold title, and a short description. Minimalist design, clean typography, neutral aesthetic. ${faceClause}. --ar 3:4`;
  }

  // Brand New Layout Styles based on additional batch
  if (style === 'cinematic_overlay') {
    return `An ultra-premium cinematic full-bleed storyboard sheet. Vertical 3:4 aspect ratio, dark atmospheric cinematic mood. Features a grid of ${gridCount} panels showing scenes of ${userPrompt}. There are no separation margins or borders between images. Inside each frame, there is a small translucent yellow badge on the top-left showing the scene number and time (e.g., 'Scene 1 (0:00-1:00)'), white bold text description overlay on the top-left, and a black semi-transparent capsule at the bottom showing camera angles and SFX cues (e.g. 'Angle: Low close-up' and 'SFX: Click'). Cinematic lighting, high-contrast dramatic tones. ${faceClause}. --ar 3:4`;
  }
  if (style === 'baking_timeline') {
    return `A premium classic timeline list storyboard sheet. Vertical 3:4 aspect ratio, cream/beige color scheme. The layout is arranged as a vertical list featuring ${gridCount} scenes. The left column shows large numbers for each scene from 1 to ${gridCount} with the duration below (e.g. '1 Detik'). The center column contains clean horizontal image panels with rounded corners showing steps of ${userPrompt}. The right column contains text details with a bold uppercase title, followed by 'Visual: ', 'Camera: ', and 'SFX: '. Bottom footer contains visual tips. Aesthetic minimal baking/cooking blog layout. ${faceClause}. --ar 3:4`;
  }
  if (style === 'frame_strip') {
    return `A unique multi-angle step progression strip storyboard sheet. Vertical 3:4 aspect ratio, clean white background. For each scene row, the left column has a dark sidebar with scene number, title, and timestamp. The right section of the row features 3 horizontal square frames side-by-side showing the action of ${userPrompt} from different camera angles or step-by-step progress. There are ${gridCount} rows in total. Focus on details, close-ups, and hands. Aesthetic clean editorial catalog layout. ${faceClause}. --ar 3:4`;
  }
  if (style === 'pencil_sketch') {
    return `A classic film crew pencil sketch storyboard sheet. Vertical 3:4 aspect ratio, vintage grid paper texture background. Top header with title 'STORYBOARD' and project metadata. The layout is a table with ${gridCount} rows for scenes 1 to ${gridCount}, with columns: 'NO.', 'TIME', 'VISUAL / SHOT', 'ACTION / DIALOG', 'CAMERA / SHOT TYPE', 'AUDIO / SOUND'. IMPORTANT: Every cell in every row must be filled with actual written text — the VISUAL column shows hand-drawn charcoal pencil sketch of the scene, ACTION/DIALOG column has actual dialog or action text, CAMERA column has actual shot type (e.g. 'ECU', 'OTS', 'Wide'), AUDIO column has actual sound description. The VISUAL column shows large hand-drawn charcoal pencil sketch drawings of ${userPrompt}. The CAMERA column shows small thumbnail pencil drawings of the camera angle. Vintage hand-drawn sketch art style, black and white pencil render. ${faceClause}. --ar 3:4`;
  }

  // Animation, Lego, and Mecha styles
  if (style === 'animation_bible') {
    return `A professional 3D animation pitch presentation bible and storyboard sheet. Vertical 3:4 aspect ratio, dark navy background. Top header with title '${userPrompt}' in huge bold white, and sub-header 'A 3D Animated Short' in gold. Main grid: ${gridCount} vertical image panels showing distinct cinematic scenes of ${userPrompt}. IMPORTANT: Below each panel, all text fields must be fully written out with real content — 'ACTION:' followed by a short action description, 'CAMERA:' followed by a camera angle name (e.g. Close-up, Wide shot, Dolly track), 'LIGHTING:' followed by a lighting description (e.g. Warm golden hour, Dramatic rim light, Soft diffused), 'AUDIO:' followed by a sound description (e.g. Cinematic strings, Forest ambience, Tense sting). These fields must never be left blank. Middle section shows CHARACTER DESIGN SHEET with turnaround poses and ENVIRONMENT layout sketches. Bottom section shows COLOR PALETTE swatches, VIDEO SPECS table, and CAMERA MOVEMENT ICONS. Pixar/Disney style, highly detailed. ${faceClause}. --ar 3:4`;
  }
  if (style === 'lego_diy') {
    return `A playful toy assembly block builder storyboard sheet. Vertical 3:4 aspect ratio, bright creative lego theme. Top header titled 'STORYBOARD DIY BRICK TOY - ${userPrompt}' in colorful bubbly text, with main ingredients box and mini-instruction graphics. Main grid: A neat ${gridDesc} showing steps of assembling ${userPrompt} with hands. Comic text overlay bubbles like 'TAP!', 'KLIK!', or 'SNAP!' inside frames. Bottom section shows a large reveal frame of the completed brick toy. Fun, vibrant, colorful. ${faceClause}. --ar 3:4`;
  }
  if (style === 'mecha_review') {
    return `A high-end mecha action figure product review storyboard sheet. Vertical 3:4 aspect ratio, clean tech-blue outline dark-mode theme. Top header titled 'STORYBOARD - ${userPrompt}' in clean sans-serif. Main body is a ${gridCount}-column layout representing Scenes 1 to ${gridCount}. Each column features text fields that MUST be filled with actual written content: 'PURPOSE:' [describe scene purpose], 'ASMR ACTION:' [describe touch or sound action like 'clicking joints', 'spinning turret'], 'CAMERA:' [describe angle like 'Close-up of hand', 'Overhead shot'], 'SOUND FOCUS:' [describe sound like 'Plastic click', 'Hydraulic hiss']. Below the text fields are 3 vertical square image panels showing detailed close-up angles of ${userPrompt}. Bottom features a visual details summary. Tech editorial, highly professional. ${faceClause}. --ar 3:4`;
  }

  // Newly Uploaded Styles
  if (style === 'anime_lego_storyboard') {
    return `A professional 2D anime style lego assembly storyboard sheet, inspired by Makoto Shinkai art style. Vertical 3:4 aspect ratio, dark starry sky header titled 'STORYBOARD - DIY LEGO ${userPrompt}' with subtitle '2D ANIME STYLE • DURASI 10 DETIK • FORMAT 9:16'. Main body features ${gridCount} horizontal rows. Each row has a dark blue pill badge for scene number & time (e.g. '01 0:00 - 0:01.5'), a bold yellow/gold uppercase title, and detailed icons for camera, action and sound cues. On the right side is a beautiful horizontal wide cinematic anime image of assembling lego pieces. Bottom features a creator tips footer. Rich aesthetic sunset lighting, highly detailed. ${faceClause}. --ar 3:4`;
  }
  if (style === 'toy_commercial') {
    return `A professional toy product commercial storyboard sheet. Vertical 3:4 aspect ratio, dark blue outline theme. Top header titled 'STORYBOARD IKLAN ${userPrompt}' with subtitle 'DURASI 10 DETIK'. The layout features ${gridCount} horizontal rows. Each row has the scene name and timestamp in the left column. The center column is a horizontal wide cinematic preview image of ${userPrompt} with bold comic overlay text in yellow and white (e.g. 'KECIL TAPI KEREEEN!', 'SIAP MELAJU!'), and round feature icons at the bottom of the image. The right column lists 'VISUAL' and 'TEKS/VO' descriptions. ${faceClause}. --ar 3:4`;
  }
  if (style === 'cartoon_script_grid') {
    return `A cute 3D cartoon style storyboard and script sheet. Vertical 3:4 aspect ratio, clean white background. Top header with title 'STORYBOARD - ${userPrompt}'. The layout features a ${gridCount}-panel grid of horizontal 3D cartoon character images of ${userPrompt} with timestamps below each frame. Below the grid is an aesthetic quotes/narrative block. The bottom section features a detailed script table with columns: 'No', 'Time', 'Visual', 'Narasi', 'Suara / Musik', 'Keterangan'. ${faceClause}. --ar 3:4`;
  }

  return userPrompt + ", " + faceClause; // Default fallback
}

// Download image from URL helper with User-Agent and Timeout support
function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    // If it's a relative path on the local server, copy it directly
    if (url.startsWith('/uploads/')) {
      const srcPath = path.join(__dirname, '..', 'public', url);
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
        file.close();
        fs.unlink(destPath, () => {});
        // Recurse to follow redirect URL
        let redirectUrl = response.headers.location;
        if (!redirectUrl.startsWith('http')) {
          const origin = urlParsed.origin;
          redirectUrl = origin + (redirectUrl.startsWith('/') ? '' : '/') + redirectUrl;
        }
        downloadFile(redirectUrl, destPath).then(resolve).catch(reject);
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
  const { title, prompt, style, apiKeyId, refImageBase64, refImageUrl, gridCount, model, duration, showFace } = req.body;

  if (!title || !prompt || !style || !apiKeyId) {
    return res.status(400).json({ message: 'Title, prompt, style, and API Key ID are required.' });
  }

  const selectedModel = model ? String(model) : '108';
  const totalDuration = duration ? Number(duration) : 15;
  const pageCount = Math.max(1, Math.min(4, Math.floor(totalDuration / 15)));

  // Create unique task ID immediately
  const taskId = 'task_' + Date.now();
  activeTasks[taskId] = {
    status: 'processing',
    logs: '=== INVENTARISASI GENERATOR STORYBOARD MULTI-PAGE ===\n\n' +
          `[1/4] Menyiapkan parameter...\n` +
          `Judul Proyek : ${title}\n` +
          `Gaya Layout  : ${style}\n` +
          `Jumlah Grid  : ${gridCount || 6} Panel\n` +
          `Model Gambar : ${selectedModel}\n` +
          `Durasi Video : ${totalDuration} Detik (${pageCount} Halaman)\n\n`,
    result: null,
    error: null
  };

  // Respond immediately with taskId to prevent blocking HTTP timeouts
  res.json({ taskId, status: 'processing' });

  // Run the process completely in background
  (async () => {
    try {
      const db = getDb();
      
      // Retrieve API key from DB
      const keyRecord = await db.get('SELECT * FROM api_keys WHERE id = ? AND is_active = 1', [apiKeyId]);
      if (!keyRecord) {
        activeTasks[taskId].status = 'failed';
        activeTasks[taskId].error = 'Selected API Key is invalid or inactive.';
        activeTasks[taskId].logs += '[ERROR] Selected API Key is invalid or inactive.\n';
        return;
      }


      const localCliPath = path.join(__dirname, '..', 'node_modules', 'freebeat-cli', 'dist', 'index.js');
      const hasLocalCli = fs.existsSync(localCliPath);

      // Save Reference Image if provided (Base64 or URL)
      let refImagePath = '';
      if (refImageBase64) {
        activeTasks[taskId].logs += `Mengolah gambar referensi (Base64)...\n`;
        const matches = refImageBase64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        if (matches && matches.length === 3) {
          const buffer = Buffer.from(matches[2], 'base64');
          const refFilename = `ref_${Date.now()}.png`;
          const publicDir = path.join(__dirname, '..', 'public', 'uploads');
          if (!fs.existsSync(publicDir)) {
            fs.mkdirSync(publicDir, { recursive: true });
          }
          refImagePath = path.join(publicDir, refFilename);
          fs.writeFileSync(refImagePath, buffer);
        }
      } else if (refImageUrl) {
        activeTasks[taskId].logs += `Mengunduh gambar referensi dari URL: ${refImageUrl}...\n`;
        const refFilename = `ref_${Date.now()}.png`;
        const publicDir = path.join(__dirname, '..', 'public', 'uploads');
        if (!fs.existsSync(publicDir)) {
          fs.mkdirSync(publicDir, { recursive: true });
        }
        refImagePath = path.join(publicDir, refFilename);
        try {
          await downloadFile(refImageUrl, refImagePath);
          activeTasks[taskId].logs += `Gambar referensi berhasil diunduh secara lokal.\n`;
        } catch (err) {
          console.warn('Could not download reference image from URL:', err.message);
          activeTasks[taskId].logs += `[WARNING] Gagal mengunduh gambar referensi: ${err.message}. Melanjutkan tanpa gambar referensi.\n`;
          refImagePath = '';
        }
      }

      // Convert backslashes to forward slashes for CLI compatibility
      const cleanRefImagePath = refImagePath ? refImagePath.replace(/\\/g, '/') : '';
      activeTasks[taskId].logs += (cleanRefImagePath ? `Ref Gambar   : ${path.basename(cleanRefImagePath)}\n\n` : `Ref Gambar   : Tidak ada\n\n`);

      activeTasks[taskId].logs += `[2/4] Mengirim perintah generate ke Freebeat (Batching Paralel maks. 2 Halaman)...\n`;

      const imagePaths = [];
      let currentError = null;

      // Process in batches of 2 parallel requests
      for (let batchStart = 0; batchStart < pageCount; batchStart += 2) {
        const batchPages = [];
        if (batchStart < pageCount) batchPages.push(batchStart);
        if (batchStart + 1 < pageCount) batchPages.push(batchStart + 1);

        activeTasks[taskId].logs += `\n[Batch] Memulai pembuatan Halaman [${batchPages.map(p => p+1).join(', ')}] dari ${pageCount}...\n`;

        // Launch all pages in this batch in parallel
        const launchPromises = batchPages.map(async (pageIdx) => {
          const pageNum = pageIdx + 1;
          const startSec = (pageNum - 1) * 15;
          const endSec = pageNum * 15;
          const startScene = (pageNum - 1) * Number(gridCount) + 1;
          const endScene = pageNum * Number(gridCount);

          let pagePrompt = getEnhancedPrompt(style, prompt, Number(gridCount) || 6, showFace);
          pagePrompt = pagePrompt.replace(/"/g, "'");

          // Inject page metadata to make them continuous
          pagePrompt = `Page ${pageNum} of ${pageCount}, Scenes ${startScene}-${endScene} (time segment ${startSec}s to ${endSec}s). ` + pagePrompt;

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


          if (cleanRefImagePath) {
            spawnArgs.push(
              'image', 'edit',
              '--model', selectedModel,
              '--image', cleanRefImagePath,
              '--prompt', pagePrompt,
              '--count', '1',
              '--json'
            );
          } else {
            spawnArgs.push(
              'image', 'generate',
              '--model', selectedModel,
              '--prompt', pagePrompt,
              '--count', '1',
              '--json'
            );
          }

          return new Promise((resolve, reject) => {
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
                // Regex fallback
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
        });

        let launchedTasks;
        try {
          launchedTasks = await Promise.all(launchPromises);
        } catch (launchErr) {
          currentError = launchErr.message;
          break;
        }

        activeTasks[taskId].logs += `[Batch] Berhasil mendaftarkan ${launchedTasks.length} halaman. Memulai polling status...\n`;

        // Poll all launched tasks in this batch in parallel
        const pollPromises = launchedTasks.map(async (taskInfo) => {
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
                    
                    if (renderStatus === 'SUCCESS') {
                      clearInterval(pollInterval);
                      const remoteUrl = item.imageUrl || item.videoUrl || item.url || dataObj.imageUrl || dataObj.url;
                      if (!remoteUrl) {
                        return reject(new Error(`URL hasil Halaman ${pageNum} tidak ditemukan.`));
                      }
                      
                      activeTasks[taskId].logs += `[Halaman ${pageNum}] Sukses! Menggunakan link asli Freebeat: ${remoteUrl}\n`;
                      resolve(remoteUrl);
                    } else if (renderStatus === 'FAILED' || renderStatus === 'ERROR') {
                      clearInterval(pollInterval);
                      reject(new Error(item.errorMessage || `Gagal render Halaman ${pageNum}`));
                    }
                  }
                } catch (err) {
                  // Intermediate parsing errors can be ignored
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
          const batchResults = await Promise.all(pollPromises);
          imagePaths.push(...batchResults);
          activeTasks[taskId].logs += `[Batch] Halaman [${batchPages.map(p => p+1).join(', ')}] selesai diproses!\n`;
        } catch (pollErr) {
          currentError = pollErr.message;
          break;
        }
      }

      if (currentError) {
        activeTasks[taskId].status = 'failed';
        activeTasks[taskId].error = currentError;
        activeTasks[taskId].logs += `[ERROR] Kesalahan fatal dalam proses generasi: ${currentError}\n`;
        return;
      }

      // Success! Insert in DB as JSON array string
      const dbPathString = JSON.stringify(imagePaths);
      await db.run(
        'INSERT INTO storyboards (user_id, title, prompt, image_path) VALUES (?, ?, ?, ?)',
        [req.user.id, title, prompt, dbPathString]
      );

      activeTasks[taskId].status = 'success';
      activeTasks[taskId].result = {
        title,
        prompt,
        image_path: dbPathString
      };
      activeTasks[taskId].logs += `\n=== SEMUA PROSES BERHASIL SELESAI ===\n`;

    } catch (bgError) {
      activeTasks[taskId].status = 'failed';
      activeTasks[taskId].error = bgError.message;
      activeTasks[taskId].logs += `[ERROR] Kesalahan fatal background task: ${bgError.message}\n`;
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
            const filePath = path.join(__dirname, '..', 'public', img);
            fs.unlink(filePath, () => {});
          }
        });
      } else if (sb.image_path.startsWith('/uploads/')) {
        const filePath = path.join(__dirname, '..', 'public', sb.image_path);
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
    const keys = await db.all('SELECT id, label FROM api_keys WHERE is_active = 1');
    res.json(keys);
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

module.exports = {
  getUserStoryboards,
  generateStoryboard,
  deleteStoryboard,
  getActiveKeys,
  getTaskStatus,
  scrapeProductUrl,
  getActiveTasksDebug
};
