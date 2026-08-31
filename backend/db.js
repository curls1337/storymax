const { SEED_DEFAULT_ADMIN, DEFAULT_ADMIN_USERNAME, DEFAULT_ADMIN_PASSWORD, AI_API_HOST, AI_API_TOKEN, AI_MODEL } = require('./config/secrets');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const bcrypt = require('bcryptjs');
const path = require('path');

const fs = require('fs');

const dbPath = process.env.SQLITE_DB_PATH 
  ? path.resolve(process.env.SQLITE_DB_PATH) 
  : path.resolve(__dirname, 'database.sqlite');

let db;

async function initDb() {
  const dbDir = path.dirname(dbPath);
  try {
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
  } catch (dirErr) {
    console.warn(`[initDb] Warning: Could not create directory ${dbDir}: ${dirErr.message}`);
  }

  db = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });

  // Enable foreign keys
  await db.run('PRAGMA foreign_keys = ON');

  // Create Users Table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT CHECK(role IN ('admin', 'user')) NOT NULL DEFAULT 'user'
    )
  `);

  // Create API Keys Table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key_value TEXT UNIQUE NOT NULL,
      label TEXT NOT NULL,
      is_active INTEGER DEFAULT 1
    )
  `);

  // Create Magica API Keys Table — SEPARATE pool from Freebeat so none of the
  // existing Freebeat key queries change (zero risk to the working Freebeat flow).
  await db.exec(`
    CREATE TABLE IF NOT EXISTS magica_api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key_value TEXT UNIQUE NOT NULL,
      label TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      last_status TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create Scenario API Keys Table — SEPARATE pool (API Key + API Secret)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS scenario_api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key_value TEXT NOT NULL,
      secret_value TEXT NOT NULL,
      label TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      last_status TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(key_value, secret_value)
    )
  `);

  // Create SeedDance 2.5 Web Cookies / AuthTokens Table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS seedance_cookies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key_value TEXT UNIQUE NOT NULL,
      label TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      last_status TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create SeedDance 2.5 Video Generation History Table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS seedance_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      cookie_id INTEGER,
      task_no TEXT UNIQUE NOT NULL,
      prompt TEXT,
      images TEXT,
      duration INTEGER DEFAULT 30,
      aspect_ratio TEXT DEFAULT '16:9',
      resolution TEXT DEFAULT '720p',
      status TEXT DEFAULT 'processing',
      video_url TEXT,
      cover_url TEXT,
      error_message TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Ensure keys in magica_api_keys remain active
  try {
    await db.run("UPDATE magica_api_keys SET is_active = 1 WHERE is_active = 0 AND (last_status LIKE 'Saldo tinggal%' OR last_status LIKE 'Saldo Habis%')");
  } catch (e) {}

  // 3D generations (Meshy V6 via Magica). model_url = .glb, thumb_url = .png preview.
  await db.exec(`
    CREATE TABLE IF NOT EXISTS generated_3d (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      mode TEXT NOT NULL DEFAULT 'text',
      prompt TEXT,
      model_url TEXT,
      thumb_url TEXT,
      credit_used INTEGER DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'processing',
      error_message TEXT,
      logs TEXT,
      magica_run_id TEXT,
      magica_key_id INTEGER,
      webhook_token TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create Storyboards Table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS storyboards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      image_path TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'success',
      marketing_title TEXT,
      marketing_description TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Create Characters Table (Consistent Character Reference Sheets)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS characters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      tagline TEXT,
      concept TEXT,
      visual_tone TEXT,
      color_palette TEXT,
      profile_notes TEXT,
      turnaround_notes TEXT,
      expressions TEXT,
      wardrobe TEXT,
      production_notes TEXT,
      trigger_prompt TEXT,
      reference_images TEXT,
      sheet_image_url TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Character management upgrade: extended attributes (gender/skin tone), per-character
  // voice identity for VO generation, free-form tags for search/organization, and Sheet
  // Image version history (migration support for existing installs).
  for (const [col, type] of [
    ['gender', 'TEXT'],
    ['skin_tone', 'TEXT'],
    ['attributes_source', "TEXT DEFAULT 'manual'"],
    ['voice_gender', 'TEXT'],
    ['voice_tone', 'TEXT'],
    ['voice_language', 'TEXT'],
    ['voice_notes', 'TEXT'],
    ['tags', 'TEXT'],
    ['sheet_image_history', 'TEXT'],
  ]) {
    try { await db.exec(`ALTER TABLE characters ADD COLUMN ${col} ${type}`); } catch (e) { /* exists */ }
  }

  // Ensure status column exists if table was already created (migration support)
  try {
    await db.exec('ALTER TABLE storyboards ADD COLUMN status TEXT NOT NULL DEFAULT "success"');
  } catch (e) {
    // Column already exists, safe to ignore
  }

  // Ensure character_id column exists in storyboards (migration support)
  try {
    await db.exec('ALTER TABLE storyboards ADD COLUMN character_id INTEGER REFERENCES characters(id)');
  } catch (e) {
    // Column already exists, safe to ignore
  }

  // Ensure task_id column exists in storyboards (migration support)
  try {
    await db.exec('ALTER TABLE storyboards ADD COLUMN task_id TEXT');
  } catch (e) {
    // Column already exists, safe to ignore
  }

  // Ensure active_task_data column exists in storyboards (migration support)
  try {
    await db.exec('ALTER TABLE storyboards ADD COLUMN active_task_data TEXT');
  } catch (e) {
    // Column already exists, safe to ignore
  }

  // Ensure video_prompts column exists if table was already created (migration support)
  try {
    await db.exec('ALTER TABLE storyboards ADD COLUMN video_prompts TEXT');
  } catch (e) {
    // Column already exists, safe to ignore
  }

  // Ensure used_credits column exists if table was already created (migration support)
  try {
    await db.exec('ALTER TABLE storyboards ADD COLUMN used_credits INTEGER DEFAULT 0');
  } catch (e) {
    // Column already exists, safe to ignore
  }

  // Ensure api_key_id column exists if table was already created (migration support)
  try {
    await db.exec('ALTER TABLE storyboards ADD COLUMN api_key_id INTEGER REFERENCES api_keys(id)');
  } catch (e) {
    // Column already exists, safe to ignore
  }

  // Ensure last_status column exists on api_keys (item 2: show last status/log per key)
  try {
    await db.exec('ALTER TABLE api_keys ADD COLUMN last_status TEXT');
  } catch (e) {
    // Column already exists, safe to ignore
  }

  // Multi-provider support: per-user permission to use Magica + the user's chosen
  // provider (freebeat|magica). Admin toggles can_use_magica; the user picks
  // preferred_provider in Settings (only 'magica' when allowed).
  try {
    await db.exec("ALTER TABLE users ADD COLUMN can_use_magica INTEGER DEFAULT 0");
  } catch (e) {
    // Column already exists, safe to ignore
  }
  try {
    await db.exec("ALTER TABLE users ADD COLUMN can_use_scenario INTEGER DEFAULT 1");
  } catch (e) {
    // Column already exists, safe to ignore
  }
  try {
    await db.exec("ALTER TABLE users ADD COLUMN can_use_seedance INTEGER DEFAULT 1");
  } catch (e) {
    // Column already exists, safe to ignore
  }
  try {
    await db.exec("ALTER TABLE users ADD COLUMN allow_hd_resolutions INTEGER DEFAULT 0");
  } catch (e) {
    // Column already exists, safe to ignore
  }
  try {
    await db.exec("ALTER TABLE users ADD COLUMN preferred_provider TEXT DEFAULT 'scenario'");
  } catch (e) {
    // Column already exists, safe to ignore
  }

  // Ensure generation_params column exists if table was already created (migration support)
  try {
    await db.exec('ALTER TABLE storyboards ADD COLUMN generation_params TEXT');
  } catch (e) {
    // Column already exists, safe to ignore
  }

  // Ensure merged_video_url column exists if table was already created (migration support)
  try {
    await db.exec('ALTER TABLE storyboards ADD COLUMN merged_video_url TEXT');
  } catch (e) {
    // Column already exists, safe to ignore
  }

  // Ensure merged_video_history column exists if table was already created (migration support)
  try {
    await db.exec('ALTER TABLE storyboards ADD COLUMN original_cdn_urls TEXT');
  } catch (e) {
    // Column already exists, safe to ignore
  }
  try {
    await db.exec('ALTER TABLE storyboards ADD COLUMN merged_video_history TEXT');
  } catch (e) {
    // Column already exists, safe to ignore
  }

  // Ensure canonical single marketing copy columns exist on storyboards (migration
  // support). ONE title + ONE caption per storyboard — the source of truth for the
  // CSV/Google Sheets export, so it always reflects the latest generated copy.
  try {
    await db.exec('ALTER TABLE storyboards ADD COLUMN marketing_title TEXT');
  } catch (e) {
    // Column already exists, safe to ignore
  }
  try {
    await db.exec('ALTER TABLE storyboards ADD COLUMN marketing_description TEXT');
  } catch (e) {
    // Column already exists, safe to ignore
  }

  // Ensure page_prompts_manifest column exists for full master prompt auditing per page
  try {
    await db.exec('ALTER TABLE storyboards ADD COLUMN page_prompts_manifest TEXT');
  } catch (e) {
    // Column already exists, safe to ignore
  }

  // Create AI Settings Table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS ai_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      endpoint TEXT NOT NULL,
      api_key TEXT NOT NULL,
      model TEXT NOT NULL DEFAULT 'gemini-3-flash'
    )
  `);

  // Ensure model column exists if table was already created (migration support)
  try {
    await db.exec('ALTER TABLE ai_settings ADD COLUMN model TEXT NOT NULL DEFAULT "gemini-3-flash"');
  } catch (e) {
    // Column already exists, safe to ignore
  }

  // LLM provider selection (admin-controlled): 'default' = the OpenAI-compatible
  // endpoint above, 'magica' = route text LLM through the Magica key pool (random key).
  try {
    await db.exec("ALTER TABLE ai_settings ADD COLUMN llm_provider TEXT NOT NULL DEFAULT 'default'");
  } catch (e) { /* column exists */ }
  // Which Magica text model to use when llm_provider = 'magica'.
  try {
    await db.exec("ALTER TABLE ai_settings ADD COLUMN magica_llm_model TEXT NOT NULL DEFAULT 'gemini_3_5_flash'");
  } catch (e) { /* column exists */ }

  // Auto Backup to Google Drive settings
  try {
    await db.exec("ALTER TABLE google_settings ADD COLUMN auto_backup_enabled INTEGER DEFAULT 0");
  } catch (e) { /* column exists */ }
  try {
    await db.exec("ALTER TABLE google_settings ADD COLUMN auto_backup_time TEXT DEFAULT '06:00'");
  } catch (e) { /* column exists */ }
  try {
    await db.exec("ALTER TABLE google_settings ADD COLUMN last_auto_backup TEXT");
  } catch (e) { /* column exists */ }
  try {
    await db.exec("ALTER TABLE google_settings ADD COLUMN last_auto_backup_link TEXT");
  } catch (e) { /* column exists */ }
  try {
    await db.exec("ALTER TABLE google_settings ADD COLUMN last_auto_backup_filename TEXT");
  } catch (e) { /* column exists */ }
  try {
    await db.exec("ALTER TABLE google_settings ADD COLUMN auto_backup_status TEXT DEFAULT 'idle'");
  } catch (e) { /* column exists */ }
  await db.exec(`
    CREATE TABLE IF NOT EXISTS google_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id TEXT,
      client_secret TEXT,
      refresh_token TEXT,
      spreadsheet_id TEXT,
      spreadsheet_url TEXT,
      service_account_json TEXT,
      redirect_uri TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Per-user Google account (OAuth): each StoryMax user connects their OWN Google
  // account; cloud export writes Sheets to THAT user's Drive.
  await db.exec(`
    CREATE TABLE IF NOT EXISTS user_google_accounts (
      user_id INTEGER PRIMARY KEY,
      email TEXT,
      name TEXT,
      picture TEXT,
      access_token TEXT,
      refresh_token TEXT,
      expiry_date INTEGER,
      spreadsheet_id TEXT,
      spreadsheet_url TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Export history per user (BACKGROUND JOBS). type: cloud|csv|full. status:
  // processing|success|failed. Cloud jobs fill spreadsheet_url; CSV jobs fill file_path.
  await db.exec(`
    CREATE TABLE IF NOT EXISTS user_google_exports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type TEXT DEFAULT 'cloud',
      status TEXT DEFAULT 'success',
      spreadsheet_id TEXT,
      spreadsheet_url TEXT,
      file_path TEXT,
      title TEXT,
      item_count INTEGER DEFAULT 0,
      total INTEGER DEFAULT 0,
      error TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Create Downloaded Files Table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS downloaded_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT UNIQUE NOT NULL,
      download_count INTEGER DEFAULT 1,
      last_downloaded_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create Generated Videos Table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS generated_videos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      storyboard_id INTEGER,
      scene_idx INTEGER,
      prompt TEXT NOT NULL,
      model TEXT NOT NULL,
      video_url TEXT,
      aspect_ratio TEXT,
      duration INTEGER,
      resolution TEXT,
      status TEXT NOT NULL,
      task_id TEXT,
      used_credits INTEGER DEFAULT 0,
      api_key_id INTEGER,
      magica_run_id TEXT,
      magica_key_id INTEGER,
      webhook_token TEXT,
      serial_no TEXT,
      marketing_title TEXT,
      marketing_description TEXT,
      marketing_platforms TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (storyboard_id) REFERENCES storyboards(id) ON DELETE CASCADE
    )
  `);

  // Ensure used_credits column exists in generated_videos (migration support)
  try {
    await db.exec('ALTER TABLE generated_videos ADD COLUMN used_credits INTEGER DEFAULT 0');
  } catch (e) {
    // Column already exists, safe to ignore
  }

  // Ensure api_key_id column exists in generated_videos (migration support)
  try {
    await db.exec('ALTER TABLE generated_videos ADD COLUMN api_key_id INTEGER');
  } catch (e) {
    // Column already exists, safe to ignore
  }

  // Ensure serial_no column exists in generated_videos (migration support)
  try {
    await db.exec('ALTER TABLE generated_videos ADD COLUMN serial_no TEXT');
  } catch (e) {
    // Column already exists, safe to ignore
  }

  // Ensure marketing_title column exists in generated_videos (migration support)
  try {
    await db.exec('ALTER TABLE generated_videos ADD COLUMN marketing_title TEXT');
  } catch (e) {
    // Column already exists, safe to ignore
  }

  // Ensure marketing_description column exists in generated_videos (migration support)
  try {
    await db.exec('ALTER TABLE generated_videos ADD COLUMN marketing_description TEXT');
  } catch (e) {
    // Column already exists, safe to ignore
  }

  // Ensure marketing_platforms column exists in generated_videos (migration support)
  // Stores JSON: { tiktok:{title,caption}, instagram:{...}, youtube:{...}, facebook:{...} }
  try {
    await db.exec('ALTER TABLE generated_videos ADD COLUMN marketing_platforms TEXT');
  } catch (e) {
    // Column already exists, safe to ignore
  }

  // Ensure error_message column exists in generated_videos (migration support)
  try {
    await db.exec('ALTER TABLE generated_videos ADD COLUMN error_message TEXT');
  } catch (e) {
    // Column already exists, safe to ignore
  }

  // Ensure logs column exists in generated_videos (migration support)
  try {
    await db.exec('ALTER TABLE generated_videos ADD COLUMN logs TEXT');
  } catch (e) {
    // Column already exists, safe to ignore
  }

  // Ensure logs column exists in generated_3d (migration support)
  try {
    await db.exec('ALTER TABLE generated_3d ADD COLUMN logs TEXT');
  } catch (e) {
    // Column already exists, safe to ignore
  }

  // Webhook support: per-run Magica runId + owning key id + token on video & 3D
  // records, so an async webhook callback can hit the CORRECT key (runId is scoped
  // to the account/key that created it — critical with a multi-key/bulk pool).
  for (const [tbl, col, type] of [
    ['generated_videos', 'magica_run_id', 'TEXT'],
    ['generated_videos', 'magica_key_id', 'INTEGER'],
    ['generated_videos', 'webhook_token', 'TEXT'],
    ['generated_3d', 'magica_run_id', 'TEXT'],
    ['generated_3d', 'magica_key_id', 'INTEGER'],
    ['generated_3d', 'webhook_token', 'TEXT'],
  ]) {
    try { await db.exec(`ALTER TABLE ${tbl} ADD COLUMN ${col} ${type}`); } catch (e) { /* exists */ }
  }

  // Google export can also authenticate via an uploaded Service Account JSON.
  try { await db.exec('ALTER TABLE google_settings ADD COLUMN service_account_json TEXT'); } catch (e) { /* exists */ }
  // Per-user OAuth: admin-configured redirect URI for the consent callback.
  try { await db.exec('ALTER TABLE google_settings ADD COLUMN redirect_uri TEXT'); } catch (e) { /* exists */ }
  // Export jobs (background): extend user_google_exports for status/type/file/error.
  for (const [col, type] of [
    ['type', "TEXT DEFAULT 'cloud'"],
    ['status', "TEXT DEFAULT 'success'"],
    ['file_path', 'TEXT'],
    ['total', 'INTEGER DEFAULT 0'],
    ['error', 'TEXT'],
    ['updated_at', 'TEXT'],
  ]) {
    try { await db.exec(`ALTER TABLE user_google_exports ADD COLUMN ${col} ${type}`); } catch (e) { /* exists */ }
  }

  // Scenario API usage tracking & plan fields
  for (const [col, type] of [
    ['usage_count', 'INTEGER DEFAULT 0'],
    ['consumption_cu', 'INTEGER DEFAULT 0'],
    ['plan_name', 'TEXT'],
  ]) {
    try { await db.exec(`ALTER TABLE scenario_api_keys ADD COLUMN ${col} ${type}`); } catch (e) { /* exists */ }
  }
  try { await db.exec('ALTER TABLE storyboards ADD COLUMN scenario_key_id INTEGER'); } catch (e) { /* exists */ }
  try { await db.exec('ALTER TABLE generated_videos ADD COLUMN scenario_key_id INTEGER'); } catch (e) { /* exists */ }

  // Seed default admin if no users exist
  const adminExists = await db.get('SELECT * FROM users WHERE role = "admin"');
  if (!adminExists && SEED_DEFAULT_ADMIN) {
    const hashedPassword = await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, 10);
    await db.run(
      'INSERT INTO users (username, password, role) VALUES (?, ?, ?)',
      [DEFAULT_ADMIN_USERNAME, hashedPassword, 'admin']
    );
    // C4: never print credentials to logs. Warn only if the insecure default is in use.
    console.log(`--- Default admin '${DEFAULT_ADMIN_USERNAME}' seeded ---`);
    if (DEFAULT_ADMIN_PASSWORD === 'adminpassword') {
      console.warn('[SECURITY] Default admin uses the built-in password. Set DEFAULT_ADMIN_PASSWORD and change it after first login.');
    }
  }

  // Seed default AI settings if none exist
  const aiSettingsExists = await db.get('SELECT * FROM ai_settings LIMIT 1');
  if (!aiSettingsExists) {
    await db.run(
      'INSERT INTO ai_settings (endpoint, api_key, model) VALUES (?, ?, ?)',
      [AI_API_HOST, AI_API_TOKEN, AI_MODEL]
    );
    console.log('--- Default AI Settings Seeded ---');
  }

  // Seed default Magica API key if none exist
  const magicaKeyExists = await db.get('SELECT * FROM magica_api_keys LIMIT 1');
  if (!magicaKeyExists) {
    await db.run(
      'INSERT INTO magica_api_keys (key_value, label, is_active, last_status) VALUES (?, ?, ?, ?)',
      ['gx_7pkrEWVt2KofL8s7VYjML5', 'Primary Magica Key (User Provided)', 1, 'OK - Seeded']
    );
    console.log('--- Default Magica API Key Seeded ---');
  }

  // Auto-migrate all existing users to Scenario provider and ensure can_use_scenario = 1
  try {
    await db.run("UPDATE users SET preferred_provider = 'scenario', can_use_scenario = 1 WHERE preferred_provider != 'scenario' OR preferred_provider IS NULL OR can_use_scenario != 1 OR can_use_scenario IS NULL");
  } catch (e) {
    // safe to ignore
  }

  console.log('Database initialized successfully.');
  return db;
}

function getDb() {
  if (!db) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return db;
}

module.exports = {
  initDb,
  getDb
};
