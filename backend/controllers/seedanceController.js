const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { getDb } = require('../db');
const { parseCookieOrTokenInput } = require('./adminController');
const { resolveVoConfig, getSceneNarration, applyAudioDirectives, getCharacterVoiceProfile } = require('./videoController');

// Helper to download or read an image buffer from disk or remote URL
function downloadOrReadImageBuffer(imageUrl) {
  return new Promise((resolve, reject) => {
    if (!imageUrl) return reject(new Error('URL gambar kosong.'));
    const str = String(imageUrl).trim();

    // Base64 Data URI
    if (str.startsWith('data:image/')) {
      try {
        const base64Data = str.split(',')[1];
        return resolve(Buffer.from(base64Data, 'base64'));
      } catch (e) {
        return reject(new Error('Gagal parse base64 image: ' + e.message));
      }
    }

    // Local file path
    if (str.startsWith('/uploads/') || str.startsWith('uploads/')) {
      const filename = str.replace(/^\/?uploads\//, '');
      const localPath = path.join(process.cwd(), 'uploads', filename);
      if (fs.existsSync(localPath)) {
        try {
          return resolve(fs.readFileSync(localPath));
        } catch (e) {
          return reject(new Error('Gagal membaca file lokal: ' + e.message));
        }
      }
    }

    // Remote HTTP / HTTPS URL
    try {
      const parsedUrl = new URL(str);
      const client = parsedUrl.protocol === 'https:' ? https : http;
      client.get(str, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return downloadOrReadImageBuffer(res.headers.location).then(resolve).catch(reject);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`Gagal mengunduh gambar (Status ${res.statusCode})`));
        }
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      }).on('error', reject);
    } catch (err) {
      reject(new Error('URL Gambar tidak valid: ' + err.message));
    }
  });
}

// Uploads an image buffer to Freebeat AWS S3 bucket using presigned URL
async function uploadImageToFreebeatS3(token, buffer, originalUrl = 'image.jpg') {
  const timestamp = Date.now();
  let ext = '.jpg';
  if (originalUrl.includes('.png')) ext = '.png';
  const key = `dance/aivideo/${timestamp}${ext}`;
  const uploadFileName = `photo_${timestamp}${ext}`;

  // 1. Get presigned signURL from Freebeat API
  const presignPayload = {
    reqList: [
      {
        key: key,
        fileName: uploadFileName,
        bucketName: 'freebeat-static'
      }
    ]
  };

  const postData = JSON.stringify(presignPayload);

  const presignData = await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.freebeatfit.com',
      port: 443,
      path: '/api/v2/file/genUploadSignUrl',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'authorization': token,
        'token': token,
        'udt': token,
        'fb-language': 'en',
        'x-platform-type': 'web',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.code === 0 && json.data && json.data[0]) {
            resolve(json.data[0]);
          } else {
            reject(new Error(json.msg || 'Gagal mendapatkan signURL dari Freebeat'));
          }
        } catch (e) {
          reject(new Error('Respon Freebeat bukan JSON: ' + data));
        }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });

  const { signURL, finalStaticUrl } = presignData;
  if (!signURL || !finalStaticUrl) {
    throw new Error('Data presignURL Freebeat tidak lengkap.');
  }

  // 2. Upload image buffer to S3 via HTTP PUT
  const s3Url = new URL(signURL);
  const contentType = ext === '.png' ? 'image/png' : 'image/jpeg';

  await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: s3Url.hostname,
      port: 443,
      path: s3Url.pathname + s3Url.search,
      method: 'PUT',
      headers: {
        'Content-Type': contentType,
        'Content-Length': buffer.length
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode === 200 || res.statusCode === 204) {
          resolve(true);
        } else {
          reject(new Error(`Upload S3 gagal (Status ${res.statusCode}): ${data}`));
        }
      });
    });
    req.on('error', reject);
    req.write(buffer);
    req.end();
  });

  return finalStaticUrl;
}

// Check if user has permission to use SeedDance 2.5
async function checkUserSeedancePermission(req) {
  if (!req.user) return true;
  if (req.user.role === 'admin') return true;
  try {
    const db = getDb();
    const u = await db.get('SELECT can_use_seedance FROM users WHERE id = ?', [req.user.id]);
    if (u && u.can_use_seedance === 0) return false;
  } catch (e) {}
  return true;
}

