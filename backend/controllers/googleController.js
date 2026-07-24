const { getDb } = require('../db');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

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
        configured: false
      });
    }

    return res.json({
      client_id: settings.client_id || '',
      client_secret: settings.client_secret ? '••••••••' : '',
      refresh_token: settings.refresh_token ? '••••••••' : '',
      spreadsheet_id: settings.spreadsheet_id || '',
      spreadsheet_url: settings.spreadsheet_url || '',
      configured: !!(settings.client_id && settings.client_secret && settings.refresh_token)
    });
  } catch (err) {
    console.error('Error fetching Google settings:', err);
    return res.status(500).json({ message: 'Gagal mengambil pengaturan Google Drive.' });
  }
}

async function saveGoogleSettings(req, res) {
  try {
    const { client_id, client_secret, refresh_token, spreadsheet_id, spreadsheet_url } = req.body;
    const db = getDb();

    const existing = await db.get('SELECT * FROM google_settings LIMIT 1');

    let finalSecret = client_secret;
    let finalRefresh = refresh_token;

    // Preserve existing masked secrets if user didn't overwrite them
    if (existing) {
      if (client_secret === '••••••••' || !client_secret) {
        finalSecret = existing.client_secret;
      }
      if (refresh_token === '••••••••' || !refresh_token) {
        finalRefresh = existing.refresh_token;
      }
    }

    if (existing) {
      await db.run(
        `UPDATE google_settings SET client_id = ?, client_secret = ?, refresh_token = ?, spreadsheet_id = ?, spreadsheet_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [client_id, finalSecret, finalRefresh, spreadsheet_id || null, spreadsheet_url || null, existing.id]
      );
    } else {
      await db.run(
        `INSERT INTO google_settings (client_id, client_secret, refresh_token, spreadsheet_id, spreadsheet_url) VALUES (?, ?, ?, ?, ?)`,
        [client_id, finalSecret, finalRefresh, spreadsheet_id || null, spreadsheet_url || null]
      );
    }

    return res.json({ message: 'Pengaturan Google Drive & Sheets berhasil disimpan!' });
  } catch (err) {
    console.error('Error saving Google settings:', err);
    return res.status(500).json({ message: 'Gagal menyimpan pengaturan Google.' });
  }
}

async function getMarketingCopyForStoryboard(db, sb) {
  let title = sb.title || 'Untitled';
  let caption = sb.prompt || '';

  // 0. Canonical single marketing copy stored on the storyboard itself (written by
  // every generate/regenerate). Source of truth so the export ALWAYS reflects the
  // latest copy — not an older per-video row.
  if (sb.marketing_title) {
    return { title: sb.marketing_title, caption: sb.marketing_description || '' };
  }

  // 1. Try to fetch from generated_videos
  const videoWithCopy = await db.get(
    'SELECT marketing_title, marketing_description FROM generated_videos WHERE storyboard_id = ? AND marketing_title IS NOT NULL AND marketing_title != "" ORDER BY id DESC LIMIT 1',
    [sb.id]
  );

  if (videoWithCopy && videoWithCopy.marketing_title) {
    title = videoWithCopy.marketing_title;
    caption = videoWithCopy.marketing_description || '';
  } else if (sb.video_prompts) {
    // 2. Try to parse from video_prompts
    try {
      const parsed = JSON.parse(sb.video_prompts);
      if (Array.isArray(parsed)) {
        for (const s of parsed) {
          if (s.marketing_title) {
            title = s.marketing_title;
            caption = s.marketing_description || '';
            break;
          }
        }
      } else if (parsed && typeof parsed === 'object') {
        if (parsed.marketing_title) title = parsed.marketing_title;
        if (parsed.marketing_description) caption = parsed.marketing_description;
      }
    } catch (e) {}
  }

  return { title, caption };
}

async function exportToGoogleSheets(req, res) {
  try {
    const { storyboardIds } = req.body;
    if (!Array.isArray(storyboardIds) || storyboardIds.length === 0) {
      return res.status(400).json({ message: 'Pilih minimal 1 storyboard untuk diekspor.' });
    }

    const db = getDb();
    const googleConf = await db.get('SELECT * FROM google_settings LIMIT 1');

    if (!googleConf || !googleConf.client_id || !googleConf.client_secret || !googleConf.refresh_token) {
      return res.status(400).json({
        message: 'Kredensial Google Drive/Sheets belum dikonfigurasi oleh Admin di menu Pengaturan.'
      });
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

    // Setup OAuth2 Client
    const oauth2Client = new google.auth.OAuth2(
      googleConf.client_id,
      googleConf.client_secret
    );
    oauth2Client.setCredentials({ refresh_token: googleConf.refresh_token });

    const sheetsAPI = google.sheets({ version: 'v4', auth: oauth2Client });
    const driveAPI = google.drive({ version: 'v3', auth: oauth2Client });

    let spreadsheetId = googleConf.spreadsheet_id;
    let spreadsheetUrl = googleConf.spreadsheet_url;

    // Create new spreadsheet if not existing
    if (!spreadsheetId) {
      const todayStr = new Date().toLocaleDateString('id-ID');
      const createRes = await sheetsAPI.spreadsheets.create({
        requestBody: {
          properties: {
            title: `Storymax Export - ${todayStr}`
          },
          sheets: [
            { properties: { title: 'Storyboard List' } }
          ]
        }
      });

      spreadsheetId = createRes.data.spreadsheetId;
      spreadsheetUrl = createRes.data.spreadsheetUrl;

      // Make spreadsheet shareable (anyone with link can view/edit)
      try {
        await driveAPI.permissions.create({
          fileId: spreadsheetId,
          requestBody: {
            role: 'writer',
            type: 'anyone'
          }
        });
      } catch (e) {
        console.warn('Could not set public permission on spreadsheet:', e.message);
      }

      // Save spreadsheet ID back to google_settings
      await db.run('UPDATE google_settings SET spreadsheet_id = ?, spreadsheet_url = ? WHERE id = ?', [
        spreadsheetId,
        spreadsheetUrl,
        googleConf.id
      ]);
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

function getPublicApiBase(req) {
  if (process.env.PUBLIC_URL && process.env.PUBLIC_URL.trim()) {
    return process.env.PUBLIC_URL.replace(/\/$/, '');
  }
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.get('host') || 'localhost:5033';
  return `${protocol}://${host}`;
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

    return res.json({
      success: true,
      message: `Berhasil mengekspor ${storyboards.length} storyboard ke Google Sheets!`,
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
    console.error('Error exporting to CSV:', err);
    return res.status(500).json({ message: 'Gagal mengekspor data ke CSV.' });
  }
}

module.exports = {
  getGoogleSettings,
  saveGoogleSettings,
  exportToGoogleSheets,
  exportToCSV
};
