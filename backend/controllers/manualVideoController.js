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

    const videoModels = (scenarioGen.SCENARIO_CATALOG?.videoModels || []).map(m => {
      const isMultiRef = m.id.includes('reference-to-video') || m.id.includes('grok-imagine') || m.id.includes('aleph') || m.id.includes('seedance');
      const isI2v = m.id.includes('i2v') || isMultiRef;
      return {
        ...m,
        isSupported: (m.tier || 0) <= detectedTier,
        badge: (m.tier || 0) > detectedTier ? `Perlu ${m.plan}` : 'Didukung',
        maxReferences: isMultiRef ? 7 : (isI2v ? 1 : 0)
      };
    });

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
    const { prompt, modelId, aspectRatio, duration, resolution, generateAudio, referenceImageUrls, keyId } = req.body;

    if (!prompt && (!referenceImageUrls || referenceImageUrls.length === 0)) {
      return res.status(400).json({ message: 'Prompt teks atau gambar referensi wajib diisi.' });
    }

    const targetModelId = modelId || 'model_google-omni-flash';
    const db = getDb();

    // Select active Scenario API key
    const activeKeys = await db.all(`
      SELECT k.id, k.key_value, k.secret_value, k.label, k.is_active, k.usage_count, k.consumption_cu, k.plan_name
      FROM scenario_api_keys k
      WHERE k.is_active = 1
      ORDER BY k.id ASC
    `);

    if (!activeKeys || activeKeys.length === 0) {
      return res.status(400).json({ message: 'Belum ada API Key Scenario yang aktif. Tambahkan di Panel Admin.' });
    }

    let targetKey = null;
    if (keyId && keyId !== 'auto') {
      targetKey = activeKeys.find(k => String(k.id) === String(keyId));
    }
    if (!targetKey) {
      targetKey = activeKeys[0];
    }

    // Upload reference images if any
    const assetIds = [];
    if (Array.isArray(referenceImageUrls) && referenceImageUrls.length > 0) {
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
              targetKey.key_value,
              targetKey.secret_value,
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

    // Construct generation parameters
    const params = {
      prompt: String(prompt || '').trim()
    };

    if (aspectRatio && aspectRatio !== 'auto') params.aspectRatio = aspectRatio;
    if (duration !== undefined && duration !== 'auto') params.duration = Number(duration);
    if (resolution) params.resolution = resolution;
    if (generateAudio !== undefined) params.generateAudio = !!generateAudio;

    if (assetIds.length > 0) {
      params.referenceImages = assetIds;
      params.image = assetIds[0];
      params.startImage = assetIds[0];
      params.firstFrameImage = assetIds[0];
    }

    // Submit custom generation job directly to Scenario
    const genRes = await scenarioClient.generateCustom(
      targetKey.key_value,
      targetKey.secret_value,
      targetModelId,
      params
    );

    const jobId = genRes?.job?.id || genRes?.id;
    if (!jobId) {
      throw new Error('Scenario tidak mengembalikan Job ID valid.');
    }

    // Poll until completed
    const pollResult = await scenarioClient.pollJobUntilDone(
      targetKey.key_value,
      targetKey.secret_value,
      jobId,
      { timeoutMs: 600000, intervalMs: 3000 }
    );

    const videoUrl = pollResult.url;
    const cost = pollResult.cost || 0;

    if (!videoUrl) {
      throw new Error('Video selesai dirender tetapi URL video tidak ditemukan.');
    }

    // Save job result to manual_video_jobs table
    const result = await db.run(
      `INSERT INTO manual_video_jobs (user_id, prompt, model_id, job_id, video_url, cost, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [req.user.id, prompt || '(Reference-only)', targetModelId, jobId, videoUrl, Number(cost) || 0, 'completed']
    );

    // Update API Key usage stats
    try {
      await db.run(
        'UPDATE scenario_api_keys SET usage_count = COALESCE(usage_count, 0) + 1, consumption_cu = COALESCE(consumption_cu, 0) + ? WHERE id = ?',
        [Number(cost) || 0, targetKey.id]
      );
    } catch (e) {}

    res.json({
      id: result.lastID,
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
