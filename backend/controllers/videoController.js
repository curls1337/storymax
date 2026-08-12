const { localCliPath } = require('../services/freebeat/cli');
const { AI_API_HOST, AI_API_TOKEN } = require('../config/secrets');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const ffmpegPath = require('ffmpeg-static');
const ffprobeInstaller = require('@ffprobe-installer/ffprobe');
const ffprobePath = ffprobeInstaller.path;

if (process.platform !== 'win32') {
  try {
    if (fs.existsSync(ffmpegPath)) fs.chmodSync(ffmpegPath, 0o755);
    if (fs.existsSync(ffprobePath)) fs.chmodSync(ffprobePath, 0o755);
  } catch (chmodErr) {
    console.error('Failed to set executable permissions on ffmpeg/ffprobe:', chmodErr);
  }
}

const { getDb } = require('../db');
const { activeTasks } = require('./storyboardController');
const magicaGen = require('../services/magicaGen');
const { llmChatViaSettings } = require('../prompts/aiClient');

async function checkAndDisableKeyIfOutofCredits(db, apiKeyId, errorText, taskObj) {
  if (!apiKeyId || !errorText) return;
  const lowerErr = errorText.toLowerCase();
  if (lowerErr.includes('credit') || lowerErr.includes('balance') || lowerErr.includes('insufficient') || lowerErr.includes('limit') || lowerErr.includes('depleted') || lowerErr.includes('payment') || lowerErr.includes('out of')) {
    console.log(`[Auto-Disable API Key] Key ID ${apiKeyId} is out of credits. Disabling key.`);
    try {
      await db.run('UPDATE api_keys SET is_active = 0 WHERE id = ?', [apiKeyId]);
      if (taskObj && taskObj.logs !== undefined) {
        taskObj.logs += `\n[SYSTEM] API Key ID ${apiKeyId} telah dinonaktifkan secara otomatis karena kehabisan/kurang kredit.\n`;
      }
    } catch (e) {
      console.error('Failed to auto-disable API key:', e);
    }
  }
}

const { uploadsDir } = require('../config');

async function getAvailableApiKey(db, { allowFallback = true } = {}) {
  const activeKeys = await db.all('SELECT * FROM api_keys WHERE is_active = 1');
  if (activeKeys.length === 0) return null;

  // Filter out keys that are currently busy in activeTasks
  const busyKeyIds = Object.values(activeTasks)
    .filter(task => task.status === 'processing')
    .map(task => parseInt(task.apiKeyId));

  const freeKeys = activeKeys.filter(k => !busyKeyIds.includes(parseInt(k.id)));
  if (freeKeys.length > 0) {
    return freeKeys[0];
  }
  // No FREE key right now. Strict mode (allowFallback:false) returns null so the caller
  // can WAIT for one to free up — never double-using a busy key. Otherwise fall back.
  return allowFallback ? activeKeys[0] : null;
}

// When voiceover/audio is NOT enabled for a video, the model must not speak — even
// if the stored scene prompt (baked at storyboard time or by prompt-regeneration
// with VO on) contains "narrator speaks…" cues. Strip obvious VO cues and append a
// hard no-speech directive so the ?generateAudio toggle is the single source of truth.
function enforceNoVoiceover(text) {
  let t = String(text || '');
  // Drop any appended "Voiceover (Lang): ..." block (usually to end of prompt).
  t = t.replace(/\n*\s*Voiceover\s*\([^)]*\)\s*:[\s\S]*$/i, '');
  // Drop the new structured "Audio — voiceover: ..." directive block if present.
  t = t.replace(/\n*\s*Audio\s*[—-]\s*voiceover\s*:[\s\S]*$/i, '');
  // Drop inline VO timing cues like "At 0s, narrator speaks: '...'."
  t = t.replace(/\bAt\s*\d+\s*s?,?\s*(the\s+)?narrator\s+speaks[^.]*\.?/gi, '');
  t = t.replace(/\b(the\s+)?narrator\s+speaks[^.]*\.?/gi, '');
  t = t.replace(/\bvoice[-\s]?over\b[^.]*\.?/gi, '');
  t = t.trim();
  return `${t}\n\nIMPORTANT AUDIO RULE: NO voiceover, NO narration, NO spoken words and NO dialogue of any kind. Ignore any "narrator speaks"/voiceover cues above. The audio may contain only natural/ambient/diegetic sound.`;
}

// Build the single, consistent voiceover directive appended to a video prompt when
// audio/VO is ON. Unlike the old plain "Voiceover (lang): <text>" tail, this anchors
// the delivery to the clip timeline (spoken evenly across the shot, synced to the
// on-screen action, off-screen narrator, no subtitles) so the model places the
// voiceover correctly instead of guessing when to speak. Returns '' when empty.
// Map a storyboard VO tone key to a short English delivery style for the directive.
function voToneLabel(tone) {
  const m = {
    casual: 'casual and friendly', comedy: 'light and comedic', excited: 'energetic and excited',
    formal: 'formal and serious', emotional: 'warm and emotional', storytelling: 'storytelling',
    dramatic: 'dramatic and suspenseful', soft_spoken: 'soft-spoken ASMR', luxury_premium: 'luxurious and premium',
    poetic_aesthetic: 'poetic and aesthetic', news_anchor: 'news-anchor', motivator_inspirational: 'inspirational and motivating',
    review_honest: 'honest and matter-of-fact', cinematic_trailer: 'epic cinematic-trailer', sarcastic_witty: 'witty and sarcastic',
    kids_playful: 'playful and cheerful',
  };
  return m[String(tone || '').trim()] || '';
}

// Item 8: pull the linked Consistent Character's saved voice identity (gender, tone,
// language, notes) from the storyboard's character_id so narration can honor the
// character's assigned voice instead of only the generic storyboard-level tone.
// Returns null when no character is linked, or the character exists but every voice
// field is empty (i.e. left as "Auto") — so behavior for un-configured characters is
// completely unchanged.
async function getCharacterVoiceProfile(db, storyboard) {
  try {
    if (!storyboard || !storyboard.character_id) return null;
    const char = await db.get(
      'SELECT name, voice_gender, voice_tone, voice_language, voice_notes FROM characters WHERE id = ?',
      [storyboard.character_id]
    );
    if (!char) return null;
    const hasAny = char.voice_gender || char.voice_tone || char.voice_language || char.voice_notes;
    if (!hasAny) return null;
    return {
      name: char.name || '',
      voiceGender: char.voice_gender || '',
      voiceTone: char.voice_tone || '',
      voiceLanguage: char.voice_language || '',
      voiceNotes: char.voice_notes || '',
    };
  } catch (e) {
    return null;
  }
}

// Item 8: builds a short additive clause anchoring the narrator's voice to the linked
// character's saved voice identity. Returns '' when no profile is set so the base
// voiceover directive is completely unchanged for characters without a configured voice.
function buildCharacterVoiceClause(voiceProfile) {
  if (!voiceProfile) return '';
  const parts = [];
  if (voiceProfile.voiceGender) parts.push(`${voiceProfile.voiceGender} voice`);
  if (voiceProfile.voiceTone) parts.push(`a ${voiceProfile.voiceTone} tone`);
  if (voiceProfile.voiceNotes) parts.push(voiceProfile.voiceNotes);
  if (!parts.length) return '';
  const who = voiceProfile.name ? `the character "${voiceProfile.name}"` : 'the linked character';
  return ` The narrator's voice should specifically match ${who}: ${parts.join(', ')}.`;
}

