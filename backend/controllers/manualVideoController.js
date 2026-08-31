const { getDb } = require('../db');
const scenarioClient = require('../services/scenarioClient');
const scenarioGen = require('../services/scenarioGen');

/**
 * Get video models for Manual Prompt Mode
 */
async function getManualVideoModels(req, res) {
  try {
    const db = getDb();
    const specificKeyId = req.query.keyId;

    const activeKeys = await db.all(`
      SELECT k.id, k.key_value, k.secret_value, k.label, k.is_active, k.usage_count, k.consumption_cu, k.plan_name,
             (COALESCE((SELECT COUNT(*) FROM storyboards s WHERE s.scenario_key_id = k.id), 0) +
              COALESCE((SELECT COUNT(*) FROM generated_videos v WHERE v.scenario_key_id = k.id), 0) +
              COALESCE((SELECT COUNT(*) FROM manual_video_jobs m WHERE m.user_id = k.id), 0) +
              COALESCE(k.usage_count, 0)) AS total_usage
      FROM scenario_api_keys k
      WHERE k.is_active = 1
      ORDER BY k.id ASC
    `);

    let targetKey = null;
    if (specificKeyId && specificKeyId !== 'auto') {
      targetKey = activeKeys.find(k => String(k.id) === String(specificKeyId));
    }
    if (!targetKey && activeKeys.length > 0) {
      targetKey = activeKeys[0];
    }

    let detectedTier = 50;
    if (targetKey && targetKey.key_value && targetKey.secret_value) {
      detectedTier = await scenarioGen.detectKeyTier(targetKey.key_value, targetKey.secret_value);
    }

    const publicKeys = activeKeys.map(k => ({
      id: k.id,
      key_value: k.key_value,
      label: k.label,
      is_active: k.is_active,
      total_usage: k.total_usage || 0,
      consumption_cu: k.consumption_cu,
      plan_name: k.plan_name || 'Standard'
    }));

    const videoModels = (scenarioGen.SCENARIO_CATALOG?.videoModels || []).map(m => ({
      ...m,
      isSupported: (m.tier || 0) <= detectedTier,
      badge: (m.tier || 0) > detectedTier ? `Perlu ${m.plan}` : 'Didukung',
      maxReferences: 7
    }));

    res.json({
      keys: publicKeys,
      detectedTier,
      videoModels
    });
  } catch (err) {
    console.error('Error fetching manual video models:', err);
    res.status(500).json({ message: 'Gagal memuat daftar model video manual.', error: err.message });
  }
}

/**
 * Submit and process a Manual Video generation job
 */
