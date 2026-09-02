// Minimal OpenAI-compatible chat client for prompt generation.
// Reads AI config from the ai_settings table (falls back to env defaults).
//
// Provider routing (admin-controlled via ai_settings.llm_provider):
//   'default' -> the OpenAI-compatible endpoint below.
//   'magica'  -> route TEXT LLM through the Magica key pool (random key).
// Vision requests (messages carrying an image) ALWAYS use the default endpoint,
// because Magica LLM needs public image URLs and StoryMax sends base64 data URLs.
const http = require('http');
const https = require('https');
const { AI_API_HOST, AI_API_TOKEN, AI_MODEL } = require('../config/secrets');

async function getAiConfig(db) {
  let host = AI_API_HOST, token = AI_API_TOKEN, model = AI_MODEL;
  let provider = 'default', magicaModel = 'gemini_3_5_flash';
  try {
    if (db) {
      const s = await db.get('SELECT * FROM ai_settings LIMIT 1');
      if (s) {
        host = s.endpoint || host; token = s.api_key || token; model = s.model || model;
        provider = s.llm_provider || provider;
        magicaModel = s.magica_llm_model || magicaModel;
      }
    }
  } catch (e) { /* use defaults */ }
  return { host, token, model, provider, magicaModel };
}

// True when any message carries image content (OpenAI vision format). Such requests
// cannot go to Magica (base64 not fetchable) and must use the default endpoint.
function messagesHaveImage(messages) {
  return (messages || []).some((m) => Array.isArray(m.content)
    && m.content.some((p) => p && (p.type === 'image_url' || p.type === 'image' || p.image_url)));
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

// Helper function to extract assistant text content from both standard JSON and SSE stream responses
function parseAiContent(body) {
  if (!body) return '';
  if (typeof body !== 'string') {
    if (typeof body === 'object') {
      return body.choices?.[0]?.message?.content || body.choices?.[0]?.delta?.content || '';
    }
    return '';
  }

  const trimmed = body.trim();
  // 1. Try standard JSON parse
  if (trimmed.startsWith('{')) {
    try {
      const json = JSON.parse(trimmed);
      const content = json.choices?.[0]?.message?.content || json.choices?.[0]?.delta?.content || '';
      if (content) return String(content).trim();
    } catch (e) {}
  }

  // 2. Parse SSE lines (data: {...}) if proxy streams chunks
  let fullContent = '';
  const lines = trimmed.split('\n');
  for (const line of lines) {
    const l = line.trim();
    if (l.startsWith('data: ') && l !== 'data: [DONE]') {
      try {
        const json = JSON.parse(l.substring(6));
        const chunk = json.choices?.[0]?.delta?.content || json.choices?.[0]?.message?.content || '';
        if (chunk) fullContent += chunk;
      } catch (e) {}
    }
  }

  return fullContent.trim();
}

// messages: OpenAI-compatible array. Returns assistant text, or throws.
async function chatCompletion(messages, opts = {}) {
  const { db, temperature = 0.6, timeoutMs } = opts;
  const cfg = await getAiConfig(db);

  if (cfg.provider === 'magica') {
    try {
      const magicaGen = require('../services/magicaGen');
      return await magicaGen.magicaChatCompletion(db, messages, {
        model: cfg.magicaModel, temperature, timeoutMs,
      });
    } catch (magicaErr) {
      console.warn('[AI Client] Magica LLM error, falling back to default proxy:', magicaErr.message);
    }
  }

  if (!cfg.token) throw new Error('No AI api_key configured');
  const res = await postJson(
    `${cfg.host}/chat/completions`,
    { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.token}` },
    { model: cfg.model, messages, temperature },
    timeoutMs
  );
  if (res.statusCode !== 200) throw new Error(`AI HTTP ${res.statusCode}: ${res.body}`);
  const content = parseAiContent(res.body);
  if (!content) throw new Error('Empty AI response');
  return content;
}

// Drop-in for existing callers that build their own OpenAI payload and parse the raw
// HTTP response. Returns { statusCode, body } shaped exactly like /chat/completions.
async function llmChatViaSettings(payload, opts = {}) {
  const { db, timeoutMs } = opts;
  const cfg = await getAiConfig(db);
  const messages = (payload && payload.messages) || [];

  if (cfg.provider === 'magica') {
    try {
      const magicaGen = require('../services/magicaGen');
      const content = await magicaGen.magicaChatCompletion(db, messages, {
        model: cfg.magicaModel,
        temperature: payload.temperature,
        timeoutMs,
      });
      return { statusCode: 200, body: JSON.stringify({ choices: [{ message: { content } }] }) };
    } catch (magicaErr) {
      console.warn('[AI Client] Magica LLM error, falling back to default proxy:', magicaErr.message);
    }
  }

  return postJson(
    `${cfg.host}/chat/completions`,
    { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.token}` },
    { ...payload, model: payload.model || cfg.model },
    timeoutMs
  );
}

module.exports = { getAiConfig, chatCompletion, llmChatViaSettings, messagesHaveImage, parseAiContent };