function buildVoiceoverDirective(narration, lang, tone, durationSec, voiceProfile) {
  let line = String(narration || '').trim();
  if (!line) return '';
  // Sanitize text for clear TTS & video models: strip quotes, brackets, and convert 'x' to 'dan'
  line = line.replace(/^['"\s]+|['"\s]+$/g, '');
  line = line.replace(/(\w+)\s*x\s*(\w+)/gi, '$1 dan $2');
  line = line.replace(/#/g, '');
  if (!line) return '';

  const language = lang || 'Bahasa Indonesia';
  // Fit the line to the CHOSEN clip length (~1.5 words/sec) so it never rushes or leaves
  // dead air — this is what keeps the VO in sync with the scene.
  const sec = Number(durationSec);
  if (Number.isFinite(sec) && sec > 0) {
    const maxWords = Math.max(4, Math.min(40, Math.round(sec * 1.5)));
    const words = line.split(/\s+/);
    if (words.length > maxWords) {
      line = words.slice(0, maxWords).join(' ');
      if (!/[.!?]$/.test(line)) line += '.';
    }
  }
  const toneLbl = voToneLabel(tone);
  const delivery = toneLbl ? ` with a ${toneLbl} delivery` : '';
  
  const charClause = buildCharacterVoiceClause(voiceProfile);
  const charLine = charClause ? `\nVoice Identity: ${charClause.trim()}` : '';

  // IMPORTANT: the storyboard panel image may itself contain a small printed "VO:" cue
  // (baked in on purpose so the panel image matches the scene). Some image-to-video
  // models try to "read"/vocalize any on-screen text they see, which fragments the
  // speech per-panel with odd pauses (sounds spelled-out). Explicitly tell the model
  // that on-screen text is silent/visual-only and to speak ONLY this narration line,
  // as one smooth continuous sentence.
  return `\n\n[AUDIO DIRECTIVE — VOICE OVER]\nNarrator Type: Off-screen professional narrator\nLanguage: ${language}${delivery}${charLine}\nScript Content: "${line}"\n\nCRITICAL PERFORMANCE RULES:\n- Speak the "Script Content" EXACTLY as written, once, from start to finish.\n- Deliver as ONE smooth, natural, continuous conversational sentence in ${language}.\n- DO NOT read word-by-word. DO NOT spell out letters. DO NOT pause between every word. STOP speaking immediately once the sentence completes.\n- DO NOT vocalize any on-screen text, captions, or "Voiceover:" labels seen in the image; those are silent visual notes only.\n- Start speaking at 0s, pace evenly, and finish completely before the final second of the scene to avoid trailing or overlapping stutter.\n- END OF AUDIO: After the script completes, maintain ABSOLUTE SILENCE for the remainder of the clip. DO NOT hum, murmur, stutter, or generate any phantom speech/noise in any other language (e.g., NO Thai, NO Chinese, NO gibberish).\n- AUDIO OUTPUT MUST BE ACTIVE, CLEAN, AND CLEARLY AUDIBLE.`;
}

// When "backsound" (background music) is OFF, forbid any BGM/soundtrack so the video
// keeps only natural diegetic audio. Does NOT trigger ASMR keyword.
function applyNoBacksound(text) {
  return `${String(text || '')}\n\nBACKGROUND MUSIC: none — do NOT add any background music, soundtrack, score or BGM. Keep clear voiceover speech and clean diegetic ambient audio.`;
}

// Remove any appended voiceover block from a prompt WITHOUT adding a no-speech rule
// (used to normalize a client-supplied prompt before the server re-decides VO).
function stripVoiceover(text) {
  let t = String(text || '');
  // Item 1: Remove full trailing audio blocks (VO scripts, mixing directives, BGM rules)
  // so the server can re-append the fresh chosen audio policy without duplication.
  t = t.replace(/\n*\s*Audio\s*[—-]\s*voiceover\s*:[\s\S]*$/i, '');
  t = t.replace(/\n*\s*AUDIO\s*MIX\s*DIRECTIVE:[\s\S]*$/i, '');
  t = t.replace(/\n*\s*BACKGROUND\s*MUSIC:[\s\S]*$/i, '');
  
  // Item 2: Strip inline cues that sometimes leak from LLM visual prompts (e.g. "VO: ...")
  // while keeping the visual description intact.
  const inlinePattern = /\b(VO|Voiceover|Voice\s*Over|Naskah\s*Voice\s*Over|Narasi|Narration|Speech)\s*:\s*(?:"[^"]*"|'[^']*'|[^\n.]*([.\n]|$))/gi;
  t = t.replace(inlinePattern, '');
  t = t.replace(/\[Voiceover\s*Narration\]\s*:\s*(?:"[^"]*"|[^\n.]*([.\n]|$))/gi, '');
  
  return t.trim();
}

// Storyboard generation stores the preferred language and tone. Video Studio owns
// whether voice-over is requested for a specific render.
function resolveVoConfig(storyboard) {
  try {
    const gp = storyboard && storyboard.generation_params ? JSON.parse(storyboard.generation_params) : {};
    return { enableVo: !!gp.enableVo, voLanguage: gp.voLanguage || 'Bahasa Indonesia', voTone: gp.voTone || 'casual' };
  } catch (e) { return { enableVo: false, voLanguage: 'Bahasa Indonesia', voTone: 'casual' }; }
}

// Pull the stored narration for one scene from the storyboard's saved video_prompts.
function getSceneNarration(storyboard, sceneIdx) {
  try {
    const vp = storyboard && storyboard.video_prompts ? JSON.parse(storyboard.video_prompts) : null;
    const scenes = vp && Array.isArray(vp.scenes) ? vp.scenes : (Array.isArray(vp) ? vp : []);
    const s = scenes.find((x) => Number(x.scene_idx) === Number(sceneIdx)) || scenes[sceneIdx];
    if (s) {
      if (typeof s === 'string') {
        const m = s.match(/VO\s*:\s*([^.\n]+[.!?]?)/i) || s.match(/Voiceover[^:]*:\s*"?([^"\n]+)"?/i);
        if (m) return m[1].trim();
      } else {
        const txt = s.narration || s.vo || s.voiceOver || s.script || '';
        if (txt && String(txt).trim()) return String(txt).trim();
        if (s.imageToVideoPrompt || s.prompt) {
          const p = String(s.imageToVideoPrompt || s.prompt);
          const m = p.match(/VO\s*:\s*([^.\n]+[.!?]?)/i) || p.match(/Voiceover[^:]*:\s*"?([^"\n]+)"?/i);
          if (m) return m[1].trim();
        }
      }
    }
  } catch (e) {}
  try {
    const at = storyboard && storyboard.active_task_data ? JSON.parse(storyboard.active_task_data) : null;
    if (at && at.subPrompts && at.subPrompts[sceneIdx]) {
      const matchVo = String(at.subPrompts[sceneIdx]).match(/VO\s*:\s*([^.\n]+[.!?]?)/i)
                   || String(at.subPrompts[sceneIdx]).match(/Voiceover[^:]*:\s*"?([^"\n]+)"?/i);
      if (matchVo) return matchVo[1].trim();
    }
  } catch (e) {}
  // Fallback: extract VO from storyboard.prompt or storyboard.title if available
  try {
    if (storyboard && storyboard.prompt) {
      const promptText = String(storyboard.prompt);
      // Look for Panel [sceneIdx+1] or similar in prompt
      const panelRegex = new RegExp(`(?:Panel|Scene)\\s*0?${sceneIdx + 1}\\b[:\\s]*([^\\n]+(?:\\n(?!\\s*(?:Panel|Scene))[^\\n]+)*)`, 'i');
      const panelMatch = promptText.match(panelRegex);
      if (panelMatch && panelMatch[1]) {
        const pContent = panelMatch[1];
        const voMatch = pContent.match(/VO\s*:\s*([^.\n]+[.!?]?)/i) || pContent.match(/Voiceover[^:]*:\s*"?([^"\n]+)"?/i);
        if (voMatch) return voMatch[1].trim();
      }
      // General VO search
      const allVoMatches = promptText.match(/(?:VO|Voiceover)\s*:\s*([^.\n]+[.!?]?)/gi);
      if (allVoMatches && allVoMatches[sceneIdx]) {
        const m = allVoMatches[sceneIdx].match(/(?:VO|Voiceover)\s*:\s*(.+)/i);
        if (m) return m[1].trim();
      }
    }
  } catch (e) {}
  if (storyboard && storyboard.title) {
    return `Menampilkan keunggulan ${storyboard.title}.`;
  }
  return 'Nikmati kualitas terbaik produk ini sekarang juga.';
}

// Finalizes a video prompt's AUDIO. When hasVo is true, keep audio enabled and attach
// narration directive if present. If hasVo is false, enforce no-speech. Apply backsound toggle.
function applyAudioDirectives(basePrompt, { hasVo, narration, voLanguage, voTone, durationSec, backsound, voiceProfile }) {
  let t = stripVoiceover(basePrompt);
  let effectiveNarration = narration;
  if (hasVo && !effectiveNarration) {
    const matchVo = basePrompt.match(/VO\s*:\s*([^.\n]+[.!?]?)/i)
                 || basePrompt.match(/Voiceover[^:]*:\s*"?([^"\n]+)"?/i)
                 || basePrompt.match(/Naskah\s*Voice\s*Over[^:]*:\s*"?([^"\n]+)"?/i)
                 || basePrompt.match(/\[Voiceover\s*Narration\]\s*:\s*"?([^"\n]+)"?/i);
    if (matchVo) effectiveNarration = matchVo[1].trim();
  }

  if (hasVo) {
    if (!effectiveNarration) {
      effectiveNarration = 'Pilihan terbaik untuk Anda.';
    }
    t += buildVoiceoverDirective(effectiveNarration, voLanguage, voTone, durationSec, voiceProfile);
  } else {
    t = enforceNoVoiceover(t);
  }

  if (!backsound) {
    t = applyNoBacksound(t);
  } else if (hasVo) {
    // When BOTH Voiceover AND Backsound are checked, mix in soft background music WITHOUT
    // implying a second/separate narration. The earlier wording here ("Produce BOTH clear
    // spoken voiceover narration AND soft background music... MUST be clearly audible") read
    // like an ADDITIONAL, separate speech requirement stacked on top of the voiceover
    // directive above — some models interpreted that as "say it again" and rendered the
    // narration TWICE (doubled VO). Be explicit that there is only ONE voiceover line total.
    t += '\n\nAUDIO MIX DIRECTIVE: The ONE voiceover line already specified above is the ONLY spoken narration allowed — do NOT add a second voice, a second narrator, or repeat/duplicate that voiceover line in any way. Simply mix in soft, subtle background music underneath it, kept low enough that the single voiceover stays clearly audible and prominent above the music.';
  } else {
    t += '\n\nBACKGROUND MUSIC: Include energetic, fitting background music / soundtrack without voiceover speech.';
  }
  return t;
}

// Returns the exact prompt that will be submitted after server-side voiceover and
// music directives are applied. It deliberately returns labels/configuration only;
// API key values are never exposed to the client.
async function previewEffectiveVideoPrompt(req, res) {
  const { storyboardId, sceneIdx, prompt, duration, generateAudio, voiceOver, backsound } = req.body || {};
  if (!storyboardId || sceneIdx === undefined || !String(prompt || '').trim()) {
    return res.status(400).json({ message: 'storyboardId, sceneIdx, dan prompt wajib diisi.' });
  }

  try {
    const db = getDb();
    const storyboard = await db.get('SELECT * FROM storyboards WHERE id = ?', [storyboardId]);
    if (!storyboard) return res.status(404).json({ message: 'Storyboard tidak ditemukan.' });

    const voCfg = resolveVoConfig(storyboard);
    const hasVo = Boolean(generateAudio && voiceOver);
    const narration = hasVo ? getSceneNarration(storyboard, Number(sceneIdx)) : '';
    const voiceProfile = await getCharacterVoiceProfile(db, storyboard);
    const effectivePrompt = applyAudioDirectives(String(prompt).trim(), {
      hasVo,
      narration,
      voLanguage: voCfg.voLanguage,
      voTone: voCfg.voTone,
      durationSec: duration,
      backsound: Boolean(backsound),
      voiceProfile
    });

    return res.json({
      basePrompt: String(prompt),
      effectivePrompt,
      audio: {
        nativeAudioEnabled: Boolean(generateAudio),
        voiceoverRequested: Boolean(voiceOver),
        voiceoverEnabled: hasVo,
        narrationPresent: Boolean(narration),
        musicAllowed: Boolean(backsound),
        language: voCfg.voLanguage,
        tone: voCfg.voTone,
      },
    });
  } catch (error) {
    console.error('previewEffectiveVideoPrompt failed:', error);
    return res.status(500).json({ message: 'Gagal membuat preview prompt efektif.', error: error.message });
  }
}