async function submitManualVideoJob(req, res) {
  try {
    const { prompt, modelId, aspectRatio, duration, resolution, generateAudio, referenceImageUrls, keyId, generationMethod } = req.body;

    if (!prompt && (!referenceImageUrls || referenceImageUrls.length === 0)) {
      return res.status(400).json({ message: 'Prompt teks atau gambar referensi wajib diisi.' });
    }

    const targetModelId = modelId || 'model_google-omni-flash';
    const db = getDb();

    const specificKeyId = (keyId && keyId !== 'auto') ? keyId : undefined;
    const isTextOnly = generationMethod === 'text';

    const { result, keyRecord: targetKey } = await scenarioGen.executeWithScenarioFailover(
      db,
      async (keyRec) => {
        // Upload reference images if any (unless text-only mode is chosen)
        const assetIds = [];
        if (!isTextOnly && Array.isArray(referenceImageUrls) && referenceImageUrls.length > 0) {
          for (let i = 0; i < Math.min(referenceImageUrls.length, 7); i++) {
            const item = referenceImageUrls[i];
            if (!item) continue;
            let dataUri = item;

            if (typeof item === 'string' && (item.startsWith('http://') || item.startsWith('https://'))) {
              try {
                const fetched = await fetch(item);
                const buf = await fetched.arrayBuffer();
                const mime = fetched.headers.get('content-type') || 'image/png';
                dataUri = `data:${mime};base64,${Buffer.from(buf).toString('base64')}`;
              } catch (fetchErr) {
                console.warn(`[Manual Video] Gagal mengunduh gambar referensi dari URL: ${item}`);
              }
            }

            if (typeof dataUri === 'string' && dataUri.startsWith('data:image/')) {
              try {
                const uploadRes = await scenarioClient.uploadAsset(
                  keyRec.key_value,
                  keyRec.secret_value,
                  dataUri,
                  `manual_ref_${Date.now()}_${i}.png`
                );
                const assetId = uploadRes?.asset?.id || uploadRes?.id;
                if (assetId) assetIds.push(assetId);
              } catch (uploadErr) {
                console.warn(`[Manual Video] Gagal mengunggah asset ke Scenario: ${uploadErr.message}`);
              }
            }
          }
        }

        // Construct model-compliant generation parameters
        const params = {
          prompt: String(prompt || '').trim()
        };

        if (targetModelId === 'model_google-omni-flash') {
          const numDur = Number(duration);
          params.duration = (numDur === 5 || numDur === 8 || numDur === 10) ? numDur : 5;
          params.aspectRatio = aspectRatio === '9:16' ? '9:16' : '16:9';
          if (assetIds.length > 0) {
            params.image = assetIds[0];
            params.referenceImages = assetIds;
          }
        } else if (targetModelId === 'model_xai-grok-imagine-video-1-5') {
          params.duration = Number(duration) === -1 ? 5 : Number(duration || 5);
          params.aspectRatio = aspectRatio === 'adaptive' || aspectRatio === 'auto' ? '16:9' : (aspectRatio || '16:9');
          params.resolution = resolution || '720p';
          if (assetIds.length > 0) {
            params.image = assetIds[0];
            params.referenceImages = assetIds;
          }
        } else if (targetModelId === 'model_kling-v3-i2v-pro') {
          params.duration = String(Number(duration) === -1 ? '5' : (duration || '5'));
          params.aspectRatio = aspectRatio === 'adaptive' || aspectRatio === 'auto' ? '16:9' : (aspectRatio || '16:9');
          if (generateAudio !== undefined) params.generateAudio = !!generateAudio;
          if (assetIds.length > 0) {
            params.image = assetIds[0];
            params.startImage = assetIds[0];
          }
        } else if (targetModelId === 'model_kling-v3-omni-video') {
          params.duration = Number(duration) === -1 ? 5 : Number(duration || 5);
          params.aspectRatio = aspectRatio === '9:16' ? '9:16' : (aspectRatio === '1:1' ? '1:1' : '16:9');
          if (generateAudio !== undefined) params.generateAudio = !!generateAudio;
          if (assetIds.length > 0) {
            params.referenceImages = assetIds;
          }
        } else if (targetModelId.includes('minimax')) {
          params.duration = Number(duration) === -1 ? 6 : Number(duration || 6);
          params.resolution = resolution === '1080p' || resolution === '4k' ? '2K' : '768P';
          params.aspectRatio = aspectRatio || '16:9';
          if (assetIds.length > 0) {
            params.firstFrameImage = assetIds[0];
          }
        } else if (targetModelId.includes('pixverse')) {
          params.duration = Number(duration) === -1 ? 5 : Number(duration || 5);
          params.resolution = resolution || '720p';
          params.aspectRatio = aspectRatio || '16:9';
          if (generateAudio !== undefined) params.generateAudioSwitch = !!generateAudio;
          if (assetIds.length > 0) {
            params.image = assetIds[0];
          }
        } else if (targetModelId.includes('p-avatar')) {
          params.voiceScript = params.prompt;
          params.videoPrompt = params.prompt;
          params.resolution = resolution || '720p';
          if (assetIds.length > 0) {
            params.image = assetIds[0];
          }
        } else {
          // Seedance 2.5, Seedance 2.0, Seedance Fast, Seedance Mini, Wan 2.7, Wan 2.5, LTX Pro, LTX Fast, Veo 3.1
          if (aspectRatio && aspectRatio !== 'auto') params.aspectRatio = aspectRatio;
          if (duration !== undefined && duration !== 'auto') params.duration = Number(duration) === -1 ? -1 : Number(duration);
          if (resolution) params.resolution = resolution;
          if (generateAudio !== undefined) params.generateAudio = !!generateAudio;
          if (assetIds.length > 0) {
            params.referenceImages = assetIds;
            params.image = assetIds[0];
          }
        }

        // Submit custom generation job directly to Scenario
        const genRes = await scenarioClient.generateCustom(
          keyRec.key_value,
          keyRec.secret_value,
          targetModelId,
          params
        );

        const jobId = genRes?.job?.jobId || genRes?.jobId || genRes?.job?.id || genRes?.id;
        if (!jobId) {
          console.error('[Manual Video] Scenario response without jobId:', JSON.stringify(genRes));
          throw new Error('Scenario tidak mengembalikan Job ID valid.');
        }

        // Poll until completed
        const pollResult = await scenarioClient.pollJobUntilDone(
          keyRec.key_value,
          keyRec.secret_value,
          jobId,
          { timeoutMs: 600000, intervalMs: 3000 }
        );

        if (!pollResult || !pollResult.url) {
          throw new Error('Video selesai dirender tetapi URL video tidak ditemukan.');
        }

        return {
          videoUrl: pollResult.url,
          jobId,
          cost: pollResult.cost || 0
        };
      },
      { specificKeyId }
    );

    const { videoUrl, jobId, cost } = result;

    // Save job result to manual_video_jobs table
    const dbResult = await db.run(
      `INSERT INTO manual_video_jobs (user_id, prompt, model_id, job_id, video_url, cost, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [req.user.id, prompt || '(Reference-only)', targetModelId, jobId, videoUrl, Number(cost) || 0, 'completed']
    );

    // Update API Key usage stats
    if (targetKey) {
      try {
        await db.run(
          'UPDATE scenario_api_keys SET usage_count = COALESCE(usage_count, 0) + 1, consumption_cu = COALESCE(consumption_cu, 0) + ? WHERE id = ?',
          [Number(cost) || 0, targetKey.id]
        );
      } catch (e) {}
    }

    res.json({
      id: dbResult.lastID,
      url: videoUrl,
      jobId,
      cost
    });
  } catch (err) {
    console.error('Error submitting manual video job:', err);
    res.status(500).json({ message: err.message || 'Gagal membuat video manual.' });
  }
}

/**
 * List all manual video jobs for current logged in user
 */
async function listManualVideoJobs(req, res) {
  try {
    const db = getDb();
    const rows = await db.all(
      'SELECT * FROM manual_video_jobs WHERE user_id = ? ORDER BY id DESC',
      [req.user.id]
    );
    res.json(rows || []);
  } catch (err) {
    console.error('Error listing manual video jobs:', err);
    res.status(500).json({ message: 'Gagal mengambil riwayat video manual.', error: err.message });
  }
}

/**
 * Delete one manual video job by ID
 */
async function deleteManualVideoJob(req, res) {
  try {
    const db = getDb();
    const { id } = req.params;
    await db.run(
      'DELETE FROM manual_video_jobs WHERE id = ? AND user_id = ?',
      [id, req.user.id]
    );
    res.json({ message: 'Riwayat video manual berhasil dihapus.' });
  } catch (err) {
    console.error('Error deleting manual video job:', err);
    res.status(500).json({ message: 'Gagal menghapus riwayat video manual.', error: err.message });
  }
}

module.exports = {
  getManualVideoModels,
  submitManualVideoJob,
  listManualVideoJobs,
  deleteManualVideoJob
};