// Get active cookies dropdown list for SeedDance Studio
async function getActiveSeedanceCookies(req, res) {
  try {
    if (!(await checkUserSeedancePermission(req))) {
      return res.status(403).json({ message: 'Akses ke SeedDance 2.5 tidak diizinkan. Hubungi Admin.' });
    }
    const db = getDb();
    const rows = await db.all('SELECT id, label, last_status, is_active, created_at FROM seedance_cookies WHERE is_active = 1 ORDER BY id DESC');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: 'Gagal mengambil daftar cookie SeedDance 2.5.', error: error.message });
  }
}

// Create SeedDance 2.5 Video Task
async function createSeedanceVideo(req, res) {
  try {
    if (!(await checkUserSeedancePermission(req))) {
      return res.status(403).json({ message: 'Akses ke SeedDance 2.5 tidak diizinkan. Hubungi Admin.' });
    }
    const { cookie_id, prompt, images, duration, resolution, aspectRatio, watermark, name, storyboardId, sceneIdx } = req.body;
    if (!prompt || !prompt.trim()) {
      return res.status(400).json({ message: 'Prompt deskripsi video wajib diisi.' });
    }

    const db = getDb();
    let cookieRow = null;

    if (cookie_id && cookie_id !== 'auto') {
      cookieRow = await db.get('SELECT * FROM seedance_cookies WHERE id = ? AND is_active = 1', [cookie_id]);
    }

    if (!cookieRow) {
      // Pick the first active cookie or random active cookie
      cookieRow = await db.get('SELECT * FROM seedance_cookies WHERE is_active = 1 ORDER BY id ASC LIMIT 1');
    }

    if (!cookieRow) {
      return res.status(400).json({ 
        message: 'Tidak ada Cookie / AuthToken SeedDance 2.5 yang aktif. Harap masukkan Cookie di Panel Admin terlebih dahulu.' 
      });
    }

    const token = parseCookieOrTokenInput(cookieRow.key_value);

    // Determine raw input image URL
    let rawImageUrl = '';
    if (Array.isArray(images) && images.length > 0) {
      rawImageUrl = String(images[0] || '').trim();
    } else if (typeof images === 'string' && images.trim()) {
      rawImageUrl = images.trim();
    }

    let imagesArr = [""];
    let genType = 1;

    if (rawImageUrl) {
      try {
        const isFreebeatHost = rawImageUrl.includes('freebeatfit.com') || rawImageUrl.includes('freebeat.ai');
        if (isFreebeatHost) {
          imagesArr = [rawImageUrl];
          genType = 0;
        } else {
          // Auto-upload non-Freebeat image (external CDN / local upload / base64) to Freebeat AWS S3 CDN first
          console.log('[SeedDance 2.5] Auto-uploading image to Freebeat S3 CDN:', rawImageUrl.substring(0, 80));
          const imgBuffer = await downloadOrReadImageBuffer(rawImageUrl);
          const staticCdnUrl = await uploadImageToFreebeatS3(token, imgBuffer, rawImageUrl);
          console.log('[SeedDance 2.5] Uploaded successfully to Freebeat CDN:', staticCdnUrl);
          imagesArr = [staticCdnUrl];
          genType = 0;
        }
      } catch (uploadErr) {
        console.error('[SeedDance 2.5] Error auto-upload gambar ke Freebeat CDN:', uploadErr.message);
        return res.status(400).json({ 
          message: `Gagal mengunggah gambar referensi ke CDN Freebeat: ${uploadErr.message}. Proses dibatalkan.` 
        });
      }
    } else {
      // User left reference image blank from the start: Text-to-Video mode
      genType = 1;
      imagesArr = [""];
    }

    // Apply Master Storyboard Settings & Audio Directives (VO Mode, Script, Character Voice Profile, No-Speech Rules)
    let finalPrompt = String(prompt).trim();

    if (storyboardId) {
      try {
        const storyboard = await db.get('SELECT * FROM storyboards WHERE id = ?', [storyboardId]);
        if (storyboard) {
          const sIdx = sceneIdx !== undefined ? Number(sceneIdx) : 0;
          const voCfg = resolveVoConfig(storyboard);
          const sceneNarration = voCfg.enableVo ? getSceneNarration(storyboard, sIdx) : '';
          const voiceProfile = await getCharacterVoiceProfile(db, storyboard);
          const hasVo = voCfg.enableVo;

          finalPrompt = applyAudioDirectives(finalPrompt, {
            hasVo,
            narration: sceneNarration,
            voLanguage: voCfg.voLanguage,
            voTone: voCfg.voTone,
            durationSec: duration || 10,
            backsound: false,
            voiceProfile
          });
        }
      } catch (sbErr) {
        console.error('[SeedDance 2.5] Warning reading storyboard params:', sbErr.message);
      }
    } else {
      // Custom standalone prompt: enforce no-voiceover & clean audio rules
      finalPrompt = applyAudioDirectives(finalPrompt, {
        hasVo: false,
        narration: '',
        voLanguage: 'Bahasa Indonesia',
        voTone: 'casual',
        durationSec: duration || 10,
        backsound: false,
        voiceProfile: null
      });
    }

    const payload = {
      generationType: genType,
      model: 'seedance-2.5',
      modelId: 134,
      duration: Number(duration) || 10,
      resolution: resolution || '720p',
      style: '',
      images: imagesArr,
      prompt: finalPrompt,
      watermark: Number(watermark) || 0,
      name: name || '',
      aspectRatio: aspectRatio || '16:9',
      extraParams: {}
    };

    const postData = JSON.stringify(payload);

    const freebeatResult = await new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.freebeatfit.com',
        port: 443,
        path: '/v1/aiVideo/createAiVideo',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
          'authorization': token,
          'token': token,
          'udt': token,
          'fb-language': 'en',
          'x-platform-type': 'web',
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'
        }
      };

      const req0 = https.request(options, (res0) => {
        let data = '';
        res0.on('data', chunk => data += chunk);
        res0.on('end', () => {
          try {
            const json = JSON.parse(data);
            resolve(json);
          } catch (e) {
            reject(new Error('Respon server Freebeat bukan JSON valid.'));
          }
        });
      });

      req0.on('error', err => reject(err));
      req0.write(postData);
      req0.end();
    });

    if (freebeatResult.code === 0 && freebeatResult.data) {
      const taskNo = freebeatResult.data;
      const userId = req.user ? req.user.id : 1;

      await db.run(
        `INSERT INTO seedance_history (user_id, cookie_id, task_no, prompt, images, duration, aspect_ratio, resolution, status) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'processing')`,
        [userId, cookieRow.id, taskNo, prompt.trim(), JSON.stringify(imagesArr), Number(duration) || 30, aspectRatio || '16:9', resolution || '720p']
      );

      res.status(201).json({
        success: true,
        taskNo,
        cookieLabel: cookieRow.label,
        message: 'Tugas video SeedDance 2.5 berhasil dikirim ke antrean server!'
      });
    } else {
      res.status(400).json({
        message: freebeatResult.msg || freebeatResult.message || 'Gagal mengirim tugas ke SeedDance 2.5 server Freebeat.',
        raw: freebeatResult
      });
    }

  } catch (error) {
    res.status(500).json({ message: 'Error eksekusi SeedDance 2.5: ' + error.message });
  }
}

