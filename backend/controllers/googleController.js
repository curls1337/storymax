const { getDb } = require('../db');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { uploadsDir } = require('../config');
const googleOAuth = require('../services/googleOAuth');

async function getGoogleSettings(req, res) {
  try {
    const db = getDb();
    const settings = await db.get('SELECT * FROM google_settings LIMIT 1');
    if (!settings) {
      return res.json({
        client_id: '',
        client_secret: '',
        refresh_token: '',
        spreadsheet_id: '',
        spreadsheet_url: '',
        redirect_uri: '',
        service_account_configured: false,
        service_account_email: '',
        mode: 'none',
        configured: false
      });
    }

    const hasSA = !!settings.service_account_json;
    const hasOAuth = !!(settings.client_id && settings.client_secret && settings.refresh_token);
    let saEmail = '';
    if (hasSA) { try { saEmail = JSON.parse(settings.service_account_json).client_email || ''; } catch (e) {} }
    return res.json({
      client_id: settings.client_id || '',
      client_secret: settings.client_secret ? '••••••••' : '',
      refresh_token: settings.refresh_token ? '••••••••' : '',
      spreadsheet_id: settings.spreadsheet_id || '',
      spreadsheet_url: settings.spreadsheet_url || '',
      redirect_uri: settings.redirect_uri || '',
      service_account_configured: hasSA,
      service_account_email: saEmail,
      mode: hasSA ? 'service_account' : (hasOAuth ? 'oauth' : 'none'),
      configured: hasSA || hasOAuth
    });
  } catch (err) {
    console.error('Error fetching Google settings:', err);
    return res.status(500).json({ message: 'Gagal mengambil pengaturan Google Drive.' });
  }
}

async function saveGoogleSettings(req, res) {
  try {
    const { client_id, client_secret, refresh_token, spreadsheet_id, spreadsheet_url, service_account_json, redirect_uri } = req.body;
    const db = getDb();

    const existing = await db.get('SELECT * FROM google_settings LIMIT 1');

    let finalSecret = client_secret;
    let finalRefresh = refresh_token;
    let finalSA = service_account_json;

    // Preserve existing masked/omitted secrets if the user didn't overwrite them.
    if (existing) {
      if (client_secret === '••••••••' || !client_secret) finalSecret = existing.client_secret;
      if (refresh_token === '••••••••' || !refresh_token) finalRefresh = existing.refresh_token;
      if (service_account_json === '••••••••' || service_account_json == null || service_account_json === '') finalSA = existing.service_account_json;
    }

    // Validate a newly-provided Service Account JSON before saving.
    if (finalSA && finalSA !== (existing && existing.service_account_json)) {
      try {
        const c = JSON.parse(finalSA);
        if (!c.client_email || !c.private_key) throw new Error('missing fields');
      } catch (e) {
        return res.status(400).json({ message: 'Service Account JSON tidak valid (butuh client_email & private_key).' });
      }
    }

    if (existing) {
      await db.run(
        `UPDATE google_settings SET client_id = ?, client_secret = ?, refresh_token = ?, spreadsheet_id = ?, spreadsheet_url = ?, service_account_json = ?, redirect_uri = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [client_id || null, finalSecret || null, finalRefresh || null, spreadsheet_id || null, spreadsheet_url || null, finalSA || null, redirect_uri || null, existing.id]
      );
    } else {
      await db.run(
        `INSERT INTO google_settings (client_id, client_secret, refresh_token, spreadsheet_id, spreadsheet_url, service_account_json, redirect_uri) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [client_id || null, finalSecret || null, finalRefresh || null, spreadsheet_id || null, spreadsheet_url || null, finalSA || null, redirect_uri || null]
      );
    }

    return res.json({ message: 'Pengaturan Google Drive & Sheets berhasil disimpan!' });
  } catch (err) {
    console.error('Error saving Google settings:', err);
    return res.status(500).json({ message: 'Gagal menyimpan pengaturan Google.' });
  }
}

// Public base URL for building absolute image/video links in exports. Declared at
// MODULE top-level so BOTH exportToGoogleSheets and exportToCSV can use it — it was
// previously nested inside exportToGoogleSheets, causing "getPublicApiBase is not
// defined" (500) in exportToCSV.
function getPublicApiBase(req) {
  if (process.env.PUBLIC_URL && process.env.PUBLIC_URL.trim()) {
    return process.env.PUBLIC_URL.replace(/\/$/, '');
  }
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.get('host') || 'localhost:5033';
  return `${protocol}://${host}`;
}

