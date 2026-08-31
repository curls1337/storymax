const path = require('path');
const fs = require('fs');
const { getDb } = require('../db');
const { uploadsDir } = require('../config');
const { chatCompletion } = require('../prompts/aiClient');
const magicaGen = require('../services/magicaGen');
const scenarioGen = require('../services/scenarioGen');
const { getAvailableApiKey } = require('../services/keyPool');
const { freebeatSizeArgs } = require('../services/freebeat/cli');
const { downloadFile } = require('../services/download');
const { spawn } = require('child_process');

// Item 2: multi-angle reference photos, capped at 3 (matches Freebeat's own reference
// limit; Magica's true per-model cap is schema-driven via `maxImages` and can be lower,
// so 3 is used as a safe common ceiling that works for both providers).
const MAX_REFERENCE_IMAGES = 3;
// Item 4: how many previous Sheet Image renders to keep in version history before the
// oldest is pruned (and its local file deleted as an orphan-cleanup side effect).
const MAX_SHEET_HISTORY = 8;

function _spawnCollect(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    let out = '', err = '';
    const child = spawn(cmd, args, { shell: true, ...opts });
    child.stdout.on('data', (c) => (out += c.toString()));
    child.stderr.on('data', (c) => (err += c.toString()));
    child.on('close', (code) => resolve({ code, out, err }));
    child.on('error', (e) => resolve({ code: 1, out, err: e.message }));
  });
}

// Downloads a remotely-generated AI image into local /uploads storage with a short
// retry, so a single flaky network blip doesn't leave a Character Sheet permanently
// pointing at the provider's temporary/signed CDN URL. Those provider URLs normally
// expire after a while, which is what previously made Character cards show a broken
// image icon (the browser's alt-text placeholder) once the link died — the download
// failure that caused it was being swallowed completely silently (`catch (dlErr) {}`)
// with no retry and no log, so it was invisible in server logs.
async function downloadFileWithRetry(url, destPath, retries = 2) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await downloadFile(url, destPath);
      return true;
    } catch (e) {
      lastErr = e;
      console.warn(`[SheetImage] Local download attempt ${attempt + 1}/${retries + 1} failed for ${url}:`, e.message);
      if (attempt < retries) await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
  }
  console.error(`[SheetImage] Giving up downloading image locally after ${retries + 1} attempts, keeping remote URL as-is (it may expire later):`, url, lastErr && lastErr.message);
  return false;
}

function _extractImageUrl(json) {
  if (!json) return null;
  const d = json.data || json;
  if (typeof d === 'string' && d.startsWith('http')) return d;
  if (Array.isArray(d)) {
    const first = d[0];
    if (typeof first === 'string' && first.startsWith('http')) return first;
    if (first && first.url) return first.url;
  }
  if (d.url) return d.url;
  if (d.images && d.images[0]) {
    const img = d.images[0];
    return typeof img === 'string' ? img : img.url;
  }
  if (d.items && d.items[0]) {
    const item = d.items[0];
    return item.url || item.image || item.imageUrl;
  }
  return null;
}

// Convert base64 data URLs into /uploads/ files on disk so Magica receives public HTTP URLs
function saveBase64ToUploads(input) {
  if (!input || typeof input !== 'string') return null;
  if (input.startsWith('http://') || input.startsWith('https://')) return input;

  const m = /^data:(image\/(png|jpe?g|webp|gif));base64,(.+)$/i.exec(input);
  if (m) {
    const ext = m[2] === 'jpeg' ? 'jpg' : m[2];
    const fname = `refupload_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`;
    const fullPath = path.join(uploadsDir, fname);
    try {
      fs.writeFileSync(fullPath, Buffer.from(m[3], 'base64'));
      return `/uploads/${fname}`;
    } catch (e) {
      console.warn('[saveBase64ToUploads] Error writing file:', e.message);
      return null;
    }
  }

  if (input.startsWith('/uploads/') || input.startsWith('uploads/')) return input;
  return null;
}

// POST /characters/upload-image — used by the frontend upload widgets (manual Sheet
// Image field + AI reference photo field) so a picked local file is immediately turned
// into a small persisted /uploads/ link instead of being kept in memory/saved on the
// character row as a giant base64 `data:` URL string.
async function uploadCharacterImage(req, res) {
  try {
    const { image } = req.body || {};
    if (!image || typeof image !== 'string') {
      return res.status(400).json({ message: 'Gambar wajib diisi.' });
    }
    const url = saveBase64ToUploads(image);
    if (!url) {
      return res.status(400).json({ message: 'Format gambar tidak didukung. Gunakan PNG, JPG, WEBP, atau GIF.' });
    }
    res.json({ url });
  } catch (error) {
    res.status(500).json({ message: 'Gagal mengunggah gambar.', error: error.message });
  }
}