// Get user SeedDance 2.5 history
async function getSeedanceHistory(req, res) {
  try {
    const db = getDb();
    const userId = req.user ? req.user.id : 1;
    let rows;
    if (req.user && req.user.role === 'admin') {
      rows = await db.all('SELECT h.*, c.label as cookie_label FROM seedance_history h LEFT JOIN seedance_cookies c ON h.cookie_id = c.id ORDER BY h.id DESC LIMIT 50');
    } else {
      rows = await db.all('SELECT h.*, c.label as cookie_label FROM seedance_history h LEFT JOIN seedance_cookies c ON h.cookie_id = c.id WHERE h.user_id = ? ORDER BY h.id DESC LIMIT 50', [userId]);
    }
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: 'Gagal mengambil riwayat SeedDance 2.5.', error: error.message });
  }
}

// Check Task Status
async function checkSeedanceTaskStatus(req, res) {
  try {
    const { taskNo } = req.body;
    if (!taskNo) return res.status(400).json({ message: 'TaskNo wajib diisi.' });

    const db = getDb();
    const taskRow = await db.get('SELECT * FROM seedance_history WHERE task_no = ?', [taskNo]);
    
    let cookieRow = null;
    if (taskRow && taskRow.cookie_id) {
      cookieRow = await db.get('SELECT * FROM seedance_cookies WHERE id = ?', [taskRow.cookie_id]);
    }
    if (!cookieRow) {
      cookieRow = await db.get('SELECT * FROM seedance_cookies WHERE is_active = 1 ORDER BY id ASC LIMIT 1');
    }

    if (!cookieRow) {
      return res.status(400).json({ message: 'Cookie tidak ditemukan untuk mengecek status.' });
    }

    const token = parseCookieOrTokenInput(cookieRow.key_value);

    // Call getAiVideoStatus
    const statusResult = await new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.freebeatfit.com',
        port: 443,
        path: `/v1/aiVideo/getAiVideoStatus?taskNo=${taskNo}`,
        method: 'GET',
        headers: {
          'accept': '*/*',
          'authorization': token,
          'token': token,
          'udt': token,
          'fb-language': 'en',
          'x-platform-type': 'web',
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'
        }
      };

      const req0 = https.request(options, (res0) => {
        let data = '';
        res0.on('data', c => data += c);
        res0.on('end', () => {
          try {
            const json = JSON.parse(data);
            resolve(json);
          } catch (e) {
            resolve({ raw: data });
          }
        });
      });

      req0.on('error', err => reject(err));
      req0.end();
    });

    res.json({
      taskNo,
      statusResult,
      taskRow
    });
  } catch (error) {
    res.status(500).json({ message: 'Error mengecek status SeedDance 2.5: ' + error.message });
  }
}

