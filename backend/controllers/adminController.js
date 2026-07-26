const { AI_API_HOST, AI_API_TOKEN } = require('../config/secrets');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const { getDb } = require('../db');
const { uploadsDir } = require('../config');
const http = require('http');
const https = require('https');

// --- User Management ---

async function getAllUsers(req, res) {
  try {
    const db = getDb();
    const users = await db.all(`
      SELECT u.id, u.username, u.role, u.can_use_magica, u.preferred_provider, COALESCE(SUM(s.used_credits), 0) AS total_credits
      FROM users u
      LEFT JOIN storyboards s ON u.id = s.user_id
      GROUP BY u.id
    `);
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching users.', error: error.message });
  }
}

async function createUser(req, res) {
  const { username, password, role } = req.body;

  if (!username || !password || !role) {
    return res.status(400).json({ message: 'Username, password, and role are required.' });
  }

  try {
    const db = getDb();
    const existingUser = await db.get('SELECT * FROM users WHERE username = ?', [username]);
    if (existingUser) {
      return res.status(400).json({ message: 'Username already taken.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await db.run(
      'INSERT INTO users (username, password, role) VALUES (?, ?, ?)',
      [username, hashedPassword, role]
    );

    res.status(201).json({ message: 'User created successfully.' });
  } catch (error) {
    res.status(500).json({ message: 'Error creating user.', error: error.message });
  }
}

async function updateUser(req, res) {
  const { id } = req.params;
  const { username, role, password } = req.body;

  if (!username || !role) {
    return res.status(400).json({ message: 'Username and role are required.' });
  }

  try {
    const db = getDb();
    const user = await db.get('SELECT * FROM users WHERE id = ?', [id]);
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    // Check username uniqueness if changed
    if (username !== user.username) {
      const existingUser = await db.get('SELECT * FROM users WHERE username = ?', [username]);
      if (existingUser) {
        return res.status(400).json({ message: 'Username already taken.' });
      }
    }

    if (password) {
      // If password provided, update it too
      const hashedPassword = await bcrypt.hash(password, 10);
      await db.run(
        'UPDATE users SET username = ?, role = ?, password = ? WHERE id = ?',
        [username, role, hashedPassword, id]
      );
    } else {
      await db.run(
        'UPDATE users SET username = ?, role = ? WHERE id = ?',
        [username, role, id]
      );
    }

    res.json({ message: 'User updated successfully.' });
  } catch (error) {
    res.status(500).json({ message: 'Error updating user.', error: error.message });
  }
}

async function deleteUser(req, res) {
  const { id } = req.params;

  if (parseInt(id) === req.user.id) {
    return res.status(400).json({ message: 'You cannot delete your own admin account.' });
  }

  try {
    const db = getDb();
    await db.run('DELETE FROM users WHERE id = ?', [id]);
    res.json({ message: 'User deleted successfully.' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting user.', error: error.message });
  }
}

// --- API Key Management ---

async function getAllKeys(req, res) {
  try {
    const db = getDb();
    const keys = await db.all(`
      SELECT k.id, k.key_value, k.label, k.is_active, k.last_status,
             (COALESCE((SELECT SUM(s.used_credits) FROM storyboards s WHERE s.api_key_id = k.id), 0) +
              COALESCE((SELECT SUM(v.used_credits) FROM generated_videos v WHERE v.api_key_id = k.id), 0)) AS total_credits
      FROM api_keys k
    `);
    
    // Mask keys before sending
    const maskedKeys = keys.map(k => {
      const val = k.key_value;
      const masked = val.length > 8 ? `${val.substring(0, 4)}...${val.substring(val.length - 4)}` : '****';
      return {
        id: k.id,
        key_value: masked, // C5: expose only the masked value to the client; never the full key.
        masked_value: masked,
        label: k.label,
        is_active: k.is_active,
        last_status: k.last_status || null,
        total_credits: k.total_credits
      };
    });
    
    res.json(maskedKeys);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching API keys.', error: error.message });
  }
}

async function addKey(req, res) {
  const { key_value, label } = req.body;

  if (!key_value || !label) {
    return res.status(400).json({ message: 'API Key and label are required.' });
  }

  try {
    const db = getDb();
    await db.run(
      'INSERT INTO api_keys (key_value, label, is_active) VALUES (?, ?, 1)',
      [key_value, label]
    );
    res.status(201).json({ message: 'API Key added successfully.' });
  } catch (error) {
    res.status(500).json({ message: 'Error adding API Key.', error: error.message });
  }
}

async function addKeysBulk(req, res) {
  const { bulk_data } = req.body; // Multiline text containing: KEY or KEY,LABEL

  if (!bulk_data) {
    return res.status(400).json({ message: 'Bulk data is empty.' });
  }

  const lines = bulk_data.split('\n');
  const db = getDb();
  let addedCount = 0;
  let errorCount = 0;

  try {
    await db.run('BEGIN TRANSACTION');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      let keyVal = line;
      let labelVal = `Bulk Key ${Date.now()}-${i}`;

      if (line.includes(',')) {
        const parts = line.split(',').map((x) => x.trim()).filter(Boolean);
        // Pick the ACTUAL Freebeat key (starts with 'fbk_', else the longest
        // non-email token). The other token (e.g. an email) becomes the label.
        // Fixes the bug where an email was saved as the API key.
        const keyPart = parts.find((x) => /^fbk_/i.test(x))
          || parts.filter((x) => !x.includes('@')).sort((a, b) => b.length - a.length)[0]
          || parts[0];
        keyVal = keyPart;
        labelVal = parts.find((x) => x !== keyPart) || labelVal;
      }

      try {
        await db.run(
          'INSERT INTO api_keys (key_value, label, is_active) VALUES (?, ?, 1)',
          [keyVal, labelVal]
        );
        addedCount++;
      } catch (err) {
        errorCount++;
      }
    }
    await db.run('COMMIT');
    res.json({
      message: `Bulk import completed. Added: ${addedCount}, Failed/Duplicates: ${errorCount}`
    });
  } catch (error) {
    await db.run('ROLLBACK');
    res.status(500).json({ message: 'Error during bulk import.', error: error.message });
  }
}

async function toggleKeyStatus(req, res) {
  const { id } = req.params;
  const { is_active } = req.body; // 1 or 0

  try {
    const db = getDb();
    await db.run('UPDATE api_keys SET is_active = ? WHERE id = ?', [is_active, id]);
    res.json({ message: 'API Key status updated.' });
  } catch (error) {
    res.status(500).json({ message: 'Error updating API Key status.', error: error.message });
  }
}

async function deleteKey(req, res) {
  const { id } = req.params;

  try {
    const db = getDb();
    // Safely remove foreign key references in storyboards first so SQLite deletion never fails
    await db.run('UPDATE storyboards SET api_key_id = NULL WHERE api_key_id = ?', [id]);
    await db.run('DELETE FROM api_keys WHERE id = ?', [id]);
    res.json({ message: 'API Key deleted successfully.' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting API Key.', error: error.message });
  }
}

async function deleteKeysBulk(req, res) {
  const { ids } = req.body;

  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ message: 'No API Key IDs provided for deletion.' });
  }

  try {
    const db = getDb();
    const placeholders = ids.map(() => '?').join(',');
    
    // Safely remove foreign key references in storyboards first
    await db.run(`UPDATE storyboards SET api_key_id = NULL WHERE api_key_id IN (${placeholders})`, ids);
    await db.run(`DELETE FROM api_keys WHERE id IN (${placeholders})`, ids);

    res.json({ message: `${ids.length} API Keys deleted successfully.` });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting selected API Keys.', error: error.message });
  }
}

function httpRequest(url, headers, body) {
  return new Promise((resolve, reject) => {
    try {
      const urlParsed = new URL(url);
      const client = url.startsWith('https') ? https : http;
      const port = urlParsed.port || (url.startsWith('https') ? 443 : 80);

      const options = {
        hostname: urlParsed.hostname,
        port: port,
        path: urlParsed.pathname + urlParsed.search,
        method: 'POST',
        headers: headers,
        timeout: 10000 // 10s timeout
      };

      const req = client.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          resolve({ statusCode: res.statusCode, body: data });
        });
      });

      req.on('error', (err) => reject(err));
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout (10s)')); });

      req.write(JSON.stringify(body));
      req.end();
    } catch (e) {
      reject(e);
    }
  });
}