async function generateVideo(req, res) {
  const {
    storyboardId,
    sceneIdx,
    prompt,
    model,
    generationType,
    aspectRatio,
    duration,
    resolution,
    generateAudio,
    voiceOver,
    backsound,
    apiKeyId,
    magicaModel,
    magicaMethod,
    magicaKeyId
  } = req.body;

  if (!storyboardId || sceneIdx === undefined || !prompt || !model || !generationType) {
    return res.status(400).json({ message: 'Parameter tidak lengkap.' });
  }

  try {
    const db = getDb();

    // 1. Retrieve storyboard
    const storyboard = await db.get('SELECT * FROM storyboards WHERE id = ?', [storyboardId]);
    if (!storyboard) {
      return res.status(404).json({ message: 'Storyboard tidak ditemukan.' });
    }

    // Safeguard against rapid duplicate requests for the same scene
    const existingProcessing = await db.get(
      `SELECT id, task_id FROM generated_videos 
       WHERE storyboard_id = ? AND scene_idx = ? AND status = 'processing' 
       ORDER BY id DESC LIMIT 1`,
      [storyboardId, sceneIdx]
    );
    if (existingProcessing) {
      return res.status(400).json({ 
        message: 'Pembuatan video untuk halaman ini sedang berjalan. Harap tunggu hingga selesai.',
        taskId: existingProcessing.task_id,
        videoId: existingProcessing.id
      });
    }

    // Restrict HD 1080p / 4K if user does not have allow_hd_resolutions permission
    const userRec = await db.get('SELECT role, allow_hd_resolutions FROM users WHERE id = ?', [req.user.id]);
    const isHdAllowed = userRec && (userRec.role === 'admin' || userRec.allow_hd_resolutions === 1);
    let finalResolution = resolution;
    if (!isHdAllowed && /1080|4k|2160/i.test(String(finalResolution || ''))) {
      finalResolution = '720p';
    }

    let panelImages = [];
    try {
      if (storyboard.image_path && storyboard.image_path.startsWith('[')) {
        panelImages = JSON.parse(storyboard.image_path);
      } else {
        panelImages = storyboard.image_path ? [storyboard.image_path] : [];
      }
    } catch (e) {
      panelImages = storyboard.image_path ? [storyboard.image_path] : [];
    }

    const sceneImage = panelImages[sceneIdx];
    if (generationType !== 'text' && !sceneImage) {
      return res.status(400).json({ message: 'Gambar scene tidak ditemukan.' });
    }

    // Voice Over is an explicit per-video prompt policy. The storyboard supplies the
    // narration text plus language/tone defaults; Audio Native controls the provider only.
    const voCfg = resolveVoConfig(storyboard);
    const hasVo = Boolean(generateAudio && voiceOver);
    const sceneNarration = hasVo ? getSceneNarration(storyboard, sceneIdx) : '';
    const voiceProfile = await getCharacterVoiceProfile(db, storyboard);

    // Provider routing (Bagian 2): Magica single-video generation — bypasses the
    // Freebeat key requirement + inline CLI spawn entirely.
    if (await magicaGen.isMagicaForStoryboard(db, storyboardId)) {
      const keys = await magicaGen.getAllMediaMagicaKeys(db, magicaKeyId);
      if (!keys || !keys.length) return res.status(400).json({ message: 'Tidak ada API Key Magica dengan saldo cukup (>= 5 kredit) untuk video. Key di bawah 5 kredit hanya untuk LLM — isi ulang atau tambah key.' });
      
      const initialKey = keys[0];
      const taskId = 'video_task_' + Date.now();
      const whToken = require('crypto').randomBytes(16).toString('hex');
      const insertResult = await db.run(
        `INSERT INTO generated_videos
         (storyboard_id, scene_idx, prompt, model, aspect_ratio, duration, resolution, status, task_id, api_key_id, magica_key_id, webhook_token)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [storyboardId, sceneIdx, prompt, 'magica:seedance', aspectRatio || null, duration || null, resolution || null, 'processing', taskId, null, initialKey.id, whToken]
      );
      const videoRecordId = insertResult.lastID;
      activeTasks[taskId] = { status: 'processing', apiKeyId: null, logs: '=== VIDEO STUDIO (MAGICA) ===\n\n[1/2] Mengirim perintah ke Magica (Seedance)...\n', result: null, error: null };
      res.json({ taskId, videoId: videoRecordId, status: 'processing' });
      
      (async () => {
        const onLog = (m) => { if (activeTasks[taskId]) activeTasks[taskId].logs += m + '\n'; };
        const magicaPrompt = applyAudioDirectives(prompt, { hasVo, narration: sceneNarration, voLanguage: voCfg.voLanguage, voTone: voCfg.voTone, durationSec: duration, backsound, voiceProfile });
        // "Hasilkan Audio/Voiceover" is the native provider switch. Music is a
        // prompt policy only and must never turn audio on by itself.
        const nativeAudio = Boolean(generateAudio);
        await db.run('UPDATE generated_videos SET prompt = ? WHERE id = ?', [magicaPrompt, videoRecordId]);
        
        try {
          const { result: magicaRes, keyRecord: usedKey } = await magicaGen.executeWithMagicaFailover(
            db,
            magicaKeyId,
            async (keyRec) => {
              await db.run('UPDATE generated_videos SET magica_key_id = ? WHERE id = ?', [keyRec.id, videoRecordId]).catch(() => {});
              return await magicaGen.generateVideoMagica(keyRec.key_value, {
                prompt: magicaPrompt,
                sceneImage,
                generationType,
                duration,
                resolution,
                aspectRatio,
                generateAudio: nativeAudio,
                nodeType: magicaModel,
                method: magicaMethod,
                onLog,
                webhook: magicaGen.buildWebhook('video', videoRecordId, whToken),
                onRunStart: (rid) => db.run('UPDATE generated_videos SET magica_run_id = ? WHERE id = ?', [rid, videoRecordId]).catch(() => {})
              });
            },
            onLog
          );

          const { url, credit } = magicaRes;
          await db.run('UPDATE generated_videos SET video_url = ?, status = ?, used_credits = ?, logs = ? WHERE id = ?', [url, 'success', credit || 0, activeTasks[taskId]?.logs || '', videoRecordId]);
          if (activeTasks[taskId]) { activeTasks[taskId].status = 'success'; activeTasks[taskId].logs += '[Magica] Video selesai.\n'; }
        } catch (mErr) {
          onLog('[ERROR] Magica gagal: ' + mErr.message);
          if (activeTasks[taskId]) { activeTasks[taskId].status = 'failed'; activeTasks[taskId].error = mErr.message; }
          await db.run('UPDATE generated_videos SET status = ?, error_message = ?, logs = ? WHERE id = ?', ['failed', mErr.message, activeTasks[taskId]?.logs || '', videoRecordId]);
        }
      })();
      return;
    }

    // 2. Retrieve active API key
    let keyRecord = null;
    if (apiKeyId && apiKeyId !== 'auto') {
      keyRecord = await db.get('SELECT * FROM api_keys WHERE id = ? AND is_active = 1', [apiKeyId]);
    }
    if (!keyRecord) {
      keyRecord = await getAvailableApiKey(db);
    }
    if (!keyRecord) {
      return res.status(400).json({ message: 'Tidak ada API Key Freebeat yang aktif.' });
    }

    // Check if key is currently busy with another generation task
    const isBusy = Object.values(activeTasks).some(task => 
      task.status === 'processing' && parseInt(task.apiKeyId) === parseInt(keyRecord.id)
    );
    if (isBusy) {
      return res.status(400).json({ message: 'API Key ini sedang digunakan untuk generasi lain.' });
    }

    // Create unique task ID for UI tracking
    const taskId = 'video_task_' + Date.now();

    // Insert initial record in generated_videos
    const insertResult = await db.run(
      `INSERT INTO generated_videos 
       (storyboard_id, scene_idx, prompt, model, aspect_ratio, duration, resolution, status, task_id, api_key_id) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        storyboardId,
        sceneIdx,
        prompt,
        model,
        aspectRatio || null,
        duration || null,
        resolution || null,
        'processing',
        taskId,
        keyRecord.id
      ]
    );
    const videoRecordId = insertResult.lastID;

    // Register active task
    activeTasks[taskId] = {
      status: 'processing',
      apiKeyId: keyRecord.id,
      logs: '=== VIDEO STUDIO GENERATION ===\n\n' +
            `Model            : ${model}\n` +
            `Prompt           : ${prompt}\n` +
            `Type             : ${generationType}\n` +
            `Duration         : ${duration ? duration + 's' : 'Default'}\n` +
            `Resolution       : ${resolution || 'Default'}\n` +
            `Aspect Ratio     : ${aspectRatio || 'Default'}\n` +
            `Audio            : ${generateAudio ? 'Yes' : 'No'}\n\n` +
            `[1/3] Mengirimkan perintah generasi ke Freebeat...\n`,
      result: null,
      error: null
    };

    // Respond immediately to client
    res.json({ taskId, videoId: videoRecordId, status: 'processing' });

    // Run submission in background
    (async () => {
      try {
        // VO is server-authoritative from the storyboard setting (single source of truth):
        // attach the VO directive when the storyboard has VO on & this scene has narration,
        // else enforce no-speech. Backsound stays a per-video toggle.
        const finalPrompt = applyAudioDirectives(prompt, { hasVo, narration: sceneNarration, voLanguage: voCfg.voLanguage, voTone: voCfg.voTone, durationSec: duration, backsound, voiceProfile });
        await db.run('UPDATE generated_videos SET prompt = ? WHERE id = ?', [finalPrompt, videoRecordId]);

        const spawnCmd = 'node';
        const cliPath = localCliPath; // B3: shared resolution (services/freebeat/cli.js)
        const spawnArgs = [
          cliPath,
          '--api-key', keyRecord.key_value,
          'video', 'generate',
          '--model', model,
          '--prompt', finalPrompt,
          '--generation-type', generationType,
          '--json'
        ];

        if (generationType !== 'text' && sceneImage) {
          let resolvedImagePath = sceneImage;
          if (sceneImage.startsWith('/uploads/') || sceneImage.startsWith('uploads/')) {
            const filename = sceneImage.replace(/^\/?uploads\//, '');
            resolvedImagePath = path.join(uploadsDir, filename);
          }
          spawnArgs.push('--image', resolvedImagePath);
        }

        if (duration) spawnArgs.push('--duration', String(duration));
        if (resolution) spawnArgs.push('--resolution', resolution);
        if (aspectRatio && aspectRatio !== 'auto') spawnArgs.push('--aspect-ratio', aspectRatio);
        if (generateAudio) spawnArgs.push('--generate-audio');

        const child = spawn(spawnCmd, spawnArgs);

        let stdoutData = '';
        let stderrData = '';

        child.stdout.on('data', (data) => {
          const str = data.toString();
          stdoutData += str;
        });

        child.stderr.on('data', (data) => {
          const str = data.toString();
          stderrData += str;
        });

        child.on('close', async (code) => {
          if (code !== 0) {
            console.error(`freebeat video generate submit exited with code ${code}`);
            const errorMsg = (stderrData.trim() || stdoutData.trim() || `Submit exited with code ${code}`);
            activeTasks[taskId].status = 'failed';
            activeTasks[taskId].error = errorMsg;
            activeTasks[taskId].logs += `\n[Freebeat Video CLI Error]\nSTDOUT:\n${stdoutData}\nSTDERR:\n${stderrData}\n`;
            activeTasks[taskId].logs += `[ERROR] Gagal mengirim task ke Freebeat: ${errorMsg}\n`;
            
            await checkAndDisableKeyIfOutofCredits(db, keyRecord.id, errorMsg || stdoutData || stderrData, activeTasks[taskId]);

            await db.run(
              'UPDATE generated_videos SET status = ?, video_url = NULL, error_message = ?, logs = ? WHERE id = ?',
              ['failed', errorMsg, activeTasks[taskId].logs, videoRecordId]
            );
            return;
          }

          try {
            // Find JSON output for batch submission details
            const jsonLines = stdoutData.split('\n').filter(line => line.trim().startsWith('{') || line.trim().startsWith('['));
            let submitResponse = null;
            for (const line of jsonLines) {
              try {
                const parsed = JSON.parse(line.trim());
                if (parsed.success && parsed.data) {
                  submitResponse = parsed.data;
                  break;
                }
              } catch (e) {}
            }

            if (!submitResponse && stdoutData.trim().startsWith('{')) {
              try {
                const parsed = JSON.parse(stdoutData.trim());
                if (parsed.success && parsed.data) {
                  submitResponse = parsed.data;
                }
              } catch (e) {}
            }

            const batchId = submitResponse?.batchId;
            const serialNo = submitResponse?.items?.[0]?.serialNo;

            if (batchId && serialNo) {
              activeTasks[taskId].logs += `[2/3] Sukses mengirim task! Batch ID: ${batchId}, Serial No: ${serialNo}\n` +
                                          `[3/3] Menjalankan Freebeat task wait di background...\n\n`;

              // Update DB with Freebeat Batch ID, Serial No AND the key that
              // submitted this batch — so status polling (incl. after a server
              // restart) queries the SAME account that owns the batch. Without
              // this, resume/poll could use a different key -> "Batch not found".
              await db.run(
                'UPDATE generated_videos SET task_id = ?, serial_no = ?, api_key_id = ? WHERE id = ?',
                [batchId, serialNo, keyRecord.id, videoRecordId]
              );

              // Link the real Freebeat Batch ID to the logs in activeTasks
              activeTasks[batchId] = activeTasks[taskId];

              // Spawn polling status workflow
              pollVideoStatus(videoRecordId, storyboardId, keyRecord.key_value, batchId, serialNo, taskId);
            } else {
              throw new Error('Gagal mendapatkan Batch ID atau Serial No dari respon Freebeat.');
            }

          } catch (err) {
            console.error('Error processing submit response:', err);
            activeTasks[taskId].status = 'failed';
            activeTasks[taskId].error = err.message;
            activeTasks[taskId].logs += `[ERROR] Gagal memproses submit respon: ${err.message}\n`;
            await db.run(
              'UPDATE generated_videos SET status = ?, video_url = NULL, error_message = ?, logs = ? WHERE id = ?',
              ['failed', err.message, activeTasks[taskId].logs, videoRecordId]
            );
          }
        });

      } catch (bgErr) {
        console.error('Error submitting background video task:', bgErr);
        activeTasks[taskId].status = 'failed';
        activeTasks[taskId].error = bgErr.message;
        await db.run(
          'UPDATE generated_videos SET status = ?, video_url = NULL, error_message = ?, logs = ? WHERE id = ?',
          ['failed', bgErr.message, activeTasks[taskId].logs, videoRecordId]
        );
      }
    })();

  } catch (err) {
    console.error('generateVideo failed:', err);
    res.status(500).json({ message: 'Gagal memulai pembuatan video.', error: err.message });
  }
}

// Marketing-copy LLM call. Routes through the central ai_settings config so it honors
// the admin LLM-provider setting (Magica for text-only, else the default endpoint).
// endpoint/apiKey are ignored in favor of that shared config; the { statusCode, body }
// contract is preserved so callers keep their existing parsing.
function callAi(endpoint, apiKey, payload) {
  return llmChatViaSettings(payload, { db: getDb(), timeoutMs: 30000 });
}

async function generateMarketingCopyInternal(storyboardId, sceneIdx) {
  try {
    const db = getDb();
    
    // Retrieve storyboard info
    const storyboard = await db.get('SELECT * FROM storyboards WHERE id = ?', [storyboardId]);
    if (!storyboard) return null;

    // Get AI settings
    const settings = await db.get('SELECT * FROM ai_settings LIMIT 1');
    let apiHost = AI_API_HOST;
    let apiToken = AI_API_TOKEN;
    let modelName = 'gemini-3-flash';

    if (settings) {
      apiHost = settings.endpoint;
      apiToken = settings.api_key;
      modelName = settings.model || 'gemini-3-flash';
    }

    // Extract style and full storyboard scene flow
    let styleId = storyboard.style || '';
    let genParams = {};
    try {
      if (storyboard.generation_params) {
        genParams = JSON.parse(storyboard.generation_params);
        if (genParams.style) styleId = genParams.style;
      }
    } catch (e) {}

    // Extract all scenes flow and specific scene info
    let narrationText = '';
    let sceneVisualPrompt = '';
    let fullStoryFlow = [];
    try {
      if (storyboard.video_prompts) {
        const parsed = JSON.parse(storyboard.video_prompts);
        const scenesArr = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.scenes) ? parsed.scenes : []);
        
        scenesArr.forEach((s, idx) => {
          const promptDesc = s.imageToVideoPrompt || s.textToVideoPrompt || '';
          const vo = s.narration || '';
          fullStoryFlow.push(`Scene ${idx + 1}: ${promptDesc} ${vo ? `(Voiceover: "${vo}")` : ''}`);
        });

        if (scenesArr[sceneIdx]) {
          narrationText = scenesArr[sceneIdx].narration || '';
          sceneVisualPrompt = scenesArr[sceneIdx].imageToVideoPrompt || scenesArr[sceneIdx].textToVideoPrompt || '';
        }
      }
    } catch (e) {}

    // Style-aware, length-capped, AUTHENTIC (not hard-sell) social copy. Tone is
    // resolved per style — see marketingTone.js — so ASMR / timelapse / tutorial /
    // etc. no longer inherit the generic "viral ad" persona. getStyleSpec resolves
    // aliases (e.g. cube_morph_product -> cube_box_transform) to the canonical tone.
    const { getStyleSpec } = require('../prompts/styleLibrary');
    const { buildMarketingSystemPrompt } = require('../prompts/marketingTone');
    const styleSpec = getStyleSpec(styleId);
    const systemPrompt = buildMarketingSystemPrompt(styleSpec, { titleMax: 80, descMax: 450 });

    const userPrompt = `Video context:
Storyboard Title: ${storyboard.title}
Concept/Prompt: ${storyboard.prompt}
Visual Style: ${styleId || 'Standard'}
Full Storyboard Progression:
${fullStoryFlow.join('\n') || 'N/A'}

Current Target Scene (Scene ${Number(sceneIdx) + 1}):
Scene Visual Action: ${sceneVisualPrompt || storyboard.prompt}
Voiceover Narration: ${narrationText || 'N/A'}

Write the title and caption per the TONE and rules above, based strictly on this video's context & style, in the storyboard's language. Return ONLY raw JSON.`;

    const payload = {
      model: modelName,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.7,
      response_format: { type: "json_object" }
    };

    const response = await callAi(apiHost, apiToken, payload);
    if (response.statusCode === 200) {
      const parsedRes = JSON.parse(response.body);
      const contentStr = parsedRes.choices?.[0]?.message?.content;
      if (contentStr) {
        const data = JSON.parse(contentStr.trim());
        const { capText } = require('../prompts/marketingTone');
        return {
          // Hard safeguards above the prompt targets (80 / 450) in case the model overshoots.
          title: capText(data.title || '', 100),
          description: capText(data.description || '', 600)
        };
      }
    }
    console.error("AI response error:", response.statusCode, response.body);
    return null;
  } catch (err) {
    console.error("Failed to generate marketing copy internally:", err);
    return null;
  }
}

