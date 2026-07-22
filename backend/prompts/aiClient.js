// Minimal OpenAI-compatible chat client for prompt generation.
// Reads AI config from the ai_settings table (falls back to env defaults).
const http = require('http');
const https = require('https');
const { AI_API_HOST, AI_API_TOKEN, AI_MODEL } = require('../config/secrets');

async function getAiConfig(db) {
  let host = AI_API_HOST, token = AI_API_TOKEN, model = AI_MODEL;
  try {
    if (db) {
      const s = await db.get('SELECT * FROM ai_settings LIMIT 1');
      if (s) { host = s.endpoint || host; token = s.api_key || token; model = s.model || model; }
    }
  } catch (e) { /* use defaults */ }
  return { host, token, model };
}

function postJson(url, headers, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch (e) { return reject(e); }
    const client = u.protocol === 'https:' ? https : http;
    const req = client.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method: 'POST',
      headers,
      timeout: timeoutMs || 60000,
    }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => resolve({ statusCode: res.statusCode, body: d }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(JSON.stringify(body));
    req.end();
  });
}

// messages: OpenAI-compatible array. Returns assistant text, or throws.
async function chatCompletion(messages, opts = {}) {
  const { db, temperature = 0.6, timeoutMs } = opts;
  const { host, token, model } = await getAiConfig(db);
  if (!token) throw new Error('No AI api_key configured');
  const res = await postJson(
    `${host}/chat/completions`,
    { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    { model, messages, temperature },
    timeoutMs
  );
  if (res.statusCode !== 200) throw new Error(`AI HTTP ${res.statusCode}`);
  const json = JSON.parse(res.body);
  const content = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
  if (!content) throw new Error('Empty AI response');
  return String(content).trim();
}

module.exports = { getAiConfig, chatCompletion };