async function getAiSettings(req, res) {
  try {
    const db = getDb();
    let settings = await db.get('SELECT * FROM ai_settings LIMIT 1');
    if (!settings) {
      await db.run(
        'INSERT INTO ai_settings (endpoint, api_key, model) VALUES (?, ?, ?)',
        [AI_API_HOST, AI_API_TOKEN, 'gemini-3-flash']
      );
      settings = await db.get('SELECT * FROM ai_settings LIMIT 1');
    }
    res.json(settings);
  } catch (error) {
    res.status(500).json({ message: 'Gagal mengambil pengaturan AI.', error: error.message });
  }
}

async function updateAiSettings(req, res) {
  const { endpoint, api_key, model } = req.body;
  // Admin LLM-provider selection. 'default' = the OpenAI-compatible endpoint;
  // 'magica' = route text LLM through the Magica key pool (random key).
  const llm_provider = req.body.llm_provider === 'magica' ? 'magica' : 'default';
  const magica_llm_model = req.body.magica_llm_model || 'gemini_3_5_flash';
  if (!endpoint || !api_key || !model) {
    return res.status(400).json({ message: 'Endpoint, API Key, dan Model wajib diisi.' });
  }

  try {
    const db = getDb();
    let settings = await db.get('SELECT * FROM ai_settings LIMIT 1');
    if (settings) {
      await db.run(
        'UPDATE ai_settings SET endpoint = ?, api_key = ?, model = ?, llm_provider = ?, magica_llm_model = ? WHERE id = ?',
        [endpoint, api_key, model, llm_provider, magica_llm_model, settings.id]
      );
    } else {
      await db.run(
        'INSERT INTO ai_settings (endpoint, api_key, model, llm_provider, magica_llm_model) VALUES (?, ?, ?, ?, ?)',
        [endpoint, api_key, model, llm_provider, magica_llm_model]
      );
    }
    res.json({ message: 'Pengaturan AI berhasil diperbarui.' });
  } catch (error) {
    res.status(500).json({ message: 'Gagal memperbarui pengaturan AI.', error: error.message });
  }
}

