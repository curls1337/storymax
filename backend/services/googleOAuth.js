// Per-user Google OAuth for cloud export. The ADMIN configures the OAuth app once
// (client_id/secret/redirect_uri in google_settings); each SToryMax USER connects their
// OWN Google account (tokens stored per user_id in user_google_accounts). Exports then
// write Sheets to THAT user's Drive. Adapted from the project's previous googleService.js.
const { google } = require('googleapis');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config/secrets');

const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',        // create/manage only files we make
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/userinfo.email',
];

function publicBase() {
  return (process.env.PUBLIC_URL || process.env.APP_URL || '').replace(/\/$/, '');
}

// The OAuth redirect URI must EXACTLY match one registered in the Google OAuth app.
function resolveRedirect(conf) {
  if (conf && conf.redirect_uri && String(conf.redirect_uri).trim()) return String(conf.redirect_uri).trim();
  const base = publicBase();
  return base ? `${base}/api/google/oauth/callback` : 'http://localhost:5033/api/google/oauth/callback';
}

function oauthClient(conf) {
  if (!conf || !conf.client_id || !conf.client_secret) return null;
  return new google.auth.OAuth2(conf.client_id, conf.client_secret, resolveRedirect(conf));
}

// The callback is PUBLIC (no JWT) — the browser is redirected by Google. We carry the
// StoryMax user id in a short-lived SIGNED state so it cannot be forged.
function signState(userId) {
  return jwt.sign({ uid: userId, p: 'goauth' }, JWT_SECRET, { expiresIn: '15m' });
}
function verifyState(state) {
  const d = jwt.verify(state, JWT_SECRET);
  if (!d || d.p !== 'goauth' || !d.uid) throw new Error('state tidak valid');
  return d.uid;
}

function getAuthUrl(conf, state) {
  const client = oauthClient(conf);
  if (!client) throw new Error('OAuth App Google belum dikonfigurasi admin (client_id/secret).');
  return client.generateAuthUrl({ access_type: 'offline', prompt: 'consent', include_granted_scopes: true, scope: SCOPES, state });
}

async function exchangeCode(conf, code) {
  const client = oauthClient(conf);
  if (!client) throw new Error('OAuth App Google belum dikonfigurasi admin.');
  const { tokens } = await client.getToken(code);
  return tokens;
}

async function fetchProfile(conf, tokens) {
  const client = oauthClient(conf);
  client.setCredentials(tokens);
  const oauth2 = google.oauth2({ version: 'v2', auth: client });
  const r = await oauth2.userinfo.get();
  return r.data || {};
}

async function getAccount(db, userId) {
  return db.get('SELECT * FROM user_google_accounts WHERE user_id = ?', [userId]);
}

async function upsertAccount(db, userId, profile, tokens) {
  const existing = await getAccount(db, userId);
  // A refresh_token is only returned on (re)consent — keep the existing one otherwise.
  const refresh = tokens.refresh_token || (existing && existing.refresh_token) || null;
  if (existing) {
    await db.run(
      `UPDATE user_google_accounts SET email=?, name=?, picture=?, access_token=?, refresh_token=?, expiry_date=?, updated_at=CURRENT_TIMESTAMP WHERE user_id=?`,
      [profile.email || existing.email, profile.name || existing.name, profile.picture || existing.picture, tokens.access_token || existing.access_token, refresh, tokens.expiry_date || existing.expiry_date, userId]
    );
  } else {
    await db.run(
      `INSERT INTO user_google_accounts (user_id, email, name, picture, access_token, refresh_token, expiry_date) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [userId, profile.email || null, profile.name || null, profile.picture || null, tokens.access_token || null, refresh, tokens.expiry_date || null]
    );
  }
}

async function deleteAccount(db, userId) {
  await db.run('DELETE FROM user_google_accounts WHERE user_id = ?', [userId]);
}

async function setUserSpreadsheet(db, userId, spreadsheetId, spreadsheetUrl) {
  await db.run('UPDATE user_google_accounts SET spreadsheet_id=?, spreadsheet_url=?, updated_at=CURRENT_TIMESTAMP WHERE user_id=?', [spreadsheetId, spreadsheetUrl, userId]);
}

// Returns { client, account } with a valid (refreshed) access token, or null when the
// user hasn't connected a Google account yet.
async function getAuthorizedClientForUser(db, userId) {
  const conf = await db.get('SELECT * FROM google_settings LIMIT 1');
  const client = oauthClient(conf);
  if (!client) throw new Error('OAuth App Google belum dikonfigurasi admin (client_id/secret).');
  const account = await getAccount(db, userId);
  if (!account || !account.refresh_token) return null;
  client.setCredentials({ access_token: account.access_token, refresh_token: account.refresh_token, expiry_date: account.expiry_date });
  const now = Date.now();
  if (!account.expiry_date || now >= Number(account.expiry_date) - 60000) {
    try {
      const { credentials } = await client.refreshAccessToken();
      client.setCredentials(credentials);
      await db.run('UPDATE user_google_accounts SET access_token=?, expiry_date=?, updated_at=CURRENT_TIMESTAMP WHERE user_id=?', [credentials.access_token, credentials.expiry_date || null, userId]);
      account.access_token = credentials.access_token;
      account.expiry_date = credentials.expiry_date;
    } catch (e) {
      throw new Error('Koneksi Google kadaluarsa atau dicabut. Hubungkan ulang akun Google Anda di Settings.');
    }
  }
  return { client, account };
}

// Record one export (a new spreadsheet) into the user's history.
async function recordExport(db, userId, { spreadsheetId, spreadsheetUrl, title, count }) {
  await db.run(
    'INSERT INTO user_google_exports (user_id, spreadsheet_id, spreadsheet_url, title, item_count) VALUES (?, ?, ?, ?, ?)',
    [userId, spreadsheetId || null, spreadsheetUrl || null, title || null, count || 0]
  );
}

// List a user's export jobs (newest first). Omits the server-side file_path; the UI
// uses the download route by id when type is csv/full and status is success.
async function listExports(db, userId, limit = 50) {
  return db.all(
    `SELECT id, type, status, spreadsheet_id, spreadsheet_url, title, item_count, total, error, created_at, updated_at
     FROM user_google_exports WHERE user_id = ? ORDER BY id DESC LIMIT ?`,
    [userId, limit]
  );
}

module.exports = {
  SCOPES, resolveRedirect, oauthClient, signState, verifyState, getAuthUrl,
  exchangeCode, fetchProfile, getAccount, upsertAccount, deleteAccount,
  setUserSpreadsheet, getAuthorizedClientForUser, recordExport, listExports,
};