// Item 3 (orphan cleanup): deletes a locally-stored /uploads/ file. Never throws;
// silently no-ops for remote CDN URLs or files that are already gone.
function deleteLocalUpload(refPath) {
  try {
    if (!refPath || typeof refPath !== 'string') return;
    if (!refPath.startsWith('/uploads/') && !refPath.startsWith('uploads/')) return; // remote URL — nothing local to remove
    const rel = refPath.replace(/^\/?uploads\//, '');
    const fullPath = path.join(uploadsDir, rel);
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
  } catch (e) {
    console.warn('[deleteLocalUpload] Gagal menghapus file lama:', e.message);
  }
}

// Item 6 (duplicate/clone): physically copies a locally-stored file to a NEW filename
// so a cloned character never shares raw file ownership with the original — otherwise
// deleting one character's files (orphan cleanup) could break the other's images.
// Remote CDN URLs are safe to share as-is (nothing local to duplicate).
function duplicateLocalUpload(refPath) {
  try {
    if (!refPath || typeof refPath !== 'string') return refPath;
    if (!refPath.startsWith('/uploads/') && !refPath.startsWith('uploads/')) return refPath;
    const rel = refPath.replace(/^\/?uploads\//, '');
    const srcPath = path.join(uploadsDir, rel);
    if (!fs.existsSync(srcPath)) return refPath;
    const ext = path.extname(rel) || '.png';
    const newName = `dup_${Date.now()}_${Math.random().toString(36).slice(2, 7)}${ext}`;
    const destPath = path.join(uploadsDir, newName);
    fs.copyFileSync(srcPath, destPath);
    return `/uploads/${newName}`;
  } catch (e) {
    console.warn('[duplicateLocalUpload] Gagal menyalin file:', e.message);
    return refPath;
  }
}

function parseJsonArray(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  try {
    const p = JSON.parse(v);
    return Array.isArray(p) ? p : [];
  } catch (e) {
    return [];
  }
}

function normalizeCharacterRow(c) {
  return {
    ...c,
    color_palette: c.color_palette ? JSON.parse(c.color_palette) : [],
    expressions: c.expressions ? JSON.parse(c.expressions) : [],
    reference_images: c.reference_images ? JSON.parse(c.reference_images) : [],
    tags: parseJsonArray(c.tags),
    sheet_image_history: parseJsonArray(c.sheet_image_history),
  };
}

// Get all characters for current user. Item 7: optional q (search) / tag / sort / order
// query params for advanced search & organization.
async function getUserCharacters(req, res) {
  try {
    const db = getDb();
    const { q, tag, sort, order } = req.query;

    let sql = 'SELECT * FROM characters WHERE user_id = ?';
    const params = [req.user.id];
    if (q) {
      sql += ' AND (name LIKE ? OR concept LIKE ? OR visual_tone LIKE ? OR tagline LIKE ?)';
      const like = `%${q}%`;
      params.push(like, like, like, like);
    }
    if (tag) {
      sql += ' AND tags LIKE ?';
      params.push(`%"${tag}"%`);
    }

    const sortableCols = { name: 'name', created_at: 'created_at', updated_at: 'updated_at' };
    const sortCol = sortableCols[sort] || 'created_at';
    const sortDir = String(order).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    sql += ` ORDER BY ${sortCol} ${sortDir}`;

    const characters = await db.all(sql, params);

    // Item 5 groundwork: usage count per character (how many storyboards reference it),
    // computed in one grouped query so the list stays fast even with many characters.
    const usageRows = await db.all(
      `SELECT s.character_id AS character_id, COUNT(*) AS cnt
       FROM storyboards s
       WHERE s.character_id IS NOT NULL AND s.user_id = ?
       GROUP BY s.character_id`,
      [req.user.id]
    );
    const usageMap = {};
    usageRows.forEach((r) => { usageMap[r.character_id] = r.cnt; });

    const parsed = characters.map((c) => ({ ...normalizeCharacterRow(c), usage_count: usageMap[c.id] || 0 }));

    res.json(parsed);
  } catch (error) {
    res.status(500).json({ message: 'Gagal mengambil data karakter.', error: error.message });
  }
}

// Get single character detail (includes usage_count — item 5)
async function getCharacterById(req, res) {
  try {
    const db = getDb();
    const character = await db.get(
      'SELECT * FROM characters WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );

    if (!character) {
      return res.status(404).json({ message: 'Karakter tidak ditemukan.' });
    }

    const usage = await db.get('SELECT COUNT(*) AS cnt FROM storyboards WHERE character_id = ?', [character.id]);
    res.json({ ...normalizeCharacterRow(character), usage_count: (usage && usage.cnt) || 0 });
  } catch (error) {
    res.status(500).json({ message: 'Gagal mengambil detail karakter.', error: error.message });
  }
}

// Create new character
async function createCharacter(req, res) {
  try {
    const {
      name, tagline, concept, visual_tone, color_palette,
      profile_notes, turnaround_notes, expressions, wardrobe,
      production_notes, trigger_prompt, reference_images, sheet_image_url,
      gender, skin_tone, attributes_source, voice_gender, voice_tone,
      voice_language, voice_notes, tags
    } = req.body;

    if (!name) {
      return res.status(400).json({ message: 'Nama karakter wajib diisi.' });
    }

    // Item 2: cap stored reference images at MAX_REFERENCE_IMAGES from the very start.
    const cappedRefImages = Array.isArray(reference_images)
      ? reference_images.filter(Boolean).slice(0, MAX_REFERENCE_IMAGES)
      : [];

    const db = getDb();
    const result = await db.run(
      `INSERT INTO characters (
        user_id, name, tagline, concept, visual_tone, color_palette,
        profile_notes, turnaround_notes, expressions, wardrobe,
        production_notes, trigger_prompt, reference_images, sheet_image_url,
        gender, skin_tone, attributes_source, voice_gender, voice_tone, voice_language, voice_notes, tags
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.user.id,
        name,
        tagline || '',
        concept || '',
        visual_tone || '',
        JSON.stringify(color_palette || []),
        profile_notes || '',
        turnaround_notes || '',
        JSON.stringify(expressions || []),
        wardrobe || '',
        production_notes || '',
        trigger_prompt || '',
        JSON.stringify(cappedRefImages),
        sheet_image_url || '',
        gender || '',
        skin_tone || '',
        attributes_source || 'manual',
        voice_gender || '',
        voice_tone || '',
        voice_language || '',
        voice_notes || '',
        JSON.stringify(Array.isArray(tags) ? tags : [])
      ]
    );

    const newChar = await db.get('SELECT * FROM characters WHERE id = ?', [result.lastID]);
    res.status(201).json(normalizeCharacterRow(newChar));
  } catch (error) {
    res.status(500).json({ message: 'Gagal membuat karakter.', error: error.message });
  }
}

// Update existing character
async function updateCharacter(req, res) {
  try {
    const { id } = req.params;
    const {
      name, tagline, concept, visual_tone, color_palette,
      profile_notes, turnaround_notes, expressions, wardrobe,
      production_notes, trigger_prompt, reference_images, sheet_image_url,
      gender, skin_tone, attributes_source, voice_gender, voice_tone,
      voice_language, voice_notes, tags
    } = req.body;

    const db = getDb();
    const existing = await db.get('SELECT * FROM characters WHERE id = ? AND user_id = ?', [id, req.user.id]);
    if (!existing) {
      return res.status(404).json({ message: 'Karakter tidak ditemukan.' });
    }

    // Item 3 (orphan cleanup) + Item 2 (multi-angle cap): when reference_images is
    // updated, cap it at MAX_REFERENCE_IMAGES and delete any previously-stored local
    // files that are no longer present in the new list.
    let finalRefImagesJson = existing.reference_images;
    if (reference_images !== undefined) {
      const capped = Array.isArray(reference_images) ? reference_images.filter(Boolean).slice(0, MAX_REFERENCE_IMAGES) : [];
      const oldRefs = parseJsonArray(existing.reference_images);
      const removed = oldRefs.filter((r) => !capped.includes(r));
      removed.forEach(deleteLocalUpload);
      finalRefImagesJson = JSON.stringify(capped);
    }

    // Item 4: Sheet Image version history — push the previous sheet_image_url into
    // history before overwriting so old renders remain browsable. Cap history length
    // and delete the oldest local file once the cap is exceeded (orphan cleanup — item 3).
    let finalSheetImageUrl = existing.sheet_image_url;
    let finalHistoryJson = existing.sheet_image_history;
    if (sheet_image_url !== undefined && sheet_image_url !== existing.sheet_image_url) {
      const history = parseJsonArray(existing.sheet_image_history);
      if (existing.sheet_image_url) {
        history.push({ url: existing.sheet_image_url, replaced_at: new Date().toISOString() });
      }
      while (history.length > MAX_SHEET_HISTORY) {
        const dropped = history.shift();
        if (dropped && dropped.url) deleteLocalUpload(dropped.url);
      }
      finalHistoryJson = JSON.stringify(history);
      finalSheetImageUrl = sheet_image_url;
    }

    await db.run(
      `UPDATE characters SET
        name = ?, tagline = ?, concept = ?, visual_tone = ?, color_palette = ?,
        profile_notes = ?, turnaround_notes = ?, expressions = ?, wardrobe = ?,
        production_notes = ?, trigger_prompt = ?, reference_images = ?, sheet_image_url = ?,
        gender = ?, skin_tone = ?, attributes_source = ?, voice_gender = ?, voice_tone = ?,
        voice_language = ?, voice_notes = ?, tags = ?, sheet_image_history = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ?`,
      [
        name || existing.name,
        tagline !== undefined ? tagline : existing.tagline,
        concept !== undefined ? concept : existing.concept,
        visual_tone !== undefined ? visual_tone : existing.visual_tone,
        color_palette !== undefined ? JSON.stringify(color_palette) : existing.color_palette,
        profile_notes !== undefined ? profile_notes : existing.profile_notes,
        turnaround_notes !== undefined ? turnaround_notes : existing.turnaround_notes,
        expressions !== undefined ? JSON.stringify(expressions) : existing.expressions,
        wardrobe !== undefined ? wardrobe : existing.wardrobe,
        production_notes !== undefined ? production_notes : existing.production_notes,
        trigger_prompt !== undefined ? trigger_prompt : existing.trigger_prompt,
        finalRefImagesJson,
        finalSheetImageUrl,
        gender !== undefined ? gender : existing.gender,
        skin_tone !== undefined ? skin_tone : existing.skin_tone,
        attributes_source !== undefined ? attributes_source : existing.attributes_source,
        voice_gender !== undefined ? voice_gender : existing.voice_gender,
        voice_tone !== undefined ? voice_tone : existing.voice_tone,
        voice_language !== undefined ? voice_language : existing.voice_language,
        voice_notes !== undefined ? voice_notes : existing.voice_notes,
        tags !== undefined ? JSON.stringify(tags) : existing.tags,
        finalHistoryJson,
        id,
        req.user.id
      ]
    );

    const updated = await db.get('SELECT * FROM characters WHERE id = ?', [id]);
    res.json(normalizeCharacterRow(updated));
  } catch (error) {
    res.status(500).json({ message: 'Gagal memperbarui karakter.', error: error.message });
  }
}

// Delete character. Item 5: checks storyboard usage before deleting; without
// ?force=1 (or body force:true) a 409 is returned so the client can confirm.
// Item 3: cleans up every local file this character owns (orphan cleanup).
async function deleteCharacter(req, res) {
  try {
    const { id } = req.params;
    const force = req.query.force === '1' || req.query.force === 'true' || req.body?.force === true;
    const db = getDb();
    const existing = await db.get('SELECT * FROM characters WHERE id = ? AND user_id = ?', [id, req.user.id]);
    if (!existing) {
      return res.status(404).json({ message: 'Karakter tidak ditemukan.' });
    }

    const usageRows = await db.all('SELECT id, title FROM storyboards WHERE character_id = ?', [id]);
    if (usageRows.length > 0 && !force) {
      return res.status(409).json({
        message: `Karakter "${existing.name}" masih dipakai di ${usageRows.length} storyboard. Konfirmasi untuk tetap menghapus.`,
        usageCount: usageRows.length,
        usedIn: usageRows.slice(0, 10).map((r) => ({ id: r.id, title: r.title }))
      });
    }

    // Orphan cleanup: remove every local file this character owns — reference images,
    // the current sheet image, and every historic sheet image render.
    parseJsonArray(existing.reference_images).forEach(deleteLocalUpload);
    if (existing.sheet_image_url) deleteLocalUpload(existing.sheet_image_url);
    parseJsonArray(existing.sheet_image_history).forEach((h) => deleteLocalUpload(h && h.url));

    if (usageRows.length > 0 && force) {
      // Detach (do not cascade-delete) the storyboards that referenced this character —
      // the storyboards themselves stay intact, only losing the character link.
      await db.run('UPDATE storyboards SET character_id = NULL WHERE character_id = ?', [id]);
    }

    await db.run('DELETE FROM characters WHERE id = ? AND user_id = ?', [id, req.user.id]);
    res.json({ message: 'Karakter berhasil dihapus.' });
  } catch (error) {
    res.status(500).json({ message: 'Gagal menghapus karakter.', error: error.message });
  }
}

// Item 6: duplicate/clone an existing character into a new row. Local files (reference
// images + sheet image) are physically COPIED (never shared by reference) so the clone
// never breaks — or is broken by — the original's future edits/deletes. Sheet image
// version history intentionally starts empty on the clone.
async function duplicateCharacter(req, res) {
  try {
    const { id } = req.params;
    const db = getDb();
    const existing = await db.get('SELECT * FROM characters WHERE id = ? AND user_id = ?', [id, req.user.id]);
    if (!existing) {
      return res.status(404).json({ message: 'Karakter tidak ditemukan.' });
    }

    const dupRefImages = parseJsonArray(existing.reference_images).map(duplicateLocalUpload);
    const dupSheetUrl = existing.sheet_image_url ? duplicateLocalUpload(existing.sheet_image_url) : '';

    const result = await db.run(
      `INSERT INTO characters (
        user_id, name, tagline, concept, visual_tone, color_palette,
        profile_notes, turnaround_notes, expressions, wardrobe,
        production_notes, trigger_prompt, reference_images, sheet_image_url,
        gender, skin_tone, attributes_source, voice_gender, voice_tone, voice_language, voice_notes, tags
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.user.id,
        `${existing.name} (Salinan)`,
        existing.tagline,
        existing.concept,
        existing.visual_tone,
        existing.color_palette,
        existing.profile_notes,
        existing.turnaround_notes,
        existing.expressions,
        existing.wardrobe,
        existing.production_notes,
        existing.trigger_prompt,
        JSON.stringify(dupRefImages),
        dupSheetUrl,
        existing.gender || '',
        existing.skin_tone || '',
        existing.attributes_source || 'manual',
        existing.voice_gender || '',
        existing.voice_tone || '',
        existing.voice_language || '',
        existing.voice_notes || '',
        existing.tags || '[]'
      ]
    );

    const newChar = await db.get('SELECT * FROM characters WHERE id = ?', [result.lastID]);
    res.status(201).json(normalizeCharacterRow(newChar));
  } catch (error) {
    res.status(500).json({ message: 'Gagal menduplikasi karakter.', error: error.message });
  }
}

// AI Assistant: Generate complete Character Sheet specification using LLM
async function generateCharacterAI(req, res) {
  try {
    const { prompt, refImageBase64, refImageUrl } = req.body;
    if (!prompt && !refImageBase64 && !refImageUrl) {
      return res.status(400).json({ message: 'Berikan deskripsi karakter atau gambar referensi.' });
    }

    const db = getDb();

    // Local /uploads/... paths aren't fetchable by the external vision LLM API, so expand
    // them to a full public URL first (mirrors the same expansion already done for
    // Magica/Freebeat reference images down in generateCharacterSheetImage).
    const publicBaseUrl = process.env.PUBLIC_URL || (req.protocol + '://' + req.get('host'));
    const absoluteRefImageUrl = refImageUrl && refImageUrl.startsWith('/uploads/')
      ? `${publicBaseUrl.replace(/\/$/, '')}${refImageUrl}`
      : refImageUrl;

    const systemPrompt = `You are a world-class Character Designer, Concept Artist, and Art Director.
Given a user prompt or image description, create an ultra-detailed, professional Character Design Reference Sheet specification (Character Bible / Turnaround Sheet).

Respond strictly with a single valid JSON object with the following fields:
{
  "name": "Full Character Name",
  "tagline": "Short catchy slogan / title",
  "concept": "Character background concept summary",
  "visual_tone": "Visual style tags e.g. Tarantino Cinematic, 90s Retro Action Film, Gritty Urban Realism, Dramatic Chiaroscuro Lighting",
  "color_palette": ["#HEX1", "#HEX2", "#HEX3", "#HEX4", "#HEX5"],
  "profile_notes": "1. PROFILE (Side View): physical traits, hairstyle, face structure, skin tone, accessories, height",
  "turnaround_notes": "2. TURNAROUND (360° View): clothing details for Front, Left, Back, Right angles",
  "expressions": [
    "01. Weary - tired, heavy eyes, subtle frown",
    "02. Ironic Smile - confident, quirky smirk",
    "03. Wide Laugh - open mouth, energetic laugh",
    "04. Suspicious - narrow squint, intense look",
    "05. Sad Clown - melancholic, gentle expression"
  ],
  "wardrobe": "5. WARDROBE BREAKDOWN: Clothing, shoes, fabrics, textures, stickers, watch, bandages, and key accessories",
  "production_notes": "6. PRODUCTION NOTES: Visual tone, color palette theory, lighting, mood reference (e.g. Pulp Fiction, Taxi Driver)",
  "trigger_prompt": "Ultra-detailed consistent physical prompt string containing full facial features, outfit details, skin tone, hair style, build, and aesthetic to maintain 100% consistent character appearance across AI images",
  "gender": "Gender karakter (e.g. Male, Female, Non-binary) — tebak dari gambar referensi bila ada, kalau tidak ada dari deskripsi teks",
  "skin_tone": "Deskripsi warna kulit/etnis singkat (e.g. Tan olive skin, Fair skin, Dark brown skin)",
  "voice_gender": "Male | Female | Neutral — perkiraan gender suara narator yang cocok untuk karakter ini",
  "voice_tone": "1-3 kata nada suara (e.g. warm and confident, gruff and weary, bright and playful)",
  "voice_language": "Bahasa yang disarankan untuk voice over (default: Bahasa Indonesia)",
  "voice_notes": "Catatan tambahan suara khas (aksen, kecepatan bicara, dsb) jika relevan, atau string kosong",
  "sheet_image_prompt": "Official character design reference sheet concept art presentation poster layout for [Character Name], featuring full multi-panel graphic composition layout: 1. Profile side view standing, 2. 360 degree turnaround view (front, 3/4 left, back, 3/4 right standing line-up), 3. Cinematic close up portrait, 4. Head study expressions grid with 5 emotions, 5. Wardrobe breakdown of clothing items, 6. Production notes & color palette swatches. Film production concept art sheet, 8k resolution masterwork, sleek studio dark background."
}
Only output pure JSON. No markdown backticks outside JSON.`;

    let parsedSpec = null;

    // Primary LLM attempt
    try {
      const userMessageContent = [];
      if (prompt) {
        userMessageContent.push({ type: 'text', text: `Ide Karakter: ${prompt}` });
      }
      if (refImageBase64) {
        userMessageContent.push({ type: 'image_url', image_url: { url: refImageBase64.startsWith('data:') ? refImageBase64 : `data:image/png;base64,${refImageBase64}` } });
      } else if (absoluteRefImageUrl) {
        userMessageContent.push({ type: 'image_url', image_url: { url: absoluteRefImageUrl } });
      }

      const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessageContent.length === 1 && userMessageContent[0].type === 'text' ? userMessageContent[0].text : userMessageContent }
      ];

      const rawResponse = await chatCompletion(messages, { db, temperature: 0.7 });
      
      let cleanJson = rawResponse.trim();
      if (cleanJson.startsWith('```')) {
        cleanJson = cleanJson.replace(/^```(json)?\n?/, '').replace(/\n?```$/, '').trim();
      }

      try {
        parsedSpec = JSON.parse(cleanJson);
      } catch (e1) {
        const match = cleanJson.match(/\{[\s\S]*\}/);
        if (match) parsedSpec = JSON.parse(match[0]);
      }
    } catch (llmErr) {
      console.warn('[CharacterAI] Primary LLM failed:', llmErr.message, 'Trying text-only fallback...');
      // Fallback 1: Text-only LLM if vision or primary endpoint failed
      if (prompt) {
        try {
          const textMessages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `Ide Karakter: ${prompt}` }
          ];
          const rawResponse = await chatCompletion(textMessages, { db, temperature: 0.7 });
          let cleanJson = rawResponse.trim();
          if (cleanJson.startsWith('```')) {
            cleanJson = cleanJson.replace(/^```(json)?\n?/, '').replace(/\n?```$/, '').trim();
          }
          const match = cleanJson.match(/\{[\s\S]*\}/);
          if (match) cleanJson = match[0];
          parsedSpec = JSON.parse(cleanJson);
        } catch (fallbackErr) {
          console.warn('[CharacterAI] Text-only LLM fallback failed:', fallbackErr.message);
        }
      }
    }

    // Fallback 2: If LLM is unconfigured or unreachable, build structured Character Spec from prompt
    if (!parsedSpec || !parsedSpec.name) {
      const charName = prompt ? prompt.split('-')[0].trim().slice(0, 30) : 'Karakter AI';
      parsedSpec = {
        name: charName || 'Karakter AI',
        tagline: prompt ? `Ikonik ${charName}` : 'Karakter Konsisten',
        concept: prompt || 'Karakter dengan gaya sinematik dan penampilan konsisten di setiap adegan.',
        visual_tone: 'Tarantino Cinematic, 90s Retro, Gritty Urban Realism',
        color_palette: ['#E6D45A', '#C4A85A', '#F5F5F5', '#8B5E34', '#1E1E1E'],
        profile_notes: `Pandangan Samping: ${prompt || 'Ciri fisik, gaya rambut, dan gestur tubuh khas.'}`,
        turnaround_notes: `Tampak Depan, Samping Kiri, Belakang, & Kanan untuk pakaian dan postur ${charName}.`,
        expressions: [
          '01. Weary - ekspresi lelah & tenang',
          '02. Ironic Smile - senyum percaya diri',
          '03. Wide Laugh - tawa lepas',
          '04. Suspicious - tatapan tajam',
          '05. Sad Clown - ekspresi melankolis'
        ],
        wardrobe: `Rincian pakaian dan aksesoris khas: ${prompt || 'Pakaian sinematik dengan detail tekstur yang konsisten.'}`,
        production_notes: 'Pencahayaan sinematik dramatis, warna moody retro 90s, high contrast studio lighting.',
        trigger_prompt: `${prompt || charName}, highly detailed consistent character design, cinematic lighting, photorealistic 8k`,
        gender: '',
        skin_tone: '',
        voice_gender: '',
        voice_tone: '',
        voice_language: 'Bahasa Indonesia',
        voice_notes: '',
        sheet_image_prompt: `Official character design reference sheet concept art presentation poster layout for ${prompt || charName}, featuring full multi-panel graphic composition layout: 1. Profile side view standing, 2. 360 degree turnaround view (front, 3/4 left, back, 3/4 right standing line-up), 3. Cinematic close up portrait, 4. Head study expressions grid with 5 emotions, 5. Wardrobe breakdown of clothing items, 6. Production notes & color palette swatches. Film production concept art sheet, 8k resolution masterwork, sleek studio dark background.`
      };
    }

    // Item 9 (Auto mode): when the character spec was derived with the help of a
    // reference photo, mark it as AI-auto-filled; a pure text prompt (no photo) is still
    // "manual" in the sense that no image evidence backed the physical attributes.
    parsedSpec.attributes_source = (refImageBase64 || refImageUrl) ? 'ai_auto' : 'manual';

    // Save reference image if uploaded as base64
    let savedRefUrl = saveBase64ToUploads(refImageBase64 || refImageUrl);
    if (!savedRefUrl && refImageUrl && (refImageUrl.startsWith('http') || refImageUrl.startsWith('/uploads/'))) {
      savedRefUrl = refImageUrl;
    }
    if (parsedSpec && savedRefUrl) {
      parsedSpec.reference_images = [savedRefUrl];
    }

    res.json({
      success: true,
      characterSpec: parsedSpec
    });
  } catch (error) {
    console.error('[CharacterAI Error]:', error);
    res.status(500).json({ message: 'Gagal menyusun karakter AI: ' + (error.message || 'Error server'), error: error.message });
  }
}