async function testAiSettings(req, res) {
  const { endpoint, api_key, model } = req.body;
  if (!endpoint || !api_key || !model) {
    return res.status(400).json({ message: 'Endpoint, API Key, dan Model wajib diisi untuk tes.' });
  }

  try {
    const payload = {
      model: model,
      messages: [{ role: 'user', content: 'Hello' }],
      max_tokens: 5
    };
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${api_key}`
    };

    const response = await httpRequest(`${endpoint}/chat/completions`, headers, payload);
    if (response.statusCode === 200) {
      res.json({ success: true, message: 'Koneksi AI berhasil terautentikasi (200 OK).' });
    } else {
      res.status(400).json({ success: false, message: `Server mengembalikan status ${response.statusCode}`, error: response.body });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: 'Gagal menghubungi Endpoint AI.', error: error.message });
  }
}

function getFilesRecursively(dir, relativeTo = dir) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      results = results.concat(getFilesRecursively(filePath, relativeTo));
    } else {
      const relPath = path.relative(relativeTo, filePath).replace(/\\/g, '/');
      results.push({
        name: file,
        relativePath: `/uploads/${relPath}`,
        size: stat.size,
        createdAt: stat.birthtime || stat.mtime
      });
    }
  }
  return results;
}

async function getStorageFiles(req, res) {
  try {
    const db = getDb();
    const filesOnDisk = getFilesRecursively(uploadsDir);
    
    const downloadLogs = await db.all('SELECT * FROM downloaded_files');
    const downloadMap = {};
    for (const log of downloadLogs) {
      downloadMap[log.file_path] = {
        downloadCount: log.download_count,
        lastDownloadedAt: log.last_downloaded_at
      };
    }

    const enhancedFiles = filesOnDisk.map(file => {
      const key = file.relativePath;
      const log = downloadMap[key];
      return {
        name: file.name,
        path: file.relativePath,
        sizeBytes: file.size,
        sizeMb: (file.size / (1024 * 1024)).toFixed(2) + ' MB',
        createdAt: file.createdAt,
        downloadCount: log ? log.downloadCount : 0,
        isDownloaded: log ? log.downloadCount > 0 : false,
        lastDownloadedAt: log ? log.lastDownloadedAt : null
      };
    });

    enhancedFiles.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(enhancedFiles);
  } catch (error) {
    res.status(500).json({ message: 'Gagal mengambil daftar file penyimpanan.', error: error.message });
  }
}

async function deleteStorageFile(req, res) {
  const { filePath, filePaths } = req.body;
  const pathsToDelete = Array.isArray(filePaths) ? filePaths : (filePath ? [filePath] : []);

  if (pathsToDelete.length === 0) {
    return res.status(400).json({ message: 'filePath atau filePaths wajib diisi.' });
  }

  try {
    const db = getDb();
    let deletedCount = 0;

    for (const p of pathsToDelete) {
      const cleanPath = p.replace(/^\/?uploads\//, '');
      const fullPath = path.join(uploadsDir, cleanPath);

      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
        deletedCount++;
      }
      
      await db.run('DELETE FROM downloaded_files WHERE file_path = ?', [p]);
      
      const pathWithSlash = p.startsWith('/') ? p : '/' + p;
      const pathWithoutSlash = p.startsWith('/') ? p.substring(1) : p;
      
      await db.run(
        'UPDATE generated_videos SET video_url = NULL WHERE video_url = ? OR video_url = ?',
        [pathWithSlash, pathWithoutSlash]
      );
      await db.run(
        'UPDATE storyboards SET merged_video_url = NULL WHERE merged_video_url = ? OR merged_video_url = ?',
        [pathWithSlash, pathWithoutSlash]
      );
    }

    res.json({ message: `${deletedCount} file berhasil dihapus.` });
  } catch (error) {
    res.status(500).json({ message: 'Gagal menghapus file dari penyimpanan.', error: error.message });
  }
}

// --- Database Backup & Restore (for server migration) ---
//
// The SQLite DB only ever stores LINKS + settings + metadata (video/image files
// live on disk under /uploads and are referenced by URL/path). So a full dump of
// these tables is exactly what the user wants to carry to a new server — settings,
// the Freebeat key pool, the LLM/AI config, Google creds, and every storyboard with
// its video links — WITHOUT the heavy media files.
//
// NOTE: the backup contains password hashes and API keys/tokens — treat the file as
// a secret.
const BACKUP_TABLES = [
  'users',            // accounts (bcrypt password hashes) — needed to migrate logins
  'api_keys',         // Freebeat API key pool
  'magica_api_keys',  // Magica API key pool
  'ai_settings',      // LLM / AI provider settings
  'google_settings',  // Google Drive & Sheets credentials
  'storyboards',      // storyboards + image/video links + marketing copy
  'generated_videos', // per-scene video records + video_url links
  'downloaded_files', // download tracking metadata
];

async function backupDatabase(req, res) {
  try {
    const db = getDb();
    const tables = {};
    const counts = {};
    for (const t of BACKUP_TABLES) {
      const rows = await db.all(`SELECT * FROM ${t}`);
      tables[t] = rows;
      counts[t] = rows.length;
    }
    const backup = {
      app: 'storymax',
      type: 'db-backup',
      version: 1,
      exportedAt: new Date().toISOString(),
      counts,
      tables,
    };
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="storymax-db-backup-${stamp}.json"`);
    res.status(200).send(JSON.stringify(backup, null, 2));
  } catch (err) {
    console.error('Backup error:', err);
    res.status(500).json({ message: 'Gagal membuat backup database.', error: err.message });
  }
}

