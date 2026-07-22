// Storyboard HTTP controller (thin). Background jobs live in
// ../jobs/storyboardJobs.js; shared task state in ../state/taskStore.js;
// helpers in ../services/* and ../prompts/*.
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { getDb } = require('../db');
const { scrapeTokopedia } = require('../lib/scrapers/tokopedia');
const { uploadsDir } = require('../config');
const { activeTasks, saveTaskState } = require('../state/taskStore');
const { getAvailableApiKey } = require('../services/keyPool');
const {
  runStoryboardGeneratorBackground,
  regenerateStoryboardPage,
  resumeProcessingStoryboardsOnStartup,
} = require('../jobs/storyboardJobs');

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

async function getUserStoryboards(req, res) {
  try {
    const db = getDb();
    const storyboards = await db.all(
      'SELECT s.*, k.label AS api_key_label FROM storyboards s LEFT JOIN api_keys k ON k.id = s.api_key_id WHERE s.user_id = ? ORDER BY s.created_at DESC',
      [req.user.id]
    );
    // Strip the heavy 'active_task_data' (accumulating logs + base64 reference
    // images) from the gallery payload — the list view never uses it and it was
    // bloating the response, making "Memuat galeri..." slow. Live task status is
    // polled separately via /storyboards/tasks/:taskId.
    for (const s of storyboards) { delete s.active_task_data; }
    res.json(storyboards);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching storyboards.', error: error.message });
  }
}

async function generateStoryboard(req, res) {
  const { title, prompt, style, apiKeyId, refImageBase64, refImageUrl, refImages, gridCount, model, duration, showFace, faceMode, aspectRatio, enableVo, voLanguage, voTone, videoEngine, containerShape } = req.body;

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
    faceMode: faceMode || (showFace ? 'full' : 'faceless'),
    duration: totalDuration,
    enableVo: !!enableVo,
    voLanguage: voLanguage || 'Bahasa Indonesia',
    voTone: voTone || 'casual',
    videoEngine: selectedEngine,
    containerShape: containerShape || 'auto'
  });

  // Create unique task ID immediately
  const taskId = 'task_' + crypto.randomUUID();
  let storyboardId = null;

  const initialTaskState = {
    status: 'processing',
    apiKeyId: parsedApiKeyId,
    storyboardId: null, // set below
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
    error: null,
    
    // Recovery properties
    pageCount,
    secondsPerPage,
    totalDuration,
    aspectRatio,
    selectedModel,
    style,
    gridCount: gridCount || 6,
    showFace: !!showFace,
    faceMode: faceMode || (showFace ? 'full' : 'faceless'),
    containerShape: containerShape || 'auto',
    prompt,
    title,
    enableVo: !!enableVo,
    voLanguage: voLanguage || 'Bahasa Indonesia',
    voTone: voTone || 'casual',
    videoEngine: selectedEngine,
    subPrompts: null,
    refImages: refImages || [],
    refImageBase64: refImageBase64 || '',
    refImageUrl: refImageUrl || '',
    finalRefImagePath: undefined,
    imagePaths: [],
    totalCreditsUsed: 0,
    currentPageIdx: 0,
    currentTaskInfo: null
  };

  try {
    const insertResult = await db.run(
      'INSERT INTO storyboards (user_id, title, prompt, image_path, used_credits, api_key_id, status, generation_params, task_id, active_task_data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [req.user.id, title, prompt, '[]', 0, parsedApiKeyId, 'processing', generationParams, taskId, JSON.stringify(initialTaskState)]
    );
    storyboardId = insertResult.lastID;
    initialTaskState.storyboardId = storyboardId;
    activeTasks[taskId] = initialTaskState;
    await saveTaskState(db, storyboardId, initialTaskState);
  } catch (dbErr) {
    console.error('Failed to create initial storyboard record:', dbErr);
    return res.status(500).json({ message: 'Gagal membuat rekam storyboard awal.', error: dbErr.message });
  }

  // Respond immediately with taskId and storyboardId to prevent blocking HTTP timeouts
  res.json({ taskId, storyboardId, status: 'processing' });

  // Run the process completely in background. B1: never leave this as an
  // unhandled rejection — on failure, mark the task/storyboard as failed.
  runStoryboardGeneratorBackground(taskId, storyboardId).catch(async (err) => {
    const t = activeTasks[taskId];
    const msg = err && err.message ? err.message : String(err);
    if (t) { t.status = 'failed'; t.error = msg; t.logs = (t.logs || '') + `[ERROR] Background task rejected: ${msg}\n`; }
    try {
      const db2 = getDb();
      await db2.run('UPDATE storyboards SET status = ? WHERE id = ?', ['failed', storyboardId]);
      if (t) await saveTaskState(db2, storyboardId, t);
    } catch (e) { /* best effort */ }
  });
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

    // Normalize URL path to relative local format to match database entries
    let dbPathKey = url;
    if (isRemote) {
      // If it's a remote URL, see if we can extract local relative path if hosted locally
      try {
        const parsed = new URL(url);
        if (parsed.pathname.includes('/uploads/')) {
          dbPathKey = parsed.pathname.substring(parsed.pathname.indexOf('/uploads/'));
        }
      } catch (e) {}
    }
    const normUrl = dbPathKey.startsWith('/') ? dbPathKey : '/' + dbPathKey;

    // Log the file download in downloaded_files table
    try {
      const db = getDb();
      const existing = await db.get('SELECT * FROM downloaded_files WHERE file_path = ?', [normUrl]);
      if (existing) {
        await db.run('UPDATE downloaded_files SET download_count = download_count + 1, last_downloaded_at = CURRENT_TIMESTAMP WHERE file_path = ?', [normUrl]);
      } else {
        await db.run('INSERT INTO downloaded_files (file_path, download_count) VALUES (?, 1)', [normUrl]);
      }
    } catch (dbErr) {
      console.error('Error logging file download to database:', dbErr);
    }

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
  regenerateStoryboardPage,
  resumeProcessingStoryboardsOnStartup,
  activeTasks,
};