async function generateMarketingCopy(videoRecordId) {
  try {
    const db = getDb();
    const video = await db.get('SELECT * FROM generated_videos WHERE id = ?', [videoRecordId]);
    if (!video) return null;
    return generateMarketingCopyInternal(video.storyboard_id, video.scene_idx);
  } catch (err) {
    console.error("Failed to wrapper generate marketing copy:", err);
    return null;
  }
}

async function regenerateStoryboardMarketingCopy(req, res) {
  const { id, sceneIdx } = req.params;
  const sIdx = Number(sceneIdx);
  try {
    const db = getDb();
    const storyboard = await db.get('SELECT * FROM storyboards WHERE id = ?', [id]);
    if (!storyboard) {
      return res.status(404).json({ message: 'Storyboard tidak ditemukan.' });
    }

    const marketingCopy = await generateMarketingCopyInternal(id, sIdx);
    if (!marketingCopy) {
      return res.status(500).json({ message: 'Gagal men-generate copywriting marketing.' });
    }

    let videoPrompts = [];
    if (storyboard.video_prompts) {
      try {
        videoPrompts = JSON.parse(storyboard.video_prompts);
      } catch (e) {
        videoPrompts = [];
      }
    }

    if (!Array.isArray(videoPrompts)) {
      videoPrompts = [];
    }

    if (!videoPrompts[sIdx]) {
      videoPrompts[sIdx] = { scene_idx: sIdx };
    }

    videoPrompts[sIdx].marketing_title = marketingCopy.title;
    videoPrompts[sIdx].marketing_description = marketingCopy.description;

    // Also store the SINGLE canonical marketing copy at the storyboard level so the
    // CSV/Sheets export always uses the latest copy (one caption for all platforms).
    await db.run(
      'UPDATE storyboards SET video_prompts = ?, marketing_title = ?, marketing_description = ? WHERE id = ?',
      [JSON.stringify(videoPrompts), marketingCopy.title, marketingCopy.description, id]
    );

    res.json({
      marketing_title: marketingCopy.title,
      marketing_description: marketingCopy.description
    });
  } catch (err) {
    console.error('Failed to regenerate storyboard marketing copy:', err);
    res.status(500).json({ message: 'Terjadi kesalahan sistem.', error: err.message });
  }
}

// Helper to poll task status and update records in real-time
function pollVideoStatus(videoRecordId, storyboardId, apiKey, batchId, serialNo, taskId) {
  let attempt = 0;
  const maxAttempts = 5760; // ~8 jam @ 5s — tunggu sampai Freebeat memberi status

  const interval = setInterval(async () => {
    attempt++;
    if (attempt > maxAttempts) {
      clearInterval(interval);
      activeTasks[taskId].status = 'failed';
      activeTasks[taskId].error = 'Timeout waiting for video generation.';
      activeTasks[taskId].logs += `\n[ERROR] Pembuatan video melampaui batas waktu (Timeout).\n`;
      const db = getDb();
      await db.run(
        'UPDATE generated_videos SET status = ?, error_message = ?, logs = ? WHERE id = ?',
        ['failed', 'Timeout waiting for video generation.', activeTasks[taskId].logs, videoRecordId]
      );
      return;
    }

    try {
      const db = getDb();
      const spawnCmd = 'node';
      const cliPath = localCliPath; // B3: shared resolution (services/freebeat/cli.js)
      const spawnArgs = [
        cliPath,
        '--api-key', apiKey,
        'task', 'status',
        batchId,
        '--serial-no', serialNo,
        '--json'
      ];

      const child = spawn(spawnCmd, spawnArgs);
      let stdoutData = '';
      child.stdout.on('data', (data) => {
        stdoutData += data.toString();
      });

      child.on('close', async (code) => {
        if (code !== 0) {
          activeTasks[taskId].logs += `\n[Freebeat Video Status Check Error]\nSTDOUT:\n${stdoutData}\n`;
          // A batch can only be queried by the key/account that created it. If Freebeat
          // keeps saying the batch doesn't exist (after allowing a few seconds for it to
          // register), retrying for hours won't help — fail fast so the user can regenerate.
          if (/batch not found/i.test(stdoutData) && attempt > 3) {
            clearInterval(interval);
            activeTasks[taskId].status = 'failed';
            activeTasks[taskId].error = 'Batch tidak ditemukan di Freebeat. Silakan generate ulang video ini.';
            activeTasks[taskId].logs += `[ERROR] Batch tidak ditemukan di akun API key ini — menghentikan pemantauan. Silakan generate ulang video.\n`;
            await db.run(
              'UPDATE generated_videos SET status = ?, error_message = ?, logs = ? WHERE id = ?',
              ['failed', activeTasks[taskId].error, activeTasks[taskId].logs, videoRecordId]
            );
            return;
          }
          await checkAndDisableKeyIfOutofCredits(db, activeTasks[taskId].apiKeyId, stdoutData, activeTasks[taskId]);
          return;
        }

        try {
          const parsed = JSON.parse(stdoutData.trim());
          if (parsed.success && parsed.data) {
            const item = parsed.data.items?.[0];
            const status = item?.status?.toUpperCase() || 'UNKNOWN';
            const credits = Number(item?.usedCredits) || Number(parsed.data.acceptedCredits) || 0;

            if (status === 'SUCCESS' || status === 'COMPLETED') {
              clearInterval(interval);
              const finalVideoUrl = item?.result?.videoUrl || item?.result?.video_url || item?.result?.url || item?.videoUrl || item?.video_url;

              if (finalVideoUrl) {
                activeTasks[taskId].status = 'success';
                activeTasks[taskId].result = { videoUrl: finalVideoUrl };
                activeTasks[taskId].logs += `\n\n[SUCCESS] Video berhasil dibuat!\n` +
                                            `Link Video: ${finalVideoUrl}\n` +
                                            `Kredit Terpakai: ⚡ ${credits}\n`;
                
                await db.run(
                  'UPDATE generated_videos SET status = ?, video_url = ?, used_credits = ?, logs = ? WHERE id = ?',
                  ['success', finalVideoUrl, credits, activeTasks[taskId].logs, videoRecordId]
                );

                await db.run(
                  'UPDATE storyboards SET used_credits = used_credits + ? WHERE id = ?',
                  [credits, storyboardId]
                );

                // Auto-generate title, description and hashtags in background
                try {
                  activeTasks[taskId].logs += `[AI Marketing] Men-generate otomatis Judul, Deskripsi, dan Hashtag...\n`;
                  const marketingCopy = await generateMarketingCopy(videoRecordId);
                  if (marketingCopy) {
                    await db.run(
                      'UPDATE generated_videos SET marketing_title = ?, marketing_description = ? WHERE id = ?',
                      [marketingCopy.title, marketingCopy.description, videoRecordId]
                    );
                    // canonical single copy at storyboard level (used by CSV/Sheets export)
                    await db.run(
                      'UPDATE storyboards SET marketing_title = ?, marketing_description = ? WHERE id = ?',
                      [marketingCopy.title, marketingCopy.description, storyboardId]
                    );
                    activeTasks[taskId].logs += `[AI Marketing] Judul & Deskripsi berhasil dibuat!\n`;
                  } else {
                    activeTasks[taskId].logs += `[AI Marketing] Gagal membuat deskripsi otomatis.\n`;
                  }
                } catch (copyErr) {
                  console.error('Failed to run background marketing copy generation:', copyErr);
                  activeTasks[taskId].logs += `[AI Marketing] Gagal membuat deskripsi otomatis: ${copyErr.message}\n`;
                }
              } else {
                activeTasks[taskId].status = 'failed';
                activeTasks[taskId].error = 'Video URL tidak ditemukan.';
                await db.run(
                  'UPDATE generated_videos SET status = ?, error_message = ?, logs = ? WHERE id = ?',
                  ['failed', 'Video URL tidak ditemukan.', activeTasks[taskId].logs, videoRecordId]
                );
              }
            } else if (status === 'FAILED' || status === 'ERROR' || status === 'REJECTED') {
              clearInterval(interval);
              const errMsg = item?.errorMessage || 'Kesalahan internal Freebeat CLI.';
              activeTasks[taskId].status = 'failed';
              activeTasks[taskId].error = errMsg;
              activeTasks[taskId].logs += `\n[Freebeat Video Render Error]\nError Message: ${errMsg}\n`;
              
              await checkAndDisableKeyIfOutofCredits(db, activeTasks[taskId].apiKeyId, errMsg, activeTasks[taskId]);

              await db.run(
                'UPDATE generated_videos SET status = ?, error_message = ?, logs = ? WHERE id = ?',
                ['failed', errMsg, activeTasks[taskId].logs, videoRecordId]
              );
            } else {
              // Status is PENDING or RUNNING — heartbeat every ~30s (6 polls @ 5s)
              if (attempt % 6 === 1) activeTasks[taskId].logs += `Masih memproses video di Freebeat... (${attempt * 5} detik berlalu) [${status}]\n`;
            }
          }
        } catch (e) {
          activeTasks[taskId].logs += `.`;
        }
      });

    } catch (err) {
      activeTasks[taskId].logs += `.`;
    }
  }, 5000);
}

