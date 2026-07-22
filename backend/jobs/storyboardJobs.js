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
const { splitStoryboardPromptWithAI } = require('../prompts/splitPrompt');
const { buildEnhancedPrompt } = require('../prompts/buildEnhancedPrompt');
const { formatTime } = require('../prompts/grid');
const { safeClampPrompt } = require('../prompts/clamp');
const { freebeatSizeArgs } = require('../services/freebeat/cli');

async function runStoryboardGeneratorBackground(taskId, storyboardId) {
  const db = getDb();
  const task = activeTasks[taskId];
  if (!task) return;

  try {
    const keyRecord = await db.get('SELECT * FROM api_keys WHERE id = ?', [task.apiKeyId]);
    if (!keyRecord || !keyRecord.is_active) {
      task.status = 'failed';
      task.error = 'Selected API Key is invalid or inactive.';
      task.logs += '[ERROR] Selected API Key is invalid or inactive.\n';
      await db.run('UPDATE storyboards SET status = ? WHERE id = ?', ['failed', storyboardId]);
      await saveTaskState(db, storyboardId, task);
      return;
    }

    const parsedApiKeyId = keyRecord.id;
    let currentKeyRecord = keyRecord;
    const localCliPath = path.join(__dirname, '..', 'node_modules', 'freebeat-cli', 'dist', 'index.js');
    const hasLocalCli = fs.existsSync(localCliPath);
    const publicDir = uploadsDir;

    // 1. Split the storyboard prompt into chronological parts using AI if starting fresh
    if (task.subPrompts === null) {
      task.logs += `[1.2/4] Menganalisis konsep cerita dan memecah menjadi ${task.pageCount} segmen visual kronologis menggunakan AI...\n`;
      await saveTaskState(db, storyboardId, task);
      
      const subPrompts = await splitStoryboardPromptWithAI(task.prompt, task.pageCount, db, task.secondsPerPage);
      task.subPrompts = subPrompts;
      
      const isFallback = subPrompts.every(p => p === task.prompt);
      if (isFallback && task.pageCount > 1) {
        task.logs += `  [INFO] Layanan AI Split sedang mengalami gangguan (HTTP 503/RTO). Menggunakan konsep cerita asli untuk setiap halaman (fallback).\n`;
      } else {
        for (let i = 0; i < subPrompts.length; i++) {
          task.logs += `  Halaman ${i+1}: ${subPrompts[i].substring(0, 100)}...\n`;
        }
      }
      task.logs += `\n`;
      await saveTaskState(db, storyboardId, task);
    }

    // 2. Save Reference Images if starting fresh
    if (task.finalRefImagePath === undefined) {
      const savedRefImagePaths = [];
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
          savedRefImagePaths.push(refImagePath.replace(/\\/g, '/'));
        }
      }

      let finalRefImagePath = '';
      if (savedRefImagePaths.length === 1) {
        finalRefImagePath = savedRefImagePaths[0];
        task.logs += `Ref Gambar   : ${path.basename(finalRefImagePath)}\n\n`;
      } else if (savedRefImagePaths.length > 1) {
        task.logs += `Ref Gambar Asli: ${savedRefImagePaths.map(p => path.basename(p)).join(', ')}\n`;
        task.logs += `[1.5/4] Menggabungkan ${savedRefImagePaths.length} gambar referensi menjadi 1 kolase side-by-side untuk Freebeat...\n`;
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
          task.logs += `Kolase referensi berhasil dibuat: ${combinedFilename}\n\n`;
        } catch (stitchErr) {
          console.error('Failed to stitch reference images:', stitchErr);
          task.logs += `[WARNING] Gagal menggabungkan gambar referensi: ${stitchErr.message}. Menggunakan gambar pertama sebagai fallback.\n\n`;
          finalRefImagePath = savedRefImagePaths[0];
        }
      } else {
        task.logs += `Ref Gambar   : Tidak ada\n\n`;
      }
      task.finalRefImagePath = finalRefImagePath;
      await saveTaskState(db, storyboardId, task);
    }

    task.logs += `[2/4] Mengirim perintah generate ke Freebeat secara sekuensial (Satu per satu)...\n`;
    await saveTaskState(db, storyboardId, task);

    let currentError = null;

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

      // Check if we already have batch information (resume scenario)
      let taskInfo = task.currentTaskInfo;
      if (!taskInfo) {
        const pageConcept = (task.subPrompts && task.subPrompts[pageIdx]) ? task.subPrompts[pageIdx] : task.prompt;
        let pagePrompt = buildEnhancedPrompt({ style: task.style, userPrompt: pageConcept, gridCount: Number(task.gridCount) || 6, showFace: task.showFace, startScene, totalDuration: task.totalDuration, secondsPerPage: task.secondsPerPage, hasRefImage: !!pageRefPath, containerShape: task.containerShape, aspectRatio: task.aspectRatio, model: task.selectedModel });
        pagePrompt = pagePrompt.replace(/"/g, "'");
        if (task.style !== 'single_premium_showcase') {
          pagePrompt = `Page ${pageNum} of ${task.pageCount}, Scenes ${startScene}-${endScene} (time segment ${formatTime(startSec)} to ${formatTime(endSec)}). ` + pagePrompt;
        }
        pagePrompt = safeClampPrompt(pagePrompt, 1995);

        task.logs += `[Halaman ${pageNum}] Prompt: ${pagePrompt.substring(0, 120)}...\n`;
        await saveTaskState(db, storyboardId, task);

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
                    await db.run('UPDATE api_keys SET is_active = 0 WHERE id = ?', [currentKeyRecord.id]);
                    reject({ type: 'credit', message: errMsg || 'Credits are not enough' });
                  } else {
                    task.logs += `\n[Freebeat CLI Error - Halaman ${pageNum}]\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}\n`;
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
              const nextKey = await db.get('SELECT * FROM api_keys WHERE is_active = 1 LIMIT 1');
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
          const maxPolls = 120;
          const pollInterval = setInterval(() => {
            pollCount++;
            task.logs += `[Halaman ${pageNum}] Memeriksa status render (${pollCount}/${maxPolls})...\n`;
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
        currentError = pollErr.message;
        break;
      }
    }

    if (currentError) {
      task.status = 'failed';
      task.error = currentError;
      task.logs += `[ERROR] Kesalahan fatal dalam proses generasi: ${currentError}\n`;
      await db.run('UPDATE storyboards SET status = ? WHERE id = ?', ['failed', storyboardId]);
      await saveTaskState(db, storyboardId, task);
      return;
    }

    // Success! Update DB
    const dbPathString = JSON.stringify(task.imagePaths);
    await db.run(
      'UPDATE storyboards SET image_path = ?, used_credits = ?, status = ? WHERE id = ?',
      [dbPathString, task.totalCreditsUsed, 'success', storyboardId]
    );
    
    task.logs += `[AI Video Prompts] Men-generate otomatis prompt video Image-to-Video ${task.enableVo ? 'dan voiceover ' : ''}di latar belakang...\n`;
    await saveTaskState(db, storyboardId, task);
    try {
      const { generateVideoPromptsInternal } = require('../controllers/aiController');
      await generateVideoPromptsInternal({
        storyboardId: storyboardId,
        promptType: 'image-to-video',
        regenerate: true,
        enableVo: !!task.enableVo,
        voLanguage: task.enableVo ? task.voLanguage : undefined,
        voTone: task.enableVo ? task.voTone : undefined,
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

        const subPrompts = await splitStoryboardPromptWithAI(storyboard.prompt, pageCount, db, secondsPerPage);
        const pageConcept = (subPrompts && subPrompts[pageIdx]) ? subPrompts[pageIdx] : storyboard.prompt;
        
        const startScene = pageIdx * Number(gridCount) + 1;
        
        // Resolve reference image path from active_task_data
        let finalRefImagePath = '';
        try {
          if (storyboard.active_task_data) {
            const taskData = JSON.parse(storyboard.active_task_data);
            finalRefImagePath = taskData.finalRefImagePath || '';
          }
        } catch (e) {}

        let pagePrompt = buildEnhancedPrompt({ style, userPrompt: pageConcept, gridCount: Number(gridCount) || 6, showFace, startScene, totalDuration: genParams.duration || (pageCount * secondsPerPage), secondsPerPage, hasRefImage: !!finalRefImagePath, containerShape: genParams.containerShape, aspectRatio, model });
        pagePrompt = pagePrompt.replace(/"/g, "'");

        activeTasks[taskId].logs += `[2/3] Mengirimkan perintah generate ke Freebeat...\n` +
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

async function resumeProcessingStoryboardsOnStartup() {
  try {
    const { getDb } = require('../db');
    const db = getDb();
    
    // Fetch all storyboards with status 'processing'
    const storyboards = await db.all('SELECT * FROM storyboards WHERE status = "processing"');
    if (storyboards.length === 0) return;
    
    console.log(`[Startup Resume] Found ${storyboards.length} storyboards in 'processing' status. Attempting to resume...`);
    
    for (const sb of storyboards) {
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

module.exports = { runStoryboardGeneratorBackground, regenerateStoryboardPage, resumeProcessingStoryboardsOnStartup };
