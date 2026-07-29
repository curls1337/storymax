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
      configured: hasSA || hasOAuth,
      auto_backup_enabled: Number(settings.auto_backup_enabled || 0),
      auto_backup_time: settings.auto_backup_time || '06:00',
      last_auto_backup: settings.last_auto_backup || null,
      last_auto_backup_link: settings.last_auto_backup_link || null,
      last_auto_backup_filename: settings.last_auto_backup_filename || null,
      auto_backup_status: settings.auto_backup_status || 'idle'
    });
  } catch (err) {
    console.error('Error fetching Google settings:', err);
    return res.status(500).json({ message: 'Gagal mengambil pengaturan Google Drive.' });
  }
}

async function saveGoogleSettings(req, res) {
  try {
    const { client_id, client_secret, refresh_token, spreadsheet_id, spreadsheet_url, service_account_json, redirect_uri, auto_backup_enabled, auto_backup_time } = req.body;
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

    const backupEnabledVal = auto_backup_enabled ? 1 : 0;
    const backupTimeVal = auto_backup_time || '06:00';

    if (existing) {
      await db.run(
        `UPDATE google_settings SET client_id = ?, client_secret = ?, refresh_token = ?, spreadsheet_id = ?, spreadsheet_url = ?, service_account_json = ?, redirect_uri = ?, auto_backup_enabled = ?, auto_backup_time = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [client_id || null, finalSecret || null, finalRefresh || null, spreadsheet_id || null, spreadsheet_url || null, finalSA || null, redirect_uri || null, backupEnabledVal, backupTimeVal, existing.id]
      );
    } else {
      await db.run(
        `INSERT INTO google_settings (client_id, client_secret, refresh_token, spreadsheet_id, spreadsheet_url, service_account_json, redirect_uri, auto_backup_enabled, auto_backup_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [client_id || null, finalSecret || null, finalRefresh || null, spreadsheet_id || null, spreadsheet_url || null, finalSA || null, redirect_uri || null, backupEnabledVal, backupTimeVal]
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

// Helper to upload a local or remote media file to Google Drive and return its public Drive webViewLink.
// If Drive auth is null or upload fails, falls back to absUrl(apiBase, u).
async function resolveMediaLink(u, apiBase, auth, folderIdCache = {}) {
  const { Readable } = require('stream');
  u = String(u == null ? '' : u);
  if (!u) return '';
  if (!auth) return absUrl(apiBase, u);

  // If already a Google Drive link, return directly
  if (u.includes('drive.google.com')) return u;

  if (!folderIdCache.uploadedFiles) folderIdCache.uploadedFiles = {};
  if (folderIdCache.uploadedFiles[u]) {
    return folderIdCache.uploadedFiles[u];
  }

  try {
    const driveAPI = google.drive({ version: 'v3', auth });

    // 1. Get or create "Storymax Export Assets" folder in Drive once per export run
    if (!folderIdCache.folderId) {
      try {
        const queryRes = await driveAPI.files.list({
          q: "name = 'Storymax Export Assets' and mimeType = 'application/vnd.google-apps.folder' and trashed = false",
          fields: 'files(id, name)'
        });
        if (queryRes.data.files && queryRes.data.files.length > 0) {
          folderIdCache.folderId = queryRes.data.files[0].id;
        } else {
          const createFolderRes = await driveAPI.files.create({
            requestBody: {
              name: 'Storymax Export Assets',
              mimeType: 'application/vnd.google-apps.folder'
            },
            fields: 'id'
          });
          folderIdCache.folderId = createFolderRes.data.id;
        }
      } catch (e) {
        console.warn('Failed to resolve Google Drive export folder:', e.message);
      }
    }

    let mediaStream = null;
    let filename = 'media_file';
    let mimeType = 'video/mp4';

    const isRemote = /^https?:\/\//i.test(u) && !u.includes('/uploads/');

    if (isRemote) {
      // Remote CDN video/image URL e.g. https://galaxy-prod.tlcdn.com/gen/...mp4
      const remoteRes = await fetch(u);
      if (!remoteRes.ok) throw new Error(`HTTP fetch failed with status ${remoteRes.status}`);
      const arrayBuf = await remoteRes.arrayBuffer();
      mediaStream = Readable.from(Buffer.from(arrayBuf));

      const urlPath = new URL(u).pathname;
      filename = path.basename(urlPath) || `asset_${Date.now()}.mp4`;
      const ext = path.extname(filename).toLowerCase();
      mimeType = ext === '.png' ? 'image/png' : (ext === '.webp' ? 'image/webp' : (ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'video/mp4'));
    } else {
      // Local file in /uploads/
      const relativePath = u.replace(/^https?:\/\/[^\/]+/, '').replace(/^\/?/, '');
      const cleanRelPath = relativePath.replace(/^uploads\//, '');
      const localFilePath = path.join(uploadsDir, cleanRelPath);
      if (!fs.existsSync(localFilePath)) return absUrl(apiBase, u);

      filename = path.basename(localFilePath);
      const ext = path.extname(filename).toLowerCase();
      mimeType = ext === '.mp4' ? 'video/mp4' : (ext === '.webp' ? 'image/webp' : 'image/png');
      mediaStream = fs.createReadStream(localFilePath);
    }

    const fileMetadata = {
      name: filename,
      parents: folderIdCache.folderId ? [folderIdCache.folderId] : []
    };
    const media = {
      mimeType,
      body: mediaStream
    };

    const uploadedFile = await driveAPI.files.create({
      requestBody: fileMetadata,
      media: media,
      fields: 'id, webViewLink'
    });

    const fileId = uploadedFile.data.id;
    // Set public view permission so anyone with link can view/download
    try {
      await driveAPI.permissions.create({
        fileId: fileId,
        requestBody: { role: 'reader', type: 'anyone' }
      });
    } catch (e) {}

    const driveLink = uploadedFile.data.webViewLink || `https://drive.google.com/file/d/${fileId}/view?usp=sharing`;
    folderIdCache.uploadedFiles[u] = driveLink;
    return driveLink;
  } catch (err) {
    console.warn('Failed to upload media to Google Drive, falling back to original URL:', err.message);
    return absUrl(apiBase, u);
  }
}

// Simple 6-column marketing export (first row = header). Auto-generates marketing copy
// when missing (via getMarketingCopyForStoryboard).
async function buildSimpleRows(db, storyboards, apiBase, auth = null) {
  const rows = [['Tanggal', 'Judul', 'Caption', 'Link GDrive', 'channel', 'Keyword']];
  const driveCache = {};
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
      const mediaUrl = await resolveMediaLink(videoLink, apiBase, auth, driveCache);
      rows.push([createdDate, title, caption, mediaUrl, '', '']);
    } catch (e) {
      rows.push([new Date((sb && sb.created_at) || Date.now()).toLocaleDateString('id-ID'), (sb && sb.title) || '', (sb && sb.prompt) || '', '', '', '']);
    }
  }
  return rows;
}

// FULL per-scene export (16 columns): storyboard prompt + per-scene image/video links,
// i2v/t2v prompts, narration, credits, marketing copy, merged video.
async function buildFullRows(db, storyboards, apiBase, auth = null) {
  const rows = [[
    'Storyboard ID', 'Tanggal', 'Judul', 'Gaya', 'Provider', 'Status', 'Scene',
    'Prompt Storyboard', 'Link Gambar', 'Prompt Image-to-Video', 'Prompt Text-to-Video',
    'Narasi (VO)', 'Link Video', 'Kredit Video', 'Caption Marketing', 'Link Video Gabungan',
  ]];
  const driveCache = {};
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
      
      const mergedVideoUrl = await resolveMediaLink(sb.merged_video_url, apiBase, auth, driveCache);
      const sceneCount = Math.max(images.length, scenes.length, ...vids.map((v) => (Number(v.scene_idx) || 0) + 1), 1);
      
      for (let i = 0; i < sceneCount; i++) {
        const sc = scenes.find((s) => s.scene_idx === i) || scenes[i] || {};
        const vid = vidByScene[i] || {};
        const imgUrl = await resolveMediaLink(images[i], apiBase, auth, driveCache);
        const vidUrl = await resolveMediaLink(vid.video_url, apiBase, auth, driveCache);

        rows.push([
          sb.id, createdDate, title, sb.style || '', provider, sb.status || '', String(i + 1),
          i === 0 ? (sb.prompt || '') : '', imgUrl,
          sc.imageToVideoPrompt || '', sc.textToVideoPrompt || '', sc.narration || '',
          vidUrl, vid.used_credits != null ? String(vid.used_credits) : '',
          i === 0 ? (caption || '') : '', i === 0 ? mergedVideoUrl : '',
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
        const rows = await buildSimpleRows(db, storyboards, apiBase, auth);
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
    const googleConf = (await db.get('SELECT * FROM google_settings LIMIT 1')) || {};

    let auth = null;
    try {
      const info = await googleOAuth.getAuthorizedClientForUser(db, req.user.id);
      if (info) auth = info.client;
    } catch (e) {}
    if (!auth) {
      auth = buildGoogleAuth(googleConf);
    }

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
        const rows = kind === 'full' ? await buildFullRows(db, storyboards, apiBase, auth) : await buildSimpleRows(db, storyboards, apiBase, auth);
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

async function performAutoDriveBackup(db) {
  const { generateDatabaseBackupPayload } = require('./adminController');
  const settings = await db.get('SELECT * FROM google_settings LIMIT 1');
  if (!settings) throw new Error('Pengaturan Google Drive belum dikonfigurasi.');

  await db.run("UPDATE google_settings SET auto_backup_status = 'processing' WHERE id = ?", [settings.id]);

  try {
    const auth = buildGoogleAuth(settings);
    if (!auth) throw new Error('Kredensial Google Drive (Service Account / OAuth2) belum disetting.');

    const driveAPI = google.drive({ version: 'v3', auth });

    // 1. Get or create "Storymax Database Backups" folder in Google Drive
    let folderId = null;
    const queryRes = await driveAPI.files.list({
      q: "name = 'Storymax Database Backups' and mimeType = 'application/vnd.google-apps.folder' and trashed = false",
      fields: 'files(id, name)'
    });
    if (queryRes.data.files && queryRes.data.files.length > 0) {
      folderId = queryRes.data.files[0].id;
    } else {
      const createFolderRes = await driveAPI.files.create({
        requestBody: {
          name: 'Storymax Database Backups',
          mimeType: 'application/vnd.google-apps.folder'
        },
        fields: 'id'
      });
      folderId = createFolderRes.data.id;
    }

    // 2. Generate backup JSON payload
    const backupPayload = await generateDatabaseBackupPayload(db);
    const jsonContent = JSON.stringify(backupPayload, null, 2);
    const now = new Date();
    const dateStamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `storymax-db-backup-${dateStamp}.json`;

    const { Readable } = require('stream');
    const mediaStream = Readable.from(Buffer.from(jsonContent, 'utf8'));

    const fileMetadata = {
      name: filename,
      parents: folderId ? [folderId] : []
    };
    const media = {
      mimeType: 'application/json',
      body: mediaStream
    };

    const uploadedFile = await driveAPI.files.create({
      requestBody: fileMetadata,
      media: media,
      fields: 'id, webViewLink'
    });

    const fileId = uploadedFile.data.id;
    try {
      await driveAPI.permissions.create({
        fileId: fileId,
        requestBody: { role: 'reader', type: 'anyone' }
      });
    } catch (e) {}

    const driveLink = uploadedFile.data.webViewLink || `https://drive.google.com/file/d/${fileId}/view?usp=sharing`;
    const lastBackupStamp = new Date().toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'medium' });

    await db.run(
      "UPDATE google_settings SET last_auto_backup = ?, last_auto_backup_link = ?, last_auto_backup_filename = ?, auto_backup_status = 'success' WHERE id = ?",
      [lastBackupStamp, driveLink, filename, settings.id]
    );

    return { filename, driveLink, time: lastBackupStamp };
  } catch (err) {
    try {
      await db.run("UPDATE google_settings SET auto_backup_status = 'failed' WHERE id = ?", [settings.id]);
    } catch (e2) {}
    throw err;
  }
}

async function testAutoDriveBackup(req, res) {
  try {
    const db = getDb();
    const settings = await db.get('SELECT * FROM google_settings LIMIT 1');
    if (!settings) return res.status(400).json({ message: 'Pengaturan Google Drive belum disetting.' });

    await db.run("UPDATE google_settings SET auto_backup_status = 'processing' WHERE id = ?", [settings.id]);

    res.json({
      message: 'Uji Auto Backup sedang berjalan di background...',
      status: 'processing'
    });

    // Execute in background so client gets instant response and polls status
    (async () => {
      try {
        await performAutoDriveBackup(db);
      } catch (e) {
        console.error('Background testAutoDriveBackup failed:', e.message);
      }
    })();
  } catch (err) {
    console.error('Test Auto Backup Error:', err);
    res.status(500).json({ message: err.message || 'Gagal menjalankan Uji Auto Backup ke Google Drive.' });
  }
}

function startAutoBackupCronJob(db) {
  setInterval(async () => {
    try {
      const settings = await db.get('SELECT * FROM google_settings LIMIT 1');
      if (!settings || !settings.auto_backup_enabled) return;

      const targetTime = (settings.auto_backup_time || '06:00').trim();
      const now = new Date();
      const currentHours = String(now.getHours()).padStart(2, '0');
      const currentMinutes = String(now.getMinutes()).padStart(2, '0');
      const currentTimeStr = `${currentHours}:${currentMinutes}`;

      const currentDateStr = now.toISOString().slice(0, 10);
      const lastBackupDate = (settings.last_auto_backup || '').slice(0, 10);

      if (currentTimeStr === targetTime && lastBackupDate !== currentDateStr) {
        console.log(`[Auto Backup] Scheduled trigger at ${currentTimeStr}. Starting database backup to Google Drive...`);
        const res = await performAutoDriveBackup(db);
        console.log(`[Auto Backup SUCCESS] Database backed up to Google Drive: ${res.filename} (${res.driveLink})`);
      }
    } catch (err) {
      console.error('[Auto Backup Error]', err.message);
    }
  }, 60000);
}

module.exports = {
  getGoogleSettings,
  saveGoogleSettings,
  exportToGoogleSheets,
  exportToCSV,
  exportFullCSV,
  testAutoDriveBackup,
  startAutoBackupCronJob
};
