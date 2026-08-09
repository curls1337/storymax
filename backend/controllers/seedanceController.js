const { getDb } = require('../db');
const https = require('https');
const { parseCookieOrTokenInput } = require('./adminController');

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
    const { cookie_id, prompt, images, duration, resolution, aspectRatio, watermark, name } = req.body;
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

    // Determine generationType and images array
    // generationType: 0 = Image-to-Video (with reference image)
    // generationType: 1 = Text-to-Video (prompt only, images = [""])
    let imagesArr = [];
    if (Array.isArray(images)) {
      imagesArr = images.map((x) => String(x || '').trim()).filter((x) => x.startsWith('http://') || x.startsWith('https://'));
    } else if (images && typeof images === 'string' && (images.trim().startsWith('http://') || images.trim().startsWith('https://'))) {
      imagesArr = [images.trim()];
    }

    let genType = 0;
    if (imagesArr.length > 0) {
      genType = 0;
    } else {
      genType = 1;
      imagesArr = [""];
    }

    const payload = {
      generationType: genType,
      model: 'seedance-2.5',
      modelId: 134,
      duration: Number(duration) || 10,
      resolution: resolution || '720p',
      style: '',
      images: imagesArr,
      prompt: String(prompt).trim(),
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

module.exports = {
  getActiveSeedanceCookies,
  createSeedanceVideo,
  getSeedanceHistory,
  checkSeedanceTaskStatus,
  getSeedanceVideoList,
  getSeedanceCookieCreditInfo
};