// Fetch real-time video list directly from Freebeat API for selected cookie/account
async function getSeedanceVideoList(req, res) {
  try {
    const { cookie_id, limit, anchor } = { ...(req.query || {}), ...(req.body || {}) };
    const db = getDb();
    let cookieRow = null;

    if (cookie_id && cookie_id !== 'auto') {
      cookieRow = await db.get('SELECT * FROM seedance_cookies WHERE id = ?', [cookie_id]);
    }
    if (!cookieRow) {
      cookieRow = await db.get('SELECT * FROM seedance_cookies WHERE is_active = 1 ORDER BY id ASC LIMIT 1');
    }

    if (!cookieRow) {
      return res.status(400).json({ message: 'Tidak ada Cookie SeedDance 2.5 aktif.' });
    }

    const token = parseCookieOrTokenInput(cookieRow.key_value);

    const payload = { limit: Number(limit) || 500, anchor: Number(anchor) || 1 };
    const postData = JSON.stringify(payload);

    const listResult = await new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.freebeatfit.com',
        port: 443,
        path: '/v1/aiVideo/list',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
          'authorization': token,
          'token': token,
          'udt': token,
          'fb-language': 'en',
          'x-platform-type': 'web',
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'
        }
      };

      const req0 = https.request(options, (res0) => {
        let data = '';
        res0.on('data', c => data += c);
        res0.on('end', () => {
          try {
            const json = JSON.parse(data);
            resolve(json);
          } catch (e) {
            reject(new Error('Respon daftar video dari server Freebeat bukan JSON valid.'));
          }
        });
      });

      req0.on('error', err => reject(err));
      req0.write(postData);
      req0.end();
    });

    if (listResult.code === 0 && listResult.data) {
      const videoList = listResult.data.list || [];

      // Sync local history table with completed video URLs
      for (const item of videoList) {
        if (item.serialNo) {
          let localStatus = 'processing';
          if (item.status === 100) localStatus = 'completed';
          else if (item.status === 101) localStatus = 'failed';

          try {
            await db.run(
              `UPDATE seedance_history 
               SET status = ?, video_url = ?, cover_url = ? 
               WHERE task_no = ?`,
              [localStatus, item.videoUrl || null, item.coverUrl || null, item.serialNo]
            );
          } catch (e) {}
        }
      }

      res.json({
        cookieId: cookieRow.id,
        cookieLabel: cookieRow.label,
        anchor: listResult.data.anchor,
        end: listResult.data.end,
        list: videoList
      });
    } else {
      res.status(400).json({
        message: listResult.msg || 'Gagal mengambil daftar video dari server Freebeat.',
        raw: listResult
      });
    }

  } catch (error) {
    res.status(500).json({ message: 'Error mengambil list video SeedDance 2.5: ' + error.message });
  }
}