// Function to automatically resume monitoring any processing videos at startup
async function resumeProcessingVideos() {
  try {
    const db = getDb();
    const processingVideos = await db.all('SELECT * FROM generated_videos WHERE status = "processing"');
    if (processingVideos.length === 0) return;

    console.log(`--- Resuming monitoring for ${processingVideos.length} processing video task(s) ---`);

    for (const video of processingVideos) {
      // Check if it has a valid batch_id (task_id in SQLite) and serial_no
      if (!video.task_id || !video.serial_no || video.task_id.startsWith('video_task_')) {
        // If it was interrupted before getting batchId, mark it as failed so user can retry
        await db.run('UPDATE generated_videos SET status = "failed" WHERE id = ?', [video.id]);
        continue;
      }

      // Resolve the key to poll with. A batch can ONLY be queried by the account
      // that submitted it, so use the video's OWN submit key first (even if it is
      // now inactive — a status query consumes no credits). Fall back to the
      // storyboard key, then any active key, only if the submit key is missing.
      const storyboard = await db.get('SELECT * FROM storyboards WHERE id = ?', [video.storyboard_id]);
      let keyRecord = null;
      if (video.api_key_id) {
        keyRecord = await db.get('SELECT * FROM api_keys WHERE id = ?', [video.api_key_id]);
      }
      if (!keyRecord && storyboard?.api_key_id) {
        keyRecord = await db.get('SELECT * FROM api_keys WHERE id = ?', [storyboard.api_key_id]);
      }
      if (!keyRecord) {
        const _act = await db.all('SELECT * FROM api_keys WHERE is_active = 1');
        keyRecord = _act.length ? _act[Math.floor(Math.random() * _act.length)] : null;
      }

      if (!keyRecord) {
        await db.run('UPDATE generated_videos SET status = "failed" WHERE id = ?', [video.id]);
        continue;
      }

      const apiKeyVal = keyRecord.key_value;

      // Re-create the activeTask entry so UI can poll it if they open the modal
      const newTaskId = video.task_id; // Using batch_id as task_id
      activeTasks[newTaskId] = {
        status: 'processing',
        apiKeyId: keyRecord.id,
        logs: `=== RESUMING VIDEO GENERATION ===\n\n` +
              `Batch ID: ${video.task_id}\n` +
              `Serial: ${video.serial_no}\n` +
              `Menyambungkan kembali pemantauan Freebeat task wait...\n\n`,
        result: null,
        error: null
      };

      // Spawn the task polling check
      pollVideoStatus(video.id, video.storyboard_id, apiKeyVal, video.task_id, video.serial_no, newTaskId);
    }
  } catch (err) {
    console.error('Failed to resume processing videos:', err);
  }
}

async function getStoryboardVideos(req, res) {
  const { storyboardId } = req.params;
  try {
    const db = getDb();
    const videos = await db.all('SELECT v.*, k.label AS api_key_label FROM generated_videos v LEFT JOIN api_keys k ON k.id = v.api_key_id WHERE v.storyboard_id = ? ORDER BY v.created_at DESC', [storyboardId]);
    res.json(videos);
  } catch (err) {
    res.status(500).json({ message: 'Gagal mengambil daftar video.', error: err.message });
  }
}

async function deleteVideo(req, res) {
  const { id } = req.params;
  try {
    const db = getDb();
    await db.run('DELETE FROM generated_videos WHERE id = ?', [id]);
    res.json({ message: 'Video berhasil dihapus.' });
  } catch (err) {
    res.status(500).json({ message: 'Gagal menghapus video.', error: err.message });
  }
}

async function regenerateVideoMarketingCopy(req, res) {
  const { id } = req.params;
  try {
    const db = getDb();
    const video = await db.get('SELECT * FROM generated_videos WHERE id = ?', [id]);
    if (!video) {
      return res.status(404).json({ message: 'Video tidak ditemukan.' });
    }

    const marketingCopy = await generateMarketingCopy(video.id);
    if (!marketingCopy) {
      return res.status(500).json({ message: 'Gagal men-generate copywriting marketing.' });
    }

    await db.run(
      'UPDATE generated_videos SET marketing_title = ?, marketing_description = ? WHERE id = ?',
      [marketingCopy.title, marketingCopy.description, video.id]
    );
    // canonical single copy at storyboard level (used by CSV/Sheets export)
    await db.run(
      'UPDATE storyboards SET marketing_title = ?, marketing_description = ? WHERE id = ?',
      [marketingCopy.title, marketingCopy.description, video.storyboard_id]
    );

    res.json({
      marketing_title: marketingCopy.title,
      marketing_description: marketingCopy.description
    });
  } catch (err) {
    console.error('Failed to regenerate video marketing copy:', err);
    res.status(500).json({ message: 'Terjadi kesalahan sistem.', error: err.message });
  }
}