async function restoreDatabase(req, res) {
  const db = getDb();
  try {
    // Accept either the backup object directly, or wrapped as { backup: {...} }.
    const payload = req.body && req.body.tables ? req.body : (req.body && req.body.backup);
    if (!payload || payload.type !== 'db-backup' || !payload.tables || typeof payload.tables !== 'object') {
      return res.status(400).json({ message: 'File backup tidak valid. Pastikan ini file backup StoryMax (.json).' });
    }

    const restored = {};
    // FK enforcement must be toggled OUTSIDE a transaction; turning it off lets us
    // wipe + re-insert in any order without cascade surprises.
    await db.run('PRAGMA foreign_keys = OFF');
    await db.run('BEGIN');
    try {
      for (const t of BACKUP_TABLES) {
        const rows = Array.isArray(payload.tables[t]) ? payload.tables[t] : null;
        if (rows === null) continue; // table absent in backup → leave current data untouched
        await db.run(`DELETE FROM ${t}`);
        // Intersect backup columns with the CURRENT schema (defensive vs schema drift).
        const info = await db.all(`PRAGMA table_info(${t})`);
        const validCols = new Set(info.map((c) => c.name));
        let inserted = 0;
        for (const row of rows) {
          const cols = Object.keys(row).filter((c) => validCols.has(c));
          if (cols.length === 0) continue;
          const placeholders = cols.map(() => '?').join(', ');
          const values = cols.map((c) => row[c]);
          await db.run(
            `INSERT INTO ${t} (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${placeholders})`,
            values
          );
          inserted++;
        }
        restored[t] = inserted;
      }
      await db.run('COMMIT');
    } catch (inner) {
      try { await db.run('ROLLBACK'); } catch (e) {}
      throw inner;
    } finally {
      await db.run('PRAGMA foreign_keys = ON');
    }

    res.status(200).json({
      message: 'Restore database berhasil.',
      restored,
      note: 'Data lama telah diganti. Anda mungkin perlu login ulang.',
    });
  } catch (err) {
    console.error('Restore error:', err);
    try { await getDb().run('PRAGMA foreign_keys = ON'); } catch (e) {}
    res.status(500).json({ message: 'Gagal me-restore database. Tidak ada perubahan yang disimpan (rollback).', error: err.message });
  }
}