// Generate the high-res Character Reference Sheet Image using Image Generator (Freebeat/Magica)
async function generateCharacterSheetImage(req, res) {
  try {
    const { prompt, aspectRatio, apiKeyId, magicaModel, magicaKeyId, provider, refUrl, refImageUrl, refImageBase64, refUrls } = req.body;
    if (!prompt) {
      return res.status(400).json({ message: 'Prompt gambar wajib diisi.' });
    }

    const db = getDb();
    const userRow = await db.get('SELECT preferred_provider AS pp, can_use_magica AS cum, can_use_scenario AS cus FROM users WHERE id = ?', [req.user.id]);
    
    // Determine primary provider to try: default to scenario unless explicitly magica
    const wantMagica = provider === 'magica' || (!provider && userRow && userRow.pp === 'magica' && userRow.cum);
    const wantScenario = !wantMagica;
    
    // Item 2: accept up to MAX_REFERENCE_IMAGES reference photos (multi-angle) via the new
    // `refUrls` array, while staying fully compatible with the legacy single
    // refUrl/refImageUrl/refImageBase64 fields used by existing callers.
    const rawRefList = (Array.isArray(refUrls) && refUrls.length ? refUrls : [refUrl || refImageUrl || refImageBase64]).filter(Boolean);
    const savedPaths = rawRefList.slice(0, MAX_REFERENCE_IMAGES).map((r) => {
      let saved = saveBase64ToUploads(r);
      if (!saved && typeof r === 'string' && (r.startsWith('http') || r.startsWith('/uploads/'))) saved = r;
      return saved;
    }).filter(Boolean);

    // Convert local /uploads/... relative paths to public HTTP URLs for Magica / Scenario
    const publicBaseUrl = process.env.PUBLIC_URL || (req.protocol + '://' + req.get('host'));
    const targetRefUrls = savedPaths.map((p) => (p.startsWith('/uploads/') ? `${publicBaseUrl.replace(/\/$/, '')}${p}` : p));
    const targetRefUrl = targetRefUrls[0] || null; // kept for readability where only one ref matters

    // Attempt 1: Scenario if requested or preferred
    if (wantScenario) {
      try {
        const { result: scRes } = await scenarioGen.executeWithScenarioFailover(
          db,
          async (keyRec) => {
            return await scenarioGen.generateOneImageScenario(keyRec, prompt, {
              aspectRatio: aspectRatio || '3:4',
              model: req.body.scenarioModel || 'model_openai-gpt-image-2',
              refUrls: targetRefUrls
            });
          },
          { specificKeyId: req.body.scenarioKeyId }
        );

        if (scRes && scRes.url) {
          let storedUrl = scRes.url;
          const fname = `refsheet_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.png`;
          const downloaded = await downloadFileWithRetry(scRes.url, path.join(uploadsDir, fname));
          if (downloaded) storedUrl = `/uploads/${fname}`;

          return res.json({ success: true, imageUrl: storedUrl });
        }
      } catch (scErr) {
        console.warn('[SheetImage] Scenario attempt failed:', scErr.message);
      }
    }

    // Attempt 2: Magica if requested or preferred
    if (wantMagica) {
      try {
        const mk = await magicaGen.pickMediaMagicaKey(db, magicaKeyId);
        if (mk) {
          // Bug fix (item 1): previously any model choice OTHER than the exact string
          // 'nano_fast' fell through to the else-branch correctly, but choosing
          // 'nano_fast' itself was silently overridden to 'gpt_image_2' — the model the
          // user picked in the UI was never actually used. Now the chosen model is
          // always respected, with 'gpt_image_2' only as the default when none is set.
          const modelToUse = magicaModel || 'gpt_image_2';
          const genRes = await magicaGen.generateOneImageMagica(mk.key_value, prompt, {
            aspectRatio: aspectRatio || '3:4',
            nodeType: modelToUse,
            refUrls: targetRefUrls
          });

          if (genRes && genRes.url) {
            let storedUrl = genRes.url;
            const fname = `refsheet_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.png`;
            const downloaded = await downloadFileWithRetry(genRes.url, path.join(uploadsDir, fname));
            if (downloaded) storedUrl = `/uploads/${fname}`;

            return res.json({ success: true, imageUrl: storedUrl });
          }
        }
      } catch (magErr) {
        console.warn('[SheetImage] Magica attempt failed:', magErr.message, 'Trying Freebeat failover...');
      }
    }

    // Attempt 2: Freebeat Provider (text-to-image only — unchanged). Freebeat's own
    // character-sheet render here has never accepted a reference photo/edit mode with a
    // verified CLI contract for this endpoint (no `--model`/edit collected here), so it
    // is intentionally left as-is rather than guessing an untested CLI invocation.
    // Multi-angle references (item 2) are fully wired for Magica above instead.
    try {
      let keyRecord = null;
      if (apiKeyId && apiKeyId !== 'auto') {
        keyRecord = await db.get('SELECT * FROM api_keys WHERE id = ? AND is_active = 1', [apiKeyId]);
      }
      if (!keyRecord) {
        keyRecord = await getAvailableApiKey(db);
      }

      if (keyRecord) {
        const localCliPath = path.join(__dirname, '..', 'node_modules', 'freebeat-cli', 'dist', 'index.js');
        const hasLocalCli = fs.existsSync(localCliPath);
        const baseCmd = hasLocalCli ? `node "${localCliPath}"` : 'npx freebeat-cli';

        const sizeArgs = freebeatSizeArgs(aspectRatio || '3:4');
        const cliArgs = [
          'generate',
          '--api-key', keyRecord.key_value,
          '--prompt', `"${prompt.replace(/"/g, '\\"')}"`,
          ...sizeArgs,
          '--json'
        ];

        const sub = await _spawnCollect(baseCmd, cliArgs, { cwd: path.join(__dirname, '..') });
        if (sub.code === 0) {
          let json = null;
          try { json = JSON.parse(sub.out.trim()); } catch (e) {
            const m = sub.out.match(/\{[\s\S]*\}/);
            if (m) { try { json = JSON.parse(m[0]); } catch (e2) {} }
          }

          const remoteUrl = _extractImageUrl(json);
          if (remoteUrl) {
            let storedUrl = remoteUrl;
            const fname = `refsheet_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.png`;
            const downloaded = await downloadFileWithRetry(remoteUrl, path.join(uploadsDir, fname));
            if (downloaded) storedUrl = `/uploads/${fname}`;

            return res.json({ success: true, imageUrl: storedUrl });
          }
        }
      }
    } catch (fbErr) {
      console.warn('[SheetImage] Freebeat attempt failed:', fbErr.message);
    }

    // Attempt 3: Magica failover if Magica wasn't attempted first
    if (!wantMagica) {
      try {
        const mk = await magicaGen.pickMediaMagicaKey(db, magicaKeyId);
        if (mk) {
          const modelToUse = magicaModel || 'gpt_image_2';
          const genRes = await magicaGen.generateOneImageMagica(mk.key_value, prompt, {
            aspectRatio: aspectRatio || '3:4',
            nodeType: modelToUse,
            refUrls: targetRefUrls
          });

          if (genRes && genRes.url) {
            let storedUrl = genRes.url;
            const fname = `refsheet_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.png`;
            const downloaded = await downloadFileWithRetry(genRes.url, path.join(uploadsDir, fname));
            if (downloaded) storedUrl = `/uploads/${fname}`;

            return res.json({ success: true, imageUrl: storedUrl });
          }
        }
      } catch (magErr2) {
        console.warn('[SheetImage] Magica failover failed:', magErr2.message);
      }
    }

    // If all providers failed or no active key, return clear error message
    return res.status(400).json({ message: 'Gagal merender gambar. Pastikan Kunci API (Freebeat atau Magica) sudah terkonfigurasi di Admin Panel / Settings.' });

  } catch (error) {
    console.error('[GenerateSheetImage Error]:', error);
    res.status(500).json({ message: 'Gagal membuat gambar lembar karakter: ' + error.message, error: error.message });
  }
}

module.exports = {
  getUserCharacters,
  getCharacterById,
  createCharacter,
  updateCharacter,
  deleteCharacter,
  duplicateCharacter,
  generateCharacterAI,
  generateCharacterSheetImage,
  uploadCharacterImage
};
