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
      SELECT u.id, u.username, u.role, COALESCE(SUM(s.used_credits), 0) AS total_credits 
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
      SELECT k.id, k.key_value, k.label, k.is_active,
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
        const parts = line.split(',');
        keyVal = parts[0].trim();
        labelVal = parts[1].trim();
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
  if (!endpoint || !api_key || !model) {
    return res.status(400).json({ message: 'Endpoint, API Key, dan Model wajib diisi.' });
  }

  try {
    const db = getDb();
    let settings = await db.get('SELECT * FROM ai_settings LIMIT 1');
    if (settings) {
      await db.run(
        'UPDATE ai_settings SET endpoint = ?, api_key = ?, model = ? WHERE id = ?',
        [endpoint, api_key, model, settings.id]
      );
    } else {
      await db.run(
        'INSERT INTO ai_settings (endpoint, api_key, model) VALUES (?, ?, ?)',
        [endpoint, api_key, model]
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
  deleteStorageFile
};