// --- Magica (multi-provider) key pool + per-user access ---
const magica = require('../services/magicaClient');

async function getMagicaKeys(req, res) {
  try {
    const db = getDb();
    const keys = await db.all('SELECT id, key_value, label, is_active, last_status, created_at FROM magica_api_keys ORDER BY id DESC');
    res.json(keys);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching Magica keys.', error: error.message });
  }
}

async function addMagicaKey(req, res) {
  const { key_value, label } = req.body;
  if (!key_value || !label) return res.status(400).json({ message: 'Magica API Key dan label wajib diisi.' });
  try {
    const db = getDb();
    await db.run('INSERT INTO magica_api_keys (key_value, label, is_active) VALUES (?, ?, 1)', [String(key_value).trim(), label]);
    res.status(201).json({ message: 'Magica API Key ditambahkan.' });
  } catch (error) {
    res.status(500).json({ message: 'Gagal menambah Magica API Key (mungkin duplikat).', error: error.message });
  }
}

async function addMagicaKeysBulk(req, res) {
  const { bulk_data } = req.body;
  if (!bulk_data) return res.status(400).json({ message: 'Data bulk kosong.' });
  const lines = String(bulk_data).split('\n');
  const db = getDb();
  let added = 0, failed = 0;
  try {
    await db.run('BEGIN TRANSACTION');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      let keyVal = line;
      let labelVal = `Magica Key ${Date.now()}-${i}`;
      if (line.includes(',')) {
        const parts = line.split(',').map((x) => x.trim()).filter(Boolean);
        const keyPart = parts.find((x) => /^gx_/i.test(x)) || parts.filter((x) => !x.includes('@')).sort((a, b) => b.length - a.length)[0] || parts[0];
        keyVal = keyPart;
        labelVal = parts.find((x) => x !== keyPart) || labelVal;
      }
      try { await db.run('INSERT INTO magica_api_keys (key_value, label, is_active) VALUES (?, ?, 1)', [keyVal, labelVal]); added++; }
      catch (e) { failed++; }
    }
    await db.run('COMMIT');
    res.json({ message: `Bulk import selesai. Ditambah: ${added}, Gagal/Duplikat: ${failed}` });
  } catch (error) {
    await db.run('ROLLBACK');
    res.status(500).json({ message: 'Error bulk import Magica.', error: error.message });
  }
}

