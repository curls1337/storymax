const express = require('express');
const { authenticateToken, requireAdmin } = require('../middleware/authMiddleware');
const { getDb } = require('../db');
const scenarioClient = require('../services/scenarioClient');
const scenarioGen = require('../services/scenarioGen');

const router = express.Router();

// Catalog endpoint (accessible by all authenticated users)
router.get('/catalog', authenticateToken, async (req, res) => {
  try {
    const db = getDb();
    const specificKeyId = req.query.keyId;
    const activeKeys = await db.all(`
      SELECT k.id, k.key_value, k.secret_value, k.label, k.is_active, k.usage_count, k.consumption_cu, k.plan_name,
             (COALESCE((SELECT COUNT(*) FROM storyboards s WHERE s.scenario_key_id = k.id), 0) +
              COALESCE((SELECT COUNT(*) FROM generated_videos v WHERE v.scenario_key_id = k.id), 0) +
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

    // Tag models with supported status based on active key plan tier
    const imageModels = scenarioGen.SCENARIO_CATALOG.imageModels.map(m => ({
      ...m,
      isSupported: (m.tier || 0) <= detectedTier,
      badge: (m.tier || 0) > detectedTier ? `Perlu ${m.plan}` : 'Didukung'
    }));

    const videoModels = scenarioGen.SCENARIO_CATALOG.videoModels.map(m => ({
      ...m,
      isSupported: (m.tier || 0) <= detectedTier,
      badge: (m.tier || 0) > detectedTier ? `Perlu ${m.plan}` : 'Didukung'
    }));

    res.json({
      detectedTier,
      tierName: detectedTier >= 50 ? 'Pro / Team Plan' : 'Starter / Standard Plan',
      keys: publicKeys,
      imageModels,
      videoModels
    });
  } catch (err) {
    res.status(500).json({ message: 'Gagal mengambil katalog model Scenario.', error: err.message });
  }
});

// Admin-only key management endpoints below
router.use(authenticateToken);
router.use(requireAdmin);

// List all Scenario keys
router.get('/keys', async (req, res) => {
  try {
    const db = getDb();
    const rows = await db.all(`
      SELECT k.id, k.key_value, k.secret_value, k.label, k.is_active, k.last_status, k.created_at,
             k.usage_count, k.consumption_cu, k.plan_name,
             (COALESCE((SELECT COUNT(*) FROM storyboards s WHERE s.scenario_key_id = k.id), 0) +
              COALESCE((SELECT COUNT(*) FROM generated_videos v WHERE v.scenario_key_id = k.id), 0) +
              COALESCE(k.usage_count, 0)) AS total_usage
      FROM scenario_api_keys k
      ORDER BY k.id DESC
    `);
    res.json(rows || []);
  } catch (err) {
    res.status(500).json({ message: 'Gagal mengambil daftar Scenario API keys.', error: err.message });
  }
});

// Add single Scenario key
router.post('/keys', async (req, res) => {
  const { key_value, secret_value, label } = req.body || {};
  if (!key_value || !secret_value) {
    return res.status(400).json({ message: 'API Key dan API Secret wajib diisi.' });
  }

  const cleanKey = String(key_value).trim();
  const cleanSecret = String(secret_value).trim();
  const cleanLabel = String(label || `Scenario Key ${Date.now()}`).trim();

  try {
    const db = getDb();
    const result = await db.run(
      'INSERT INTO scenario_api_keys (key_value, secret_value, label, is_active) VALUES (?, ?, ?, 1)',
      [cleanKey, cleanSecret, cleanLabel]
    );
    res.status(201).json({
      message: 'API Key Scenario berhasil ditambahkan.',
      id: result.lastID
    });
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE constraint failed')) {
      return res.status(409).json({ message: 'Kombinasi API Key & Secret ini sudah ada di database.' });
    }
    res.status(500).json({ message: 'Gagal menambahkan API Key Scenario.', error: err.message });
  }
});

// Bulk add Scenario keys
// Format per baris yang didukung:
// 1. email/label,apiKey,apiSecret,https://... (link tempmail diabaikan/auto-strip)
// 2. email/label,apiKey,apiSecret
// 3. apiKey,apiSecret,email/label
// 4. apiKey:apiSecret,Label atau apiKey:apiSecret
router.post('/keys/bulk', async (req, res) => {
  const { data } = req.body || {};
  if (!data || typeof data !== 'string') {
    return res.status(400).json({ message: 'Data bulk keys wajib diisi dalam bentuk teks.' });
  }

  const lines = data.split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) {
    return res.status(400).json({ message: 'Tidak ada baris data yang valid.' });
  }

  const db = getDb();
  let addedCount = 0;
  let errorCount = 0;

  await db.run('BEGIN TRANSACTION');
  try {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('#') || line.startsWith('//')) continue;

      let keyVal = '';
      let secretVal = '';
      let labelVal = `Scenario Key ${Date.now()}-${i + 1}`;

      // Check delimiters
      let rawTokens = [];
      if (line.includes(',')) {
        rawTokens = line.split(',').map(t => t.trim()).filter(Boolean);
      } else if (line.includes('\t')) {
        rawTokens = line.split('\t').map(t => t.trim()).filter(Boolean);
      } else if (line.includes(';')) {
        rawTokens = line.split(';').map(t => t.trim()).filter(Boolean);
      } else if (line.includes('|')) {
        rawTokens = line.split('|').map(t => t.trim()).filter(Boolean);
      } else if (line.includes(':')) {
        rawTokens = line.split(':').map(t => t.trim()).filter(Boolean);
      } else {
        rawTokens = [line];
      }

      // If any token has a colon that wasn't split yet (e.g. key:secret in a comma-separated line)
      let tokens = [];
      for (const tok of rawTokens) {
        if (!/^https?:\/\//i.test(tok) && tok.includes(':')) {
          tokens.push(...tok.split(':').map(t => t.trim()).filter(Boolean));
        } else {
          tokens.push(tok);
        }
      }

      // Auto-strip/ignore URLs (e.g. https://m.mangatuh.xyz/share/...)
      const cleanTokens = tokens.filter(tok => !/^https?:\/\//i.test(tok));

      if (cleanTokens.length >= 3) {
        const [t0, t1, t2] = cleanTokens;
        // If t0 contains '@' (email) or t1 starts with 'api_'
        if (t0.includes('@') || /^api_/i.test(t1) || /^key_/i.test(t1)) {
          labelVal = t0;
          keyVal = t1;
          secretVal = t2;
        } else if (/^api_/i.test(t0) || /^key_/i.test(t0)) {
          keyVal = t0;
          secretVal = t1;
          labelVal = t2;
        } else if (t2.includes('@')) {
          keyVal = t0;
          secretVal = t1;
          labelVal = t2;
        } else {
          labelVal = t0;
          keyVal = t1;
          secretVal = t2;
        }
      } else if (cleanTokens.length === 2) {
        keyVal = cleanTokens[0];
        secretVal = cleanTokens[1];
        labelVal = `Scenario Key ${Date.now()}-${i + 1}`;
      }

      if (!keyVal || !secretVal) {
        errorCount++;
        continue;
      }

      try {
        await db.run(
          'INSERT INTO scenario_api_keys (key_value, secret_value, label, is_active) VALUES (?, ?, ?, 1)',
          [keyVal, secretVal, labelVal]
        );
        addedCount++;
      } catch (e) {
        errorCount++;
      }
    }
    await db.run('COMMIT');
    res.json({
      message: `Impor bulk selesai. Ditambahkan: ${addedCount}, Gagal/Duplikat: ${errorCount}`
    });
  } catch (err) {
    await db.run('ROLLBACK');
    res.status(500).json({ message: 'Gagal memproses bulk import Scenario keys.', error: err.message });
  }
});

// Toggle key active status
router.put('/keys/:id/toggle', async (req, res) => {
  const { id } = req.params;
  const { is_active } = req.body;
  try {
    const db = getDb();
    await db.run('UPDATE scenario_api_keys SET is_active = ? WHERE id = ?', [is_active ? 1 : 0, id]);
    res.json({ message: 'Status Scenario API Key berhasil diperbarui.' });
  } catch (err) {
    res.status(500).json({ message: 'Gagal mengubah status key.', error: err.message });
  }
});

// Delete single key
router.delete('/keys/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const db = getDb();
    await db.run('DELETE FROM scenario_api_keys WHERE id = ?', [id]);
    res.json({ message: 'API Key Scenario berhasil dihapus.' });
  } catch (err) {
    res.status(500).json({ message: 'Gagal menghapus API Key Scenario.', error: err.message });
  }
});

// Bulk delete keys
router.post('/keys/bulk-delete', async (req, res) => {
  const { ids } = req.body;
  if (!ids || !Array.isArray(ids) || !ids.length) {
    return res.status(400).json({ message: 'Daftar ID key tidak valid.' });
  }

  try {
    const db = getDb();
    const placeholders = ids.map(() => '?').join(',');
    await db.run(`DELETE FROM scenario_api_keys WHERE id IN (${placeholders})`, ids);
    res.json({ message: `${ids.length} API Key Scenario berhasil dihapus.` });
  } catch (err) {
    res.status(500).json({ message: 'Gagal menghapus key terpilih.', error: err.message });
  }
});

// Test connection of a key
router.post('/keys/test', async (req, res) => {
  const { key_value, secret_value, id } = req.body || {};
  let key = key_value;
  let secret = secret_value;

  try {
    const db = getDb();
    if (id && (!key || !secret)) {
      const row = await db.get('SELECT key_value, secret_value FROM scenario_api_keys WHERE id = ?', [id]);
      if (row) {
        key = row.key_value;
        secret = row.secret_value;
      }
    }

    if (!key || !secret) {
      return res.status(400).json({ message: 'API Key dan Secret diperlukan untuk pengujian.' });
    }

    const testRes = await scenarioClient.testConnection(key, secret);
    if (testRes.ok) {
      if (id) {
        await db.run(
          'UPDATE scenario_api_keys SET last_status = ?, consumption_cu = ?, plan_name = ? WHERE id = ?',
          ['OK - ' + new Date().toLocaleString('id-ID'), testRes.consumption || 0, testRes.plan || 'cu-basic', id]
        );
      }
      return res.json({
        ok: true,
        message: 'Koneksi Scenario API Berhasil!',
        consumption: testRes.consumption,
        plan: testRes.plan
      });
    } else {
      if (id) {
        await db.run('UPDATE scenario_api_keys SET last_status = ? WHERE id = ?', ['Gagal: ' + String(testRes.message).slice(0, 60), id]);
      }
      return res.status(400).json({
        ok: false,
        message: testRes.message || 'Koneksi Scenario gagal.'
      });
    }
  } catch (err) {
    res.status(500).json({ ok: false, message: 'Gagal melakukan tes koneksi Scenario.', error: err.message });
  }
});

module.exports = router;
