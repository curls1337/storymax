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
    // total_credits = Freebeat-only usage (storyboards + videos generated via Freebeat).
    // magica_credits_micro = Magica-only usage across 3 Magica record types:
    //   storyboards flagged Magica + Magica videos + Meshy 3D.
    // Values are microcredits; the UI divides by 1e6 to show Magica credits.
    const users = await db.all(`
      SELECT u.id, u.username, u.role, u.can_use_magica, u.can_use_seedance, u.allow_hd_resolutions, u.preferred_provider,
        (
          COALESCE((SELECT SUM(s.used_credits) FROM storyboards s WHERE s.user_id = u.id AND (s.generation_params NOT LIKE '%magica%' OR s.generation_params IS NULL) AND s.api_key_id IS NOT NULL), 0)
          + COALESCE((SELECT SUM(gv.used_credits) FROM generated_videos gv JOIN storyboards s2 ON s2.id = gv.storyboard_id WHERE s2.user_id = u.id AND gv.api_key_id IS NOT NULL AND (gv.model NOT LIKE 'magica:%' OR gv.model IS NULL)), 0)
        ) AS total_credits,
        (
          COALESCE((SELECT SUM(s.used_credits) FROM storyboards s WHERE s.user_id = u.id AND s.generation_params LIKE '%magica%'), 0)
          + COALESCE((SELECT SUM(gv.used_credits) FROM generated_videos gv JOIN storyboards s2 ON s2.id = gv.storyboard_id WHERE s2.user_id = u.id AND (gv.magica_key_id IS NOT NULL OR gv.model LIKE 'magica:%')), 0)
          + COALESCE((SELECT SUM(g3.credit_used) FROM generated_3d g3 WHERE g3.user_id = u.id), 0)
        ) AS magica_credits_micro
      FROM users u
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
  'ai_settings',      // LLM / AI provider settings (incl. llm_provider + magica_llm_model)
  'google_settings',  // Google Drive & Sheets credentials
  'storyboards',      // storyboards + image/video links + marketing copy
  'generated_videos', // per-scene video records + video_url links
  'generated_3d',     // 3D (Meshy V6) generations + model/thumb links
  'downloaded_files', // download tracking metadata
];

async function generateDatabaseBackupPayload(db) {
  const tables = {};
  const counts = {};
  for (const t of BACKUP_TABLES) {
    const rows = await db.all(`SELECT * FROM ${t}`);
    tables[t] = rows;
    counts[t] = rows.length;
  }
  return {
    app: 'storymax',
    type: 'db-backup',
    version: 2,
    exportedAt: new Date().toISOString(),
    counts,
    tables,
  };
}

async function backupDatabase(req, res) {
  try {
    const db = getDb();
    const backup = await generateDatabaseBackupPayload(db);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="storymax-db-backup-${stamp}.json"`);
    res.status(200).send(JSON.stringify(backup, null, 2));
  } catch (err) {
    console.error('Backup error:', err);
    res.status(500).json({ message: 'Gagal membuat backup database.', error: err.message });
  }
}