// Build a Google auth client from stored settings. Prefers a Service Account JSON
// (the "just upload one file" flow) when present; otherwise falls back to OAuth2
// (client_id/secret/refresh_token). Returns null when nothing is configured.
function buildGoogleAuth(conf) {
  const SCOPES = ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'];
  if (conf && conf.service_account_json) {
    let creds;
    try { creds = JSON.parse(conf.service_account_json); } catch (e) { throw new Error('Service Account JSON tidak valid (bukan JSON).'); }
    if (!creds.client_email || !creds.private_key) throw new Error('Service Account JSON tidak lengkap (butuh client_email & private_key).');
    return new google.auth.JWT({ email: creds.client_email, key: creds.private_key, scopes: SCOPES });
  }
  if (conf && conf.client_id && conf.client_secret && conf.refresh_token) {
    const o = new google.auth.OAuth2(conf.client_id, conf.client_secret);
    o.setCredentials({ refresh_token: conf.refresh_token });
    return o;
  }
  return null;
}

async function getMarketingCopyForStoryboard(db, sb) {
  // 0. Canonical marketing copy stored on the storyboard (source of truth).
  if (sb.marketing_title) {
    return { title: sb.marketing_title, caption: sb.marketing_description || '' };
  }

  // 1. From a generated video row.
  const videoWithCopy = await db.get(
    'SELECT marketing_title, marketing_description FROM generated_videos WHERE storyboard_id = ? AND marketing_title IS NOT NULL AND marketing_title != "" ORDER BY id DESC LIMIT 1',
    [sb.id]
  );
  if (videoWithCopy && videoWithCopy.marketing_title) {
    return { title: videoWithCopy.marketing_title, caption: videoWithCopy.marketing_description || '' };
  }

  // 2. From video_prompts (older storyboards).
  if (sb.video_prompts) {
    try {
      const parsed = JSON.parse(sb.video_prompts);
      const scenes = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.scenes) ? parsed.scenes : []);
      for (const s of scenes) {
        if (s && s.marketing_title) return { title: s.marketing_title, caption: s.marketing_description || '' };
      }
      if (parsed && !Array.isArray(parsed) && parsed.marketing_title) {
        return { title: parsed.marketing_title, caption: parsed.marketing_description || '' };
      }
    } catch (e) {}
  }

  // 3. AUTO-GENERATE via the AI Marketing Copy engine — the export must use marketing
  // copy, NOT the raw storyboard title/prompt. Persist it so future exports are instant.
  try {
    const { generateMarketingCopyInternal } = require('./videoController'); // lazy require (avoid circular dep)
    const gen = await generateMarketingCopyInternal(sb.id, 0);
    if (gen && gen.title) {
      try {
        await db.run('UPDATE storyboards SET marketing_title = ?, marketing_description = ? WHERE id = ?', [gen.title, gen.description || '', sb.id]);
      } catch (e) {}
      return { title: gen.title, caption: gen.description || '' };
    }
  } catch (e) { /* generation failed — fall through to raw values below */ }

  // 4. Last resort.
  return { title: sb.title || 'Untitled', caption: sb.prompt || '' };
}

// ---- Shared row builders (used by cloud + CSV exports) --------------------------

function absUrl(apiBase, u) {
  u = String(u == null ? '' : u);
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  return u.startsWith('/') ? `${apiBase}${u}` : `${apiBase}/${u}`;
}

// Simple 6-column marketing export (first row = header). Auto-generates marketing copy
// when missing (via getMarketingCopyForStoryboard).
async function buildSimpleRows(db, storyboards, apiBase) {
  const rows = [['Tanggal', 'Judul', 'Caption', 'Link GDrive', 'channel', 'Keyword']];
  for (const sb of storyboards) {
    try {
      const createdDate = new Date(sb.created_at || Date.now()).toLocaleDateString('id-ID');
      const { title, caption } = await getMarketingCopyForStoryboard(db, sb);
      let videoLink = '';
      if (sb.merged_video_url) videoLink = sb.merged_video_url;
      else {
        const latestVid = await db.get('SELECT video_url FROM generated_videos WHERE storyboard_id = ? AND status = "success" ORDER BY id DESC LIMIT 1', [sb.id]);
        videoLink = (latestVid && latestVid.video_url) ? latestVid.video_url : (sb.image_path || '');
      }
      rows.push([createdDate, title, caption, absUrl(apiBase, videoLink), '', '']);
    } catch (e) {
      rows.push([new Date((sb && sb.created_at) || Date.now()).toLocaleDateString('id-ID'), (sb && sb.title) || '', (sb && sb.prompt) || '', '', '', '']);
    }
  }
  return rows;
}

