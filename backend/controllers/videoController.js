const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const { getDb } = require('../db');
const { activeTasks } = require('./storyboardController');

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

const { uploadsDir } = require('../config');

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
  // Fallback: return the first active key if all are busy
  return activeKeys[0];
}

async function generateVideo(req, res) {
  const {
    storyboardId,
    sceneIdx,
    prompt,
    model,
    generationType,
    aspectRatio,
    duration,
    resolution,
    generateAudio,
    apiKeyId
  } = req.body;

  if (!storyboardId || sceneIdx === undefined || !prompt || !model || !generationType) {
    return res.status(400).json({ message: 'Parameter tidak lengkap.' });
  }

  try {
    const db = getDb();

    // 1. Retrieve storyboard
    const storyboard = await db.get('SELECT * FROM storyboards WHERE id = ?', [storyboardId]);
    if (!storyboard) {
      return res.status(404).json({ message: 'Storyboard tidak ditemukan.' });
    }

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

    const sceneImage = panelImages[sceneIdx];
    if (generationType !== 'text' && !sceneImage) {
      return res.status(400).json({ message: 'Gambar scene tidak ditemukan.' });
    }

    // 2. Retrieve active API key
    let keyRecord = null;
    if (apiKeyId && apiKeyId !== 'auto') {
      keyRecord = await db.get('SELECT * FROM api_keys WHERE id = ? AND is_active = 1', [apiKeyId]);
    }
    if (!keyRecord) {
      keyRecord = await getAvailableApiKey(db);
    }
    if (!keyRecord) {
      return res.status(400).json({ message: 'Tidak ada API Key Freebeat yang aktif.' });
    }

    // Check if key is currently busy with another generation task
    const isBusy = Object.values(activeTasks).some(task => 
      task.status === 'processing' && parseInt(task.apiKeyId) === parseInt(keyRecord.id)
    );
    if (isBusy) {
      return res.status(400).json({ message: 'API Key ini sedang digunakan untuk generasi lain.' });
    }

    // Create unique task ID for UI tracking
    const taskId = 'video_task_' + Date.now();

    // Insert initial record in generated_videos
    const insertResult = await db.run(
      `INSERT INTO generated_videos 
       (storyboard_id, scene_idx, prompt, model, aspect_ratio, duration, resolution, status, task_id, api_key_id) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        storyboardId,
        sceneIdx,
        prompt,
        model,
        aspectRatio || null,
        duration || null,
        resolution || null,
        'processing',
        taskId,
        keyRecord.id
      ]
    );
    const videoRecordId = insertResult.lastID;

    // Register active task
    activeTasks[taskId] = {
      status: 'processing',
      apiKeyId: keyRecord.id,
      logs: '=== VIDEO STUDIO GENERATION ===\n\n' +
            `Model            : ${model}\n` +
            `Prompt           : ${prompt}\n` +
            `Type             : ${generationType}\n` +
            `Duration         : ${duration ? duration + 's' : 'Default'}\n` +
            `Resolution       : ${resolution || 'Default'}\n` +
            `Aspect Ratio     : ${aspectRatio || 'Default'}\n` +
            `Audio            : ${generateAudio ? 'Yes' : 'No'}\n\n` +
            `[1/3] Mengirimkan perintah generasi ke Freebeat...\n`,
      result: null,
      error: null
    };

    // Respond immediately to client
    res.json({ taskId, videoId: videoRecordId, status: 'processing' });

    // Run submission in background
    (async () => {
      try {
        let finalPrompt = prompt;
        if (generateAudio && storyboard.video_prompts) {
          try {
            const parsed = JSON.parse(storyboard.video_prompts);
            if (parsed && Array.isArray(parsed.scenes)) {
              const match = parsed.scenes.find(s => s.scene_idx === sceneIdx);
              if (match && match.narration) {
                let lang = 'Bahasa Indonesia';
                if (storyboard.generation_params) {
                  try {
                    const params = JSON.parse(storyboard.generation_params);
                    if (params.voLanguage) lang = params.voLanguage;
                  } catch (e) {}
                }
                finalPrompt += `\n\nVoiceover (${lang}):\n${match.narration}`;
              }
            }
          } catch (e) {
            console.error("Failed to append voiceover narration to video prompt:", e);
          }
        }

        const spawnCmd = 'node';
        const cliPath = path.join(__dirname, '..', 'node_modules', 'freebeat-cli', 'dist', 'index.js');
        const spawnArgs = [
          cliPath,
          '--api-key', keyRecord.key_value,
          'video', 'generate',
          '--model', model,
          '--prompt', finalPrompt,
          '--generation-type', generationType,
          '--json'
        ];

        if (generationType !== 'text' && sceneImage) {
          let resolvedImagePath = sceneImage;
          if (sceneImage.startsWith('/uploads/') || sceneImage.startsWith('uploads/')) {
            const filename = sceneImage.replace(/^\/?uploads\//, '');
            resolvedImagePath = path.join(uploadsDir, filename);
          }
          spawnArgs.push('--image', resolvedImagePath);
        }

        if (duration) spawnArgs.push('--duration', String(duration));
        if (resolution) spawnArgs.push('--resolution', resolution);
        if (aspectRatio && aspectRatio !== 'auto') spawnArgs.push('--aspect-ratio', aspectRatio);
        if (generateAudio && (!model || !model.toLowerCase().includes('seedance'))) spawnArgs.push('--generate-audio');

        const child = spawn(spawnCmd, spawnArgs);

        let stdoutData = '';
        let stderrData = '';

        child.stdout.on('data', (data) => {
          const str = data.toString();
          stdoutData += str;
        });

        child.stderr.on('data', (data) => {
          const str = data.toString();
          stderrData += str;
        });

        child.on('close', async (code) => {
          if (code !== 0) {
            console.error(`freebeat video generate submit exited with code ${code}`);
            const errorMsg = (stderrData.trim() || stdoutData.trim() || `Submit exited with code ${code}`);
            activeTasks[taskId].status = 'failed';
            activeTasks[taskId].error = errorMsg;
            activeTasks[taskId].logs += `\n[Freebeat Video CLI Error]\nSTDOUT:\n${stdoutData}\nSTDERR:\n${stderrData}\n`;
            activeTasks[taskId].logs += `[ERROR] Gagal mengirim task ke Freebeat: ${errorMsg}\n`;
            
            await checkAndDisableKeyIfOutofCredits(db, keyRecord.id, errorMsg || stdoutData || stderrData, activeTasks[taskId]);

            await db.run(
              'UPDATE generated_videos SET status = ?, video_url = NULL, error_message = ?, logs = ? WHERE id = ?',
              ['failed', errorMsg, activeTasks[taskId].logs, videoRecordId]
            );
            return;
          }

          try {
            // Find JSON output for batch submission details
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

            const batchId = submitResponse?.batchId;
            const serialNo = submitResponse?.items?.[0]?.serialNo;

            if (batchId && serialNo) {
              activeTasks[taskId].logs += `[2/3] Sukses mengirim task! Batch ID: ${batchId}, Serial No: ${serialNo}\n` +
                                          `[3/3] Menjalankan Freebeat task wait di background...\n\n`;

              // Update DB with Freebeat Batch ID and Serial No
              await db.run(
                'UPDATE generated_videos SET task_id = ?, serial_no = ? WHERE id = ?',
                [batchId, serialNo, videoRecordId]
              );

              // Link the real Freebeat Batch ID to the logs in activeTasks
              activeTasks[batchId] = activeTasks[taskId];

              // Spawn polling status workflow
              pollVideoStatus(videoRecordId, storyboardId, keyRecord.key_value, batchId, serialNo, taskId);
            } else {
              throw new Error('Gagal mendapatkan Batch ID atau Serial No dari respon Freebeat.');
            }

          } catch (err) {
            console.error('Error processing submit response:', err);
            activeTasks[taskId].status = 'failed';
            activeTasks[taskId].error = err.message;
            activeTasks[taskId].logs += `[ERROR] Gagal memproses submit respon: ${err.message}\n`;
            await db.run(
              'UPDATE generated_videos SET status = ?, video_url = NULL, error_message = ?, logs = ? WHERE id = ?',
              ['failed', err.message, activeTasks[taskId].logs, videoRecordId]
            );
          }
        });

      } catch (bgErr) {
        console.error('Error submitting background video task:', bgErr);
        activeTasks[taskId].status = 'failed';
        activeTasks[taskId].error = bgErr.message;
        await db.run(
          'UPDATE generated_videos SET status = ?, video_url = NULL, error_message = ?, logs = ? WHERE id = ?',
          ['failed', bgErr.message, activeTasks[taskId].logs, videoRecordId]
        );
      }
    })();

  } catch (err) {
    console.error('generateVideo failed:', err);
    res.status(500).json({ message: 'Gagal memulai pembuatan video.', error: err.message });
  }
}

function callAi(endpoint, apiKey, payload) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint + '/chat/completions');
    const client = url.protocol === 'https:' ? https : http;
    const bodyStr = JSON.stringify(payload);

    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      timeout: 30000
    };

    const req = client.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('AI Request Timeout'));
    });

    req.write(bodyStr);
    req.end();
  });
}

async function generateMarketingCopyInternal(storyboardId, sceneIdx) {
  try {
    const db = getDb();
    
    // Retrieve storyboard info
    const storyboard = await db.get('SELECT * FROM storyboards WHERE id = ?', [storyboardId]);
    if (!storyboard) return null;

    // Get AI settings
    const settings = await db.get('SELECT * FROM ai_settings LIMIT 1');
    let apiHost = 'http://localhost:8045/v1';
    let apiToken = 'ag_api_55bd6bfe5c3b771a';
    let modelName = 'gemini-3-flash';

    if (settings) {
      apiHost = settings.endpoint;
      apiToken = settings.api_key;
      modelName = settings.model || 'gemini-3-flash';
    }

    // Try to extract narration and visual prompt from video prompts JSON for this scene
    let narrationText = '';
    let sceneVisualPrompt = '';
    try {
      if (storyboard.video_prompts) {
        const parsed = JSON.parse(storyboard.video_prompts);
        if (Array.isArray(parsed) && parsed[sceneIdx]) {
          narrationText = parsed[sceneIdx].narration || '';
          sceneVisualPrompt = parsed[sceneIdx].imageToVideoPrompt || parsed[sceneIdx].textToVideoPrompt || '';
        } else if (parsed && typeof parsed === 'object') {
          if (Array.isArray(parsed.scenes) && parsed.scenes[sceneIdx]) {
            narrationText = parsed.scenes[sceneIdx].narration || '';
            sceneVisualPrompt = parsed.scenes[sceneIdx].imageToVideoPrompt || parsed.scenes[sceneIdx].textToVideoPrompt || '';
          }
        }
      }
    } catch (e) {}

    const systemPrompt = `You are a social media marketing copywriter expert. Your task is to write viral marketing content for a generated video.
You must return the output EXACTLY in JSON format with two keys:
1. "title": A short catchy title representing the video (MAXIMUM 100 characters).
2. "description": A descriptive, engaging marketing copy for social media posts (e.g. TikTok, Instagram Reels, Shopee, Tokopedia video description), combining description and related hashtags.

The language of the response should match the language of the storyboard or voiceover narration (usually Indonesian, unless English/others are explicitly used). Make it look premium, modern, and engaging.

Format example:
{
  "title": "Unboxing Tas Korea Mini Gemoy Yang Lagi Viral!",
  "description": "Siapa sih yang gak kepincut sama tas mini ala Korea yang satu ini? 😍 Desainnya simple, gemoy, tapi muat banyak! Pas banget buat nemenin daily outfit kamu biar makin aesthetic. Yuk, kepoin detailnya sekarang juga!\\n\\n#TasMini #KoreaStyle #TasAesthetic #RacunTikTok #OOTDIndo"
}`;

    const userPrompt = `Video context:
Storyboard Title: ${storyboard.title}
Concept/Prompt: ${storyboard.prompt}
Scene Visual Action: ${sceneVisualPrompt}
Voiceover Narration (if any): ${narrationText}

Write the catchy title (max 100 chars) and description with hashtags based on the above video context. Return ONLY the raw JSON string matching the format.`;

    const payload = {
      model: modelName,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.7,
      response_format: { type: "json_object" }
    };

    const response = await callAi(apiHost, apiToken, payload);
    if (response.statusCode === 200) {
      const parsedRes = JSON.parse(response.body);
      const contentStr = parsedRes.choices?.[0]?.message?.content;
      if (contentStr) {
        const data = JSON.parse(contentStr.trim());
        return {
          title: data.title || '',
          description: data.description || ''
        };
      }
    }
    console.error("AI response error:", response.statusCode, response.body);
    return null;
  } catch (err) {
    console.error("Failed to generate marketing copy internally:", err);
    return null;
  }
}

async function generateMarketingCopy(videoRecordId) {
  try {
    const db = getDb();
    const video = await db.get('SELECT * FROM generated_videos WHERE id = ?', [videoRecordId]);
    if (!video) return null;
    return generateMarketingCopyInternal(video.storyboard_id, video.scene_idx);
  } catch (err) {
    console.error("Failed to wrapper generate marketing copy:", err);
    return null;
  }
}

async function regenerateStoryboardMarketingCopy(req, res) {
  const { id, sceneIdx } = req.params;
  const sIdx = Number(sceneIdx);
  try {
    const db = getDb();
    const storyboard = await db.get('SELECT * FROM storyboards WHERE id = ?', [id]);
    if (!storyboard) {
      return res.status(404).json({ message: 'Storyboard tidak ditemukan.' });
    }

    const marketingCopy = await generateMarketingCopyInternal(id, sIdx);
    if (!marketingCopy) {
      return res.status(500).json({ message: 'Gagal men-generate copywriting marketing.' });
    }

    let videoPrompts = [];
    if (storyboard.video_prompts) {
      try {
        videoPrompts = JSON.parse(storyboard.video_prompts);
      } catch (e) {
        videoPrompts = [];
      }
    }

    if (!Array.isArray(videoPrompts)) {
      videoPrompts = [];
    }

    if (!videoPrompts[sIdx]) {
      videoPrompts[sIdx] = { scene_idx: sIdx };
    }

    videoPrompts[sIdx].marketing_title = marketingCopy.title;
    videoPrompts[sIdx].marketing_description = marketingCopy.description;

    await db.run(
      'UPDATE storyboards SET video_prompts = ? WHERE id = ?',
      [JSON.stringify(videoPrompts), id]
    );

    res.json({
      marketing_title: marketingCopy.title,
      marketing_description: marketingCopy.description
    });
  } catch (err) {
    console.error('Failed to regenerate storyboard marketing copy:', err);
    res.status(500).json({ message: 'Terjadi kesalahan sistem.', error: err.message });
  }
}

// Helper to poll task status and update records in real-time
function pollVideoStatus(videoRecordId, storyboardId, apiKey, batchId, serialNo, taskId) {
  let attempt = 0;
  const maxAttempts = 120; // 10 minutes at 5s interval

  const interval = setInterval(async () => {
    attempt++;
    if (attempt > maxAttempts) {
      clearInterval(interval);
      activeTasks[taskId].status = 'failed';
      activeTasks[taskId].error = 'Timeout waiting for video generation.';
      activeTasks[taskId].logs += `\n[ERROR] Pembuatan video melampaui batas waktu (Timeout).\n`;
      const db = getDb();
      await db.run(
        'UPDATE generated_videos SET status = ?, error_message = ?, logs = ? WHERE id = ?',
        ['failed', 'Timeout waiting for video generation.', activeTasks[taskId].logs, videoRecordId]
      );
      return;
    }

    try {
      const db = getDb();
      const spawnCmd = 'node';
      const cliPath = path.join(__dirname, '..', 'node_modules', 'freebeat-cli', 'dist', 'index.js');
      const spawnArgs = [
        cliPath,
        '--api-key', apiKey,
        'task', 'status',
        batchId,
        '--serial-no', serialNo,
        '--json'
      ];

      const child = spawn(spawnCmd, spawnArgs);
      let stdoutData = '';
      child.stdout.on('data', (data) => {
        stdoutData += data.toString();
      });

      child.on('close', async (code) => {
        if (code !== 0) {
          activeTasks[taskId].logs += `\n[Freebeat Video Status Check Error]\nSTDOUT:\n${stdoutData}\n`;
          await checkAndDisableKeyIfOutofCredits(db, activeTasks[taskId].apiKeyId, stdoutData, activeTasks[taskId]);
          return;
        }

        try {
          const parsed = JSON.parse(stdoutData.trim());
          if (parsed.success && parsed.data) {
            const item = parsed.data.items?.[0];
            const status = item?.status?.toUpperCase() || 'UNKNOWN';
            const credits = Number(item?.usedCredits) || Number(parsed.data.acceptedCredits) || 0;

            if (status === 'SUCCESS' || status === 'COMPLETED') {
              clearInterval(interval);
              const finalVideoUrl = item?.result?.videoUrl || item?.result?.video_url || item?.result?.url || item?.videoUrl || item?.video_url;

              if (finalVideoUrl) {
                activeTasks[taskId].status = 'success';
                activeTasks[taskId].result = { videoUrl: finalVideoUrl };
                activeTasks[taskId].logs += `\n\n[SUCCESS] Video berhasil dibuat!\n` +
                                            `Link Video: ${finalVideoUrl}\n` +
                                            `Kredit Terpakai: ⚡ ${credits}\n`;
                
                await db.run(
                  'UPDATE generated_videos SET status = ?, video_url = ?, used_credits = ?, logs = ? WHERE id = ?',
                  ['success', finalVideoUrl, credits, activeTasks[taskId].logs, videoRecordId]
                );

                await db.run(
                  'UPDATE storyboards SET used_credits = used_credits + ? WHERE id = ?',
                  [credits, storyboardId]
                );

                // Auto-generate title, description and hashtags in background
                try {
                  activeTasks[taskId].logs += `[AI Marketing] Men-generate otomatis Judul, Deskripsi, dan Hashtag...\n`;
                  const marketingCopy = await generateMarketingCopy(videoRecordId);
                  if (marketingCopy) {
                    await db.run(
                      'UPDATE generated_videos SET marketing_title = ?, marketing_description = ? WHERE id = ?',
                      [marketingCopy.title, marketingCopy.description, videoRecordId]
                    );
                    activeTasks[taskId].logs += `[AI Marketing] Judul & Deskripsi berhasil dibuat!\n`;
                  } else {
                    activeTasks[taskId].logs += `[AI Marketing] Gagal membuat deskripsi otomatis.\n`;
                  }
                } catch (copyErr) {
                  console.error('Failed to run background marketing copy generation:', copyErr);
                  activeTasks[taskId].logs += `[AI Marketing] Gagal membuat deskripsi otomatis: ${copyErr.message}\n`;
                }
              } else {
                activeTasks[taskId].status = 'failed';
                activeTasks[taskId].error = 'Video URL tidak ditemukan.';
                await db.run(
                  'UPDATE generated_videos SET status = ?, error_message = ?, logs = ? WHERE id = ?',
                  ['failed', 'Video URL tidak ditemukan.', activeTasks[taskId].logs, videoRecordId]
                );
              }
            } else if (status === 'FAILED' || status === 'ERROR' || status === 'REJECTED') {
              clearInterval(interval);
              const errMsg = item?.errorMessage || 'Kesalahan internal Freebeat CLI.';
              activeTasks[taskId].status = 'failed';
              activeTasks[taskId].error = errMsg;
              activeTasks[taskId].logs += `\n[Freebeat Video Render Error]\nError Message: ${errMsg}\n`;
              
              await checkAndDisableKeyIfOutofCredits(db, activeTasks[taskId].apiKeyId, errMsg, activeTasks[taskId]);

              await db.run(
                'UPDATE generated_videos SET status = ?, error_message = ?, logs = ? WHERE id = ?',
                ['failed', errMsg, activeTasks[taskId].logs, videoRecordId]
              );
            } else {
              // Status is PENDING or RUNNING
              activeTasks[taskId].logs += `Checking status (${attempt}/120)... [${status}]\n`;
            }
          }
        } catch (e) {
          activeTasks[taskId].logs += `.`;
        }
      });

    } catch (err) {
      activeTasks[taskId].logs += `.`;
    }
  }, 5000);
}

// Function to automatically resume monitoring any processing videos at startup
async function resumeProcessingVideos() {
  try {
    const db = getDb();
    const processingVideos = await db.all('SELECT * FROM generated_videos WHERE status = "processing"');
    if (processingVideos.length === 0) return;

    console.log(`--- Resuming monitoring for ${processingVideos.length} processing video task(s) ---`);

    for (const video of processingVideos) {
      // Check if it has a valid batch_id (task_id in SQLite) and serial_no
      if (!video.task_id || !video.serial_no || video.task_id.startsWith('video_task_')) {
        // If it was interrupted before getting batchId, mark it as failed so user can retry
        await db.run('UPDATE generated_videos SET status = "failed" WHERE id = ?', [video.id]);
        continue;
      }

      // Fetch active API key
      const storyboard = await db.get('SELECT * FROM storyboards WHERE id = ?', [video.storyboard_id]);
      let keyRecord = null;
      if (storyboard?.api_key_id) {
        keyRecord = await db.get('SELECT * FROM api_keys WHERE id = ? AND is_active = 1', [storyboard.api_key_id]);
      }
      if (!keyRecord) {
        keyRecord = await db.get('SELECT * FROM api_keys WHERE is_active = 1 LIMIT 1');
      }

      if (!keyRecord) {
        await db.run('UPDATE generated_videos SET status = "failed" WHERE id = ?', [video.id]);
        continue;
      }

      const apiKeyVal = keyRecord.key_value;

      // Re-create the activeTask entry so UI can poll it if they open the modal
      const newTaskId = video.task_id; // Using batch_id as task_id
      activeTasks[newTaskId] = {
        status: 'processing',
        apiKeyId: keyRecord.id,
        logs: `=== RESUMING VIDEO GENERATION ===\n\n` +
              `Batch ID: ${video.task_id}\n` +
              `Serial: ${video.serial_no}\n` +
              `Menyambungkan kembali pemantauan Freebeat task wait...\n\n`,
        result: null,
        error: null
      };

      // Spawn the task polling check
      pollVideoStatus(video.id, video.storyboard_id, apiKeyVal, video.task_id, video.serial_no, newTaskId);
    }
  } catch (err) {
    console.error('Failed to resume processing videos:', err);
  }
}

async function getStoryboardVideos(req, res) {
  const { storyboardId } = req.params;
  try {
    const db = getDb();
    const videos = await db.all('SELECT * FROM generated_videos WHERE storyboard_id = ? ORDER BY created_at DESC', [storyboardId]);
    res.json(videos);
  } catch (err) {
    res.status(500).json({ message: 'Gagal mengambil daftar video.', error: err.message });
  }
}

async function deleteVideo(req, res) {
  const { id } = req.params;
  try {
    const db = getDb();
    await db.run('DELETE FROM generated_videos WHERE id = ?', [id]);
    res.json({ message: 'Video berhasil dihapus.' });
  } catch (err) {
    res.status(500).json({ message: 'Gagal menghapus video.', error: err.message });
  }
}

async function regenerateVideoMarketingCopy(req, res) {
  const { id } = req.params;
  try {
    const db = getDb();
    const video = await db.get('SELECT * FROM generated_videos WHERE id = ?', [id]);
    if (!video) {
      return res.status(404).json({ message: 'Video tidak ditemukan.' });
    }

    const marketingCopy = await generateMarketingCopy(video.id);
    if (!marketingCopy) {
      return res.status(500).json({ message: 'Gagal men-generate copywriting marketing.' });
    }

    await db.run(
      'UPDATE generated_videos SET marketing_title = ?, marketing_description = ? WHERE id = ?',
      [marketingCopy.title, marketingCopy.description, video.id]
    );

    res.json({
      marketing_title: marketingCopy.title,
      marketing_description: marketingCopy.description
    });
  } catch (err) {
    console.error('Failed to regenerate video marketing copy:', err);
    res.status(500).json({ message: 'Terjadi kesalahan sistem.', error: err.message });
  }
}

async function runSingleVideoSpawn(vRecId, tId, kRec, pText, scImg, model, generationType, duration, resolution, aspectRatio, generateAudio, storyboardId) {
  let attemptKeyRecord = kRec;
  let submitSuccess = false;

  while (!submitSuccess) {
    try {
      const db = getDb();
      const spawnCmd = 'node';
      const cliPath = path.join(__dirname, '..', 'node_modules', 'freebeat-cli', 'dist', 'index.js');
      const spawnArgs = [
        cliPath,
        '--api-key', attemptKeyRecord.key_value,
        'video', 'generate',
        '--model', model,
        '--prompt', pText,
        '--generation-type', generationType,
        '--json'
      ];

      if (generationType !== 'text' && scImg) {
        let resolvedImagePath = scImg;
        if (scImg.startsWith('/uploads/') || scImg.startsWith('uploads/')) {
          const filename = scImg.replace(/^\/?uploads\//, '');
          resolvedImagePath = path.join(uploadsDir, filename);
        }
        spawnArgs.push('--image', resolvedImagePath);
      }

      if (duration) spawnArgs.push('--duration', String(duration));
      if (resolution) spawnArgs.push('--resolution', resolution);
      if (aspectRatio && aspectRatio !== 'auto') spawnArgs.push('--aspect-ratio', aspectRatio);
      if (generateAudio && (!model || !model.toLowerCase().includes('seedance'))) spawnArgs.push('--generate-audio');

      await new Promise((resolve, reject) => {
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
            const errorMsg = (stderrData.trim() || stdoutData.trim() || `Submit exited with code ${code}`);
            
            const lowerErr = errorMsg.toLowerCase();
            const isCreditErr = lowerErr.includes('credit') || lowerErr.includes('balance') || lowerErr.includes('insufficient') || lowerErr.includes('limit') || lowerErr.includes('depleted') || lowerErr.includes('payment') || lowerErr.includes('out of');
            
            if (isCreditErr) {
              console.log(`[Auto-Disable API Key] Key ID ${attemptKeyRecord.id} is out of credits. Disabling key.`);
              await db.run('UPDATE api_keys SET is_active = 0 WHERE id = ?', [attemptKeyRecord.id]);
              if (activeTasks[tId]) {
                activeTasks[tId].logs += `\n[Auto-Disable] API Key ID ${attemptKeyRecord.id} (${attemptKeyRecord.label}) kehabisan kredit. Menonaktifkan key.\n`;
              }
              reject({ type: 'credit', message: errorMsg });
            } else {
              if (activeTasks[tId]) {
                activeTasks[tId].status = 'failed';
                activeTasks[tId].error = errorMsg;
                activeTasks[tId].logs += `\n[Freebeat Video CLI Error]\nSTDOUT:\n${stdoutData}\nSTDERR:\n${stderrData}\n`;
                activeTasks[tId].logs += `[ERROR] Gagal mengirim task ke Freebeat: ${errorMsg}\n`;
              }
              await db.run(
                'UPDATE generated_videos SET status = ?, error_message = ?, logs = ? WHERE id = ?',
                ['failed', errorMsg, activeTasks[tId]?.logs || '', vRecId]
              );
              reject(new Error(errorMsg));
            }
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

            if (submitResponse) {
              const batchId = submitResponse.batchId;
              const serialNo = submitResponse.items?.[0]?.serialNo || '';

              if (batchId) {
                if (activeTasks[tId]) {
                  activeTasks[tId].logs += `[2/3] Sukses mendaftarkan task ke Freebeat.\n` +
                                           `Batch ID: ${batchId}\n` +
                                           `Serial  : ${serialNo}\n\n` +
                                           `[3/3] Mulai memantau progress render Freebeat...\n`;
                }
                
                await db.run(
                  'UPDATE generated_videos SET task_id = ?, serial_no = ?, api_key_id = ? WHERE id = ?',
                  [batchId, serialNo, attemptKeyRecord.id, vRecId]
                );

                if (activeTasks[tId]) {
                  activeTasks[batchId] = activeTasks[tId];
                }
                
                pollVideoStatus(vRecId, storyboardId, attemptKeyRecord.key_value, batchId, serialNo, tId);
                resolve();
              } else {
                reject(new Error('Gagal mendapatkan Batch ID dari respon Freebeat.'));
              }
            } else {
              reject(new Error('Respon submit dari Freebeat CLI tidak valid.'));
            }
          } catch (err) {
            reject(err);
          }
        });
      });

      submitSuccess = true;
    } catch (err) {
      if (err && err.type === 'credit') {
        const db = getDb();
        const nextKey = await db.get('SELECT * FROM api_keys WHERE is_active = 1 LIMIT 1');
        if (nextKey) {
          if (activeTasks[tId]) {
            activeTasks[tId].logs += `[SYSTEM] Beralih secara otomatis ke API Key alternatif: ${nextKey.label}...\n`;
          }
          attemptKeyRecord = nextKey;
        } else {
          const errMsg = 'Semua API Key Freebeat yang aktif telah kehabisan kredit.';
          if (activeTasks[tId]) {
            activeTasks[tId].status = 'failed';
            activeTasks[tId].error = errMsg;
            activeTasks[tId].logs += `\n[ERROR] ${errMsg}\n`;
          }
          await db.run(
            'UPDATE generated_videos SET status = ?, error_message = ?, logs = ? WHERE id = ?',
            ['failed', errMsg, activeTasks[tId]?.logs || '', vRecId]
          );
          break;
        }
      } else {
        const errStr = String(err.message || err).toLowerCase();
        const isNetworkErr = errStr.includes('network') || errStr.includes('econnreset') || errStr.includes('timeout') || errStr.includes('socket') || errStr.includes('connection');
        
        if (isNetworkErr) {
          if (!activeTasks[tId]) {
            activeTasks[tId] = { pageRetries: 0 };
          }
          activeTasks[tId].pageRetries = (activeTasks[tId].pageRetries || 0) + 1;
          
          if (activeTasks[tId].pageRetries <= 3) {
            const retryMsg = `[SYSTEM] Terdeteksi gangguan koneksi Freebeat (${err.message || err}). Melakukan uji coba ulang (Retry ${activeTasks[tId].pageRetries}/3) dalam 3 detik...\n`;
            activeTasks[tId].logs = (activeTasks[tId].logs || '') + retryMsg;
            await new Promise(r => setTimeout(r, 3000));
            continue;
          }
        }
        
        const errorMsg = err.message || err;
        if (activeTasks[tId]) {
          activeTasks[tId].status = 'failed';
          activeTasks[tId].error = errorMsg;
          activeTasks[tId].logs += `\n[ERROR] Generasi video gagal permanen: ${errorMsg}\n`;
        }
        await db.run(
          'UPDATE generated_videos SET status = ?, error_message = ?, logs = ? WHERE id = ?',
          ['failed', errorMsg, activeTasks[tId]?.logs || '', vRecId]
        );
        break;
      }
    }
  }
}

async function generateAllVideos(req, res) {
  const {
    storyboardId,
    model,
    generationType,
    aspectRatio,
    duration,
    resolution,
    generateAudio,
    apiKeyId
  } = req.body;

  if (!storyboardId || !model || !generationType) {
    return res.status(400).json({ message: 'Parameter tidak lengkap.' });
  }

  try {
    const db = getDb();

    // 1. Retrieve storyboard
    const storyboard = await db.get('SELECT * FROM storyboards WHERE id = ?', [storyboardId]);
    if (!storyboard) {
      return res.status(404).json({ message: 'Storyboard tidak ditemukan.' });
    }

    // 2. Resolve pages & total scenes
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

    const totalScenes = panelImages.length;
    if (totalScenes === 0) {
      return res.status(400).json({ message: 'Storyboard ini belum memiliki gambar panel.' });
    }

    // Parse the video prompts array
    let scenePrompts = [];
    try {
      if (storyboard.video_prompts) {
        const parsed = JSON.parse(storyboard.video_prompts);
        if (parsed && Array.isArray(parsed.scenes)) {
          scenePrompts = parsed.scenes;
        }
      }
    } catch (e) {
      console.error("Failed to parse video prompts in generateAllVideos:", e);
    }

    // Respond immediately to prevent HTTP timeouts
    res.json({ message: 'Proses batch video generation sukses dimulai di background. Setiap scene akan diantrekan secara bergiliran.' });

    // Run the queue loop in the background!
    (async () => {
      const activeTasksCountForStoryboard = () => {
        return Object.values(activeTasks).filter(task => 
          task.status === 'processing' && task.storyboardId === storyboardId
        ).length;
      };

      const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

      for (let sceneIdx = 0; sceneIdx < totalScenes; sceneIdx++) {
        // Wait if there are already 2 or more active tasks processing for this storyboard
        while (activeTasksCountForStoryboard() >= 2) {
          await sleep(5000); // Check every 5 seconds
        }

        // Re-read DB connection
        const db = getDb();

        // Check if there is already a successfully generated or processing video for this sceneIdx
        const existingVideo = await db.get(
          'SELECT * FROM generated_videos WHERE storyboard_id = ? AND scene_idx = ? ORDER BY id DESC LIMIT 1',
          [storyboardId, sceneIdx]
        );

        if (existingVideo && (existingVideo.status === 'success' || existingVideo.status === 'processing')) {
          continue;
        }

        // Introduce a delay of 20 seconds before starting the next video (except for the first one)
        if (sceneIdx > 0) {
          await sleep(20000);
        }

        // Resolve scene-specific prompt
        let promptText = '';
        const matchingPrompt = scenePrompts.find(p => p.scene_idx === sceneIdx);
        if (matchingPrompt) {
          promptText = generationType !== 'text' 
            ? (matchingPrompt.imageToVideoPrompt || matchingPrompt.textToVideoPrompt)
            : (matchingPrompt.textToVideoPrompt || matchingPrompt.imageToVideoPrompt);

          if (generateAudio && matchingPrompt.narration) {
            let lang = 'Bahasa Indonesia';
            if (storyboard.generation_params) {
              try {
                const params = JSON.parse(storyboard.generation_params);
                if (params.voLanguage) lang = params.voLanguage;
              } catch (e) {}
            }
            promptText += `\n\nVoiceover (${lang}):\n${matchingPrompt.narration}`;
          }
        }
        
        if (!promptText) {
          promptText = storyboard.prompt || storyboard.title;
        }

        // Resolve scene image
        const pageIdx = sceneIdx;
        const sceneImage = panelImages[pageIdx];

        // Dynamically select an available API key for each scene!
        let keyRecord = null;
        if (apiKeyId && apiKeyId !== 'auto') {
          keyRecord = await db.get('SELECT * FROM api_keys WHERE id = ? AND is_active = 1', [apiKeyId]);
        }
        if (!keyRecord) {
          keyRecord = await getAvailableApiKey(db);
        }

        if (!keyRecord) {
          console.warn(`[Batch] No active key available for scene ${sceneIdx}`);
          continue;
        }

        // Create unique task ID
        const taskId = 'video_task_' + Date.now() + '_' + sceneIdx;

        // Insert record in generated_videos
        const insertResult = await db.run(
          `INSERT INTO generated_videos 
           (storyboard_id, scene_idx, prompt, model, aspect_ratio, duration, resolution, status, task_id, api_key_id) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            storyboardId,
            sceneIdx,
            promptText,
            model,
            aspectRatio || null,
            duration || null,
            resolution || null,
            'processing',
            taskId,
            keyRecord.id
          ]
        );
        const videoRecordId = insertResult.lastID;

        // Register active task
        activeTasks[taskId] = {
          status: 'processing',
          storyboardId,
          apiKeyId: keyRecord.id,
          logs: '=== VIDEO STUDIO GENERATION (BATCH QUEUE) ===\n\n' +
                `Scene Index      : ${sceneIdx + 1}\n` +
                `Model            : ${model}\n` +
                `Prompt           : ${promptText}\n` +
                `Type             : ${generationType}\n` +
                `Duration         : ${duration ? duration + 's' : 'Default'}\n` +
                `Resolution       : ${resolution || 'Default'}\n` +
                `Aspect Ratio     : ${aspectRatio || 'Default'}\n` +
                `Audio            : ${generateAudio ? 'Yes' : 'No'}\n\n` +
                `[1/3] Mengirimkan perintah generasi ke Freebeat...\n`,
          result: null,
          error: null
        };

        // Spawn execution
        runSingleVideoSpawn(videoRecordId, taskId, keyRecord, promptText, sceneImage, model, generationType, duration, resolution, aspectRatio, generateAudio, storyboardId);
      }
    })();

  } catch (err) {
    console.error('generateAllVideos failed:', err);
    res.status(500).json({ message: 'Gagal memulai batch video generation.', error: err.message });
  }
}

