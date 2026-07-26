const { getDb } = require('../db');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
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

async function exportToGoogleSheets(req, res) {
  try {
    const { storyboardIds } = req.body;
    if (!Array.isArray(storyboardIds) || storyboardIds.length === 0) {
      return res.status(400).json({ message: 'Pilih minimal 1 storyboard untuk diekspor.' });
    }

    const db = getDb();
    const googleConf = (await db.get('SELECT * FROM google_settings LIMIT 1')) || {};

    // Prefer the CURRENT user's OWN connected Google account (per-user). Fall back to
    // the admin global creds (Service Account / OAuth) only if the user isn't connected.
    let auth = null; let perUser = false; let account = null;
    try {
      const info = await googleOAuth.getAuthorizedClientForUser(db, req.user.id);
      if (info) { auth = info.client; account = info.account; perUser = true; }
    } catch (e) {
      return res.status(400).json({ message: e.message });
    }
    if (!auth) {
      auth = buildGoogleAuth(googleConf);
      if (!auth) {
        return res.status(400).json({
          message: 'Akun Google Anda belum terhubung. Buka Settings → Hubungkan Akun Google (atau minta Admin mengatur kredensial global).'
        });
      }
    }

    // Load storyboards to export
    const placeholders = storyboardIds.map(() => '?').join(',');
    const storyboards = await db.all(
      `SELECT * FROM storyboards WHERE id IN (${placeholders}) ORDER BY id DESC`,
      storyboardIds
    );

    if (storyboards.length === 0) {
      return res.status(404).json({ message: 'Data storyboard tidak ditemukan.' });
    }

    const sheetsAPI = google.sheets({ version: 'v4', auth });
    const driveAPI = google.drive({ version: 'v3', auth });

    // Each export creates a BRAND-NEW spreadsheet (so exports never overwrite/merge, and
    // the user can tell them apart). We do NOT reuse a previous sheet.
    const stamp = new Date().toLocaleString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const exportTitle = `Storymax Export - ${stamp}`;
    const createRes = await sheetsAPI.spreadsheets.create({
      requestBody: {
        properties: { title: exportTitle },
        sheets: [{ properties: { title: 'Storyboard List' } }],
      },
    });
    let spreadsheetId = createRes.data.spreadsheetId;
    let spreadsheetUrl = createRes.data.spreadsheetUrl;

    // Share as editor (anyone with the link can edit) — not private.
    try {
      await driveAPI.permissions.create({ fileId: spreadsheetId, requestBody: { role: 'writer', type: 'anyone' } });
    } catch (e) {
      console.warn('Could not set public permission on spreadsheet:', e.message);
    }

    const sheetName = 'Storyboard List';

    // Check if headers exist
    let hasHeaders = false;
    try {
      const headerRes = await sheetsAPI.spreadsheets.values.get({
        spreadsheetId,
        range: `${sheetName}!A1:F1`
      });
      hasHeaders = headerRes.data.values && headerRes.data.values.length > 0;
    } catch (e) {
      hasHeaders = false;
    }

    const rowsToAppend = [];
    if (!hasHeaders) {
      rowsToAppend.push([
        'Tanggal',
        'Judul',
        'Caption',
        'Link GDrive',
        'channel',
        'Keyword'
      ]);
    }

    // Base URL for image/video link resolution (dynamic domain)
    const apiBase = getPublicApiBase(req);

    for (const sb of storyboards) {
      const createdDate = new Date(sb.created_at || Date.now()).toLocaleDateString('id-ID');
      const { title, caption } = await getMarketingCopyForStoryboard(db, sb);

      // Auto-detect video link: merged video URL or single scene video URL
      let videoLink = '';
      if (sb.merged_video_url) {
        videoLink = sb.merged_video_url;
      } else {
        const latestVid = await db.get(
          'SELECT video_url FROM generated_videos WHERE storyboard_id = ? AND status = "success" ORDER BY id DESC LIMIT 1',
          [sb.id]
        );
        if (latestVid && latestVid.video_url) {
          videoLink = latestVid.video_url;
        } else {
          videoLink = sb.image_path || '';
        }
      }

      if (videoLink) {
        if (videoLink.startsWith('/')) {
          videoLink = `${apiBase}${videoLink}`;
        } else if (!videoLink.startsWith('http')) {
          videoLink = `${apiBase}/${videoLink}`;
        }
      }

      rowsToAppend.push([
        createdDate,
        title,
        caption,
        videoLink,
        '', // channel empty
        ''  // Keyword empty
      ]);
    }

    // Append rows to sheet
    await sheetsAPI.spreadsheets.values.append({
      spreadsheetId,
      range: `${sheetName}!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: rowsToAppend
      }
    });

    // Record this export in the user's history (shown in Settings).
    try { await googleOAuth.recordExport(db, req.user.id, { spreadsheetId, spreadsheetUrl, title: exportTitle, count: storyboards.length }); } catch (e) {}

    return res.json({
      success: true,
      message: `Berhasil mengekspor ${storyboards.length} storyboard ke Google Sheets baru!`,
      spreadsheetId,
      spreadsheetUrl,
      count: storyboards.length
    });
  } catch (err) {
    console.error('Error exporting to Google Sheets:', err);
    return res.status(500).json({
      message: err.message || 'Gagal mengekspor data ke Google Sheets.'
    });
  }
}

async function exportToCSV(req, res) {
  try {
    const { storyboardIds } = req.body;
    if (!Array.isArray(storyboardIds) || storyboardIds.length === 0) {
      return res.status(400).json({ message: 'Pilih minimal 1 storyboard untuk diekspor.' });
    }

    const db = getDb();
    const placeholders = storyboardIds.map(() => '?').join(',');
    const storyboards = await db.all(
      `SELECT * FROM storyboards WHERE id IN (${placeholders}) ORDER BY id DESC`,
      storyboardIds
    );

    if (storyboards.length === 0) {
      return res.status(404).json({ message: 'Data storyboard tidak ditemukan.' });
    }

    const apiBase = getPublicApiBase(req);

    // Header matching autoclip reference exactly
    const rows = [
      ['Tanggal', 'Judul', 'Caption', 'Link GDrive', 'channel', 'Keyword']
    ];

    for (const sb of storyboards) {
      try {
        const createdDate = new Date(sb.created_at || Date.now()).toLocaleDateString('id-ID');
        const { title, caption } = await getMarketingCopyForStoryboard(db, sb);

        // Auto-detect video link: merged video URL or single scene video URL
        let videoLink = '';
        if (sb.merged_video_url) {
          videoLink = sb.merged_video_url;
        } else {
          const latestVid = await db.get(
            'SELECT video_url FROM generated_videos WHERE storyboard_id = ? AND status = "success" ORDER BY id DESC LIMIT 1',
            [sb.id]
          );
          if (latestVid && latestVid.video_url) {
            videoLink = latestVid.video_url;
          } else {
            videoLink = sb.image_path || '';
          }
        }

        if (videoLink) {
          if (videoLink.startsWith('/')) {
            videoLink = `${apiBase}${videoLink}`;
          } else if (!videoLink.startsWith('http')) {
            videoLink = `${apiBase}/${videoLink}`;
          }
        }

        rows.push([
          createdDate,
          title,
          caption,
          videoLink,
          '', // channel empty
          ''  // Keyword empty
        ]);
      } catch (rowErr) {
        // One bad storyboard must NOT fail the whole export — degrade this row instead.
        console.error('CSV row failed for storyboard', sb && sb.id, rowErr && rowErr.message);
        rows.push([
          new Date((sb && sb.created_at) || Date.now()).toLocaleDateString('id-ID'),
          (sb && sb.title) || '',
          (sb && sb.prompt) || '',
          '', '', ''
        ]);
      }
    }

    // Format into standard CSV string
    const csvContent = rows.map(row => 
      row.map(field => {
        const str = String(field || '').replace(/"/g, '""');
        return `"${str}"`;
      }).join(',')
    ).join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="storyboards_export.csv"');
    return res.send(csvContent);
  } catch (err) {
    // Surface the real cause so an opaque 500 is diagnosable from the client too.
    console.error('Error exporting to CSV:', err);
    return res.status(500).json({ message: 'Gagal mengekspor data ke CSV.', error: String((err && err.message) || err) });
  }
}

// FULL export: one tidy row PER SCENE with everything — storyboard prompt, per-scene
// image link, image-to-video & text-to-video prompts, narration, video link, credits,
// marketing copy, and the merged video link. Media are LINKS only (no files bundled).
async function exportFullCSV(req, res) {
  try {
    const { storyboardIds } = req.body;
    if (!Array.isArray(storyboardIds) || storyboardIds.length === 0) {
      return res.status(400).json({ message: 'Pilih minimal 1 storyboard untuk diekspor.' });
    }
    const db = getDb();
    const placeholders = storyboardIds.map(() => '?').join(',');
    const storyboards = await db.all(
      `SELECT * FROM storyboards WHERE id IN (${placeholders}) ORDER BY id DESC`,
      storyboardIds
    );
    if (storyboards.length === 0) return res.status(404).json({ message: 'Data storyboard tidak ditemukan.' });

    const apiBase = getPublicApiBase(req);
    const abs = (u) => {
      u = String(u == null ? '' : u);
      if (!u) return '';
      if (/^https?:\/\//i.test(u)) return u;
      return u.startsWith('/') ? `${apiBase}${u}` : `${apiBase}/${u}`;
    };

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
        try { images = sb.image_path && sb.image_path.startsWith('[') ? JSON.parse(sb.image_path) : (sb.image_path ? [sb.image_path] : []); }
        catch (e) { images = sb.image_path ? [sb.image_path] : []; }

        let scenes = [];
        try { const vp = sb.video_prompts ? JSON.parse(sb.video_prompts) : null; scenes = (vp && Array.isArray(vp.scenes)) ? vp.scenes : []; } catch (e) {}

        const vids = await db.all('SELECT scene_idx, video_url, used_credits, status FROM generated_videos WHERE storyboard_id = ? ORDER BY id ASC', [sb.id]);
        const vidByScene = {};
        for (const v of vids) { const cur = vidByScene[v.scene_idx]; if (!cur || v.status === 'success') vidByScene[v.scene_idx] = v; }
        const mergedVideo = abs(sb.merged_video_url);

        const sceneCount = Math.max(images.length, scenes.length, ...vids.map((v) => (Number(v.scene_idx) || 0) + 1), 1);
        for (let i = 0; i < sceneCount; i++) {
          const sc = scenes.find((s) => s.scene_idx === i) || scenes[i] || {};
          const vid = vidByScene[i] || {};
          rows.push([
            sb.id,
            createdDate,
            title,
            sb.style || '',
            provider,
            sb.status || '',
            String(i + 1),
            i === 0 ? (sb.prompt || '') : '',
            abs(images[i]),
            sc.imageToVideoPrompt || '',
            sc.textToVideoPrompt || '',
            sc.narration || '',
            abs(vid.video_url),
            vid.used_credits != null ? String(vid.used_credits) : '',
            i === 0 ? (caption || '') : '',
            i === 0 ? mergedVideo : '',
          ]);
        }
      } catch (rowErr) {
        console.error('Full CSV row failed for storyboard', sb && sb.id, rowErr && rowErr.message);
        rows.push([(sb && sb.id) || '', '', (sb && sb.title) || '', '', '', '', '', (sb && sb.prompt) || '', '', '', '', '', '', '', '', '']);
      }
    }

    const csvContent = rows.map((row) =>
      row.map((field) => `"${String(field == null ? '' : field).replace(/"/g, '""')}"`).join(',')
    ).join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="storymax_full_export.csv"');
    return res.send('﻿' + csvContent); // UTF-8 BOM so Excel renders Indonesian text cleanly
  } catch (err) {
    console.error('Error exporting full CSV:', err);
    return res.status(500).json({ message: 'Gagal mengekspor data (full).', error: String((err && err.message) || err) });
  }
}

module.exports = {
  getGoogleSettings,
  saveGoogleSettings,
  exportToGoogleSheets,
  exportToCSV,
  exportFullCSV
};