async function executeDatabaseRestorePayload(db, payload) {
  if (payload && payload.backup) payload = payload.backup;
  if (!payload || payload.type !== 'db-backup' || !payload.tables || typeof payload.tables !== 'object') {
    throw new Error('File backup tidak valid. Pastikan ini file backup StoryMax (.json).');
  }

  const restored = {};
  await db.run('PRAGMA foreign_keys = OFF');
  await db.run('BEGIN');
  try {
    for (const t of BACKUP_TABLES) {
      const rows = Array.isArray(payload.tables[t]) ? payload.tables[t] : null;
      if (rows === null) continue;
      await db.run(`DELETE FROM ${t}`);
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
    try { await db.run('PRAGMA wal_checkpoint(FULL)'); } catch (e) {}
  } catch (inner) {
    try { await db.run('ROLLBACK'); } catch (e) {}
    throw inner;
  } finally {
    await db.run('PRAGMA foreign_keys = ON');
  }
  return restored;
}

async function restoreDatabase(req, res) {
  const db = getDb();
  try {
    let payload = null;
    if (req.body && Buffer.isBuffer(req.body)) {
      try { payload = JSON.parse(req.body.toString('utf8').trim()); } catch (e) {}
    } else if (req.body && typeof req.body === 'object') {
      payload = req.body.tables ? req.body : req.body.backup;
    }

    if (!payload) {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const rawText = Buffer.concat(chunks).toString('utf8').trim();
      if (rawText) {
        try { payload = JSON.parse(rawText); } catch (e) {}
      }
    }

    const restored = await executeDatabaseRestorePayload(db, payload);
    res.status(200).json({
      message: 'Restore database berhasil.',
      restored,
      note: 'Data lama telah diganti. Anda mungkin perlu login ulang.',
    });
  } catch (err) {
    console.error('Restore error:', err);
    res.status(500).json({ message: err.message || 'Gagal me-restore database.', error: err.message });
  }
}

async function executeDatabaseRestoreFromFile(db, tempFilePath) {
  const readline = require('readline');

  if (!fs.existsSync(tempFilePath)) {
    throw new Error('File backup temporary tidak ditemukan.');
  }

  const stats = fs.statSync(tempFilePath);
  // For files smaller than 15MB, parse directly
  if (stats.size < 15 * 1024 * 1024) {
    const rawText = fs.readFileSync(tempFilePath, 'utf8').trim();
    const payload = JSON.parse(rawText);
    return await executeDatabaseRestorePayload(db, payload);
  }

  // For large files (>15MB), stream line-by-line using line-demarcated object boundaries to keep RAM < 15MB
  await db.run('PRAGMA foreign_keys = OFF');
  await db.run('BEGIN');

  const restored = {};
  for (const t of BACKUP_TABLES) {
    restored[t] = 0;
  }

  const tableSchemas = {};
  for (const t of BACKUP_TABLES) {
    const info = await db.all(`PRAGMA table_info(${t})`);
    tableSchemas[t] = new Set(info.map((c) => c.name));
  }

  let currentTable = null;
  let inTablesBlock = false;
  let insideRow = false;
  let rowLines = [];

  const clearedTables = new Set();
  const fileStream = fs.createReadStream(tempFilePath, { encoding: 'utf8' });
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  try {
    for await (const line of rl) {
      const trimmed = line.trim();

      if (!inTablesBlock) {
        if (trimmed.includes('"tables"') || trimmed.includes("'tables'")) {
          inTablesBlock = true;
        }
        continue;
      }

      // Check for table header e.g. "storyboards": [
      for (const t of BACKUP_TABLES) {
        const tableHeaderRegex = new RegExp(`"${t}"\\s*:\\s*\\[`);
        if (tableHeaderRegex.test(trimmed)) {
          currentTable = t;
          if (!clearedTables.has(currentTable)) {
            await db.run(`DELETE FROM ${currentTable}`);
            clearedTables.add(currentTable);
          }
          break;
        }
      }

      if (!currentTable) continue;

      // Detect start of object e.g. line is exactly "{"
      if (!insideRow && trimmed === '{') {
        insideRow = true;
        rowLines = ['{'];
        continue;
      }

      if (insideRow) {
        // Detect end of object e.g. line is "}" or "},"
        if (trimmed === '}' || trimmed === '},') {
          rowLines.push('}');
          insideRow = false;
          try {
            const jsonStr = rowLines.join('\n');
            const row = JSON.parse(jsonStr);
            const validCols = tableSchemas[currentTable];
            if (validCols && row && typeof row === 'object') {
              const cols = Object.keys(row).filter((c) => validCols.has(c));
              if (cols.length > 0) {
                const placeholders = cols.map(() => '?').join(', ');
                const values = cols.map((c) => row[c]);
                await db.run(
                  `INSERT INTO ${currentTable} (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${placeholders})`,
                  values
                );
                restored[currentTable]++;
              }
            }
          } catch (parseErr) {
            // Ignore single malformed row if any
          }
          rowLines = [];
        } else {
          rowLines.push(line);
        }
      }
    }

    // Fallback: If streaming line boundaries yielded 0 restored rows across all tables
    // (e.g. minified JSON file on single line), fallback to standard execution
    const totalRestored = Object.values(restored).reduce((a, b) => a + b, 0);
    if (totalRestored === 0) {
      await db.run('ROLLBACK');
      const rawText = fs.readFileSync(tempFilePath, 'utf8').trim();
      const payload = JSON.parse(rawText);
      return await executeDatabaseRestorePayload(db, payload);
    }

    await db.run('COMMIT');
    try { await db.run('PRAGMA wal_checkpoint(FULL)'); } catch (e) {}
  } catch (err) {
    try { await db.run('ROLLBACK'); } catch (e) {}
    throw err;
  } finally {
    try { await db.run('PRAGMA foreign_keys = ON'); } catch (e) {}
  }

  return restored;
}

let restoreJobStatus = {
  status: 'idle',
  progress: 0,
  message: '',
  restored: null,
  error: null,
};

async function getRestoreStatus(req, res) {
  res.json(restoreJobStatus);
}

// Chunked Restore for large files (>10MB) to easily bypass Cloudflare / Nginx / Sevalla 100MB proxy limits
async function restoreChunkDatabase(req, res) {
  const db = getDb();
  try {
    const chunkIndex = parseInt(req.headers['x-chunk-index'] || req.query.chunkIndex || '0', 10);
    const totalChunks = parseInt(req.headers['x-total-chunks'] || req.query.totalChunks || '1', 10);
    const sessionId = (req.headers['x-restore-session'] || req.query.sessionId || 'default').replace(/[^a-zA-Z0-9_-]/g, '');

    const tempDir = path.join(uploadsDir, 'temp_restore');
    try { fs.mkdirSync(tempDir, { recursive: true }); } catch (e) {}
    const tempFilePath = path.join(tempDir, `restore_${sessionId}.json`);

    let chunkBuffer = null;
    if (Buffer.isBuffer(req.body)) {
      chunkBuffer = req.body;
    } else {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      chunkBuffer = Buffer.concat(chunks);
    }

    fs.appendFileSync(tempFilePath, chunkBuffer);

    if (chunkIndex >= totalChunks - 1) {
      restoreJobStatus = {
        status: 'processing',
        progress: 0,
        message: 'File selesai diunggah. Memulihkan database di background...',
        restored: null,
        error: null,
      };

      // Run restore asynchronously in background to finish HTTP request in 0.01 seconds (0 proxy timeouts!)
      (async () => {
        try {
          const restored = await executeDatabaseRestoreFromFile(db, tempFilePath);
          restoreJobStatus = {
            status: 'completed',
            progress: 100,
            message: 'Restore database berhasil.',
            restored,
            error: null,
          };
        } catch (restoreErr) {
          console.error('Execute restore from file error:', restoreErr);
          restoreJobStatus = {
            status: 'failed',
            progress: 0,
            message: 'Gagal memproses data backup: ' + restoreErr.message,
            error: restoreErr.message,
          };
        } finally {
          try { fs.unlinkSync(tempFilePath); } catch (e) {}
        }
      })();

      return res.status(200).json({
        status: 'processing',
        message: 'File backup berhasil diunggah. Database sedang dipulihkan di background...',
      });
    } else {
      return res.status(200).json({
        status: 'chunk_received',
        chunkIndex,
        totalChunks,
      });
    }
  } catch (err) {
    console.error('Restore chunk error:', err);
    return res.status(500).json({ message: err.message || 'Gagal me-restore database.', error: err.message });
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

// Try to derive a stable per-account identifier from a Magica /credits/balance
// payload so keys belonging to the same account can be de-duplicated. Returns null
// when the payload exposes no account-identifying field.
function pickAccountKey(bal) {
  if (!bal || typeof bal !== 'object') return null;
  const cand = bal.accountId || bal.account_id || bal.organizationId || bal.organization_id
    || bal.orgId || bal.org_id || bal.workspaceId || bal.workspace_id
    || bal.userId || bal.user_id || bal.customerId || bal.customer_id
    || bal.subscriptionId || bal.subscription_id || bal.email
    || (bal.account && (bal.account.id || bal.account.email))
    || (bal.user && (bal.user.id || bal.user.email));
  return cand != null ? String(cand) : null;
}

// Aggregate credit balances across all ACTIVE Magica keys for the admin dashboard.
// Magica credit is PER-ACCOUNT: several keys can belong to the same account and thus
// SHARE one balance. We de-duplicate by an account identifier from the balance payload
// when present, so same-account keys are counted once. If no identifier is exposed we
// sum every active key and flag `mayDoubleCount` so the UI can warn about over-counting.
// availableBalance is in MICROCREDITS (1 credit = 1,000,000); we return credits.
async function getMagicaBalances(req, res) {
  try {
    const db = getDb();
    const rows = await db.all('SELECT id, label, key_value FROM magica_api_keys WHERE is_active = 1 ORDER BY id ASC');
    const enriched = await Promise.all((rows || []).map(async (k) => {
      let micro = null, formatted = null, accountKey = null, error = null;
      try {
        const bal = await magica.getCreditBalance(k.key_value);
        const n = Number(bal.availableBalance);
        micro = Number.isFinite(n) ? n : null;
        formatted = bal.formatted != null ? String(bal.formatted) : null;
        accountKey = pickAccountKey(bal);
      } catch (e) { error = e.message; }
      return { id: k.id, label: k.label, micro, formatted, accountKey, error };
    }));

    // De-duplicate by account when an identifier is available; otherwise count each key.
    let totalMicro = 0, accountsCounted = 0, missingAccountKeys = 0;
    const seen = new Set();
    for (const k of enriched) {
      if (k.micro == null) continue;
      if (k.accountKey) {
        if (seen.has(k.accountKey)) continue;
        seen.add(k.accountKey);
      } else {
        missingAccountKeys++;
      }
      totalMicro += k.micro;
      accountsCounted++;
    }
    const totalCredits = totalMicro / 1e6;
    const keysWithBalance = enriched.filter((k) => k.micro != null).length;

    res.json({
      keys: enriched.map((k) => ({
        id: k.id,
        label: k.label,
        credits: k.micro != null ? k.micro / 1e6 : null,
        formatted: k.formatted,
        error: k.error,
      })),
      totalCredits,
      totalFormatted: totalCredits.toLocaleString('id-ID', { maximumFractionDigits: 2 }),
      activeKeys: enriched.length,
      keysWithBalance,
      accountsCounted,
      // If accounts can't be identified and 2+ keys reported a balance, the sum may
      // include same-account keys more than once.
      mayDoubleCount: missingAccountKeys > 1,
    });
  } catch (error) {
    res.status(500).json({ message: 'Gagal mengambil saldo Magica.', error: error.message });
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

async function setUserHdAccess(req, res) {
  const { id } = req.params;
  const { allow_hd_resolutions } = req.body;
  try {
    const db = getDb();
    const val = allow_hd_resolutions ? 1 : 0;
    await db.run('UPDATE users SET allow_hd_resolutions = ? WHERE id = ?', [val, id]);
    res.json({ message: 'Izin HD (1080p/4K) user diperbarui.', allow_hd_resolutions: val });
  } catch (error) {
    res.status(500).json({ message: 'Error update izin HD user.', error: error.message });
  }
}

async function setUserSeedanceAccess(req, res) {
  const { id } = req.params;
  const { can_use_seedance } = req.body;
  try {
    const db = getDb();
    const val = can_use_seedance ? 1 : 0;
    await db.run('UPDATE users SET can_use_seedance = ? WHERE id = ?', [val, id]);
    res.json({ message: 'Izin SeedDance 2.5 user diperbarui.', can_use_seedance: val });
  } catch (error) {
    res.status(500).json({ message: 'Error update izin SeedDance 2.5 user.', error: error.message });
  }
}

// SeedDance 2.5 Cookies / AuthTokens Pool Management
async function getSeedanceCookies(req, res) {
  try {
    const db = getDb();
    const rows = await db.all('SELECT id, key_value, label, is_active, last_status, created_at FROM seedance_cookies ORDER BY id DESC');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching SeedDance 2.5 cookies.', error: error.message });
  }
}

// Helper to extract authToken or format raw cookie string from JSON array / text
function parseCookieOrTokenInput(rawInput) {
  const str = String(rawInput || '').trim();
  if (!str) return null;

  // Try parsing as JSON (e.g. Chrome exported cookies JSON array)
  if (str.startsWith('[') || str.startsWith('{')) {
    try {
      const parsed = JSON.parse(str);
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      
      // Look for authToken specifically first
      const authItem = arr.find((c) => c && (c.name === 'authToken' || c.name === 'authorization'));
      if (authItem && authItem.value) {
        return authItem.value.trim();
      }

      // If no authToken item found, combine all name=value pairs into a Cookie header string
      const cookieString = arr
        .filter((c) => c && c.name && c.value)
        .map((c) => `${c.name}=${c.value}`)
        .join('; ');
      
      if (cookieString) return cookieString;
    } catch (e) {
      // Not valid JSON, fallback to text parsing
    }
  }

  // If plain text line containing authToken=xyz...
  if (str.includes('authToken=')) {
    const match = str.match(/authToken=([^;\s]+)/);
    if (match && match[1]) return match[1].trim();
  }

  return str;
}

async function addSeedanceCookie(req, res) {
  const { key_value, label } = req.body;
  if (!key_value || !label) return res.status(400).json({ message: 'Cookie/Token dan label wajib diisi.' });
  try {
    const extractedKey = parseCookieOrTokenInput(key_value);
    const db = getDb();
    await db.run('INSERT INTO seedance_cookies (key_value, label, is_active) VALUES (?, ?, 1)', [extractedKey, label]);
    res.status(201).json({ message: 'Cookie SeedDance 2.5 berhasil ditambahkan.' });
  } catch (error) {
    res.status(500).json({ message: 'Gagal menambah Cookie (mungkin duplikat).', error: error.message });
  }
}

async function addSeedanceCookiesBulk(req, res) {
  const { bulk_data } = req.body;
  if (!bulk_data) return res.status(400).json({ message: 'Data bulk kosong.' });
  const db = getDb();
  let added = 0, failed = 0;

  try {
    const str = String(bulk_data).trim();
    let itemsToProcess = [];

    // Check if user pasted a single full JSON array of cookies directly into the bulk field
    if (str.startsWith('[') && str.endsWith(']')) {
      try {
        const parsed = JSON.parse(str);
        if (Array.isArray(parsed)) {
          // Extracted single cookie/authToken object from JSON array
          const extractedKey = parseCookieOrTokenInput(str);
          if (extractedKey) {
            itemsToProcess.push({
              keyVal: extractedKey,
              labelVal: `SeedDance Cookie ${Date.now()}`
            });
          }
        }
      } catch (e) {
        // Fallback to line by line
      }
    }

    // If not handled as single JSON array, process line by line
    if (itemsToProcess.length === 0) {
      const lines = str.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        let keyVal = line;
        let labelVal = `SeedDance Cookie ${Date.now()}-${i + 1}`;
        if (line.includes(',')) {
          const parts = line.split(',').map((x) => x.trim()).filter(Boolean);
          const keyPart = parts.find((x) => /^webcbc/i.test(x) || x.startsWith('[') || x.length > 20) || parts[parts.length - 1];
          keyVal = parseCookieOrTokenInput(keyPart);
          labelVal = parts.find((x) => x !== keyPart) || labelVal;
        } else {
          keyVal = parseCookieOrTokenInput(line);
        }
        if (keyVal) {
          itemsToProcess.push({ keyVal, labelVal });
        }
      }
    }

    await db.run('BEGIN TRANSACTION');
    for (const item of itemsToProcess) {
      try {
        await db.run('INSERT INTO seedance_cookies (key_value, label, is_active) VALUES (?, ?, 1)', [item.keyVal, item.labelVal]);
        added++;
      } catch (e) {
        failed++;
      }
    }
    await db.run('COMMIT');
    res.json({ message: `Bulk import selesai. Ditambah: ${added}, Gagal/Duplikat: ${failed}` });
  } catch (error) {
    await db.run('ROLLBACK');
    res.status(500).json({ message: 'Error bulk import SeedDance cookies.', error: error.message });
  }
}

async function toggleSeedanceCookie(req, res) {
  const { id } = req.params;
  const { is_active } = req.body;
  try {
    const db = getDb();
    await db.run('UPDATE seedance_cookies SET is_active = ? WHERE id = ?', [is_active, id]);
    res.json({ message: 'Status Cookie SeedDance 2.5 diperbarui.' });
  } catch (error) {
    res.status(500).json({ message: 'Error update status Cookie.', error: error.message });
  }
}

async function deleteSeedanceCookie(req, res) {
  const { id } = req.params;
  try {
    const db = getDb();
    await db.run('DELETE FROM seedance_cookies WHERE id = ?', [id]);
    res.json({ message: 'Cookie SeedDance 2.5 dihapus.' });
  } catch (error) {
    res.status(500).json({ message: 'Error menghapus Cookie.', error: error.message });
  }
}

async function deleteSeedanceCookiesBulk(req, res) {
  const { ids } = req.body;
  if (!ids || !Array.isArray(ids) || ids.length === 0) return res.status(400).json({ message: 'Tidak ada ID Cookie.' });
  try {
    const db = getDb();
    const ph = ids.map(() => '?').join(',');
    await db.run(`DELETE FROM seedance_cookies WHERE id IN (${ph})`, ids);
    res.json({ message: `${ids.length} Cookie SeedDance 2.5 dihapus.` });
  } catch (error) {
    res.status(500).json({ message: 'Error menghapus Cookie terpilih.', error: error.message });
  }
}

async function testSeedanceCookieConnection(req, res) {
  try {
    const db = getDb();
    let rawToken = req.body && req.body.key_value ? String(req.body.key_value).trim() : null;
    let cookieRow = null;
    if (!rawToken) {
      cookieRow = await db.get('SELECT id, key_value FROM seedance_cookies WHERE is_active = 1 ORDER BY id ASC LIMIT 1');
      rawToken = cookieRow && cookieRow.key_value;
    }
    if (!rawToken) return res.status(400).json({ message: 'Belum ada Cookie/Token SeedDance 2.5 aktif untuk dites.' });

    const token = parseCookieOrTokenInput(rawToken);

    const https = require('https');
    const result = await new Promise((resolve, reject) => {
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
          'x-platform-type': 'web'
        }
      };
      const req0 = https.request(options, (res0) => {
        let data = '';
        res0.on('data', (chunk) => data += chunk);
        res0.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.code === 0 && json.data) {
              resolve(json.data);
            } else {
              reject(new Error(json.msg || 'Token/Cookie tidak valid'));
            }
          } catch (e) {
            reject(new Error('Respon server bukan JSON valid'));
          }
        });
      });
      req0.on('error', (e) => reject(e));
      req0.end();
    });

    if (cookieRow && cookieRow.id) {
      const statusText = `OK - ${result.totalCredits ?? result.membership ?? 0} Kredit (${result.planName || 'Plan'}) - ${new Date().toLocaleTimeString('id-ID')}`;
      try {
        await db.run('UPDATE seedance_cookies SET last_status = ? WHERE id = ?', [statusText, cookieRow.id]);
      } catch (e) {}
    }

    res.json({ message: 'Koneksi Cookie SeedDance 2.5 OK!', ...result });
  } catch (error) {
    res.status(500).json({ message: 'Gagal tes koneksi Cookie SeedDance 2.5: ' + error.message });
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
  generateDatabaseBackupPayload,
  restoreDatabase,
  restoreChunkDatabase,
  getRestoreStatus,
  getMagicaKeys,
  addMagicaKey,
  addMagicaKeysBulk,
  toggleMagicaKey,
  deleteMagicaKey,
  deleteMagicaKeysBulk,
  testMagicaConnection,
  getMagicaBalances,
  setUserMagicaAccess,
  setUserHdAccess,
  setUserSeedanceAccess,
  getSeedanceCookies,
  addSeedanceCookie,
  addSeedanceCookiesBulk,
  toggleSeedanceCookie,
  deleteSeedanceCookie,
  deleteSeedanceCookiesBulk,
  testSeedanceCookieConnection,
  parseCookieOrTokenInput
};
