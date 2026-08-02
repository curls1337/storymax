const path = require('path');
const fs = require('fs');
const { getDb } = require('../db');
const { uploadsDir } = require('../config');
const { chatCompletion } = require('../prompts/aiClient');
const magicaGen = require('../services/magicaGen');
const { getAvailableApiKey } = require('../services/keyPool');
const { freebeatSizeArgs } = require('../services/freebeat/cli');
const { downloadFile } = require('../services/download');
const { spawn } = require('child_process');

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

// Get all characters for current user
async function getUserCharacters(req, res) {
  try {
    const db = getDb();
    const characters = await db.all(
      'SELECT * FROM characters WHERE user_id = ? ORDER BY created_at DESC',
      [req.user.id]
    );

    // Parse JSON fields
    const parsed = characters.map(c => ({
      ...c,
      color_palette: c.color_palette ? JSON.parse(c.color_palette) : [],
      expressions: c.expressions ? JSON.parse(c.expressions) : [],
      reference_images: c.reference_images ? JSON.parse(c.reference_images) : []
    }));

    res.json(parsed);
  } catch (error) {
    res.status(500).json({ message: 'Gagal mengambil data karakter.', error: error.message });
  }
}

// Get single character detail
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

    character.color_palette = character.color_palette ? JSON.parse(character.color_palette) : [];
    character.expressions = character.expressions ? JSON.parse(character.expressions) : [];
    character.reference_images = character.reference_images ? JSON.parse(character.reference_images) : [];

    res.json(character);
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
      production_notes, trigger_prompt, reference_images, sheet_image_url
    } = req.body;

    if (!name) {
      return res.status(400).json({ message: 'Nama karakter wajib diisi.' });
    }

    const db = getDb();
    const result = await db.run(
      `INSERT INTO characters (
        user_id, name, tagline, concept, visual_tone, color_palette,
        profile_notes, turnaround_notes, expressions, wardrobe,
        production_notes, trigger_prompt, reference_images, sheet_image_url
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        JSON.stringify(reference_images || []),
        sheet_image_url || ''
      ]
    );

    const newChar = await db.get('SELECT * FROM characters WHERE id = ?', [result.lastID]);
    newChar.color_palette = JSON.parse(newChar.color_palette || '[]');
    newChar.expressions = JSON.parse(newChar.expressions || '[]');
    newChar.reference_images = JSON.parse(newChar.reference_images || '[]');

    res.status(201).json(newChar);
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
      production_notes, trigger_prompt, reference_images, sheet_image_url
    } = req.body;

    const db = getDb();
    const existing = await db.get('SELECT * FROM characters WHERE id = ? AND user_id = ?', [id, req.user.id]);
    if (!existing) {
      return res.status(404).json({ message: 'Karakter tidak ditemukan.' });
    }

    await db.run(
      `UPDATE characters SET
        name = ?, tagline = ?, concept = ?, visual_tone = ?, color_palette = ?,
        profile_notes = ?, turnaround_notes = ?, expressions = ?, wardrobe = ?,
        production_notes = ?, trigger_prompt = ?, reference_images = ?, sheet_image_url = ?,
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
        reference_images !== undefined ? JSON.stringify(reference_images) : existing.reference_images,
        sheet_image_url !== undefined ? sheet_image_url : existing.sheet_image_url,
        id,
        req.user.id
      ]
    );

    const updated = await db.get('SELECT * FROM characters WHERE id = ?', [id]);
    updated.color_palette = JSON.parse(updated.color_palette || '[]');
    updated.expressions = JSON.parse(updated.expressions || '[]');
    updated.reference_images = JSON.parse(updated.reference_images || '[]');

    res.json(updated);
  } catch (error) {
    res.status(500).json({ message: 'Gagal memperbarui karakter.', error: error.message });
  }
}

// Delete character
async function deleteCharacter(req, res) {
  try {
    const { id } = req.params;
    const db = getDb();
    const existing = await db.get('SELECT * FROM characters WHERE id = ? AND user_id = ?', [id, req.user.id]);
    if (!existing) {
      return res.status(404).json({ message: 'Karakter tidak ditemukan.' });
    }

    await db.run('DELETE FROM characters WHERE id = ? AND user_id = ?', [id, req.user.id]);
    res.json({ message: 'Karakter berhasil dihapus.' });
  } catch (error) {
    res.status(500).json({ message: 'Gagal menghapus karakter.', error: error.message });
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
      } else if (refImageUrl) {
        userMessageContent.push({ type: 'image_url', image_url: { url: refImageUrl } });
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
        sheet_image_prompt: `Official character design reference sheet concept art presentation poster layout for ${prompt || charName}, featuring full multi-panel graphic composition layout: 1. Profile side view standing, 2. 360 degree turnaround view (front, 3/4 left, back, 3/4 right standing line-up), 3. Cinematic close up portrait, 4. Head study expressions grid with 5 emotions, 5. Wardrobe breakdown of clothing items, 6. Production notes & color palette swatches. Film production concept art sheet, 8k resolution masterwork, sleek studio dark background.`
      };
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
    const { prompt, aspectRatio, apiKeyId, magicaModel, magicaKeyId, provider } = req.body;
    if (!prompt) {
      return res.status(400).json({ message: 'Prompt gambar wajib diisi.' });
    }

    const db = getDb();
    const userRow = await db.get('SELECT preferred_provider AS pp, can_use_magica AS cum FROM users WHERE id = ?', [req.user.id]);
    
    // Determine primary provider to try
    const wantMagica = provider === 'magica' || (!provider && userRow && userRow.pp === 'magica' && userRow.cum);

    // Attempt 1: Magica if requested or preferred
    if (wantMagica) {
      try {
        const mk = await magicaGen.pickMediaMagicaKey(db, magicaKeyId);
        if (mk) {
          const modelToUse = (magicaModel && magicaModel !== 'nano_fast') ? magicaModel : 'gpt_image_2';
          const genRes = await magicaGen.generateOneImageMagica(mk.key_value, prompt, {
            aspectRatio: aspectRatio || '3:4',
            nodeType: modelToUse
          });

          if (genRes && genRes.url) {
            let storedUrl = genRes.url;
            try {
              const fname = `refsheet_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.png`;
              await downloadFile(genRes.url, path.join(uploadsDir, fname));
              storedUrl = `/uploads/${fname}`;
            } catch (dlErr) {}

            return res.json({ success: true, imageUrl: storedUrl });
          }
        }
      } catch (magErr) {
        console.warn('[SheetImage] Magica attempt failed:', magErr.message, 'Trying Freebeat failover...');
      }
    }

    // Attempt 2: Freebeat Provider
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
            try {
              const fname = `refsheet_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.png`;
              await downloadFile(remoteUrl, path.join(uploadsDir, fname));
              storedUrl = `/uploads/${fname}`;
            } catch (dlErr) {}

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
          const modelToUse = (magicaModel && magicaModel !== 'nano_fast') ? magicaModel : 'gpt_image_2';
          const genRes = await magicaGen.generateOneImageMagica(mk.key_value, prompt, {
            aspectRatio: aspectRatio || '3:4',
            nodeType: modelToUse
          });

          if (genRes && genRes.url) {
            let storedUrl = genRes.url;
            try {
              const fname = `refsheet_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.png`;
              await downloadFile(genRes.url, path.join(uploadsDir, fname));
              storedUrl = `/uploads/${fname}`;
            } catch (dlErr) {}

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
  generateCharacterAI,
  generateCharacterSheetImage
};