// FULL per-scene export (16 columns): storyboard prompt + per-scene image/video links,
// i2v/t2v prompts, narration, credits, marketing copy, merged video.
async function buildFullRows(db, storyboards, apiBase) {
  const rows = [[
    'Storyboard ID', 'Tanggal', 'Judul', 'Gaya', 'Provider', 'Status', 'Scene',
    'Prompt Storyboard', 'Link Gambar', 'Prompt Image-to-Video', 'Prompt Text-to-Video',
    'Narasi (VO)', 'Link Video', 'Kredit Video', 'Caption Marketing', 'Link Video Gabungan',
  ]];
  for (const sb of storyboards) {
    try {
      const createdDate = new Date(sb.created_at || Date.now()).toLocaleDateString('id-ID');
      const { title, caption } = await getMarketingCopyForStoryboard(db, sb);
      const provider = /magica/i.test(sb.generation_params || '') ? 'Magica' : 'Freebeat';
      let images = [];
      try { images = sb.image_path && sb.image_path.startsWith('[') ? JSON.parse(sb.image_path) : (sb.image_path ? [sb.image_path] : []); } catch (e) { images = sb.image_path ? [sb.image_path] : []; }
      let scenes = [];
      try { const vp = sb.video_prompts ? JSON.parse(sb.video_prompts) : null; scenes = (vp && Array.isArray(vp.scenes)) ? vp.scenes : []; } catch (e) {}
      const vids = await db.all('SELECT scene_idx, video_url, used_credits, status FROM generated_videos WHERE storyboard_id = ? ORDER BY id ASC', [sb.id]);
      const vidByScene = {};
      for (const v of vids) { const cur = vidByScene[v.scene_idx]; if (!cur || v.status === 'success') vidByScene[v.scene_idx] = v; }
      const mergedVideo = absUrl(apiBase, sb.merged_video_url);
      const sceneCount = Math.max(images.length, scenes.length, ...vids.map((v) => (Number(v.scene_idx) || 0) + 1), 1);
      for (let i = 0; i < sceneCount; i++) {
        const sc = scenes.find((s) => s.scene_idx === i) || scenes[i] || {};
        const vid = vidByScene[i] || {};
        rows.push([
          sb.id, createdDate, title, sb.style || '', provider, sb.status || '', String(i + 1),
          i === 0 ? (sb.prompt || '') : '', absUrl(apiBase, images[i]),
          sc.imageToVideoPrompt || '', sc.textToVideoPrompt || '', sc.narration || '',
          absUrl(apiBase, vid.video_url), vid.used_credits != null ? String(vid.used_credits) : '',
          i === 0 ? (caption || '') : '', i === 0 ? mergedVideo : '',
        ]);
      }
    } catch (e) {
      rows.push([(sb && sb.id) || '', '', (sb && sb.title) || '', '', '', '', '', (sb && sb.prompt) || '', '', '', '', '', '', '', '', '']);
    }
  }
  return rows;
}

function rowsToCsv(rows) {
  return '﻿' + rows.map((row) => row.map((f) => `"${String(f == null ? '' : f).replace(/"/g, '""')}"`).join(',')).join('\n');
}

// Save CSV content to disk (uploads/exports) and return the absolute file path.
function saveExportCsv(content, jobId) {
  const dir = path.join(uploadsDir, 'exports');
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
  const file = path.join(dir, `storymax_export_${jobId}_${crypto.randomBytes(4).toString('hex')}.csv`);
  fs.writeFileSync(file, content, 'utf8');
  return file;
}

// ---- Export endpoints (BACKGROUND JOBS) -----------------------------------------
// All three return immediately with a jobId and run the heavy work in the background,
// so large exports (100+) never hit the proxy timeout (502) and survive a tab close.
// Progress/results are recorded in user_google_exports and shown in Settings.

