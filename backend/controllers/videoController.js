const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const { getDb } = require('../db');
const { activeTasks } = require('./storyboardController');

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
    if (generationType === 'image' && !sceneImage) {
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
        const spawnCmd = 'node';
        const cliPath = path.join(__dirname, '..', 'node_modules', 'freebeat-cli', 'dist', 'index.js');
        const spawnArgs = [
          cliPath,
          '--api-key', keyRecord.key_value,
          'video', 'generate',
          '--model', model,
          '--prompt', prompt,
          '--generation-type', generationType === 'image' ? 'image' : 'text',
          '--json'
        ];

        if (generationType === 'image' && sceneImage) {
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
        if (generateAudio) spawnArgs.push('--generate-audio');

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
            activeTasks[taskId].logs += `[ERROR] Gagal mengirim task ke Freebeat: ${errorMsg}\n`;
            await db.run(
              'UPDATE generated_videos SET status = ?, video_url = NULL WHERE id = ?',
              ['failed', videoRecordId]
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
              'UPDATE generated_videos SET status = ?, video_url = NULL WHERE id = ?',
              ['failed', videoRecordId]
            );
          }
        });

      } catch (bgErr) {
        console.error('Error submitting background video task:', bgErr);
        activeTasks[taskId].status = 'failed';
        activeTasks[taskId].error = bgErr.message;
        await db.run(
          'UPDATE generated_videos SET status = ?, video_url = NULL WHERE id = ?',
          ['failed', videoRecordId]
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

async function generateMarketingCopy(videoRecordId) {
  try {
    const db = getDb();
    
    // Retrieve video record
    const video = await db.get('SELECT * FROM generated_videos WHERE id = ?', [videoRecordId]);
    if (!video) return null;

    // Retrieve storyboard info
    const storyboard = await db.get('SELECT * FROM storyboards WHERE id = ?', [video.storyboard_id]);
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

    // Try to extract narration from video prompts JSON for this scene
    let narrationText = '';
    try {
      if (storyboard.video_prompts) {
        const parsed = JSON.parse(storyboard.video_prompts);
        const sceneIdx = video.scene_idx;
        if (Array.isArray(parsed) && parsed[sceneIdx]) {
          narrationText = parsed[sceneIdx].narration || '';
        } else if (parsed && typeof parsed === 'object') {
          if (Array.isArray(parsed.scenes) && parsed.scenes[sceneIdx]) {
            narrationText = parsed.scenes[sceneIdx].narration || '';
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
Scene Visual Action: ${video.prompt}
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
    console.error("Failed to generate marketing copy:", err);
    return null;
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
      await db.run('UPDATE generated_videos SET status = ? WHERE id = ?', ['failed', videoRecordId]);
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
          activeTasks[taskId].logs += `.`;
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
                  'UPDATE generated_videos SET status = ?, video_url = ?, used_credits = ? WHERE id = ?',
                  ['success', finalVideoUrl, credits, videoRecordId]
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
                await db.run('UPDATE generated_videos SET status = ? WHERE id = ?', ['failed', videoRecordId]);
              }
            } else if (status === 'FAILED' || status === 'ERROR' || status === 'REJECTED') {
              clearInterval(interval);
              const errMsg = item?.errorMessage || 'Kesalahan internal Freebeat CLI.';
              activeTasks[taskId].status = 'failed';
              activeTasks[taskId].error = errMsg;
              activeTasks[taskId].logs += `\n\n[ERROR] Pembuatan video gagal: ${errMsg}\n`;
              await db.run('UPDATE generated_videos SET status = ? WHERE id = ?', ['failed', videoRecordId]);
            } else {
              // Status is PENDING or RUNNING
              activeTasks[taskId].logs += `Checking status... [${status}]\n`;
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

    const totalScenes = panelImages.length * 4;
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

    const spawnedTasks = [];

    // 3. Loop over each scene
    for (let sceneIdx = 0; sceneIdx < totalScenes; sceneIdx++) {
      // Check if there is already a successfully generated or processing video for this sceneIdx
      const existingVideo = await db.get(
        'SELECT * FROM generated_videos WHERE storyboard_id = ? AND scene_idx = ? ORDER BY id DESC LIMIT 1',
        [storyboardId, sceneIdx]
      );

      if (existingVideo && (existingVideo.status === 'success' || existingVideo.status === 'processing')) {
        continue;
      }

      // Resolve scene-specific prompt
      let promptText = '';
      const matchingPrompt = scenePrompts.find(p => p.scene_idx === sceneIdx);
      if (matchingPrompt) {
        promptText = generationType === 'image' 
          ? (matchingPrompt.imageToVideoPrompt || matchingPrompt.textToVideoPrompt)
          : matchingPrompt.textToVideoPrompt;
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
        break;
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
        apiKeyId: keyRecord.id,
        logs: '=== VIDEO STUDIO GENERATION (BATCH) ===\n\n' +
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

      // Spawn execution in background (separate process for each scene)
      (async (vRecId, tId, kRec, pText, scImg) => {
        try {
          const spawnCmd = 'node';
          const cliPath = path.join(__dirname, '..', 'node_modules', 'freebeat-cli', 'dist', 'index.js');
          const spawnArgs = [
            cliPath,
            '--api-key', kRec.key_value,
            'video', 'generate',
            '--model', model,
            '--prompt', pText,
            '--generation-type', generationType === 'image' ? 'image' : 'text',
            '--json'
          ];

          if (generationType === 'image' && scImg) {
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
          if (generateAudio) spawnArgs.push('--generate-audio');

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
              activeTasks[tId].status = 'failed';
              activeTasks[tId].error = errorMsg;
              activeTasks[tId].logs += `[ERROR] Gagal mengirim task ke Freebeat: ${errorMsg}\n`;
              await db.run('UPDATE generated_videos SET status = ? WHERE id = ?', ['failed', vRecId]);
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
                  activeTasks[tId].logs += `[2/3] Sukses mendaftarkan task ke Freebeat.\n` +
                                           `Batch ID: ${batchId}\n` +
                                           `Serial  : ${serialNo}\n\n` +
                                           `[3/3] Mulai memantau progress render Freebeat...\n`;
                  
                  await db.run(
                    'UPDATE generated_videos SET task_id = ?, serial_no = ? WHERE id = ?',
                    [batchId, serialNo, vRecId]
                  );

                  // Link the real Freebeat Batch ID to the logs in activeTasks
                  activeTasks[batchId] = activeTasks[tId];

                  const { pollVideoStatus } = require('./videoController');
                  pollVideoStatus(vRecId, storyboardId, kRec.key_value, batchId, serialNo, tId);
                } else {
                  throw new Error('Gagal mendapatkan Batch ID dari respon Freebeat.');
                }
              } else {
                throw new Error('Respon submit dari Freebeat CLI tidak valid.');
              }
            } catch (err) {
              activeTasks[tId].status = 'failed';
              activeTasks[tId].error = err.message;
              activeTasks[tId].logs += `[ERROR] Gagal memproses respon Freebeat: ${err.message}\n`;
              await db.run('UPDATE generated_videos SET status = ? WHERE id = ?', ['failed', vRecId]);
            }
          });
        } catch (bgErr) {
          activeTasks[tId].status = 'failed';
          activeTasks[tId].error = bgErr.message;
          activeTasks[tId].logs += `[CRITICAL ERROR] Gagal inisiasi sub-proses: ${bgErr.message}\n`;
          await db.run('UPDATE generated_videos SET status = ? WHERE id = ?', ['failed', vRecId]);
        }
      })(videoRecordId, taskId, keyRecord, promptText, sceneImage);

      spawnedTasks.push({ sceneIdx, taskId, videoRecordId });
    }

    res.json({ message: 'Batch video generation started successfully.', tasks: spawnedTasks });
  } catch (err) {
    console.error('generateAllVideos failed:', err);
    res.status(500).json({ message: 'Gagal memulai batch video generation.', error: err.message });
  }
}

module.exports = {
  generateVideo,
  getStoryboardVideos,
  deleteVideo,
  resumeProcessingVideos,
  regenerateVideoMarketingCopy,
  generateAllVideos
};
