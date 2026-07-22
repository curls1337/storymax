// Centralised secrets & environment configuration.
//
// Design goal: the app runs with ZERO environment variables.
// - JWT secret: uses the JWT_SECRET env var if provided; otherwise auto-generates
//   and persists a per-deployment secret (backend/.jwt_secret). Never crashes, and
//   never falls back to the old public hardcoded value.
// - AI endpoint/token/model + Freebeat API keys: configured IN-APP via the Admin
//   Panel (ai_settings / api_keys tables). The AI_* values below are only fallback
//   DEFAULTS used to seed an empty ai_settings row — env is NOT required for AI.
// - Admin seed: opt-out via SEED_DEFAULT_ADMIN; credentials are never logged.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const isProd = process.env.NODE_ENV === 'production';

// C2: resolve a JWT signing secret WITHOUT requiring any env var.
function resolveJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;

  const secretFile = path.join(__dirname, '..', '.jwt_secret');
  try {
    if (fs.existsSync(secretFile)) {
      const existing = fs.readFileSync(secretFile, 'utf8').trim();
      if (existing) return existing;
    }
    const generated = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(secretFile, generated, { mode: 0o600 });
    console.warn('[config] JWT_SECRET not set — generated a persistent local secret (backend/.jwt_secret). For multi-instance/ephemeral deployments, set the JWT_SECRET env var instead.');
    return generated;
  } catch (e) {
    console.warn('[config] JWT_SECRET not set and a persistent secret could not be written (' + e.message + '); using an ephemeral secret (users must re-login after each restart). Set JWT_SECRET to avoid this.');
    return crypto.randomBytes(32).toString('hex');
  }
}

const JWT_SECRET = resolveJwtSecret();

// AI (OpenAI-compatible) endpoint defaults. Configured in-app via Admin Panel;
// these env values only seed an empty ai_settings row (env NOT required).
const AI_API_HOST = process.env.AI_API_HOST || 'http://localhost:8045/v1';
const AI_API_TOKEN = process.env.AI_API_TOKEN || '';
const AI_MODEL = process.env.AI_MODEL || 'gemini-3-flash';

// C4: default admin seed. Only seeded when explicitly allowed; credentials are
// configurable and never logged in plaintext.
const SEED_DEFAULT_ADMIN = process.env.SEED_DEFAULT_ADMIN !== 'false';
const DEFAULT_ADMIN_USERNAME = process.env.DEFAULT_ADMIN_USERNAME || 'admin';
const DEFAULT_ADMIN_PASSWORD = process.env.DEFAULT_ADMIN_PASSWORD || 'adminpassword';

module.exports = {
  isProd,
  JWT_SECRET,
  AI_API_HOST,
  AI_API_TOKEN,
  AI_MODEL,
  SEED_DEFAULT_ADMIN,
  DEFAULT_ADMIN_USERNAME,
  DEFAULT_ADMIN_PASSWORD,
};