async function mergeStoryboardVideos(req, res) {
  const { storyboardId } = req.params;
  const { videoIds, transitionType, audioBlend } = req.body || {};
  const db = getDb();
  
  function downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const options = {
        hostname: parsedUrl.hostname,
        path: parsedUrl.pathname + parsedUrl.search,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        timeout: 20000
      };
      
      const file = fs.createWriteStream(destPath);
      const protocol = url.startsWith('https') ? https : http;
      
      protocol.get(options, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`Failed to download: HTTP ${response.statusCode}`));
          return;
        }
        response.pipe(file);
        file.on('finish', () => {
          file.close(resolve);
        });
      }).on('error', (err) => {
        fs.unlink(destPath, () => reject(err));
      });
    });
  }

  function getVideoMetadata(filePath) {
    return new Promise((resolve) => {
      const { exec } = require('child_process');
      const cmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`;
      exec(cmd, (error, stdout) => {
        if (error) {
          resolve({ duration: 15, hasAudio: true });
        } else {
          const duration = parseFloat(stdout.trim()) || 15;
          const audioCmd = `ffprobe -v error -select_streams a:0 -show_entries stream=codec_type -of default=noprint_wrappers=1:nokey=1 "${filePath}"`;
          exec(audioCmd, (aErr, aStdout) => {
            const hasAudio = !aErr && aStdout.trim() === 'audio';
            resolve({ duration, hasAudio });
          });
        }
      });
    });
  }

  function getVideoDimensions(filePath) {
    return new Promise((resolve) => {
      const { exec } = require('child_process');
      const cmd = `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of default=noprint_wrappers=1:nokey=1 "${filePath}"`;
      exec(cmd, (error, stdout) => {
        if (error) {
          resolve({ width: 720, height: 1280 });
        } else {
          const lines = stdout.trim().split('\n').map(l => parseInt(l.trim()));
          if (lines.length >= 2 && !isNaN(lines[0]) && !isNaN(lines[1])) {
            resolve({ width: lines[0], height: lines[1] });
          } else {
            resolve({ width: 720, height: 1280 });
          }
        }
      });
    });
  }

  function ensureVideoHasAudio(filePath) {
    return new Promise((resolve, reject) => {
      const { exec } = require('child_process');
      const tempOut = path.join(uploadsDir, `silent_audio_${Date.now()}_${Math.random().toString(36).substr(2, 5)}.mp4`);
      const cmd = `ffmpeg -y -i "${filePath}" -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100 -c:v copy -c:a aac -shortest "${tempOut}"`;
      exec(cmd, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`Gagal menyuntikkan audio hening: ${stderr || error.message}`));
        } else {
          resolve(tempOut);
        }
      });
    });
  }

  const tempFiles = [];
  let listPath = '';

  try {
    const storyboard = await db.get('SELECT * FROM storyboards WHERE id = ?', [storyboardId]);
    if (!storyboard) {
      return res.status(404).json({ message: 'Storyboard tidak ditemukan.' });
    }

    let videos = [];
    if (Array.isArray(videoIds) && videoIds.length > 0) {
      // Query specific video IDs selected by the user
      const placeholders = videoIds.map(() => '?').join(',');
      videos = await db.all(
        `SELECT * FROM generated_videos 
         WHERE id IN (${placeholders}) AND storyboard_id = ? AND status = "success" 
         ORDER BY scene_idx ASC`,
        [...videoIds, storyboardId]
      );
    } else {
      // Fallback: Pick only the latest successful video for each scene_idx (to prevent duplicates)
      const allVideos = await db.all(
        `SELECT * FROM generated_videos 
         WHERE storyboard_id = ? AND status = "success" 
         ORDER BY id DESC`,
        [storyboardId]
      );
      
      const seenScenes = new Set();
      const latestVideos = [];
      for (const v of allVideos) {
        if (!seenScenes.has(v.scene_idx)) {
          seenScenes.add(v.scene_idx);
          latestVideos.push(v);
        }
      }
      // Sort chronologically by scene index
      videos = latestVideos.sort((a, b) => a.scene_idx - b.scene_idx);
    }

    if (!videos || videos.length === 0) {
      return res.status(400).json({ message: 'Tidak ada video sukses yang ditemukan untuk digabungkan.' });
    }

    if (videos.length < 2) {
      return res.status(400).json({ message: 'Minimal harus ada 2 video sukses untuk dapat digabungkan.' });
    }

    const localPaths = [];
    for (let i = 0; i < videos.length; i++) {
      const video = videos[i];
      const videoUrl = video.video_url;
      const isLocal = !videoUrl.startsWith('http');
      let localPath = '';

      if (isLocal) {
        const relativePath = videoUrl.replace(/^\/?uploads\//, '');
        localPath = path.join(uploadsDir, relativePath);
      } else {
        const tempFilename = `temp_merge_${Date.now()}_${i}.mp4`;
        localPath = path.join(uploadsDir, tempFilename);
        tempFiles.push(localPath);
        await downloadFile(videoUrl, localPath);
      }

      if (!fs.existsSync(localPath)) {
        throw new Error(`File video tidak ditemukan secara lokal untuk scene ${video.scene_idx + 1}`);
      }
      localPaths.push(localPath);
    }

    const outputFilename = `merged_${storyboardId}_${Date.now()}.mp4`;
    const outputPath = path.join(uploadsDir, outputFilename);
    const { exec } = require('child_process');

    const activeTransition = transitionType || 'none';

    if (activeTransition === 'none') {
      const listFilename = `list_${Date.now()}.txt`;
      listPath = path.join(uploadsDir, listFilename);
      const listContent = localPaths.map(p => `file '${p.replace(/\\/g, '/')}'`).join('\n');
      fs.writeFileSync(listPath, listContent);

      await new Promise((resolve, reject) => {
        const ffmpegCmd = `ffmpeg -y -f concat -safe 0 -i "${listPath}" -c copy "${outputPath}"`;
        exec(ffmpegCmd, (error, stdout, stderr) => {
          if (error) {
            reject(new Error(`FFmpeg error: ${stderr || error.message}`));
          } else {
            resolve();
          }
        });
      });
    } else {
      // Transition merging
      const { width, height } = await getVideoDimensions(localPaths[0]);

      // Pre-process paths: Ensure all have audio
      const processedPaths = [];
      for (const p of localPaths) {
        const { hasAudio } = await getVideoMetadata(p);
        if (!hasAudio) {
          const withAudioPath = await ensureVideoHasAudio(p);
          tempFiles.push(withAudioPath);
          processedPaths.push(withAudioPath);
        } else {
          processedPaths.push(p);
        }
      }

      let currentPath = processedPaths[0];

      for (let i = 1; i < processedPaths.length; i++) {
        const nextPath = processedPaths[i];
        const { duration: dur1 } = await getVideoMetadata(currentPath);

        const transitionDur = 1.0;
        let offset = dur1 - transitionDur;
        if (offset < 0) offset = 0;

        const nextTempOut = path.join(uploadsDir, `temp_merged_step_${i}_${Date.now()}.mp4`);
        tempFiles.push(nextTempOut);

        const isAudioBlend = audioBlend !== false;
        const audioFilter = isAudioBlend 
          ? `[0:a][1:a]acrossfade=d=1[a]` 
          : `[0:a][1:a]concat=n=2:v=0:a=1[a]`;

        const filterComplex = 
          `[0:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1[v0]; ` +
          `[1:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1[v1]; ` +
          `[v0][v1]xfade=transition=${activeTransition}:duration=${transitionDur}:offset=${offset.toFixed(2)}[v]; ` +
          audioFilter;

        await new Promise((resolve, reject) => {
          const ffmpegCmd = `ffmpeg -y -i "${currentPath}" -i "${nextPath}" -filter_complex "${filterComplex}" -map "[v]" -map "[a]" -c:v libx264 -pix_fmt yuv420p -c:a aac -preset fast "${nextTempOut}"`;
          exec(ffmpegCmd, (error, stdout, stderr) => {
            if (error) {
              reject(new Error(`FFmpeg error at step ${i}: ${stderr || error.message}`));
            } else {
              resolve();
            }
          });
        });

        currentPath = nextTempOut;
      }

      fs.copyFileSync(currentPath, outputPath);
    }

    if (listPath && fs.existsSync(listPath)) {
      fs.unlinkSync(listPath);
      listPath = '';
    }
    for (const f of tempFiles) {
      if (fs.existsSync(f) && f !== outputPath) {
        try { fs.unlinkSync(f); } catch (e) {}
      }
    }

    const finalMergedUrl = `/uploads/${outputFilename}`;
    await db.run('UPDATE storyboards SET merged_video_url = ? WHERE id = ?', [finalMergedUrl, storyboardId]);

    res.json({
      message: 'Video berhasil digabungkan.',
      merged_video_url: finalMergedUrl
    });

  } catch (err) {
    if (listPath && fs.existsSync(listPath)) {
      try { fs.unlinkSync(listPath); } catch (e) {}
    }
    for (const f of tempFiles) {
      if (fs.existsSync(f)) {
        try { fs.unlinkSync(f); } catch (e) {}
      }
    }
    console.error('[Video Concat] Merging failed:', err);
    res.status(500).json({ message: 'Gagal menggabungkan video.', error: err.message });
  }
}

module.exports = {
  generateVideo,
  getStoryboardVideos,
  deleteVideo,
  resumeProcessingVideos,
  regenerateVideoMarketingCopy,
  regenerateStoryboardMarketingCopy,
  generateAllVideos,
  mergeStoryboardVideos
};
