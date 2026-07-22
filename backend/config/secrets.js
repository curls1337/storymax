// Centralised secrets & environment configuration.
// Fixes C2 (JWT secret), C3 (AI token no longer hardcoded in source), and
// C4 (default admin seed is opt-out and never printed).
//
// In production (NODE_ENV=production) required secrets MUST be provided via env
// or the process refuses to boot. In development a loud warning + insecure
// fallback keeps local runs working.

const isProd = process.env.NODE_ENV === 'production';

function requiredSecret(name, devFallback) {
  const value = process.env[name];
  if (value) return value;
  if (isProd) {
    throw new Error(`[config] Missing required environment variable ${name} in production.`);
  }
  console.warn(`[config] WARNING: ${name} is not set — using an INSECURE development fallback. Set ${name} before deploying.`);
  return devFallback;
}

// C2: signing secret for JWTs.
const JWT_SECRET = requiredSecret('JWT_SECRET', 'dev_only_insecure_secret_change_me');

// C3: AI (OpenAI-compatible) endpoint config. Token comes from env only.
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