async function runSingleVideoSpawn(vRecId, tId, kRec, pText, scImg, model, generationType, duration, resolution, aspectRatio, generateAudio, storyboardId) {
  // Provider routing (Bagian 2): render via Magica (Seedance) when the storyboard
  // owner prefers Magica. The Freebeat spawn path below is left untouched.
  try {
    const db0 = getDb();
    if (await magicaGen.isMagicaForStoryboard(db0, storyboardId)) {
      const onLog = (m) => { if (activeTasks[tId]) activeTasks[tId].logs = (activeTasks[tId].logs || '') + m + '\n'; };
      const mk = await magicaGen.pickMediaMagicaKey(db0, null);
      if (!mk) {
        const msg = 'Tidak ada API Key Magica dengan saldo cukup (>= 5 kredit) untuk video (key < 5 kredit hanya untuk LLM).';
        onLog('[ERROR] ' + msg);
        if (activeTasks[tId]) { activeTasks[tId].status = 'failed'; activeTasks[tId].error = msg; }
        await db0.run('UPDATE generated_videos SET status = ?, error_message = ?, logs = ? WHERE id = ?', ['failed', msg, activeTasks[tId]?.logs || '', vRecId]);
        return;
      }
      onLog('[Provider] Membuat video via Magica (Seedance)...');
      try {
        const { url, credit } = await magicaGen.generateVideoMagica(mk.key_value, {
          prompt: pText, sceneImage: scImg, generationType, duration, resolution, aspectRatio, generateAudio, onLog,
        });
        await db0.run('UPDATE generated_videos SET video_url = ?, status = ?, used_credits = ?, logs = ? WHERE id = ?', [url, 'success', credit || 0, activeTasks[tId]?.logs || '', vRecId]);
        if (activeTasks[tId]) { activeTasks[tId].status = 'success'; activeTasks[tId].logs += '[Magica] Video selesai.\n'; }
        try { await db0.run('UPDATE magica_api_keys SET last_status = ? WHERE id = ?', ['OK - ' + new Date().toLocaleString('id-ID'), mk.id]); } catch (e) {}
      } catch (mErr) {
        onLog('[ERROR] Magica gagal: ' + mErr.message);
        if (activeTasks[tId]) { activeTasks[tId].status = 'failed'; activeTasks[tId].error = mErr.message; }
        await db0.run('UPDATE generated_videos SET status = ?, error_message = ?, logs = ? WHERE id = ?', ['failed', mErr.message, activeTasks[tId]?.logs || '', vRecId]);
        try { await db0.run('UPDATE magica_api_keys SET last_status = ? WHERE id = ?', ['Error: ' + String(mErr.message).slice(0, 120), mk.id]); } catch (e) {}
      }
      return;
    }
  } catch (e) { /* fall through to Freebeat on any routing error */ }

  let attemptKeyRecord = kRec;
  let submitSuccess = false;

  while (!submitSuccess) {
    try {
      const db = getDb();
      const spawnCmd = 'node';
      const cliPath = localCliPath; // B3: shared resolution (services/freebeat/cli.js)
      const spawnArgs = [
        cliPath,
        '--api-key', attemptKeyRecord.key_value,
        'video', 'generate',
        '--model', model,
        '--prompt', pText,
        '--generation-type', generationType,
        '--json'
      ];

      if (generationType !== 'text' && scImg) {
        let resolvedImagePath = scImg;
        if (scImg.startsWith('/uploads/') || scImg.startsWith('uploads/')) {
          const filename = scImg.replace(/^\/?uploads\//, '');
          resolvedImagePath = path.join(uploadsDir, filename);
        }
        spawnArgs.push('--image', resolvedImagePath);
      }

      if (duration) spawnArgs.push('--duration', String(duration));
      if (resolution) spawnArgs.push('--resolution', resolution);
      if (aspectRatio && aspectRatio !== 'auto') spawnArgs.push('--aspect-ratio', aspectRatio);
      if (generateAudio) spawnArgs.push('--generate-audio');

      await new Promise((resolve, reject) => {
        const child = spawn(spawnCmd, spawnArgs);
        let stdoutData = '';
        let stderrData = '';

        child.stdout.on('data', (data) => {
          stdoutData += data.toString();
        });

        child.stderr.on('data', (data) => {
          stderrData += data.toString();
        });

        child.on('close', async (code) => {
          if (code !== 0) {
            const errorMsg = (stderrData.trim() || stdoutData.trim() || `Submit exited with code ${code}`);
            
            const lowerErr = errorMsg.toLowerCase();
            const isCreditErr = lowerErr.includes('credit') || lowerErr.includes('balance') || lowerErr.includes('insufficient') || lowerErr.includes('limit') || lowerErr.includes('depleted') || lowerErr.includes('payment') || lowerErr.includes('out of');
            
            if (isCreditErr) {
              console.log(`[Auto-Disable API Key] Key ID ${attemptKeyRecord.id} is out of credits. Disabling key.`);
              await db.run('UPDATE api_keys SET is_active = 0 WHERE id = ?', [attemptKeyRecord.id]);
              if (activeTasks[tId]) {
                activeTasks[tId].logs += `\n[Auto-Disable] API Key ID ${attemptKeyRecord.id} (${attemptKeyRecord.label}) kehabisan kredit. Menonaktifkan key.\n`;
              }
              reject({ type: 'credit', message: errorMsg });
            } else {
              if (activeTasks[tId]) {
                activeTasks[tId].status = 'failed';
                activeTasks[tId].error = errorMsg;
                activeTasks[tId].logs += `\n[Freebeat Video CLI Error]\nSTDOUT:\n${stdoutData}\nSTDERR:\n${stderrData}\n`;
                activeTasks[tId].logs += `[ERROR] Gagal mengirim task ke Freebeat: ${errorMsg}\n`;
              }
              await db.run(
                'UPDATE generated_videos SET status = ?, error_message = ?, logs = ? WHERE id = ?',
                ['failed', errorMsg, activeTasks[tId]?.logs || '', vRecId]
              );
              reject(new Error(errorMsg));
            }
            return;
          }

          try {
            const jsonLines = stdoutData.split('\n').filter(line => line.trim().startsWith('{') || line.trim().startsWith('['));
            let submitResponse = null;
            for (const line of jsonLines) {
              try {
                const parsed = JSON.parse(line.trim());
                if (parsed.success && parsed.data) {
                  submitResponse = parsed.data;
                  break;
                }
              } catch (e) {}
            }

            if (!submitResponse && stdoutData.trim().startsWith('{')) {
              try {
                const parsed = JSON.parse(stdoutData.trim());
                if (parsed.success && parsed.data) {
                  submitResponse = parsed.data;
                }
              } catch (e) {}
            }

            if (submitResponse) {
              const batchId = submitResponse.batchId;
              const serialNo = submitResponse.items?.[0]?.serialNo || '';

              if (batchId) {
                if (activeTasks[tId]) {
                  activeTasks[tId].logs += `[2/3] Sukses mendaftarkan task ke Freebeat.\n` +
                                           `Batch ID: ${batchId}\n` +
                                           `Serial  : ${serialNo}\n\n` +
                                           `[3/3] Mulai memantau progress render Freebeat...\n`;
                }
                
                await db.run(
                  'UPDATE generated_videos SET task_id = ?, serial_no = ?, api_key_id = ? WHERE id = ?',
                  [batchId, serialNo, attemptKeyRecord.id, vRecId]
                );

                if (activeTasks[tId]) {
                  activeTasks[batchId] = activeTasks[tId];
                }
                
                pollVideoStatus(vRecId, storyboardId, attemptKeyRecord.key_value, batchId, serialNo, tId);
                resolve();
              } else {
                reject(new Error('Gagal mendapatkan Batch ID dari respon Freebeat.'));
              }
            } else {
              reject(new Error('Respon submit dari Freebeat CLI tidak valid.'));
            }
          } catch (err) {
            reject(err);
          }
        });
      });

      submitSuccess = true;
    } catch (err) {
      if (err && err.type === 'credit') {
        const db = getDb();
        const _alt = await db.all('SELECT * FROM api_keys WHERE is_active = 1 AND id != ?', [attemptKeyRecord.id]);
        const nextKey = _alt.length ? _alt[Math.floor(Math.random() * _alt.length)] : null;
        if (nextKey) {
          if (activeTasks[tId]) {
            activeTasks[tId].logs += `[SYSTEM] Beralih secara otomatis ke API Key alternatif: ${nextKey.label}...\n`;
          }
          attemptKeyRecord = nextKey;
        } else {
          const errMsg = 'Semua API Key Freebeat yang aktif telah kehabisan kredit.';
          if (activeTasks[tId]) {
            activeTasks[tId].status = 'failed';
            activeTasks[tId].error = errMsg;
            activeTasks[tId].logs += `\n[ERROR] ${errMsg}\n`;
          }
          await db.run(
            'UPDATE generated_videos SET status = ?, error_message = ?, logs = ? WHERE id = ?',
            ['failed', errMsg, activeTasks[tId]?.logs || '', vRecId]
          );
          break;
        }
      } else {
        const errStr = String(err.message || err).toLowerCase();
        const isNetworkErr = errStr.includes('network') || errStr.includes('econnreset') || errStr.includes('timeout') || errStr.includes('socket') || errStr.includes('connection');
        
        if (isNetworkErr) {
          if (!activeTasks[tId]) {
            activeTasks[tId] = { pageRetries: 0 };
          }
          activeTasks[tId].pageRetries = (activeTasks[tId].pageRetries || 0) + 1;
          
          if (activeTasks[tId].pageRetries <= 3) {
            const retryMsg = `[SYSTEM] Terdeteksi gangguan koneksi Freebeat (${err.message || err}). Melakukan uji coba ulang (Retry ${activeTasks[tId].pageRetries}/3) dalam 3 detik...\n`;
            activeTasks[tId].logs = (activeTasks[tId].logs || '') + retryMsg;
            await new Promise(r => setTimeout(r, 3000));
            continue;
          }
        }
        
        const errorMsg = err.message || err;
        if (activeTasks[tId]) {
          activeTasks[tId].status = 'failed';
          activeTasks[tId].error = errorMsg;
          activeTasks[tId].logs += `\n[ERROR] Generasi video gagal permanen: ${errorMsg}\n`;
        }
        await db.run(
          'UPDATE generated_videos SET status = ?, error_message = ?, logs = ? WHERE id = ?',
          ['failed', errorMsg, activeTasks[tId]?.logs || '', vRecId]
        );
        break;
      }
    }
  }
}

// Fire-and-forget Magica video render for ONE scene in a batch. Extracted so multiple
// scenes can be launched in PARALLEL (not one-by-one), each using a DIFFERENT Magica
// API key (round-robin key assignment happens in the caller).
async function runSingleMagicaVideoSpawn({ mRecId, mTaskId, mk, promptText, sceneImage, originalCdnUrl, generationType, duration, resolution, aspectRatio, generateAudio, magicaModel, magicaMethod, mWhToken }) {
  const db = getDb();
  const onLog = (m) => { if (activeTasks[mTaskId]) activeTasks[mTaskId].logs += m + '\n'; };

  if (!mk) {
    const _noKeyMsg = 'Tidak ada API Key Magica dengan saldo cukup (>= 5 kredit) untuk video (key < 5 kredit hanya untuk LLM).';
    if (activeTasks[mTaskId]) { activeTasks[mTaskId].status = 'failed'; activeTasks[mTaskId].error = _noKeyMsg; }
    await db.run('UPDATE generated_videos SET status = ?, error_message = ?, logs = ? WHERE id = ?', ['failed', _noKeyMsg, activeTasks[mTaskId]?.logs || '', mRecId]);
    return;
  }

  try {
    const nativeAudio = Boolean(generateAudio);
    const { url, credit } = await magicaGen.generateVideoMagica(mk.key_value, { prompt: promptText, sceneImage, originalCdnUrl, generationType, duration, resolution, aspectRatio, generateAudio: nativeAudio, nodeType: magicaModel, method: magicaMethod, onLog, webhook: magicaGen.buildWebhook('video', mRecId, mWhToken), onRunStart: (rid) => db.run('UPDATE generated_videos SET magica_run_id = ? WHERE id = ?', [rid, mRecId]).catch(() => {}) });
    await db.run('UPDATE generated_videos SET video_url = ?, status = ?, used_credits = ?, logs = ? WHERE id = ?', [url, 'success', credit || 0, activeTasks[mTaskId]?.logs || '', mRecId]);
    if (activeTasks[mTaskId]) { activeTasks[mTaskId].status = 'success'; activeTasks[mTaskId].logs += '[Magica] Video selesai.\n'; }
    try { await db.run('UPDATE magica_api_keys SET last_status = ? WHERE id = ?', ['OK - ' + new Date().toLocaleString('id-ID'), mk.id]); } catch (e) {}
  } catch (mErr) {
    onLog('[ERROR] Magica gagal: ' + mErr.message);
    if (activeTasks[mTaskId]) { activeTasks[mTaskId].status = 'failed'; activeTasks[mTaskId].error = mErr.message; }
    await db.run('UPDATE generated_videos SET status = ?, error_message = ?, logs = ? WHERE id = ?', ['failed', mErr.message, activeTasks[mTaskId]?.logs || '', mRecId]);
    try { await db.run('UPDATE magica_api_keys SET last_status = ? WHERE id = ?', ['Error: ' + String(mErr.message).slice(0, 120), mk.id]); } catch (e) {}
  }
}

async function generateAllVideos(req, res) {
  const {
    storyboardId,
    model,
    generationType,
    aspectRatio,
    duration,
    resolution,
    generateAudio,
    voiceOver,
    backsound,
    apiKeyId,
    magicaModel,
    magicaMethod,
    magicaKeyId
  } = req.body;

  if (!storyboardId || !model || !generationType) {
    return res.status(400).json({ message: 'Parameter tidak lengkap.' });
  }

  try {
    const db = getDb();

    // 1. Retrieve storyboard
    const storyboard = await db.get('SELECT * FROM storyboards WHERE id = ?', [storyboardId]);
    if (!storyboard) {
      return res.status(404).json({ message: 'Storyboard tidak ditemukan.' });
    }

    // 2. Resolve pages & total scenes
    let panelImages = [];
    try {
      if (storyboard.image_path && storyboard.image_path.startsWith('[')) {
        panelImages = JSON.parse(storyboard.image_path);
      } else {
        panelImages = storyboard.image_path ? [storyboard.image_path] : [];
      }
    } catch (e) {
      panelImages = storyboard.image_path ? [storyboard.image_path] : [];
    }

    const userRecAll = await db.get('SELECT role, allow_hd_resolutions FROM users WHERE id = ?', [req.user.id]);
    const isHdAllowedAll = userRecAll && (userRecAll.role === 'admin' || userRecAll.allow_hd_resolutions === 1);
    let finalBatchResolution = resolution;
    if (!isHdAllowedAll && /1080|4k|2160/i.test(String(finalBatchResolution || ''))) {
      finalBatchResolution = '720p';
    }

    const totalScenes = panelImages.length;
    if (totalScenes === 0) {
      return res.status(400).json({ message: 'Storyboard ini belum memiliki gambar panel.' });
    }

    // Parse the video prompts array
    let scenePrompts = [];
    try {
      if (storyboard.video_prompts) {
        const parsed = JSON.parse(storyboard.video_prompts);
        if (parsed && Array.isArray(parsed.scenes)) {
          scenePrompts = parsed.scenes;
        }
      }
    } catch (e) {
      console.error("Failed to parse video prompts in generateAllVideos:", e);
    }

    // Respond immediately to prevent HTTP timeouts
    res.json({ message: 'Proses batch video generation sukses dimulai di background.' });

    // Run the queue loop in the background!
    (async () => {
      const db = getDb();
      const voiceProfile = await getCharacterVoiceProfile(db, storyboard);
      const activeTasksCountForStoryboard = () => {
        return Object.values(activeTasks).filter(task => 
          task.status === 'processing' && task.storyboardId === storyboardId
        ).length;
      };

      const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

      // MANUAL (a specific key chosen) runs ONE scene at a time; AUTO runs as many in
      // parallel as there are FREE active keys — the key acquisition below is the gate.
      const isManual = !!(apiKeyId && apiKeyId !== 'auto');
      // Provider routing (Bagian 2): Magica renders ALL scenes in PARALLEL (fire-and-forget)
      // via its own key pool, cycling through a DIFFERENT key per scene (round-robin) —
      // no more one-by-one sequential Magica rendering. Determined once for the batch.
      const isMagica = await magicaGen.isMagicaForStoryboard(getDb(), storyboardId);

      for (let sceneIdx = 0; sceneIdx < totalScenes; sceneIdx++) {
        // Re-read DB connection
        const db = getDb();

        // Check if there is already a successfully generated or processing video for this sceneIdx
        const existingVideo = await db.get(
          'SELECT * FROM generated_videos WHERE storyboard_id = ? AND scene_idx = ? ORDER BY id DESC LIMIT 1',
          [storyboardId, sceneIdx]
        );

        if (existingVideo && (existingVideo.status === 'success' || existingVideo.status === 'processing')) {
          continue;
        }

        // Resolve scene-specific prompt (visual only; VO handled below from the storyboard)
        let promptText = '';
        const matchingPrompt = scenePrompts.find(p => p.scene_idx === sceneIdx);
        if (matchingPrompt) {
          promptText = generationType !== 'text'
            ? (matchingPrompt.imageToVideoPrompt || matchingPrompt.textToVideoPrompt)
            : (matchingPrompt.textToVideoPrompt || matchingPrompt.imageToVideoPrompt);
        }
        if (!promptText) {
          promptText = storyboard.prompt || storyboard.title;
        }

        // VO from the STORYBOARD setting (single source of truth), auto-attached here —
        // no Video Studio VO toggle. Backsound stays a per-video toggle.
        const voCfg = resolveVoConfig(storyboard);
        const hasVo = Boolean(generateAudio && voiceOver);
        const sceneNarration = hasVo ? (getSceneNarration(storyboard, sceneIdx) || (matchingPrompt && matchingPrompt.narration ? String(matchingPrompt.narration).trim() : '')) : '';
        promptText = applyAudioDirectives(promptText, { hasVo, narration: sceneNarration, voLanguage: voCfg.voLanguage, voTone: voCfg.voTone, durationSec: duration, backsound, voiceProfile });
        const nativeAudio = Boolean(generateAudio);

        // Resolve scene image
        const pageIdx = sceneIdx;
        const sceneImage = panelImages[pageIdx];
        let originalCdnUrl = null;
        if (storyboard.original_cdn_urls) {
          try {
            const parsedCdn = JSON.parse(storyboard.original_cdn_urls);
            if (Array.isArray(parsedCdn) && parsedCdn[pageIdx]) originalCdnUrl = parsedCdn[pageIdx];
          } catch (e) {}
        }

        // Magica batch scene — PARALLEL: fired off immediately (not awaited) so ALL
        // queued pages render at once instead of waiting for each page to finish first,
        // and each launch cycles to a DIFFERENT Magica API key (round-robin over the
        // qualifying key pool) instead of reusing a single key.
        if (isMagica) {
          const mAllKeys = await magicaGen.getAllMediaMagicaKeys(db, magicaKeyId);
          const mk = mAllKeys.length ? mAllKeys[sceneIdx % mAllKeys.length] : null;
          const mTaskId = 'video_task_' + Date.now() + '_' + sceneIdx;
          const mWhToken = require('crypto').randomBytes(16).toString('hex');
          const mIns = await db.run(
            `INSERT INTO generated_videos (storyboard_id, scene_idx, prompt, model, aspect_ratio, duration, resolution, status, task_id, api_key_id, magica_key_id, webhook_token) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [storyboardId, sceneIdx, promptText, 'magica:seedance', aspectRatio || null, duration || null, resolution || null, 'processing', mTaskId, null, mk ? mk.id : null, mWhToken]
          );
          const mRecId = mIns.lastID;
          activeTasks[mTaskId] = { status: 'processing', storyboardId, apiKeyId: null, logs: `=== VIDEO (MAGICA) scene ${sceneIdx + 1} (Key #${mk ? mk.id : '-'}) ===\n`, result: null, error: null };

          if (!mk) {
            const _noKeyMsg = 'Tidak ada API Key Magica dengan saldo cukup (>= 5 kredit) untuk video (key < 5 kredit hanya untuk LLM).';
            activeTasks[mTaskId].status = 'failed'; activeTasks[mTaskId].error = _noKeyMsg;
            await db.run('UPDATE generated_videos SET status = ?, error_message = ?, logs = ? WHERE id = ?', ['failed', _noKeyMsg, activeTasks[mTaskId].logs, mRecId]);
            break;
          }

          // Fire-and-forget: do NOT await this scene's generation — start the next
          // queued scene immediately so all pages render in parallel.
          runSingleMagicaVideoSpawn({ mRecId, mTaskId, mk, promptText, sceneImage, originalCdnUrl, generationType, duration, resolution, aspectRatio, generateAudio: nativeAudio, magicaModel, magicaMethod, mWhToken });

          // Small courtesy stagger so simultaneous launches don't all hit Magica at
          // the exact same instant — this does NOT serialize generation itself.
          await sleep(400);
          continue;
        }

        // Acquire an API key — this is ALSO the concurrency gate.
        //  - MANUAL: run ONE scene at a time — wait until this storyboard has no active
        //    task, then reuse the chosen key (so you wait for a page to finish first).
        //  - AUTO: wait until a FREE active key is available, then take it. Parallelism
        //    therefore equals the number of free active keys and no key is used twice at
        //    once; each finished/failed video frees its key for the next queued scene.
        let keyRecord = null;
        if (isManual) {
          while (activeTasksCountForStoryboard() >= 1) {
            await sleep(4000);
          }
          keyRecord = await db.get('SELECT * FROM api_keys WHERE id = ? AND is_active = 1', [apiKeyId]);
          if (!keyRecord) {
            console.warn(`[Batch] Chosen API key ${apiKeyId} is inactive/missing — stopping batch.`);
            break;
          }
        } else {
          for (;;) {
            keyRecord = await getAvailableApiKey(db, { allowFallback: false });
            if (keyRecord) break;
            const activeCount = await db.get('SELECT COUNT(*) AS c FROM api_keys WHERE is_active = 1');
            if (!activeCount || activeCount.c === 0) break; // no active keys at all
            await sleep(4000); // all active keys busy — wait for one to free up
          }
          if (!keyRecord) {
            console.warn('[Batch] No active API key available — stopping batch.');
            break;
          }
        }

        // Create unique task ID
        const taskId = 'video_task_' + Date.now() + '_' + sceneIdx;

        // Insert record in generated_videos
        const insertResult = await db.run(
          `INSERT INTO generated_videos 
           (storyboard_id, scene_idx, prompt, model, aspect_ratio, duration, resolution, status, task_id, api_key_id) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            storyboardId,
            sceneIdx,
            promptText,
            model,
            aspectRatio || null,
            duration || null,
            resolution || null,
            'processing',
            taskId,
            keyRecord.id
          ]
        );
        const videoRecordId = insertResult.lastID;

        // Register active task
        activeTasks[taskId] = {
          status: 'processing',
          storyboardId,
          apiKeyId: keyRecord.id,
          logs: '=== VIDEO STUDIO GENERATION (BATCH QUEUE) ===\n\n' +
                `Scene Index      : ${sceneIdx + 1}\n` +
                `Model            : ${model}\n` +
                `Prompt           : ${promptText}\n` +
                `Type             : ${generationType}\n` +
                `Duration         : ${duration ? duration + 's' : 'Default'}\n` +
                `Resolution       : ${resolution || 'Default'}\n` +
                `Aspect Ratio     : ${aspectRatio || 'Default'}\n` +
                `Audio Native     : ${nativeAudio ? 'aktif' : 'nonaktif'}\n` +
                `Voice Over       : ${hasVo ? 'aktif via prompt' : 'nonaktif'}\n` +
                `Musik Latar      : ${backsound ? 'diizinkan' : 'dilarang via prompt'}\n\n` +
                `[1/3] Mengirimkan perintah generasi ke Freebeat...\n`,
          result: null,
          error: null
        };

        // Spawn execution
        runSingleVideoSpawn(videoRecordId, taskId, keyRecord, promptText, sceneImage, model, generationType, duration, resolution, aspectRatio, nativeAudio, storyboardId);

        // Small courtesy stagger so parallel AUTO starts don't hit the API at the exact
        // same instant. This does NOT serialize — the free-key gate controls parallelism.
        if (!isManual) await sleep(1500);
      }
    })();

  } catch (err) {
    console.error('generateAllVideos failed:', err);
    res.status(500).json({ message: 'Gagal memulai batch video generation.', error: err.message });
  }
}

async function mergeStoryboardVideos(req, res) {
  const { storyboardId } = req.params;
  const { videoIds, transitionType, audioBlend } = req.body || {};
  const db = getDb();
  
  function downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const options = {
        hostname: parsedUrl.hostname,
        path: parsedUrl.pathname + parsedUrl.search,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        timeout: 20000
      };
      
      const file = fs.createWriteStream(destPath);
      const protocol = url.startsWith('https') ? https : http;
      
      protocol.get(options, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`Failed to download: HTTP ${response.statusCode}`));
          return;
        }
        response.pipe(file);
        file.on('finish', () => {
          file.close(resolve);
        });
      }).on('error', (err) => {
        fs.unlink(destPath, () => reject(err));
      });
    });
  }

  function getVideoMetadata(filePath) {
    return new Promise((resolve) => {
      const { exec } = require('child_process');
      const cmd = `"${ffprobePath}" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`;
      exec(cmd, (error, stdout) => {
        if (error) {
          resolve({ duration: 15, hasAudio: true });
        } else {
          const duration = parseFloat(stdout.trim()) || 15;
          const audioCmd = `"${ffprobePath}" -v error -select_streams a:0 -show_entries stream=codec_type -of default=noprint_wrappers=1:nokey=1 "${filePath}"`;
          exec(audioCmd, (aErr, aStdout) => {
            const hasAudio = !aErr && aStdout && aStdout.toLowerCase().includes('audio');
            resolve({ duration, hasAudio });
          });
        }
      });
    });
  }

  function getVideoDimensions(filePath) {
    return new Promise((resolve) => {
      const { exec } = require('child_process');
      const cmd = `"${ffprobePath}" -v error -select_streams v:0 -show_entries stream=width,height -of default=noprint_wrappers=1:nokey=1 "${filePath}"`;
      exec(cmd, (error, stdout) => {
        if (error) {
          resolve({ width: 720, height: 1280 });
        } else {
          const lines = stdout.trim().split(/\s+/).map(l => parseInt(l.trim())).filter(n => !isNaN(n));
          if (lines.length >= 2) {
            resolve({ width: lines[0], height: lines[1] });
          } else {
            resolve({ width: 720, height: 1280 });
          }
        }
      });
    });
  }

  function ensureVideoHasAudio(filePath, duration = 15) {
    return new Promise((resolve, reject) => {
      const { exec } = require('child_process');
      const tempOut = path.join(uploadsDir, `silent_audio_${Date.now()}_${Math.random().toString(36).substr(2, 5)}.mp4`);
      const cmd = `"${ffmpegPath}" -y -i "${filePath}" -f lavfi -i "anullsrc=channel_layout=stereo:sample_rate=44100" -map 0:v -map 1:a -c:v copy -c:a aac -t ${duration} "${tempOut}"`;
      exec(cmd, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`Gagal menyuntikkan audio hening: ${stderr || error.message}`));
        } else {
          resolve(tempOut);
        }
      });
    });
  }

  const tempFiles = [];
  let listPath = '';

  try {
    const storyboard = await db.get('SELECT * FROM storyboards WHERE id = ?', [storyboardId]);
    if (!storyboard) {
      return res.status(404).json({ message: 'Storyboard tidak ditemukan.' });
    }

    let videos = [];
    if (Array.isArray(videoIds) && videoIds.length > 0) {
      // Query specific video IDs selected by the user
      const placeholders = videoIds.map(() => '?').join(',');
      const dbVideos = await db.all(
        `SELECT * FROM generated_videos 
         WHERE id IN (${placeholders}) AND storyboard_id = ? AND status = "success"`,
        [...videoIds, storyboardId]
      );
      // Sort in the exact order of videoIds array to respect custom ordering
      videos = dbVideos.sort((a, b) => videoIds.indexOf(a.id) - videoIds.indexOf(b.id));
    } else {
      // Fallback: Pick only the latest successful video for each scene_idx (to prevent duplicates)
      const allVideos = await db.all(
        `SELECT * FROM generated_videos 
         WHERE storyboard_id = ? AND status = "success" 
         ORDER BY id DESC`,
        [storyboardId]
      );
      
      const seenScenes = new Set();
      const latestVideos = [];
      for (const v of allVideos) {
        if (!seenScenes.has(v.scene_idx)) {
          seenScenes.add(v.scene_idx);
          latestVideos.push(v);
        }
      }
      // Sort chronologically by scene index
      videos = latestVideos.sort((a, b) => a.scene_idx - b.scene_idx);
    }

    if (!videos || videos.length === 0) {
      return res.status(400).json({ message: 'Tidak ada video sukses yang ditemukan untuk digabungkan.' });
    }

    if (videos.length < 2) {
      return res.status(400).json({ message: 'Minimal harus ada 2 video sukses untuk dapat digabungkan.' });
    }

    const localPaths = [];
    for (let i = 0; i < videos.length; i++) {
      const video = videos[i];
      const videoUrl = video.video_url;
      const isLocal = !videoUrl.startsWith('http') || videoUrl.includes('/uploads/');
      let localPath = '';

      if (isLocal) {
        let relativePath = videoUrl;
        if (videoUrl.includes('/uploads/')) {
          relativePath = videoUrl.substring(videoUrl.indexOf('/uploads/') + 9);
        } else {
          relativePath = videoUrl.replace(/^\/?uploads\//, '');
        }
        localPath = path.join(uploadsDir, relativePath);
      } else {
        const tempFilename = `temp_merge_${Date.now()}_${i}.mp4`;
        localPath = path.join(uploadsDir, tempFilename);
        tempFiles.push(localPath);
        await downloadFile(videoUrl, localPath);
      }

      if (!fs.existsSync(localPath)) {
        throw new Error(`File video tidak ditemukan secara lokal untuk scene ${video.scene_idx + 1}`);
      }
      localPaths.push(localPath);
    }

    const outputFilename = `merged_${storyboardId}_${Date.now()}.mp4`;
    const outputPath = path.join(uploadsDir, outputFilename);
    const { exec } = require('child_process');

    const activeTransition = transitionType || 'none';

    if (activeTransition === 'none') {
      const { width, height } = await getVideoDimensions(localPaths[0]);

      // Pre-process paths: Ensure all have audio
      const processedPaths = [];
      for (const p of localPaths) {
        const { hasAudio, duration } = await getVideoMetadata(p);
        if (!hasAudio) {
          const withAudioPath = await ensureVideoHasAudio(p, duration);
          tempFiles.push(withAudioPath);
          processedPaths.push(withAudioPath);
        } else {
          processedPaths.push(p);
        }
      }

      let currentPath = processedPaths[0];

      for (let i = 1; i < processedPaths.length; i++) {
        const nextPath = processedPaths[i];
        const nextTempOut = path.join(uploadsDir, `temp_merged_step_${i}_${Date.now()}.mp4`);
        tempFiles.push(nextTempOut);

        const filterComplex = 
          `[0:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1[v0]; ` +
          `[1:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1[v1]; ` +
          `[0:a]aresample=async=1:ochl=stereo:osr=44100[a0]; ` +
          `[1:a]aresample=async=1:ochl=stereo:osr=44100[a1]; ` +
          `[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]`;

        await new Promise((resolve, reject) => {
          const ffmpegCmd = `"${ffmpegPath}" -y -i "${currentPath}" -i "${nextPath}" -filter_complex "${filterComplex}" -map "[v]" -map "[a]" -c:v libx264 -crf 18 -b:v 6M -preset fast -c:a aac -b:a 192k -pix_fmt yuv420p "${nextTempOut}"`;
          exec(ffmpegCmd, (error, stdout, stderr) => {
            if (error) {
              reject(new Error(`FFmpeg error at step ${i}: ${stderr || error.message}`));
            } else {
              resolve();
            }
          });
        });

        currentPath = nextTempOut;
      }

      fs.copyFileSync(currentPath, outputPath);
    } else {
      // Transition merging
      const { width, height } = await getVideoDimensions(localPaths[0]);

      // Pre-process paths: Ensure all have audio
      const processedPaths = [];
      for (const p of localPaths) {
        const { hasAudio, duration } = await getVideoMetadata(p);
        if (!hasAudio) {
          const withAudioPath = await ensureVideoHasAudio(p, duration);
          tempFiles.push(withAudioPath);
          processedPaths.push(withAudioPath);
        } else {
          processedPaths.push(p);
        }
      }

      let currentPath = processedPaths[0];

      for (let i = 1; i < processedPaths.length; i++) {
        const nextPath = processedPaths[i];
        const { duration: dur1 } = await getVideoMetadata(currentPath);

        const transitionDur = 1.0;
        let offset = dur1 - transitionDur;
        if (offset < 0) offset = 0;

        const nextTempOut = path.join(uploadsDir, `temp_merged_step_${i}_${Date.now()}.mp4`);
        tempFiles.push(nextTempOut);

        const isAudioBlend = audioBlend !== false;
        const audioFilter = isAudioBlend 
          ? `[0:a]aresample=async=1:ochl=stereo:osr=44100[a0]; [1:a]aresample=async=1:ochl=stereo:osr=44100[a1]; [a0][a1]acrossfade=d=1[a]` 
          : `[0:a]aresample=async=1:ochl=stereo:osr=44100[a0]; [1:a]aresample=async=1:ochl=stereo:osr=44100[a1]; [a0][a1]concat=n=2:v=0:a=1[a]`;

        const filterComplex = 
          `[0:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1[v0]; ` +
          `[1:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1[v1]; ` +
          `[v0][v1]xfade=transition=${activeTransition}:duration=${transitionDur}:offset=${offset.toFixed(2)}[v]; ` +
          audioFilter;

        await new Promise((resolve, reject) => {
          // Using -crf 18 and -b:v 6M / -b:a 192k for pristine high-definition video and audio quality!
          const ffmpegCmd = `"${ffmpegPath}" -y -i "${currentPath}" -i "${nextPath}" -filter_complex "${filterComplex}" -map "[v]" -map "[a]" -c:v libx264 -crf 18 -b:v 6M -preset fast -c:a aac -b:a 192k -pix_fmt yuv420p "${nextTempOut}"`;
          exec(ffmpegCmd, (error, stdout, stderr) => {
            if (error) {
              reject(new Error(`FFmpeg error at step ${i}: ${stderr || error.message}`));
            } else {
              resolve();
            }
          });
        });

        currentPath = nextTempOut;
      }

      fs.copyFileSync(currentPath, outputPath);
    }

    if (listPath && fs.existsSync(listPath)) {
      fs.unlinkSync(listPath);
      listPath = '';
    }
    for (const f of tempFiles) {
      if (fs.existsSync(f) && f !== outputPath) {
        try { fs.unlinkSync(f); } catch (e) {}
      }
    }

    const finalMergedUrl = `/uploads/${outputFilename}`;
    
    // Maintain history of all merged video versions generated for this storyboard
    const sbRecord = await db.get('SELECT merged_video_url, merged_video_history FROM storyboards WHERE id = ?', [storyboardId]);
    let history = [];
    if (sbRecord && sbRecord.merged_video_history) {
      try { history = JSON.parse(sbRecord.merged_video_history); } catch (e) { history = []; }
    }
    if (!Array.isArray(history)) history = [];
    if (sbRecord && sbRecord.merged_video_url && !history.includes(sbRecord.merged_video_url)) {
      history.push(sbRecord.merged_video_url);
    }
    if (!history.includes(finalMergedUrl)) {
      history.push(finalMergedUrl);
    }

    const historyJson = JSON.stringify(history);
    await db.run('UPDATE storyboards SET merged_video_url = ?, merged_video_history = ? WHERE id = ?', [finalMergedUrl, historyJson, storyboardId]);

    res.json({
      message: 'Video berhasil digabungkan.',
      merged_video_url: finalMergedUrl,
      merged_video_history: historyJson
    });

  } catch (err) {
    if (listPath && fs.existsSync(listPath)) {
      try { fs.unlinkSync(listPath); } catch (e) {}
    }
    for (const f of tempFiles) {
      if (fs.existsSync(f)) {
        try { fs.unlinkSync(f); } catch (e) {}
      }
    }
    console.error('[Video Concat] Merging failed:', err);
    res.status(500).json({ message: 'Gagal menggabungkan video.', error: err.message });
  }
}

async function deleteMergedVideo(req, res) {
  const { storyboardId } = req.params;
  try {
    const db = getDb();
    const sb = await db.get('SELECT * FROM storyboards WHERE id = ? AND user_id = ?', [storyboardId, req.user.id]);
    if (!sb) {
      return res.status(404).json({ message: 'Storyboard tidak ditemukan.' });
    }

    let history = [];
    try {
      if (sb.merged_video_history) history = JSON.parse(sb.merged_video_history);
    } catch (e) {}

    let newMergedUrl = null;
    if (history.length > 0) {
      history.pop();
      if (history.length > 0) {
        newMergedUrl = history[history.length - 1];
      }
    }

    await db.run('UPDATE storyboards SET merged_video_url = ?, merged_video_history = ? WHERE id = ?', [
      newMergedUrl,
      history.length > 0 ? JSON.stringify(history) : null,
      storyboardId
    ]);

    return res.json({ message: 'Video gabungan berhasil dihapus.', merged_video_url: newMergedUrl, merged_video_history: history.length > 0 ? JSON.stringify(history) : null });
  } catch (err) {
    console.error('Failed to delete merged video:', err);
    return res.status(500).json({ message: 'Gagal menghapus video gabungan.', error: err.message });
  }
}

module.exports = {
  generateVideo,
  getStoryboardVideos,
  deleteVideo,
  resumeProcessingVideos,
  regenerateVideoMarketingCopy,
  regenerateStoryboardMarketingCopy,
  generateMarketingCopyInternal,
  generateAllVideos,
  mergeStoryboardVideos,
  previewEffectiveVideoPrompt,
  deleteMergedVideo,
  resolveVoConfig,
  getSceneNarration,
  applyAudioDirectives,
  getCharacterVoiceProfile
};
