// Background storyboard generation jobs (moved out of the controller to keep
// files small). Logic preserved from the original controller; only the prompt
// builder, size-args helper, image persistence (B2), and imports changed.
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { getDb } = require('../db');
const { uploadsDir } = require('../config');
const { activeTasks, saveTaskState } = require('../state/taskStore');
const { checkAndDisableKeyIfOutofCredits } = require('../services/keyPool');
const { downloadFile } = require('../services/download');
const { splitStoryboardPromptWithAI, buildFallbackConceptForPage } = require('../prompts/splitPrompt');
const { buildEnhancedPrompt } = require('../prompts/buildEnhancedPrompt'); // legacy (kept)
const { formatTime } = require('../prompts/grid');
const { safeClampPrompt } = require('../prompts/clamp');
const { freebeatSizeArgs } = require('../services/freebeat/cli');
const magicaGen = require('../services/magicaGen');
const scenarioGen = require('../services/scenarioGen');
const { getStyleSpec } = require('../prompts/styleLibrary');
const { buildMasterPrompt } = require('../prompts/masterPrompt');
const { generateMasterPromptWithAI } = require('../prompts/masterPromptLLM');
const { analyzeSubject } = require('../prompts/subjectAnalyzer');
const { normalizeFaceMode } = require('../prompts/faceMode');

// A14: stitches multiple reference image paths into one side-by-side collage
// PNG. Extracted as a shared helper so it can be reused for either the legacy
// "no character" collage path, or (separately) for combining multiple NON-
// character product/scene reference images used only for the text descriptor.
async function stitchImagesSideBySide(paths, publicDir) {
  const combinedFilename = `combined_ref_${Date.now()}.png`;
  const combinedPath = path.join(publicDir, combinedFilename);

  const { Jimp } = require('jimp');
  const images = await Promise.all(paths.map(p => Jimp.read(p)));

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
  return combinedPath.replace(/\\/g, '/');
}