async function toggleMagicaKey(req, res) {
  const { id } = req.params;
  const { is_active } = req.body;
  try {
    const db = getDb();
    await db.run('UPDATE magica_api_keys SET is_active = ? WHERE id = ?', [is_active, id]);
    res.json({ message: 'Status Magica API Key diperbarui.' });
  } catch (error) {
    res.status(500).json({ message: 'Error update status Magica key.', error: error.message });
  }
}

async function deleteMagicaKey(req, res) {
  const { id } = req.params;
  try {
    const db = getDb();
    await db.run('DELETE FROM magica_api_keys WHERE id = ?', [id]);
    res.json({ message: 'Magica API Key dihapus.' });
  } catch (error) {
    res.status(500).json({ message: 'Error menghapus Magica key.', error: error.message });
  }
}

async function deleteMagicaKeysBulk(req, res) {
  const { ids } = req.body;
  if (!ids || !Array.isArray(ids) || ids.length === 0) return res.status(400).json({ message: 'Tidak ada ID key.' });
  try {
    const db = getDb();
    const ph = ids.map(() => '?').join(',');
    await db.run(`DELETE FROM magica_api_keys WHERE id IN (${ph})`, ids);
    res.json({ message: `${ids.length} Magica API Key dihapus.` });
  } catch (error) {
    res.status(500).json({ message: 'Error menghapus Magica key terpilih.', error: error.message });
  }
}

// Verify a Magica key (from the request body, or the first active pooled key) by
// hitting the read-only /models + /credits endpoints. No credits are spent.
async function testMagicaConnection(req, res) {
  try {
    const db = getDb();
    let key = req.body && req.body.key_value ? String(req.body.key_value).trim() : null;
    if (!key) {
      const row = await db.get('SELECT key_value FROM magica_api_keys WHERE is_active = 1 ORDER BY id ASC LIMIT 1');
      key = row && row.key_value;
    }
    if (!key) return res.status(400).json({ message: 'Belum ada Magica API Key aktif untuk dites.' });
    const result = await magica.testConnection(key);
    res.json({ message: 'Koneksi Magica OK.', ...result });
  } catch (error) {
    res.status(502).json({ message: 'Koneksi Magica gagal.', error: error.message });
  }
}

async function setUserMagicaAccess(req, res) {
  const { id } = req.params;
  const { can_use_magica } = req.body;
  try {
    const db = getDb();
    const val = can_use_magica ? 1 : 0;
    await db.run('UPDATE users SET can_use_magica = ? WHERE id = ?', [val, id]);
    // If access is revoked, reset a 'magica' preference back to Freebeat for that user.
    if (!val) {
      await db.run("UPDATE users SET preferred_provider = 'freebeat' WHERE id = ? AND preferred_provider = 'magica'", [id]);
    }
    res.json({ message: 'Izin Magica user diperbarui.' });
  } catch (error) {
    res.status(500).json({ message: 'Error update izin Magica user.', error: error.message });
  }
}

module.exports = {
  getAllUsers,
  createUser,
  updateUser,
  deleteUser,
  getAllKeys,
  addKey,
  addKeysBulk,
  toggleKeyStatus,
  deleteKey,
  deleteKeysBulk,
  getAiSettings,
  updateAiSettings,
  testAiSettings,
  getStorageFiles,
  deleteStorageFile,
  backupDatabase,
  restoreDatabase,
  getMagicaKeys,
  addMagicaKey,
  addMagicaKeysBulk,
  toggleMagicaKey,
  deleteMagicaKey,
  deleteMagicaKeysBulk,
  testMagicaConnection,
  setUserMagicaAccess
};
