// PUBLIC Magica webhook receiver (NO JWT auth — it's called by Magica, not a browser).
// Mounted in server.js BEFORE the authenticated /api/magica router.
//
// Security without a dashboard signing secret (API-only): every run is started with a
// per-run random token stored on its DB record and echoed back in `metadata`. We only
// act when metadata.token matches the stored webhook_token AND the record is still
// 'processing'. We also complete the record using the EXACT key that started the run
// (magica_key_id) — because a Magica runId is scoped to the account/key that created it
// (essential with a multi-key/bulk pool).
//
// Polling remains the primary completion path; this webhook is a robustness upgrade so
// a job still completes even if the polling process died (e.g. a server restart).
const express = require('express');
const { getDb } = require('../db');
const magica = require('../services/magicaClient');
const magicaGen = require('../services/magicaGen');

const router = express.Router();

router.post('/', async (req, res) => {
  // Respond 200 immediately so Svix doesn't retry; process afterwards.
  res.status(200).json({ ok: true });
  try {
    const ev = req.body || {};
    const md = ev.metadata || {};
    if (!md || md.app !== 'storymax' || !md.recId || !md.kind || !md.token) return;

    const db = getDb();
    const table = md.kind === '3d' ? 'generated_3d' : (md.kind === 'video' ? 'generated_videos' : null);
    if (!table) return;

    const row = await db.get(`SELECT * FROM ${table} WHERE id = ?`, [md.recId]);
    if (!row) return;
    if (String(row.webhook_token || '') !== String(md.token)) return; // auth: token must match
    if (row.status !== 'processing') return;                          // idempotent

    const type = ev.type;

    if (type === 'run.failed') {
      const detail = ev.error ? (typeof ev.error === 'object' ? JSON.stringify(ev.error) : String(ev.error)) : 'Run gagal (via webhook).';
      const msg = detail.slice(0, 500);
      if (md.kind === '3d') {
        await db.run("UPDATE generated_3d SET status='failed', error_message=?, logs=COALESCE(logs,'') || ? WHERE id=? AND status='processing'", [msg, `\n[webhook] GAGAL: ${msg}`, md.recId]);
      } else {
        await db.run("UPDATE generated_videos SET status='failed', error_message=?, logs=COALESCE(logs,'') || ? WHERE id=? AND status='processing'", [msg, `\n[webhook] GAGAL: ${msg}`, md.recId]);
      }
      return;
    }

    if (type === 'run.completed') {
      // Fetch the output with the SAME key that owns this runId (account-scoped).
      const runId = ev.runId || row.magica_run_id;
      const keyRow = row.magica_key_id ? await db.get('SELECT key_value FROM magica_api_keys WHERE id = ?', [row.magica_key_id]) : null;
      const key = keyRow && keyRow.key_value;
      if (!key || !runId) return; // can't fetch output — leave for polling/stale-cleanup

      let run;
      try { run = await magica.getRun(key, runId); } catch (e) { return; }

      if (md.kind === '3d') {
        const { modelUrl, thumbUrl, credit } = magicaGen.extractMeshyResult(run);
        if (!modelUrl) return;
        await db.run("UPDATE generated_3d SET status='success', model_url=?, thumb_url=?, credit_used=?, logs=COALESCE(logs,'') || ? WHERE id=? AND status='processing'", [modelUrl, thumbUrl || null, credit || 0, '\n[webhook] Selesai.', md.recId]);
      } else {
        const url = magica.extractMediaUrls(run)[0];
        if (!url) return;
        const credit = Number((run && run.creditUsed) || (run && run.output && run.output.creditUsed)) || 0;
        await db.run("UPDATE generated_videos SET status='success', video_url=?, used_credits=? WHERE id=? AND status='processing'", [url, credit, md.recId]);
      }
    }
  } catch (e) { /* already responded 200; nothing else to do */ }
});

module.exports = router;