async function exportToGoogleSheets(req, res) {
  try {
    const { storyboardIds } = req.body;
    if (!Array.isArray(storyboardIds) || storyboardIds.length === 0) {
      return res.status(400).json({ message: 'Pilih minimal 1 storyboard untuk diekspor.' });
    }
    const db = getDb();
    const googleConf = (await db.get('SELECT * FROM google_settings LIMIT 1')) || {};

    // Resolve auth (fail fast) — per-user connected account first, else admin global.
    let auth = null;
    try {
      const info = await googleOAuth.getAuthorizedClientForUser(db, req.user.id);
      if (info) auth = info.client;
    } catch (e) { return res.status(400).json({ message: e.message }); }
    if (!auth) {
      auth = buildGoogleAuth(googleConf);
      if (!auth) return res.status(400).json({ message: 'Akun Google Anda belum terhubung. Buka Settings → Hubungkan Akun Google.' });
    }

    const placeholders = storyboardIds.map(() => '?').join(',');
    const storyboards = await db.all(`SELECT * FROM storyboards WHERE id IN (${placeholders}) ORDER BY id DESC`, storyboardIds);
    if (storyboards.length === 0) return res.status(404).json({ message: 'Data storyboard tidak ditemukan.' });

    const stamp = new Date().toLocaleString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const exportTitle = `Storymax Export - ${stamp}`;
    const ins = await db.run('INSERT INTO user_google_exports (user_id, type, status, title, total) VALUES (?, ?, ?, ?, ?)', [req.user.id, 'cloud', 'processing', exportTitle, storyboards.length]);
    const jobId = ins.lastID;
    const apiBase = getPublicApiBase(req);

    res.json({ jobId, status: 'processing', message: 'Export ke Google Sheets dimulai di background. Lihat hasilnya di Settings → Riwayat Export.' });

    (async () => {
      try {
        const sheetsAPI = google.sheets({ version: 'v4', auth });
        const driveAPI = google.drive({ version: 'v3', auth });
        const createRes = await sheetsAPI.spreadsheets.create({ requestBody: { properties: { title: exportTitle }, sheets: [{ properties: { title: 'Storyboard List' } }] } });
        const spreadsheetId = createRes.data.spreadsheetId;
        const spreadsheetUrl = createRes.data.spreadsheetUrl;
        try { await driveAPI.permissions.create({ fileId: spreadsheetId, requestBody: { role: 'writer', type: 'anyone' } }); } catch (e) {}
        const rows = await buildSimpleRows(db, storyboards, apiBase);
        await sheetsAPI.spreadsheets.values.append({ spreadsheetId, range: 'Storyboard List!A1', valueInputOption: 'USER_ENTERED', requestBody: { values: rows } });
        await db.run('UPDATE user_google_exports SET status = ?, spreadsheet_id = ?, spreadsheet_url = ?, item_count = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', ['success', spreadsheetId, spreadsheetUrl, storyboards.length, jobId]);
      } catch (e) {
        console.error('Cloud export job failed:', e && e.message);
        try { await db.run('UPDATE user_google_exports SET status = ?, error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', ['failed', String((e && e.message) || 'error').slice(0, 400), jobId]); } catch (e2) {}
      }
    })();
  } catch (err) {
    console.error('Error starting Google Sheets export:', err);
    return res.status(500).json({ message: err.message || 'Gagal memulai export Google Sheets.' });
  }
}

async function exportCsvJob(req, res, kind) {
  try {
    const { storyboardIds } = req.body;
    if (!Array.isArray(storyboardIds) || storyboardIds.length === 0) {
      return res.status(400).json({ message: 'Pilih minimal 1 storyboard untuk diekspor.' });
    }
    const db = getDb();
    const placeholders = storyboardIds.map(() => '?').join(',');
    const storyboards = await db.all(`SELECT * FROM storyboards WHERE id IN (${placeholders}) ORDER BY id DESC`, storyboardIds);
    if (storyboards.length === 0) return res.status(404).json({ message: 'Data storyboard tidak ditemukan.' });

    const stamp = new Date().toLocaleString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const title = `${kind === 'full' ? 'Storymax Full CSV' : 'Storymax CSV'} - ${stamp}`;
    const ins = await db.run('INSERT INTO user_google_exports (user_id, type, status, title, total) VALUES (?, ?, ?, ?, ?)', [req.user.id, kind === 'full' ? 'full' : 'csv', 'processing', title, storyboards.length]);
    const jobId = ins.lastID;
    const apiBase = getPublicApiBase(req);

    res.json({ jobId, status: 'processing', message: 'CSV sedang dibuat di background. Download nanti di Settings → Riwayat Export.' });

    (async () => {
      try {
        const rows = kind === 'full' ? await buildFullRows(db, storyboards, apiBase) : await buildSimpleRows(db, storyboards, apiBase);
        const file = saveExportCsv(rowsToCsv(rows), jobId);
        await db.run('UPDATE user_google_exports SET status = ?, file_path = ?, item_count = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', ['success', file, storyboards.length, jobId]);
      } catch (e) {
        console.error('CSV export job failed:', e && e.message);
        try { await db.run('UPDATE user_google_exports SET status = ?, error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', ['failed', String((e && e.message) || 'error').slice(0, 400), jobId]); } catch (e2) {}
      }
    })();
  } catch (err) {
    console.error('Error starting CSV export:', err);
    return res.status(500).json({ message: err.message || 'Gagal memulai export CSV.' });
  }
}

async function exportToCSV(req, res) { return exportCsvJob(req, res, 'simple'); }
async function exportFullCSV(req, res) { return exportCsvJob(req, res, 'full'); }

module.exports = {
  getGoogleSettings,
  saveGoogleSettings,
  exportToGoogleSheets,
  exportToCSV,
  exportFullCSV
};
