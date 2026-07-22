// API key pool helpers.
const { activeTasks } = require('../state/taskStore');

async function checkAndDisableKeyIfOutofCredits(db, apiKeyId, errorText, taskObj) {
  if (!apiKeyId || !errorText) return;
  const lowerErr = errorText.toLowerCase();
  if (lowerErr.includes('credit') || lowerErr.includes('balance') || lowerErr.includes('insufficient') || lowerErr.includes('limit') || lowerErr.includes('depleted') || lowerErr.includes('payment') || lowerErr.includes('out of')) {
    console.log(`[Auto-Disable API Key] Key ID ${apiKeyId} is out of credits. Disabling key.`);
    try {
      await db.run('UPDATE api_keys SET is_active = 0, last_status = ? WHERE id = ?', ['Kredit habis (nonaktif otomatis) - ' + new Date().toLocaleString('id-ID'), apiKeyId]);
      if (taskObj && taskObj.logs !== undefined) {
        taskObj.logs += `\n[SYSTEM] API Key ID ${apiKeyId} telah dinonaktifkan secara otomatis karena kehabisan/kurang kredit.\n`;
      }
    } catch (e) {
      console.error('Failed to auto-disable API key:', e);
    }
  }
}

async function getAvailableApiKey(db) {
  const activeKeys = await db.all('SELECT * FROM api_keys WHERE is_active = 1');
  if (activeKeys.length === 0) return null;

  // Filter out keys that are currently busy in activeTasks
  const busyKeyIds = Object.values(activeTasks)
    .filter(task => task.status === 'processing')
    .map(task => parseInt(task.apiKeyId));

  const freeKeys = activeKeys.filter(k => !busyKeyIds.includes(parseInt(k.id)));
  const pool = freeKeys.length > 0 ? freeKeys : activeKeys;
  // Pick RANDOMLY (not sequentially) so auto key selection rotates/acak.
  return pool[Math.floor(Math.random() * pool.length)];
}

// Record the latest status/log for an API key (item 2).
async function setKeyStatus(db, keyId, status) {
  if (!keyId) return;
  try {
    await db.run('UPDATE api_keys SET last_status = ? WHERE id = ?', [String(status).slice(0, 200), keyId]);
  } catch (e) { /* best effort */ }
}

module.exports = { checkAndDisableKeyIfOutofCredits, getAvailableApiKey, setKeyStatus };