async function runStoryboardGeneratorBackground(taskId, storyboardId) {
  const db = getDb();
  const task = activeTasks[taskId];
  if (!task) return;

  try {
    const storyboardIsMagica = await magicaGen.isMagicaForStoryboard(db, storyboardId);
    const storyboardIsScenario = await scenarioGen.isScenarioForStoryboard(db, storyboardId);
    const keyRecord = await db.get('SELECT * FROM api_keys WHERE id = ?', [task.apiKeyId]);
    // Freebeat needs a valid key; Magica/Scenario users render via their own pool, so a missing
    // Freebeat key must NOT fail the job for them.
    if (!storyboardIsMagica && !storyboardIsScenario && (!keyRecord || !keyRecord.is_active)) {
      task.status = 'failed';
      task.error = 'Selected API Key is invalid or inactive.';
      task.logs += '[ERROR] Selected API Key is invalid or inactive.\n';
      await db.run('UPDATE storyboards SET status = ? WHERE id = ?', ['failed', storyboardId]);
      await saveTaskState(db, storyboardId, task);
      return;
    }

    const parsedApiKeyId = keyRecord ? keyRecord.id : null;
    let currentKeyRecord = keyRecord;
    const localCliPath = path.join(__dirname, '..', 'node_modules', 'freebeat-cli', 'dist', 'index.js');
    const hasLocalCli = fs.existsSync(localCliPath);
    const publicDir = uploadsDir;

    // A selected character is an IMAGE-ONLY reference. Prefer the original character
    // photo and never inject name, trigger prompt, profile, or vision-derived physical
    // details into the storyboard text prompt. The provider receives this image directly.
    if (task.characterId && !task.characterLoaded) {
      try {
        const char = await db.get('SELECT * FROM characters WHERE id = ?', [task.characterId]);
        if (char) {
          task.characterName = char.name || '';
          let originalRefs = [];
          try { originalRefs = Array.isArray(char.reference_images) ? char.reference_images : JSON.parse(char.reference_images || '[]'); } catch (e) {}
          const characterImageUrl = originalRefs.find(Boolean) || char.sheet_image_url || '';

          task.refImages = task.refImages || [];
          if (characterImageUrl) {
            // Keep the character image as the sole visual identity anchor. It must not
            // be stitched with product/scene references before the provider sees it.
            task.refImages.unshift({ url: characterImageUrl, isCharacterRef: true });
            task.logs += `[INFO] Menggunakan gambar referensi karakter: ${char.name || 'karakter'} (tanpa descriptor teks).\n`;
          } else {
            task.logs += `[WARNING] Karakter terpilih tidak memiliki gambar referensi yang dapat dipakai.\n`;
          }
          task.characterLoaded = true;
          await saveTaskState(db, storyboardId, task);
        }
      } catch (charErr) {
        console.warn('Gagal memuat gambar referensi karakter:', charErr.message);
      }
    }

    // 1. Split the storyboard prompt into chronological parts using AI if starting fresh
    if (task.subPrompts === null) {
      task.logs += `[1.2/4] Menganalisis konsep cerita dan memecah menjadi ${task.pageCount} segmen visual kronologis menggunakan AI...\n`;
      await saveTaskState(db, storyboardId, task);
      
      const subPrompts = await splitStoryboardPromptWithAI(task.prompt, task.pageCount, db, task.secondsPerPage, task.style);
      task.subPrompts = subPrompts;
      
      const isFallback = !subPrompts || subPrompts.length !== task.pageCount || subPrompts.every(p => typeof p === 'string' && (p.includes('dari cerita berikut:') || p.includes('dari konsep cerita berikut:') || p.startsWith(task.prompt)));
      task.isAiSplitFallback = !!isFallback;

      if (isFallback && task.pageCount > 1) {
        task.logs += `  [PERINGATAN] Layanan AI Split mengalami gangguan (HTTP 503/RTO). Menerapkan pemecahan babak terarah per halaman (Fallback deterministik: Pembuka -> Demo/Penggunaan -> Penutup).\n`;
      } else {
        for (let i = 0; i < subPrompts.length; i++) {
          task.logs += `  Halaman ${i+1}: ${subPrompts[i].substring(0, 100)}...\n`;
        }
      }
      task.logs += `\n`;
      await saveTaskState(db, storyboardId, task);
    }

    // 2. Resolve Provider Routing (Scenario / Magica / Freebeat) for this storyboard
    let isMagica = false, magicaApiKey = null;
    let isScenario = false, scenarioKeyRecord = null;
    try {
      if (await scenarioGen.isScenarioForStoryboard(db, storyboardId)) {
        const sk = await scenarioGen.pickScenarioKey(db, task.scenarioKeyId);
        if (sk) {
          isScenario = true;
          scenarioKeyRecord = sk;
          task.scenarioKeyId = sk.id;
          task.logs += `[Provider] Render gambar via Scenario API (${task.scenarioModel || 'model_openai-gpt-image-2'}) — key #${sk.id} (${sk.label}).\n`;
        } else {
          task.logs += '[Provider] Belum ada API Key Scenario yang aktif. Tambahkan key di Admin → API Scenario.\n';
        }
        await saveTaskState(db, storyboardId, task);
      } else if (await magicaGen.isMagicaForStoryboard(db, storyboardId)) {
        const mk = await magicaGen.pickMediaMagicaKey(db, task.magicaKeyId);
        if (mk) {
          isMagica = true; magicaApiKey = mk.key_value;
          task.magicaKeyId = mk.id;
          task.logs += `[Provider] Render gambar via Magica (GPT Image 2) — key #${mk.id} (saldo ~${(mk.balance / 1e6).toFixed(2)} kredit).\n`;
        } else {
          task.logs += '[Provider] Tidak ada API Key Magica dengan saldo cukup (>= 5 kredit) untuk gambar. Key di bawah 5 kredit hanya untuk LLM. Isi ulang / tambah key. Memakai Freebeat bila tersedia.\n';
        }
        await saveTaskState(db, storyboardId, task);
      }
    } catch (e) {}

    // 3. Save Reference Images if starting fresh
    if (task.finalRefImagePath === undefined) {
      const savedRefMeta = []; // { path, isCharacterRef }
      let refImagesList = task.refImages || [];
      if (refImagesList.length === 0) {
        if (task.refImageBase64) {
          refImagesList.push({ base64: task.refImageBase64 });
        } else if (task.refImageUrl) {
          refImagesList.push({ url: task.refImageUrl });
        }
      }

      if (refImagesList.length > 0 && !fs.existsSync(publicDir)) {
        fs.mkdirSync(publicDir, { recursive: true });
      }

      for (let i = 0; i < refImagesList.length; i++) {
        const item = refImagesList[i];
        let refImagePath = '';
        if (item.base64) {
          task.logs += `Mengolah gambar referensi [${i+1}] (Base64)...\n`;
          const matches = item.base64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
          if (matches && matches.length === 3) {
            const buffer = Buffer.from(matches[2], 'base64');
            const refFilename = `ref_${Date.now()}_${i}.png`;
            refImagePath = path.join(publicDir, refFilename);
            fs.writeFileSync(refImagePath, buffer);
          }
        } else if (item.url) {
          task.logs += `Mengunduh gambar referensi [${i+1}] dari URL: ${item.url}...\n`;
          try {
            const refFilename = `ref_${Date.now()}_${i}.png`;
            refImagePath = path.join(publicDir, refFilename);
            await downloadFile(item.url, refImagePath);
            task.logs += `Gambar referensi [${i+1}] berhasil diunduh secara lokal.\n`;
          } catch (err) {
            console.warn('Could not download reference image from URL:', err.message);
            task.logs += `[WARNING] Gagal mengunduh gambar referensi [${i+1}]: ${err.message}. Melanjutkan tanpa gambar referensi ini.\n`;
            refImagePath = '';
          }
        }
        if (refImagePath) {
          try {
            const sharp = require('sharp');
            const buffer = fs.readFileSync(refImagePath);
            const outputPngPath = refImagePath.replace(/\.png$/, '_converted.png');
            
            // Read metadata to check dimensions
            const image = sharp(buffer);
            const metadata = await image.metadata();
            
            let pipeline = image;
            // Downscale extremely large images to speed up processing and prevent size limit errors
            if (metadata.width > 2560 || metadata.height > 2560) {
              pipeline = pipeline.resize({
                width: metadata.width > metadata.height ? 2048 : undefined,
                height: metadata.height >= metadata.width ? 2048 : undefined,
                fit: 'inside',
                withoutEnlargement: true
              });
            }
            
            await pipeline
              .png({ quality: 90, compressionLevel: 8 })
              .toFile(outputPngPath);
            
            // Check final file size and convert to optimized JPEG if still over 10MB
            const stats = fs.statSync(outputPngPath);
            if (stats.size > 10 * 1024 * 1024) {
              const outputJpgPath = outputPngPath.replace(/_converted\.png$/, '_converted.jpg');
              await sharp(outputPngPath)
                .jpeg({ quality: 80, mozjpeg: true })
                .toFile(outputJpgPath);
              
              if (fs.existsSync(outputPngPath)) fs.unlinkSync(outputPngPath);
              if (fs.existsSync(refImagePath)) fs.unlinkSync(refImagePath);
              refImagePath = outputJpgPath;
            } else {
              if (fs.existsSync(refImagePath)) {
                fs.unlinkSync(refImagePath);
              }
              refImagePath = outputPngPath;
            }
          } catch (sharpErr) {
            console.warn(`[sharp] failed to process reference image: ${sharpErr.message}`);
          }
          savedRefMeta.push({ path: refImagePath.replace(/\\/g, '/'), isCharacterRef: !!item.isCharacterRef });
        }
      }

      // A14: keep the Consistent Character's own photo as the SOLE visual edit
      // reference instead of stitching it into a side-by-side collage with any
      // OTHER reference image the user also uploaded (e.g. a product/scene
      // photo). A stitched collage gave every independent per-page "image edit"
      // call an ambiguous mixed photo to interpret — which is why the rendered
      // person's face/identity could still drift page-to-page even with the
      // CHARACTER text anchor in place. This is style-agnostic (runs before any
      // style branching), so it applies uniformly to every layout style. The
      // character's own photo is now used directly (maximizing facial
      // fidelity); any OTHER reference image(s) are kept separate and used only
      // for the PRODUCT text descriptor below (never mixed into the identity photo).
      const characterPaths = savedRefMeta.filter(m => m.isCharacterRef).map(m => m.path);
      const otherPaths = savedRefMeta.filter(m => !m.isCharacterRef).map(m => m.path);
      task.rawRefImagePaths = savedRefMeta.map(m => m.path);

      let finalRefImagePath = '';
      let productRefImagePath = '';

      if (characterPaths.length > 0) {
        finalRefImagePath = characterPaths[0];
        task.logs += `Ref Karakter : ${path.basename(finalRefImagePath)} (dipakai langsung sebagai acuan wajah)\n`;
        if (otherPaths.length === 1) {
          productRefImagePath = otherPaths[0];
          task.logs += `Ref Produk   : ${path.basename(productRefImagePath)} (dipakai untuk deskripsi produk)\n\n`;
        } else if (otherPaths.length > 1) {
          if (isScenario || isMagica) {
            productRefImagePath = otherPaths[0];
            task.logs += `Ref Produk   : ${otherPaths.length} gambar referensi produk (dikirim terpisah sebagai multi-reference ke ${isScenario ? 'Scenario' : 'Magica'})\n\n`;
          } else {
            task.logs += `[1.5/4] Menggabungkan ${otherPaths.length} gambar referensi produk menjadi 1 kolase (khusus deskripsi produk)...\n`;
            try {
              productRefImagePath = await stitchImagesSideBySide(otherPaths, publicDir);
              task.logs += `Kolase referensi produk berhasil dibuat.\n\n`;
            } catch (stitchErr) {
              console.error('Failed to stitch product reference images:', stitchErr);
              task.logs += `[WARNING] Gagal menggabungkan gambar referensi produk: ${stitchErr.message}. Menggunakan gambar pertama sebagai fallback.\n\n`;
              productRefImagePath = otherPaths[0];
            }
          }
        } else {
          task.logs += `\n`;
        }
      } else if (otherPaths.length === 1) {
        finalRefImagePath = otherPaths[0];
        task.logs += `Ref Gambar   : ${path.basename(finalRefImagePath)}\n\n`;
      } else if (otherPaths.length > 1) {
        task.logs += `Ref Gambar Asli: ${otherPaths.map(p => path.basename(p)).join(', ')}\n`;
        if (isScenario || isMagica) {
          finalRefImagePath = otherPaths[0];
          task.logs += `[1.5/4] ${otherPaths.length} gambar referensi akan dikirim langsung secara terpisah (multi-reference) ke ${isScenario ? 'Scenario' : 'Magica'}.\n\n`;
        } else {
          task.logs += `[1.5/4] Menggabungkan ${otherPaths.length} gambar referensi menjadi 1 kolase side-by-side untuk Freebeat...\n`;
          try {
            finalRefImagePath = await stitchImagesSideBySide(otherPaths, publicDir);
            task.logs += `Kolase referensi berhasil dibuat.\n\n`;
          } catch (stitchErr) {
            console.error('Failed to stitch reference images:', stitchErr);
            task.logs += `[WARNING] Gagal menggabungkan gambar referensi: ${stitchErr.message}. Menggunakan gambar pertama sebagai fallback.\n\n`;
            finalRefImagePath = otherPaths[0];
          }
        }
      } else {
        task.logs += `Ref Gambar   : Tidak ada\n\n`;
      }
      task.finalRefImagePath = finalRefImagePath;
      task.productRefImagePath = productRefImagePath;
      await saveTaskState(db, storyboardId, task);
    }

    task.logs += `[2/4] Memulai proses render halaman storyboard...\n`;
    await saveTaskState(db, storyboardId, task);

    let currentError = null;
    if (!task.imagePaths) task.imagePaths = [];
    if (!task.originalCdnUrls) task.originalCdnUrls = [];

    for (let pageIdx = task.currentPageIdx; pageIdx < task.pageCount; pageIdx++) {
      task.currentPageIdx = pageIdx;
      await saveTaskState(db, storyboardId, task);

      const pageNum = pageIdx + 1;
      const startSec = pageIdx * task.secondsPerPage;
      const endSec = (pageIdx + 1) * task.secondsPerPage;
      const startScene = pageIdx * Number(task.gridCount) + 1;
      const endScene = (pageIdx + 1) * Number(task.gridCount);

      task.logs += `\n[Halaman ${pageNum}] Memulai proses generasi Halaman ${pageNum} dari ${task.pageCount}...\n`;
      await saveTaskState(db, storyboardId, task);

       // Resolve reference image for this page
       // ALWAYS use the clean original reference image (if provided) to maintain product/model consistency.
       // NEVER combine or use the previous generated page (prevPagePath) as a reference for any style,
       // as passing a fully formatted storyboard sheet with headers, grids, and old panels causes
       // severe layout leakage and visual bleeding (inception) of previous scenes into the new panels.
       let pageRefPath = task.finalRefImagePath || '';

      let taskInfo = task.currentTaskInfo;
      if (!taskInfo) {
        let pageConcept = (task.subPrompts && task.subPrompts[pageIdx]) ? task.subPrompts[pageIdx] : task.prompt;
        if ((!task.subPrompts || task.subPrompts.length !== task.pageCount || pageConcept === task.prompt) && task.pageCount > 1) {
          const spec = getStyleSpec(task.style);
          pageConcept = buildFallbackConceptForPage(task.prompt, pageIdx, task.pageCount, task.secondsPerPage, !!spec.independentScenes);
        }

        // Describe the reference product ONCE (bounded: async read, ~15s timeout)
        // so the prompt can lock the exact product identity across panels. Falls
        // back to the idea text on any failure — never blocks/hangs.
        if (task.subjectDescriptor === undefined) {
          // A14: when a Consistent Character's own photo is the finalRefImagePath
          // (used for visual identity), analyze the SEPARATE product reference
          // (if the user also supplied one) for the product descriptor instead —
          // otherwise the "product" description would just re-describe the person.
          // A character image is sent directly to the provider as a visual anchor only.
          // Analyze a separate product reference when available; never turn character
          // appearance into text that can conflict with the reference image.
          const subjectImagePath = task.productRefImagePath || (task.characterId ? '' : task.finalRefImagePath);
          const productFallback = (task.title && !/^proyek|untitled|storyboard/i.test(task.title))
            ? task.title
            : (task.prompt || 'the product');
          task.subjectDescriptor = subjectImagePath
            ? await analyzeSubject({ imagePath: subjectImagePath, ideaText: task.prompt }, db)
            : (task.characterId ? productFallback : task.prompt);
          await saveTaskState(db, storyboardId, task);
        }
        const faceMode = normalizeFaceMode(task.faceMode, task.showFace, task.style);
        const spec = getStyleSpec(task.style);
        const genCtx = {
          subject: task.subjectDescriptor || (task.characterId ? (task.title || 'the product') : task.prompt),
          concept: pageConcept,
          faceMode,
          gridCount: Number(task.gridCount) || 6,
          startScene,
          totalDuration: task.totalDuration,
          aspectRatio: task.aspectRatio,
          model: task.selectedModel,
          pageNum,
          pageCount: task.pageCount,
          hasRefImage: !!pageRefPath,
          secondsPerPage: task.secondsPerPage,
          textOnScreen: !!task.textOnScreen,
          voiceOver: task.enableVoImage !== undefined ? !!task.enableVoImage : !!task.enableVo,
          voLanguage: task.voLanguage || 'Bahasa Indonesia',
          referenceKind: task.characterId ? 'character' : 'subject',
          // Pass a brief character anchor if characterId is present, to help the model
          // identify who the person in the reference image is without verbose prose.
          characterDescriptor: task.characterId ? 'the main character' : '',
          characterName: task.characterName || '',
        };
        // Try the LLM generator first; it returns null on ANY failure (no AI key,
        // timeout, bad output) so we always fall back to the deterministic builder.
        let pagePrompt = await generateMasterPromptWithAI(spec, genCtx, db);
        const promptSource = pagePrompt ? 'LLM' : 'deterministik';
        if (!pagePrompt) pagePrompt = buildMasterPrompt(spec, genCtx);
        pagePrompt = pagePrompt.replace(/"/g, "'");
        pagePrompt = safeClampPrompt(pagePrompt, 1995);

        task.pagePromptsManifest = task.pagePromptsManifest || [];
        task.pagePromptsManifest[pageIdx] = {
          pageNum,
          promptSource,
          isAiSplitFallback: !!task.isAiSplitFallback,
          fullPrompt: pagePrompt,
          createdAt: new Date().toISOString(),
        };

        task.logs += `[Halaman ${pageNum}] Prompt (${promptSource}): ${pagePrompt.substring(0, 120)}...\n`;
        await saveTaskState(db, storyboardId, task);
        try {
          await db.run('UPDATE storyboards SET page_prompts_manifest = ? WHERE id = ?', [JSON.stringify(task.pagePromptsManifest), storyboardId]);
        } catch (manifestErr) {}

        // Scenario render for this page
        if (isScenario) {
          try {
            const { result: scRes, keyRecord: usedKey } = await scenarioGen.executeWithScenarioFailover(
              db,
              async (keyRec) => {
                const refUrls = [];
                if (Array.isArray(task.rawRefImagePaths) && task.rawRefImagePaths.length > 0) {
                  refUrls.push(...task.rawRefImagePaths);
                } else {
                  if (task.finalRefImagePath) refUrls.push(task.finalRefImagePath);
                  if (task.productRefImagePath && !refUrls.includes(task.productRefImagePath)) refUrls.push(task.productRefImagePath);
                  if (pageRefPath && !refUrls.includes(pageRefPath)) refUrls.push(pageRefPath);
                }

                return await scenarioGen.generateOneImageScenario(keyRec, pagePrompt, {
                  aspectRatio: task.aspectRatio,
                  model: task.scenarioModel || 'model_openai-gpt-image-2',
                  refUrls: refUrls.length ? refUrls : undefined,
                  referenceImage: !refUrls.length ? pageRefPath : undefined,
                  onLog: (m) => { task.logs += m + '\n'; }
                });
              },
              { onLog: (m) => { task.logs += m + '\n'; }, specificKeyId: task.scenarioKeyId }
            );

            if (usedKey && usedKey.id) {
              try {
                await db.run('UPDATE scenario_api_keys SET usage_count = COALESCE(usage_count, 0) + 1, last_status = ? WHERE id = ?', ['OK - ' + new Date().toLocaleString('id-ID'), usedKey.id]);
                await db.run('UPDATE storyboards SET scenario_key_id = ? WHERE id = ?', [usedKey.id, storyboardId]);
              } catch (e) {}
            }

            const { url, credit } = scRes;
            try {
              const ext = ((String(url).split('?')[0].match(/\.(png|jpe?g|webp)$/i) || [])[1] || 'png').toLowerCase();
              const fname = `storyboard_${storyboardId}_page_${pageIdx}_${Date.now()}.${ext}`;
              await downloadFile(url, path.join(uploadsDir, fname));
              task.logs += `[Halaman ${pageNum}] Backup lokal tersimpan di /uploads/${fname}\n`;
            } catch (dlErr) {}
            task.originalCdnUrls[pageIdx] = url;
            task.imagePaths[pageIdx] = url;
            task.totalCreditsUsed = (task.totalCreditsUsed || 0) + credit;
            task.currentTaskInfo = null;
            task.logs += `[Halaman ${pageNum}] Selesai (Scenario).\n`;
            await saveTaskState(db, storyboardId, task);
          } catch (scErr) {
            const scErrStr = String(scErr.message || scErr);
            const isPolicyErr = /CONTENT_POLICY|POLICY_VIOLATION|CONTENT_FILTER|SAFETY|PROFANITY|NSFW|MODERATION|SENSITIVE|BLOCKED/i.test(scErrStr);
            const isAllKeysFailed = /Semua API Key/i.test(scErrStr);
            if (isPolicyErr || isAllKeysFailed) {
              task.status = 'failed';
              task.error = isPolicyErr
                ? `Gagal: Konten ditolak oleh sistem keamanan AI (${scErr.message}). Silakan periksa prompt atau gambar referensi Anda.`
                : `Gagal: ${scErr.message}`;
              task.logs += `\n[ERROR FATAL] Proses dihentikan sepenuhnya: ${task.error}\n`;
              task.imagePaths[pageIdx] = 'failed';
              task.currentTaskInfo = null;
              await db.run('UPDATE storyboards SET status = ? WHERE id = ?', ['failed', storyboardId]);
              await saveTaskState(db, storyboardId, task);
              return;
            }
            task.logs += `[WARNING][Halaman ${pageNum}] Scenario gagal (${scErr.message}). Melanjutkan ke halaman berikutnya...\n`;
            task.imagePaths[pageIdx] = 'failed';
            task.currentTaskInfo = null;
            await saveTaskState(db, storyboardId, task);
          }
          continue;
        }

        // Magica render for this page — uses failover loop to retry next key if one is empty/error
        if (isMagica) {
          try {
            const { result: magicaRes } = await magicaGen.executeWithMagicaFailover(
              db,
              task.magicaKeyId,
              async (keyRec) => {
                // For Magica, send BOTH character and product images if available
                const refUrls = [];
                if (task.characterId && task.finalRefImagePath) {
                  refUrls.push(task.finalRefImagePath); // Character (Primary)
                  if (task.productRefImagePath) refUrls.push(task.productRefImagePath); // Product (Secondary)
                } else if (pageRefPath) {
                  refUrls.push(pageRefPath);
                }

                return await magicaGen.generateOneImageMagica(keyRec.key_value, pagePrompt, {
                  aspectRatio: task.aspectRatio,
                  refUrls: refUrls.length ? refUrls : undefined,
                  refUrl: !refUrls.length ? pageRefPath : undefined,
                  nodeType: task.magicaModel,
                  onLog: (m) => { task.logs += m + '\n'; },
                });
              },
              (msg) => { task.logs += msg + '\n'; }
            );

            const { url, credit } = magicaRes;

            // Use direct Magica public CDN URL directly so video generation can fetch it reliably without local uploads dependency
            const magicaStored = url;
            try {
              const ext = ((String(url).split('?')[0].match(/\.(png|jpe?g|webp)$/i) || [])[1] || 'png').toLowerCase();
              const fname = `storyboard_${storyboardId}_page_${pageIdx}_${Date.now()}.${ext}`;
              await downloadFile(url, path.join(uploadsDir, fname));
              task.logs += `[Halaman ${pageNum}] Backup lokal tersimpan di /uploads/${fname}\n`;
            } catch (dlErr) {}
            task.originalCdnUrls[pageIdx] = url;
            task.imagePaths[pageIdx] = magicaStored;
            task.totalCreditsUsed = (task.totalCreditsUsed || 0) + credit;
            task.currentTaskInfo = null;
            task.logs += `[Halaman ${pageNum}] Selesai (Magica).\n`;
            await saveTaskState(db, storyboardId, task);
          } catch (mErr) {
            const mErrStr = String(mErr.message || mErr);
            const isPolicyErr = /CONTENT_POLICY|POLICY_VIOLATION|CONTENT_FILTER|SAFETY|PROFANITY|NSFW|MODERATION|SENSITIVE|BLOCKED/i.test(mErrStr);
            const isAllKeysFailed = /Semua API Key/i.test(mErrStr);
            if (isPolicyErr || isAllKeysFailed) {
              task.status = 'failed';
              task.error = isPolicyErr
                ? `Gagal: Konten ditolak oleh sistem keamanan AI (${mErr.message}). Silakan periksa prompt atau gambar referensi Anda.`
                : `Gagal: ${mErr.message}`;
              task.logs += `\n[ERROR FATAL] Proses dihentikan sepenuhnya: ${task.error}\n`;
              task.imagePaths[pageIdx] = 'failed';
              task.currentTaskInfo = null;
              await db.run('UPDATE storyboards SET status = ? WHERE id = ?', ['failed', storyboardId]);
              await saveTaskState(db, storyboardId, task);
              return;
            }
            task.logs += `[WARNING][Halaman ${pageNum}] Magica gagal (${mErr.message}). Melanjutkan ke halaman berikutnya...\n`;
            task.imagePaths[pageIdx] = 'failed';
            task.currentTaskInfo = null;
            await saveTaskState(db, storyboardId, task);
          }
          continue;
        }

        taskInfo = null;
        let submitSuccess = false;

        while (!submitSuccess) {
          let spawnCmd;
          let spawnArgs;

          if (hasLocalCli) {
            spawnCmd = 'node';
            spawnArgs = [
              localCliPath,
              '--api-key', currentKeyRecord.key_value
            ];
          } else {
            spawnCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
            spawnArgs = [
              '-p', 'freebeat-cli',
              'freebeat',
              '--api-key', currentKeyRecord.key_value
            ];
          }

          const sizeArgs = freebeatSizeArgs(task.selectedModel, task.aspectRatio);

          if (pageRefPath) {
            spawnArgs.push(
              'image', 'edit',
              '--model', task.selectedModel,
              '--image', pageRefPath,
              '--prompt', pagePrompt,
              '--count', '1',
              '--json',
              ...sizeArgs
            );
          } else {
            spawnArgs.push(
              'image', 'generate',
              '--model', task.selectedModel,
              '--prompt', pagePrompt,
              '--count', '1',
              '--json',
              ...sizeArgs
            );
          }

          try {
            taskInfo = await new Promise((resolve, reject) => {
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
                  
                  const lowerErr = (errMsg || '').toLowerCase() + (stdout || '').toLowerCase() + (stderr || '').toLowerCase();
                  const isCreditErr = lowerErr.includes('credit') || lowerErr.includes('balance') || lowerErr.includes('insufficient') || lowerErr.includes('limit') || lowerErr.includes('depleted') || lowerErr.includes('payment') || lowerErr.includes('out of');
                  
                  if (isCreditErr) {
                    task.logs += `\n[Auto-Disable] API Key ID ${currentKeyRecord.id} (${currentKeyRecord.label}) kehabisan kredit. Menonaktifkan key.\n`;
                    await db.run('UPDATE api_keys SET is_active = 0, last_status = ? WHERE id = ?', ['Kredit habis (nonaktif otomatis) - ' + new Date().toLocaleString('id-ID'), currentKeyRecord.id]);
                    reject({ type: 'credit', message: errMsg || 'Credits are not enough' });
                  } else {
                    task.logs += `\n[Freebeat CLI Error - Halaman ${pageNum}]\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}\n`;
                    db.run('UPDATE api_keys SET last_status = ? WHERE id = ?', ['Error: ' + (errMsg || 'gagal').slice(0, 120), currentKeyRecord.id]).catch(() => {});
                    reject(new Error(`CLI Halaman ${pageNum} gagal: ${errMsg || code}`));
                  }
                  return;
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

            submitSuccess = true;
          } catch (err) {
            if (err && err.type === 'credit') {
              const altKeys = await db.all('SELECT * FROM api_keys WHERE is_active = 1 AND id != ?', [currentKeyRecord.id]);
              const nextKey = altKeys.length ? altKeys[Math.floor(Math.random() * altKeys.length)] : null;
              if (nextKey) {
                task.logs += `[SYSTEM] Beralih secara otomatis ke API Key alternatif: ${nextKey.label}...\n`;
                await saveTaskState(db, storyboardId, task);
                currentKeyRecord = nextKey;
                task.apiKeyId = nextKey.id;
                await db.run('UPDATE storyboards SET api_key_id = ? WHERE id = ?', [nextKey.id, storyboardId]);
              } else {
                currentError = 'Semua API Key Freebeat yang aktif telah kehabisan kredit.';
                break;
              }
            } else {
              const errStr = String(err.message || err).toLowerCase();
              const isNetworkErr = errStr.includes('network') || errStr.includes('econnreset') || errStr.includes('timeout') || errStr.includes('socket') || errStr.includes('connection');
              
              if (isNetworkErr) {
                task.pageRetries = task.pageRetries || {};
                task.pageRetries[pageNum] = (task.pageRetries[pageNum] || 0) + 1;
                
                if (task.pageRetries[pageNum] <= 3) {
                  task.logs += `[SYSTEM] Terdeteksi gangguan koneksi Freebeat (${err.message || err}). Melakukan uji coba ulang (Retry ${task.pageRetries[pageNum]}/3) dalam 3 detik...\n`;
                  await saveTaskState(db, storyboardId, task);
                  await new Promise(r => setTimeout(r, 3000));
                  continue;
                }
              }
              
              currentError = err.message || err;
              break;
            }
          }
        }

        if (currentError) {
          break;
        }

        task.currentTaskInfo = taskInfo;
        task.logs += `[Halaman ${pageNum}] Pendaftaran sukses (BatchID: ${taskInfo.batchId}). Memulai polling status...\n`;
        await saveTaskState(db, storyboardId, task);
      } else {
        task.logs += `[Halaman ${pageNum}] Melanjutkan pemantauan status tugas render (BatchID: ${taskInfo.batchId})...\n`;
        await saveTaskState(db, storyboardId, task);
      }

      // 2. Poll status for this page
      try {
        const creditsUsed = await new Promise((resolve, reject) => {
          let pollCount = 0;
          const maxPolls = 5760; // ~24 jam @ 15s — tunggu sampai Freebeat memberi status (item 4)
          const pollInterval = setInterval(() => {
            pollCount++;
            if (pollCount % 2 === 1) task.logs += `[Halaman ${pageNum}] Masih memproses di Freebeat... (${pollCount * 15} detik berlalu)\n`;
            saveTaskState(db, storyboardId, task).catch(() => {});

            let statusCmd;
            let statusArgs;

            if (hasLocalCli) {
              statusCmd = 'node';
              statusArgs = [
                localCliPath,
                '--api-key', currentKeyRecord.key_value
              ];
            } else {
              statusCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
              statusArgs = [
                '-p', 'freebeat-cli',
                'freebeat',
                '--api-key', currentKeyRecord.key_value
              ];
            }

            statusArgs.push('task', 'status', taskInfo.batchId, '--json');
            if (taskInfo.serialNo) statusArgs.push('--serial-no', taskInfo.serialNo);

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
                task.logs += `\n[Freebeat Status Check Error - Halaman ${pageNum}]\nSTDOUT:\n${statusStdout}\nSTDERR:\n${statusStderr}\n`;
                await checkAndDisableKeyIfOutofCredits(db, parsedApiKeyId, errMsg || statusStdout || statusStderr, task);
                task.logs += `[WARNING][Halaman ${pageNum}] Gagal memeriksa status: ${errMsg || statusCode}\n`;
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
                    
                    const credits = item.usedCredits || item.needCredits || 0;
                    task.logs += `[Halaman ${pageNum}] Sukses! Link asli: ${remoteUrl} (Kredit: ${credits})\n`;
                    // B2: persist the image locally so a storyboard's pages are
                    // uniform (not a mix of remote CDN URLs + local paths) and
                    // survive CDN link expiry.
                    let storedPath = remoteUrl;
                    try {
                      const ext = ((remoteUrl.split('?')[0].match(/\.(png|jpe?g|webp)$/i) || [])[1] || 'png').toLowerCase();
                      const fname = `storyboard_${storyboardId}_page_${pageIdx}_${Date.now()}.${ext}`;
                      await downloadFile(remoteUrl, path.join(uploadsDir, fname));
                      storedPath = `/uploads/${fname}`;
                      task.logs += `[Halaman ${pageNum}] Gambar disimpan lokal: ${storedPath}\n`;
                    } catch (dlErr) {
                      task.logs += `[WARNING][Halaman ${pageNum}] Gagal menyimpan lokal (${dlErr.message}); memakai URL remote.\n`;
                    }
                    if (!task.originalCdnUrls) task.originalCdnUrls = [];
                    task.originalCdnUrls[pageIdx] = remoteUrl;
                    task.imagePaths[pageIdx] = storedPath;
                    resolve(credits);
                  } else if (renderStatus === 'FAILED' || renderStatus === 'ERROR' || renderStatus === 'failed') {
                    clearInterval(pollInterval);
                    const errMsg = item.errorMessage || `Gagal render Halaman ${pageNum}`;
                    task.logs += `\n[Freebeat Render Error - Halaman ${pageNum}]\nError Message: ${errMsg}\n`;
                    await checkAndDisableKeyIfOutofCredits(db, parsedApiKeyId, errMsg, task);
                    reject(new Error(errMsg));
                  }
                }
              } catch (err) {
                // Ignore parsing errors
              }

              if (pollCount >= maxPolls) {
                clearInterval(pollInterval);
                reject(new Error(`Timeout render Halaman ${pageNum}`));
              }
            });
          }, 15000);
        });
        
        task.totalCreditsUsed += (Number(creditsUsed) || 0);
        task.currentTaskInfo = null; // Clear page's task info as it completed successfully!
        task.logs += `[Halaman ${pageNum}] Selesai diproses!\n`;
        await saveTaskState(db, storyboardId, task);

      } catch (pollErr) {
        task.logs += `[WARNING][Halaman ${pageNum}] Freebeat gagal (${pollErr.message}). Melanjutkan ke halaman berikutnya...\n`;
        task.imagePaths[pageIdx] = 'failed';
        task.currentTaskInfo = null;
        await saveTaskState(db, storyboardId, task);
      }
    }

    const validPaths = (task.imagePaths || []).filter(p => p && p !== 'null' && p !== 'failed');

    if (validPaths.length === 0) {
      task.status = 'failed';
      task.error = 'Seluruh halaman gagal digenerasi.';
      task.logs += `[ERROR] Kesalahan fatal: Seluruh halaman gagal digenerasi.\n`;
      await db.run('UPDATE storyboards SET status = ? WHERE id = ?', ['failed', storyboardId]);
      await saveTaskState(db, storyboardId, task);
      return;
    }

    // Success or Partial Success! Update DB
    task.status = 'success';
    const dbPathString = JSON.stringify(task.imagePaths);
    const originalCdnString = JSON.stringify(task.originalCdnUrls || []);
    await db.run(
      'UPDATE storyboards SET image_path = ?, original_cdn_urls = ?, used_credits = ?, status = ?, page_prompts_manifest = ? WHERE id = ?',
      [dbPathString, originalCdnString, task.totalCreditsUsed, 'success', JSON.stringify(task.pagePromptsManifest || []), storyboardId]
    );
    
    const isVoActive = (task.enableVoScript !== undefined ? !!task.enableVoScript : false) ||
                       (task.enableVoImage !== undefined ? !!task.enableVoImage : false) ||
                       !!task.enableVo;
    task.logs += `[AI Video Prompts] Men-generate otomatis prompt video Image-to-Video ${isVoActive ? 'dan voiceover ' : ''}di latar belakang...\n`;
    await saveTaskState(db, storyboardId, task);
    try {
      const { generateVideoPromptsInternal } = require('../controllers/aiController');
      await generateVideoPromptsInternal({
        storyboardId: storyboardId,
        promptType: 'image-to-video',
        regenerate: true,
        enableVo: isVoActive,
        voMaxWords: task.voMaxWords || 10,
        voLanguage: isVoActive ? task.voLanguage : 'Bahasa Indonesia',
        voTone: isVoActive ? (task.voTone || 'casual') : 'casual',
        videoDuration: task.totalDuration
      });
      task.logs += `[AI Video Prompts] Prompt video berhasil di-generate secara otomatis.\n`;
    } catch (promptErr) {
      console.error('Failed to auto-generate video prompt for new storyboard:', promptErr.message);
      task.logs += `[WARNING] Gagal menulis prompt video otomatis: ${promptErr.message}. Anda bisa membuatnya secara manual di Dashboard.\n`;
    }

    task.status = 'success';
    task.result = {
      id: storyboardId,
      title: task.title,
      prompt: task.prompt,
      image_path: dbPathString
    };
    task.logs += `\n=== SEMUA PROSES BERHASIL SELESAI ===\n`;
    await saveTaskState(db, storyboardId, task);

  } catch (bgError) {
    task.status = 'failed';
    task.error = bgError.message;
    task.logs += `[ERROR] Kesalahan fatal background task: ${bgError.message}\n`;
    try {
      await db.run('UPDATE storyboards SET status = ? WHERE id = ?', ['failed', storyboardId]);
      await saveTaskState(db, storyboardId, task);
    } catch (e) {}
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

    const style = genParams.style || 'premium_vertical_row';
    const gridCount = genParams.gridCount || 6;
    const model = genParams.model || '108';
    const aspectRatio = genParams.aspectRatio || '1:1';
    const showFace = genParams.showFace !== undefined ? genParams.showFace : false;
    const videoEngine = genParams.videoEngine || 'seedance';

    let secondsPerPage = 15;
    if (videoEngine === 'seedance25') {
      secondsPerPage = 30;
    } else if (videoEngine === 'omni') {
      secondsPerPage = 10;
    } else if (videoEngine === 'veo' || videoEngine.startsWith('veo')) {
      secondsPerPage = 8;
    }
    const pageCount = imagePaths.length;

    const storyboardIsMagica = await magicaGen.isMagicaForStoryboard(db, storyboard.id);
    const storyboardIsScenario = await scenarioGen.isScenarioForStoryboard(db, storyboard.id);

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

    if (!storyboardIsMagica && !storyboardIsScenario && !keyRecord) {
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

        const spec = getStyleSpec(style);
        const subPrompts = await splitStoryboardPromptWithAI(storyboard.prompt, pageCount, db, secondsPerPage, style);
        const isFallback = !subPrompts || subPrompts.length !== pageCount || subPrompts.every(p => typeof p === 'string' && (p.includes('dari cerita berikut:') || p.includes('dari konsep cerita berikut:') || p.startsWith(storyboard.prompt)));

        let pageConcept = (subPrompts && subPrompts[pageIdx]) ? subPrompts[pageIdx] : null;
        if (!pageConcept || pageConcept === storyboard.prompt) {
          pageConcept = buildFallbackConceptForPage(storyboard.prompt, pageIdx, pageCount, secondsPerPage, !!spec.independentScenes);
        }

        if (isFallback && pageCount > 1) {
          activeTasks[taskId].logs += `[PERINGATAN] Layanan AI Split mengalami gangguan — halaman ${pageIdx + 1} diregenerasi dengan fokus babak terarah (fallback deterministik).\n`;
        }
        
        const startScene = pageIdx * Number(gridCount) + 1;
        
        // Resolve reference image path from active_task_data
        let finalRefImagePath = '';
        let productRefImagePath = '';
        let rawRefPaths = [];
        try {
          if (storyboard.active_task_data) {
            const taskData = JSON.parse(storyboard.active_task_data);
            finalRefImagePath = taskData.finalRefImagePath || '';
            productRefImagePath = taskData.productRefImagePath || '';
            rawRefPaths = taskData.rawRefImagePaths || [];
          }
        } catch (e) {}

        const faceMode = normalizeFaceMode(genParams.faceMode, showFace, style);

        let characterName = '';
        if (storyboard.character_id) {
          try {
            const charRow = await db.get('SELECT name FROM characters WHERE id = ?', [storyboard.character_id]);
            if (charRow) characterName = charRow.name || '';
          } catch (e) {}
        }

        let subjectDesc = genParams.subjectDescriptor;
        if (subjectDesc === undefined) {
          const subjectImagePath = productRefImagePath || (storyboard.character_id ? '' : finalRefImagePath);
          const productFallback = (storyboard.title && !/^proyek|untitled|storyboard/i.test(storyboard.title))
            ? storyboard.title
            : storyboard.prompt;
          subjectDesc = subjectImagePath
            ? await analyzeSubject({ imagePath: subjectImagePath, ideaText: storyboard.prompt }, db)
            : (storyboard.character_id ? productFallback : storyboard.prompt);
        }

        const genCtx = {
          subject: subjectDesc || (storyboard.title || storyboard.prompt), concept: pageConcept, faceMode,
          gridCount: Number(gridCount) || 6, startScene,
          totalDuration: genParams.duration || (pageCount * secondsPerPage),
          aspectRatio, model, pageNum: pageIdx + 1, pageCount, hasRefImage: !!finalRefImagePath, secondsPerPage,
          textOnScreen: !!genParams.textOnScreen,
          voiceOver: !!genParams.enableVo, voLanguage: genParams.voLanguage || 'Bahasa Indonesia',
          referenceKind: storyboard.character_id ? 'character' : 'subject',
          characterDescriptor: storyboard.character_id ? 'the main character' : '',
          characterName,
        };
        // Try the LLM generator first; it falls back to the deterministic builder
        // (returns null on any failure) so generation never breaks.
        let pagePrompt = await generateMasterPromptWithAI(spec, genCtx, db);
        const promptSource = pagePrompt ? 'LLM' : 'deterministik';
        if (!pagePrompt) pagePrompt = buildMasterPrompt(spec, genCtx);
        pagePrompt = pagePrompt.replace(/"/g, "'");

        let manifest = [];
        try {
          if (storyboard.page_prompts_manifest) {
            manifest = JSON.parse(storyboard.page_prompts_manifest);
          }
        } catch (e) {}
        if (!Array.isArray(manifest)) manifest = [];
        manifest[pageIdx] = {
          pageNum: pageIdx + 1,
          promptSource,
          fullPrompt: pagePrompt,
          createdAt: new Date().toISOString(),
        };

        if (await scenarioGen.isScenarioForStoryboard(db, storyboard.id)) {
          activeTasks[taskId].logs += `[2/3] Memproses regenerasi Halaman ${pageIdx + 1} via Scenario...\n`;
          try {
            const { result: scRes } = await scenarioGen.executeWithScenarioFailover(
              db,
              async (keyRec) => {
                const refUrls = [];
                if (Array.isArray(rawRefPaths) && rawRefPaths.length > 0) {
                  refUrls.push(...rawRefPaths);
                } else {
                  if (finalRefImagePath) refUrls.push(finalRefImagePath);
                  if (productRefImagePath && !refUrls.includes(productRefImagePath)) refUrls.push(productRefImagePath);
                }

                return await scenarioGen.generateOneImageScenario(keyRec, pagePrompt, {
                  aspectRatio,
                  refUrls: refUrls.length ? refUrls : undefined,
                  referenceImage: !refUrls.length ? (finalRefImagePath || undefined) : undefined,
                  model: genParams.scenarioModel || 'model_openai-gpt-image-2',
                  onLog: (m) => { activeTasks[taskId].logs += m + '\n'; }
                });
              },
              { onLog: (m) => { activeTasks[taskId].logs += m + '\n'; }, specificKeyId: genParams.scenarioKeyId }
            );
            const { url } = scRes;
            try {
              const ext = ((String(url).split('?')[0].match(/\.(png|jpe?g|webp)$/i) || [])[1] || 'png').toLowerCase();
              const fname = `storyboard_${storyboard.id}_page_${pageIdx}_regen_${Date.now()}.${ext}`;
              await downloadFile(url, path.join(uploadsDir, fname));
            } catch (dlErr) {}
            imagePaths[pageIdx] = url;
            await db.run('UPDATE storyboards SET image_urls = ?, page_prompts_manifest = ? WHERE id = ?', [JSON.stringify(imagePaths), JSON.stringify(manifest), storyboard.id]);
            activeTasks[taskId].status = 'completed';
            activeTasks[taskId].result = { imageUrl: url, pageIdx };
            activeTasks[taskId].logs += `[3/3] Selesai! Halaman ${pageIdx + 1} berhasil diregenerasi (Scenario).\n`;
            return;
          } catch (err) {
            activeTasks[taskId].status = 'failed';
            activeTasks[taskId].error = err.message;
            activeTasks[taskId].logs += `[ERROR] Regenerasi Scenario gagal: ${err.message}\n`;
            return;
          }
        }

        if (await magicaGen.isMagicaForStoryboard(db, storyboard.id)) {
          activeTasks[taskId].logs += `[2/3] Memproses regenerasi Halaman ${pageIdx + 1} via Magica...\n`;
          try {
            const { result: magicaRes } = await magicaGen.executeWithMagicaFailover(
              db,
              genParams.magicaKeyId || null,
              async (keyRec) => {
                return await magicaGen.generateOneImageMagica(keyRec.key_value, pagePrompt, {
                  aspectRatio,
                  refUrl: finalRefImagePath,
                  nodeType: genParams.magicaModel || 'gpt_image_2',
                  onLog: (m) => { activeTasks[taskId].logs += m + '\n'; }
                });
              },
              (msg) => { activeTasks[taskId].logs += msg + '\n'; }
            );
            const { url } = magicaRes;
            const storedPath = url;
            try {
              const ext = ((String(url).split('?')[0].match(/\.(png|jpe?g|webp)$/i) || [])[1] || 'png').toLowerCase();
              const fname = `storyboard_${storyboard.id}_page_${pageIdx}_regen_${Date.now()}.${ext}`;
              await downloadFile(url, path.join(uploadsDir, fname));
            } catch (dlErr) {}

            imagePaths[pageIdx] = storedPath;
            let origCdn = [];
            try { if (storyboard.original_cdn_urls) origCdn = JSON.parse(storyboard.original_cdn_urls); } catch (e) {}
            origCdn[pageIdx] = url;

            const updatedPathsString = JSON.stringify(imagePaths);
            const updatedCdnString = JSON.stringify(origCdn);
            await db.run('UPDATE storyboards SET image_path = ?, original_cdn_urls = ?, page_prompts_manifest = ? WHERE id = ?', [updatedPathsString, updatedCdnString, JSON.stringify(manifest), storyboard.id]);

            activeTasks[taskId].status = 'success';
            activeTasks[taskId].logs += `=== REGENERASI MAGICA SELESAI ===\nHalaman ${pageIdx + 1} berhasil diperbarui!\n`;
            activeTasks[taskId].result = { id: storyboard.id, image_path: updatedPathsString };
            return;
          } catch (mErr) {
            activeTasks[taskId].status = 'failed';
            activeTasks[taskId].error = mErr.message;
            activeTasks[taskId].logs += `[ERROR] Gagal regenerasi Magica: ${mErr.message}\n`;
            return;
          }
        }

        activeTasks[taskId].logs += `[2/3] Mengirimkan perintah generate ke Freebeat (${promptSource})...\n` +
                                     `Prompt Halaman: ${pagePrompt}\n\n`;

        // Resolve resolution arguments (shared helper)
        const sizeArgs = freebeatSizeArgs(model, aspectRatio);

        // Spawn Freebeat CLI
        const spawnCmd = 'node';
        const cliPath = path.join(__dirname, '..', 'node_modules', 'freebeat-cli', 'dist', 'index.js');
        const spawnArgs = [
          cliPath,
          '--api-key', keyRecord.key_value
        ];

        if (finalRefImagePath) {
          spawnArgs.push(
            'image', 'edit',
            '--model', model,
            '--image', finalRefImagePath,
            '--prompt', pagePrompt,
            '--count', '1',
            '--json',
            ...sizeArgs
          );
        } else {
          spawnArgs.push(
            'image', 'generate',
            '--model', model,
            '--prompt', pagePrompt,
            '--count', '1',
            '--json',
            ...sizeArgs
          );
        }

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
                          await db.run('UPDATE storyboards SET image_path = ?, page_prompts_manifest = ? WHERE id = ?', [updatedPathsString, JSON.stringify(manifest), storyboard.id]);

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

async function resumeProcessingStoryboardsOnStartup() {
  try {
    const { getDb } = require('../db');
    const db = getDb();
    
    // Fetch all storyboards with status 'processing'
    const storyboards = await db.all('SELECT * FROM storyboards WHERE status = "processing"');
    if (storyboards.length === 0) return;
    
    console.log(`[Startup Resume] Found ${storyboards.length} storyboards in 'processing' status. Attempting to resume...`);
    
    for (const sb of storyboards) {
      // Ref-image projects (text-to-image) aren't multi-page storyboards and can't be
      // resumed by the storyboard generator — mark orphaned ones failed so they don't hang.
      let _gp = {};
      try { _gp = JSON.parse(sb.generation_params || '{}'); } catch (e) {}
      if (_gp.style === 'ref_image') {
        await db.run('UPDATE storyboards SET status = "failed" WHERE id = ?', [sb.id]);
        continue;
      }

      if (!sb.active_task_data) {
        console.log(`[Startup Resume] Storyboard ID ${sb.id} has no task data. Marking as failed.`);
        await db.run('UPDATE storyboards SET status = "failed" WHERE id = ?', [sb.id]);
        continue;
      }
      
      try {
        const taskState = JSON.parse(sb.active_task_data);
        const taskId = sb.task_id || ('task_resume_' + sb.id);
        
        taskState.logs += `\n[SYSTEM] Server direstart/deploy. Menyambungkan kembali pemantauan dan melanjutkan proses...\n`;
        activeTasks[taskId] = taskState;
        
        // Start background process to resume this task
        runStoryboardGeneratorBackground(taskId, sb.id);
      } catch (parseErr) {
        console.error(`[Startup Resume] Failed to parse task data for storyboard ID ${sb.id}:`, parseErr);
        await db.run('UPDATE storyboards SET status = "failed" WHERE id = ?', [sb.id]);
      }
    }
  } catch (err) {
    console.error('[Startup Resume] Error during startup recovery:', err);
  }
}

module.exports = { runStoryboardGeneratorBackground, regenerateStoryboardPage, resumeProcessingStoryboardsOnStartup, stitchImagesSideBySide };
