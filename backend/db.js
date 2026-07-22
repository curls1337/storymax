const { SEED_DEFAULT_ADMIN, DEFAULT_ADMIN_USERNAME, DEFAULT_ADMIN_PASSWORD, AI_API_HOST, AI_API_TOKEN, AI_MODEL } = require('./config/secrets');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const bcrypt = require('bcryptjs');
const path = require('path');

const dbPath = process.env.SQLITE_DB_PATH 
  ? path.resolve(process.env.SQLITE_DB_PATH) 
  : path.resolve(__dirname, 'database.sqlite');

let db;

async function initDb() {
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

  // Create Storyboards Table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS storyboards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      image_path TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'success',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Ensure status column exists if table was already created (migration support)
  try {
    await db.exec('ALTER TABLE storyboards ADD COLUMN status TEXT NOT NULL DEFAULT "success"');
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
    await db.exec('ALTER TABLE storyboards ADD COLUMN merged_video_history TEXT');
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
      serial_no TEXT,
      marketing_title TEXT,
      marketing_description TEXT,
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
