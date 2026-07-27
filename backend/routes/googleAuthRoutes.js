// Per-user Google OAuth endpoints. Mounted at /api/google/oauth.
// NOTE: /callback is PUBLIC (Google redirects the browser here, so no JWT header is
// present) — the user identity is carried in a signed `state`. The other routes require
// auth. There is intentionally NO router-wide auth middleware here.
const express = require('express');
const fs = require('fs');
const { getDb } = require('../db');
const { authenticateToken, authenticateTokenAllowQuery } = require('../middleware/authMiddleware');
const googleOAuth = require('../services/googleOAuth');

const router = express.Router();

// Start connect: return the Google consent URL for the current user.
router.get('/url', authenticateToken, async (req, res) => {
  try {
    const db = getDb();
    const conf = await db.get('SELECT * FROM google_settings LIMIT 1');
    const state = googleOAuth.signState(req.user.id);
    const url = googleOAuth.getAuthUrl(conf, state);
    res.json({ url });
  } catch (err) {
    res.status(400).json({ message: err.message || 'Gagal membuat URL koneksi Google.' });
  }
});

// Whether the current user has a connected Google account (+ app-configured flag).
router.get('/status', authenticateToken, async (req, res) => {
  try {
    const db = getDb();
    const acct = await googleOAuth.getAccount(db, req.user.id);
    const conf = await db.get('SELECT client_id, client_secret FROM google_settings LIMIT 1');
    res.json({
      appConfigured: !!(conf && conf.client_id && conf.client_secret),
      connected: !!(acct && acct.refresh_token),
      email: (acct && acct.email) || '',
      name: (acct && acct.name) || '',
      picture: (acct && acct.picture) || '',
      spreadsheetUrl: (acct && acct.spreadsheet_url) || '',
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// List the current user's export spreadsheets (each export = a new sheet).
router.get('/exports', authenticateToken, async (req, res) => {
  try {
    const db = getDb();
    const rows = await googleOAuth.listExports(db, req.user.id);
    res.json(rows || []);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Status of a single export job (owner-only) — used by the Dashboard to poll a job it
// started until it finishes, then show the success popup (Buka / Download / Salin link).
router.get('/exports/:id', authenticateToken, async (req, res) => {
  try {
    const db = getDb();
    const row = await db.get(
      `SELECT id, type, status, spreadsheet_id, spreadsheet_url, title, item_count, total, error, created_at, updated_at,
              (CASE WHEN file_path IS NOT NULL AND file_path != '' THEN 1 ELSE 0 END) AS has_file
       FROM user_google_exports WHERE id = ? AND user_id = ?`,
      [req.params.id, req.user.id]
    );
    if (!row) return res.status(404).json({ message: 'Export tidak ditemukan.' });
    res.json(row);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Download a CSV export file (owner-only). Uses query-token auth so a browser link works.
router.get('/exports/:id/download', authenticateTokenAllowQuery, async (req, res) => {
  try {
    const db = getDb();
    const row = await db.get('SELECT file_path, title FROM user_google_exports WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!row || !row.file_path) return res.status(404).json({ message: 'File export tidak ditemukan.' });
    if (!fs.existsSync(row.file_path)) return res.status(404).json({ message: 'File export sudah tidak tersedia (mungkin dibersihkan).' });
    const safe = String(row.title || 'export').replace(/[^\w.-]+/g, '_').slice(0, 60);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${safe}.csv"`);
    fs.createReadStream(row.file_path).pipe(res);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Disconnect the current user's Google account.
router.post('/disconnect', authenticateToken, async (req, res) => {
  try {
    const db = getDb();
    await googleOAuth.deleteAccount(db, req.user.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUBLIC OAuth callback — Google redirects the browser here with ?code & ?state.
router.get('/callback', async (req, res) => {
  const base = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
  const back = (q) => res.redirect(`${base}/?${q}`);
  try {
    const { code, state, error } = req.query;
    if (error) return back('google=error&reason=' + encodeURIComponent(String(error)));
    if (!code || !state) return back('google=error&reason=missing_code');
    let uid;
    try { uid = googleOAuth.verifyState(state); } catch (e) { return back('google=error&reason=bad_state'); }
    const db = getDb();
    const conf = await db.get('SELECT * FROM google_settings LIMIT 1');
    const tokens = await googleOAuth.exchangeCode(conf, code);
    let profile = {};
    try { profile = await googleOAuth.fetchProfile(conf, tokens); } catch (e) { /* profile best-effort */ }
    await googleOAuth.upsertAccount(db, uid, profile, tokens);
    return back('google=connected');
  } catch (err) {
    return back('google=error&reason=' + encodeURIComponent(String((err && err.message) || 'exchange_failed')));
  }
});

module.exports = router;