// Fetch credit info for selected cookie and update DB last_status
async function getSeedanceCookieCreditInfo(req, res) {
  try {
    const { cookie_id } = { ...(req.query || {}), ...(req.body || {}) };
    const db = getDb();
    let cookieRow = null;

    if (cookie_id && cookie_id !== 'auto') {
      cookieRow = await db.get('SELECT * FROM seedance_cookies WHERE id = ?', [cookie_id]);
    }
    if (!cookieRow) {
      cookieRow = await db.get('SELECT * FROM seedance_cookies WHERE is_active = 1 ORDER BY id ASC LIMIT 1');
    }

    if (!cookieRow) {
      return res.status(400).json({ message: 'Tidak ada Cookie SeedDance 2.5 aktif.' });
    }

    const token = parseCookieOrTokenInput(cookieRow.key_value);

    const creditResult = await new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.freebeatfit.com',
        port: 443,
        path: '/v1/user/credits/findCredits',
        method: 'GET',
        headers: {
          'accept': '*/*',
          'authorization': token,
          'token': token,
          'udt': token,
          'fb-language': 'en',
          'x-platform-type': 'web',
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'
        }
      };

      const req0 = https.request(options, (res0) => {
        let data = '';
        res0.on('data', c => data += c);
        res0.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.code === 0 && json.data) resolve(json.data);
            else reject(new Error(json.msg || 'Gagal mengambil kredit'));
          } catch (e) {
            reject(new Error('Respon kredit bukan JSON valid'));
          }
        });
      });

      req0.on('error', err => reject(err));
      req0.end();
    });

    const statusText = `OK - ${creditResult.totalCredits ?? creditResult.membership ?? 0} Kredit (${creditResult.planName || 'Plan'}) - ${new Date().toLocaleTimeString('id-ID')}`;
    try {
      await db.run('UPDATE seedance_cookies SET last_status = ? WHERE id = ?', [statusText, cookieRow.id]);
    } catch (e) {}

    res.json({
      cookieId: cookieRow.id,
      label: cookieRow.label,
      totalCredits: creditResult.totalCredits,
      planName: creditResult.planName,
      membershipDescription: creditResult.membershipDescription,
      last_status: statusText
    });
  } catch (error) {
    res.status(500).json({ message: 'Error mengambil kredit cookie: ' + error.message });
  }
}

// AI Rewrite & Enhance Prompt for SeedDance 2.5
async function rewriteSeedancePrompt(req, res) {
  try {
    const { prompt } = req.body;
    if (!prompt || !prompt.trim()) {
      return res.status(400).json({ message: 'Prompt tidak boleh kosong.' });
    }

    const db = getDb();
    const settings = await db.get('SELECT * FROM ai_settings LIMIT 1');

    let endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
    let apiKey = process.env.GEMINI_API_KEY || '';

    if (settings && settings.api_key) {
      apiKey = settings.api_key;
      if (settings.endpoint) {
        endpoint = settings.endpoint;
      }
    }

    const sysPrompt = `You are an expert AI Video Director & Prompt Engineer specializing in SeedDance 2.5 video generation.
Your job is to rewrite and expand the user's short input or rough draft into a high-fidelity, cinematic English video prompt (60-120 words).
Focus on:
1. Camera movement (e.g. slow push-in, cinematic panning, tracking shot, low angle, smooth orbit).
2. Lighting & atmosphere (e.g. volumetric lighting, cinematic golden hour, neon cyber reflections, 8k photorealistic).
3. Detailed subject & environment motion (smooth physical movement, fluid action).
STRICT RULES:
- Output ONLY the rewritten video prompt text in English.
- NO conversational intro, NO explanation, NO markdown quotes, NO voiceover speech text.
- Do NOT mention "VO:" or narration text.`;

    const userMsg = `Rewrite this prompt into a cinematic SeedDance 2.5 video prompt:\n\n"${prompt.trim()}"`;

    let rewrittenText = '';

    if (apiKey) {
      const url = `${endpoint}?key=${apiKey}`;
      const payload = {
        contents: [
          {
            parts: [
              { text: `${sysPrompt}\n\nUser Prompt: ${userMsg}` }
            ]
          }
        ]
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        const data = await response.json();
        if (data.candidates && data.candidates[0] && data.candidates[0].content) {
          rewrittenText = data.candidates[0].content.parts.map(p => p.text).join(' ').trim();
        }
      }
    }

    if (!rewrittenText) {
      rewrittenText = `Cinematic 4K video shot of ${prompt.trim()}, slow camera tracking shot with natural atmospheric lighting, high detail, photorealistic 8k render, smooth motion flow.`;
    }

    rewrittenText = rewrittenText
      .replace(/^```json\s*/i, '')
      .replace(/^```markdown\s*/i, '')
      .replace(/^```\s*/, '')
      .replace(/```$/, '')
      .replace(/^["']|["']$/g, '')
      .trim();

    res.json({ prompt: rewrittenText });
  } catch (error) {
    console.error('Error rewriting prompt:', error);
    res.status(500).json({ message: 'Gagal menulis ulang prompt dengan AI.', error: error.message });
  }
}

module.exports = {
  getActiveSeedanceCookies,
  createSeedanceVideo,
  getSeedanceHistory,
  checkSeedanceTaskStatus,
  getSeedanceVideoList,
  getSeedanceCookieCreditInfo,
  rewriteSeedancePrompt
};
