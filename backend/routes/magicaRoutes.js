const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { authenticateToken } = require('../middleware/authMiddleware');
const { getDb } = require('../db');
const { uploadsDir } = require('../config');
const magicaGen = require('../services/magicaGen');

const router = express.Router();
router.use(authenticateToken);

// Save a data:image base64 to /uploads and return its relative path (image-to-3D).
function saveBase64Image(b64) {
  const m = /^data:(image\/(png|jpe?g|webp));base64,(.+)$/i.exec(String(b64 || ''));
  if (!m) return null;
  const ext = m[2].toLowerCase() === 'jpeg' ? 'jpg' : m[2].toLowerCase();
  const name = `3d_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(uploadsDir, name), Buffer.from(m[3], 'base64'));
  return `uploads/${name}`;
}

// Provider-aware catalog for the Generator + Video Studio pickers when a user is on
// Magica: active Magica keys + image/video models with their methods (submodels).
router.get('/catalog', async (req, res) => {
  try {
    const catalog = await magicaGen.getCatalog(getDb());
    res.json(catalog);
  } catch (err) {
    res.status(502).json({ message: 'Gagal mengambil katalog Magica.', error: err.message });
  }
});

// Lightweight active-key list (id, label, balance) for pickers (e.g. the 3D tab).
router.get('/keys', async (req, res) => {
  try {
    const db = getDb();
    const rows = await db.all('SELECT id, label FROM magica_api_keys WHERE is_active = 1 ORDER BY id ASC');
    const bals = await magicaGen.getKeyBalances(db);
    const balById = {};
    bals.forEach((b) => { balById[b.id] = b.balance; });
    res.json(rows.map((r) => {
      const bal = balById[r.id];
      return { id: r.id, label: r.label, balance: bal != null ? bal : null, formatted: bal != null ? (bal / 1e6).toFixed(2) : null };
    }));
  } catch (err) {
    res.status(502).json({ message: 'Gagal mengambil daftar key Magica.', error: err.message });
  }
});

// Estimate a job's credit cost BEFORE generating. Body: { kind:'image'|'video'|'3d',
// model, method, duration, resolution, aspectRatio, hasImage, prompt, targetPolycount, mode }.
router.post('/estimate', async (req, res) => {
  try {
    const db = getDb();
    const key = await magicaGen.pickRandomMagicaKey(db);
    if (!key) return res.status(400).json({ message: 'Belum ada API Key Magica aktif.' });
    const r = await magicaGen.estimateMagicaCost(key.key_value, req.body || {});
    res.json({ microcredits: r.microcredits, credits: r.credits });
  } catch (err) {
    res.status(502).json({ message: 'Gagal estimasi biaya Magica.', error: err.message });
  }
});

// Start a 3D (Meshy V6) generation. Runs in the background; poll GET /3d/task/:id.
router.post('/3d/generate', async (req, res) => {
  const db = getDb();
  try {
    // 3D is open to ALL logged-in users (no per-user Magica permission needed); it only
    // requires the admin to have an active Magica key in the pool.
    const b = req.body || {};
    const mode = b.mode === 'image' ? 'image' : 'text';
    let imageUrls = [];
    if (mode === 'image') {
      if (Array.isArray(b.imageUrls)) imageUrls = b.imageUrls.filter(Boolean);
      if (b.imageBase64) { const p = saveBase64Image(b.imageBase64); if (p) imageUrls.push(p); }
      if (!imageUrls.length) return res.status(400).json({ message: 'Mode gambar butuh minimal 1 gambar.' });
    } else if (!b.prompt) {
      return res.status(400).json({ message: 'Prompt teks wajib diisi untuk 3D.' });
    }

    // Key selection: honor the user's chosen key ('auto' = the highest-balance one).
    const keys = await magicaGen.getKeyBalances(db);
    let best = null;
    const idNum = parseInt(b.magicaKeyId, 10);
    if (b.magicaKeyId && b.magicaKeyId !== 'auto' && Number.isFinite(idNum)) best = keys.find((k) => k.id === idNum) || null;
    if (!best) best = keys.slice().sort((a, c) => c.balance - a.balance)[0];
    if (!best) return res.status(400).json({ message: 'Belum ada API Key Magica aktif. Minta admin menambahkannya di Admin → API Magica.' });

    const ts = () => new Date().toLocaleTimeString('id-ID');
    const startLog = `[${ts()}] Memulai 3D (${mode === 'image' ? 'Image→3D' : 'Text→3D'})...`;
    const ins = await db.run('INSERT INTO generated_3d (user_id, mode, prompt, status, logs) VALUES (?, ?, ?, ?, ?)',
      [req.user.id, mode, b.prompt || null, 'processing', startLog]);
    const id = ins.lastID;
    res.json({ id });

    (async () => {
      // Capture progress so the user can see WHAT is happening (was: silent — no way
      // to tell if a 3D job is still running or why it failed). Persist throttled.
      let logs = startLog;
      let lastWrite = 0;
      const persist = async () => { try { await db.run('UPDATE generated_3d SET logs = ? WHERE id = ?', [logs.slice(-6000), id]); } catch (e) {} };
      const onLog = (m) => {
        logs += `\n[${ts()}] ${m}`;
        const now = Date.now();
        if (now - lastWrite > 1500) { lastWrite = now; persist(); }
      };
      try {
        const r = await magicaGen.generateMeshy3D(best.key_value, {
          mode: b.meshMode, // Meshy 'preview' | 'full' (text mode)
          prompt: b.prompt, imageUrls,
          topology: b.topology, targetPolycount: b.targetPolycount, symmetryMode: b.symmetryMode,
          shouldRemesh: b.shouldRemesh, shouldTexture: b.shouldTexture, enablePbr: b.enablePbr,
          isAtPose: b.isAtPose, riggingHeightMeters: b.riggingHeightMeters, animationActionId: b.animationActionId,
          texturePrompt: b.texturePrompt, enablePromptExpansion: b.enablePromptExpansion,
          onLog,
        });
        logs += `\n[${ts()}] Selesai — model 3D siap (${((r.credit || 0) / 1e6).toFixed(3)} kredit).`;
        await db.run('UPDATE generated_3d SET status = ?, model_url = ?, thumb_url = ?, credit_used = ?, logs = ? WHERE id = ?',
          ['success', r.modelUrl, r.thumbUrl || null, r.credit || 0, logs.slice(-6000), id]);
      } catch (e) {
        logs += `\n[${ts()}] GAGAL: ${e.message || 'error'}`;
        await db.run('UPDATE generated_3d SET status = ?, error_message = ?, logs = ? WHERE id = ?',
          ['failed', String(e.message || 'error').slice(0, 300), logs.slice(-6000), id]);
      }
    })();
  } catch (err) {
    res.status(500).json({ message: 'Gagal memulai 3D.', error: err.message });
  }
});

// Jobs left 'processing' well past the max render time are almost certainly dead
// (e.g. the server restarted mid-job) — flip them to 'failed' so the UI stops
// showing a forever-spinning "stuck" item.
async function failStale3d(db, userId) {
  try {
    await db.run(
      "UPDATE generated_3d SET status = 'failed', error_message = COALESCE(NULLIF(error_message, ''), 'Proses berhenti / timeout (mungkin server sempat restart). Silakan buat lagi.') WHERE user_id = ? AND status = 'processing' AND created_at <= datetime('now', '-30 minutes')",
      [userId]
    );
  } catch (e) { /* best-effort cleanup */ }
}

// Poll one 3D generation.
router.get('/3d/task/:id', async (req, res) => {
  try {
    const db = getDb();
    await failStale3d(db, req.user.id);
    const row = await db.get(
      'SELECT id, mode, prompt, model_url, thumb_url, credit_used, status, error_message, logs, created_at FROM generated_3d WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    if (!row) return res.status(404).json({ message: 'Tidak ditemukan.' });
    res.json(row);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// List this user's 3D generations (newest first).
router.get('/3d/list', async (req, res) => {
  try {
    const db = getDb();
    await failStale3d(db, req.user.id);
    const rows = await db.all(
      'SELECT id, mode, prompt, model_url, thumb_url, credit_used, status, error_message, logs, created_at FROM generated_3d WHERE user_id = ? ORDER BY id DESC LIMIT 60',
      [req.user.id]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Delete one 3D generation from this user's history — works for ANY status,
// including a stuck 'processing' item. Only the owner can delete their own row.
router.delete('/3d/:id', async (req, res) => {
  try {
    const db = getDb();
    const r = await db.run('DELETE FROM generated_3d WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (r && r.changes === 0) return res.status(404).json({ message: 'Item 3D tidak ditemukan.' });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ message: 'Gagal menghapus item 3D.', error: err.message }); }
});

module.exports = router;
