# StoryMax — Panduan Lengkap & Handoff untuk AI

> **Cara pakai file ini:** Berikan file ini (utuh) sebagai pesan pertama ke AI lain
> (ChatGPT / Claude / Cursor / Copilot), lalu beri AI itu akses ke repo GitHub
> `curls1337/storymax` (atau clone lokal). Minta AI melanjutkan pengembangan dengan
> mengikuti **Konvensi Kerja & Verifikasi (Bagian 12)**. **Selalu balas Bahasa Indonesia.**
> Format terbaik untuk AI = `.md` (AI membaca markdown natif).

_Terakhir diperbarui: 26 Juli 2026 — mencakup sampai PR #41._

---

## 1. Ringkasan Produk

**StoryMax** = SaaS generator AI dengan 3 output:

1. **Storyboard** — satu lembar (sheet) berisi grid panel bernomor.
2. **Video** — dibuat dari panel storyboard (image-to-video) atau teks (text-to-video).
3. **3D** — model 3D (fitur via Meshy V6).

- Multi-user (JWT), ada peran **admin**.
- UI **Bahasa Indonesia**, tema gelap + aksen emas `#cfae80` (aksen 3D ungu `#a855f7`).
- Dua **provider** generasi:
  - **Freebeat** (asli) — lewat `freebeat-cli` (proses anak yang di-spawn).
  - **Magica** (REST API) — alternatif untuk **gambar, video, LLM**; dan **satu-satunya** untuk **3D**.
- Admin menentukan provider & izin; user memilih provider di **Pengaturan**.

---

## 2. Repo, Deploy, Env

- **Repo:** github.com/curls1337/storymax — branch default `master`.
- **Deploy:** Railway, auto-deploy tiap push/merge ke `master`.
  - Kadang meleset → buka Railway → **Deployments → "Deploy latest commit"** (manual).
- **Live:** https://story.devcurl.me
- **App native** (Capacitor/WebView) memuat URL remote `server.url = https://story.devcurl.me`,
  jadi deploy web otomatis meng-update app iOS/Android saat dibuka ulang.
- **ENV WAJIB di Railway:** `PUBLIC_URL=https://story.devcurl.me`
  → agar Magica bisa mengambil gambar referensi untuk **image-to-image / image-to-video /
  image-to-3D**. **Magica butuh URL publik, TIDAK menerima base64.**

---

## 3. Tech Stack

- **Backend:** Node.js + Express, SQLite (paket `sqlite` + `sqlite3`), JWT auth.
- **Frontend:** React 19 + Vite + Tailwind CSS 4 + Capacitor. Tanpa router (state tab di `App.jsx`).
  Ikon: `lucide-react`. Notifikasi: toast + confirm kustom (`utils/toast.js`, `utils/confirm.js`).
- **Preview 3D:** web component Google `<model-viewer>` (dimuat via CDN di `index.html`).

---

## 4. Struktur Folder & File Penting

### BACKEND (`backend/`)

- `db.js` — init SQLite + semua `CREATE TABLE` + migrasi (pola: `ALTER TABLE` dalam try/catch).
- `services/magicaClient.js` — REST client Magica: `listModels`, `getModelSchema`,
  `getCreditBalance`, `estimateCredits`, `runModel`, `getRun`, `pollRun`, `testConnection`.
- `services/magicaGen.js` — SEMUA logika Magica:
  - Pilih key: `pickMediaMagicaKey` (≥5 kredit, untuk gambar/video/3D),
    `pickRandomMagicaKey` (LLM, utamakan key <5 kredit), `getKeyBalances` (cache 60 dtk),
    `pickMagicaKey` (by id/auto), `MEDIA_MIN_MICRO = 5_000_000`.
  - Build input schema-driven: `buildInput`, `buildMeshyInput`, `resolveSubModel`,
    `getSchemaCached`, `getModelsCached`.
  - Generate: `generateOneImageMagica`, `generateVideoMagica`, `generateMeshy3D`,
    `magicaChatCompletion`.
  - Lain: `getCatalog` (keys+imageModels+videoModels+llmModels), `estimateMagicaCost`,
    `estimateNodeCost`, `isMagicaForStoryboard`, `toPublicUrl`.
- `prompts/aiClient.js` — router LLM: `chatCompletion` + `llmChatViaSettings` (shim balikin
  bentuk respons OpenAI). Jika `ai_settings.llm_provider='magica'` DAN pesan tanpa gambar →
  Magica (key acak); jika ada gambar (vision base64) → selalu endpoint default.
- `prompts/` lain: `masterPromptLLM.js`, `masterPrompt.js` (deterministik, fallback),
  `splitPrompt.js`, `subjectAnalyzer.js` (vision analisa produk), `styleLibrary.js` (30+ gaya),
  `faceMode.js`, `containerShapes.js`, `marketingTone.js`, `sanitizeVideoPrompt.js`.
- `controllers/`:
  - `aiController.js` (`generateVideoPromptsInternal`: prompt I2V/T2V + vision analisa lembar,
    plus penulisan skrip **narration/voiceover** per-scene).
  - `videoController.js` (generate video single + generate-all + `callAi` marketing; helper
    `buildVoiceoverDirective`, `enforceNoVoiceover`, `applyNoBacksound`).
  - `storyboardController.js` (`generateStoryboard`), `adminController.js` (kelola key,
    ai-settings, backup/restore, izin user, **saldo Magica**), `authController.js`, `googleController.js`.
- `jobs/storyboardJobs.js` — job latar render tiap halaman storyboard (cabang Magica per halaman).
- `routes/magicaRoutes.js` — `/api/magica`: `catalog`, `keys`, `estimate`, `3d/generate`,
  `3d/task/:id`, `3d/list`. Semua `authenticateToken`.
- `routes/` lain: `adminRoutes.js`, `authRoutes.js`, `storyboardRoutes.js`, `videoRoutes.js`.
- `server.js` — mount routes (mis. `/api/magica`).

### FRONTEND (`frontend/src/`)

- `App.jsx` — layout + tab: `dashboard | generator | 3d | settings | admin` (nav sidebar
  desktop + bar bawah mobile). Handler `focusin` (nudge keyboard mobile — kecuali `<select>`,
  hanya layar sentuh, hanya bila field tertutup) + pull-to-refresh (hanya dari paling atas).
- `pages/Generator.jsx` — buat storyboard (Freebeat/Magica): pilih gaya, model, ref image,
  pemilih API key, **estimasi biaya gambar + TOTAL (per-gambar × jumlah halaman)**, banner error merah.
- `pages/Dashboard.jsx` — daftar storyboard + Video Studio: buat video (model/metode/durasi/
  resolusi/rasio mengikuti model Magica terpilih), estimasi biaya video, kredit terpakai
  (helper `fmtCredit`), tampilan error video (panel merah). Menyusun prompt video + **direktif
  voiceover** untuk dikirim ke model.
- `pages/ThreeD.jsx` — Studio 3D (Meshy): text/image-to-3D, setting lengkap Meshy, pemilih API
  Key, estimasi, preview besar `<model-viewer>` + strip history + **pemilih Animasi berupa nama
  (Idle/Walk/Run dll)**.
- `pages/AdminPanel.jsx` — tab: API Freebeat, **API Magica** (kelola key + Tes Koneksi +
  **kartu Total Saldo semua key**), Pengaturan AI (Provider LLM + model LLM Magica), Manajemen
  User (izin Magica per-user), Backup/Restore.
- `pages/Settings.jsx` — user pilih Provider (Freebeat/Magica).
- `utils/api.js` — axios instance (base `/api`, sisip token). `utils/toast.js`, `utils/confirm.js`.
- `index.html` — memuat `<model-viewer>` via CDN unpkg.

---

## 5. Model Data (SQLite) — tabel utama

- `users` : + kolom `can_use_magica` (izin Magica per-user), `preferred_provider` ('freebeat'|'magica').
- `api_keys` : kolom key Freebeat.
- `magica_api_keys` : `id, key_value, label, is_active, last_status, created_at`.
- `ai_settings` (1 baris global): `endpoint, api_key, model, llm_provider` ('default'|'magica'),
  `magica_llm_model` (nodeType, mis. `gemini_3_5_flash`).
- `storyboards` : termasuk `image_path` (JSON array path halaman), `used_credits`, `status`,
  `generation_params`, `marketing_title/description`, `video_prompts` (JSON scenes: i2v/t2v/narration).
- `generated_videos` : `storyboard_id, scene_idx, prompt, model, aspect_ratio, duration,
  resolution, status, task_id, video_url, used_credits, error_message, logs`.
- `generated_3d` : `user_id, mode` ('text'|'image'), `prompt, model_url` (.glb), `thumb_url` (.png),
  `credit_used, status, error_message, created_at`.
- `google_settings`, `downloaded_files`.

---

## 6. Sistem Provider (Freebeat vs Magica)

- Per storyboard/user ditentukan `users.preferred_provider` + `users.can_use_magica`.
- Backend memeriksa via `magicaGen.isMagicaForStoryboard(db, storyboardId)` (join storyboard→user).
- Jalur Freebeat **tidak disentuh** oleh integrasi Magica (cabang Magica ditaruh sebagai EARLY
  branch; key Magica di tabel terpisah agar query Freebeat tak berubah — risiko nol).
- **3D = Magica-only** dan terbuka untuk semua user (tak butuh `can_use_magica`), asal ada key
  Magica aktif.

---

## 7. Magica API — Referensi

- Base: `https://api.magica.com/api/v1` — Auth: `Authorization: Bearer gx_...`.
- Run: `POST /nodes/{nodeType}/run` body `{subModelId, input}` → 202 `{runId}`.
- Poll: `GET /nodes/runs/{runId}` → status `QUEUED|RUNNING|COMPLETED|FAILED`.
  - Media (gambar/video/3D): hasil URL di `output.result` (array). LLM: teks di `output.output`.
  - Kredit dipakai: `output.creditUsed` (microcredit; ÷1.000.000 = kredit).
- Estimasi (tanpa efek): `POST /nodes/estimate-credits` body `{nodes:[{type, data, subModelId}]}`
  → `{estimates:[{microcredits}]}`.
- Skema model: `GET /models/{modelId}/schema` → `fields[]` (name, dataType, options, required, default).
- Saldo: `GET /credits/balance` → `{ availableBalance (microcredit), formatted, hasActiveSubscription, ... }`.
- Rate limit: 60/menit, 1000/hari per key (429 + `Retry-After`).
- **Kredit bersifat PER-AKUN** (semua key dari 1 akun berbagi saldo).

### PENTING: field input beda tiap model (input dibangun dari skema)

- Gambar referensi: `uploadedImages` (gpt_image_2) / `image_urls` (grok, flux, nano) /
  `reference_image_urls` (model `*_reference` video).
- Ukuran: `size` (gpt) / `image_size` (flux) / `aspect_ratio` + `resolution` (grok, nano).
- Video: `image_url` (single); durasi/resolusi/rasio beda tiap model.
- 3D (Meshy V6): nodeType `meshy_v6_preview`; submodel `meshy-v6-preview-text` (text-to-3D) /
  `meshy-v6-preview-edit` (image-to-3D). Field: image_urls/prompt, mode(preview/full), topology,
  target_polycount, symmetry_mode, should_remesh, should_texture, enable_pbr, is_a_t_pose,
  rigging_height_meters, **animation_action_id**, texture_prompt. Output `.glb` + thumbnail `.png`.

### Model tersedia (ringkas)

- Gambar: gpt_image_2, grok_imagine_image, flux_2_max, nano_banana_2, nano_banana_pro.
- Video: seedance_2_0, seedance_2_0_fast (+ `*_reference`), veo_3_1, sora_2, sora_2_pro,
  gemini_omni_flash, happy_horse (+ reference), grok_imagine_video, kling_v3_pro.
- LLM: gpt_5_5, gpt_5_5_pro, claude_sonnet_4_6/5, claude_opus_4_7/4_8, gemini_3_1_pro,
  gemini_3_5_flash, gemini_3_1_flash_lite, deepseek_v3_2, grok_4_3.
- 3D: meshy_v6_preview.

---

## 8. LLM (aiClient.js)

- Semua panggilan LLM lewat `chatCompletion(messages, {db,...})` atau shim `llmChatViaSettings(payload,{db})`.
- Routing: `ai_settings.llm_provider` = 'default' → endpoint OpenAI-compatible; 'magica' → model
  LLM Magica (key acak, TEKS SAJA).
- Vision (pesan mengandung gambar/base64) SELALU pakai endpoint default (Magica LLM butuh URL publik).
- Model Magica LLM dipilih admin (`ai_settings.magica_llm_model`).

---

## 9. Aturan Kredit, Estimasi, Pre-flight, Error

- **Aturan 5 kredit:** key Magica < 5 kredit → hanya LLM; gambar/video/3D butuh key ≥ 5 kredit
  (`pickMediaMagicaKey`). Konstanta `MEDIA_MIN_MICRO = 5_000_000`.
- **Pre-flight cost check:** sebelum video/3D, hitung estimasi vs saldo key → gagal cepat (±1 detik)
  dengan pesan jelas kalau saldo kurang. Timeout poll video 25 menit untuk render berat.
- **Estimasi biaya di UI** sebelum generate via `POST /api/magica/estimate`:
  - Generator gambar menampilkan **biaya per-gambar DAN TOTAL = per-gambar × jumlah halaman**
    (jumlah halaman diturunkan dari engine + durasi terpilih; helper `pagesForDuration`).
  - Video Studio & 3D menampilkan estimasi per item.
- **Kredit terpakai** tampil per storyboard & per video (`fmtCredit`: nilai besar = microcredit
  Magica → ÷1e6; nilai kecil = unit Freebeat).
- **Error Magica ASLI** ditampilkan saat gagal: Generator (banner merah), Video Studio (panel
  merah + logs + toast), 3D (panel preview merah + thumbnail gagal bisa diklik).
- Biaya acuan: gambar ~0.21; video seedance-fast 15s/720p ~3.63; seedance 15s/1080p ~10.2;
  3D preview ~0.6–0.8; LLM ~0.0001 kredit.

---

## 10. Fitur 3D (Meshy V6)

- Backend: tabel `generated_3d`; `magicaGen.generateMeshy3D(apiKey, opts)` (text/image-to-3D,
  balikin `{modelUrl (.glb), thumbUrl (.png), credit}`, dengan pre-flight cost check); route
  `POST /magica/3d/generate` (background → simpan ke `generated_3d`), `GET /magica/3d/task/:id`
  (poll baris DB), `GET /magica/3d/list`. Pilih key via `magicaKeyId` ('auto'=saldo tertinggi).
- Frontend `ThreeD.jsx`: mode Text/Image, setting Meshy lengkap, pemilih API key, estimasi live,
  preview besar `<model-viewer>` (440px, camera-controls + auto-rotate + autoplay animasi),
  strip History thumbnail, tampilan error.
- **Animasi (PR #38):** pemilih animasi kini berupa **NAMA** (Diam/Idle, Jalan, Jalan Santai,
  Lari, Lari Cepat, Lompat, Melambai, Menari, Selebrasi) — bukan input angka. Tiap nama dipetakan
  ke `animation_action_id` dari **Meshy Animation Library** (0=Idle, 1=Walking, 30=Casual Walk,
  14=Run, 16=RunFast, 44=Jump, 28=Wave, 22=Dance, 59=Victory). Default = **Idle (0)**. Nilai tetap
  dikirim sebagai `animationActionId` dan diteruskan `buildMeshyInput` tanpa perubahan backend.
- `index.html` memuat `@google/model-viewer` via CDN.

---

## 11. Voice-over (VO) untuk Video

Penting dipahami: **VO bukan TTS terpisah.** Narasi (teks) ditulis LLM per-scene
(`aiController.generateVideoPromptsInternal` → field `narration`), lalu **ditempel ke prompt video**,
dan **model video** (veo/sora/seedance-with-audio, atau Freebeat Pixverse) yang mengucapkannya via
audio native.

- **Direktif VO ter-anchor timing (PR #40):** helper `buildVoiceoverDirective(narration, lang)` di
  `videoController.js` membangun satu direktif audio konsisten: narator **off-screen**, diucapkan
  **merata sepanjang klip & sinkron dengan aksi di layar**, mulai saat shot mulai / selesai ~1 detik
  sebelum habis, **tanpa teks/subtitle di layar**. Ini menggantikan tempelan polos lama
  (`Voiceover (lang): <teks>`) yang membuat model menaruh VO di momen sembarang.
- Dipakai konsisten di **Video Studio** (`Dashboard.jsx`, jalur single) dan **generate-all**
  (`videoController.generateAllVideos`).
- **Fix VO dobel (PR #40):** dulu klien menempel VO ke prompt DAN `generateVideo()` menempelnya lagi
  → narasi dobel (khusus jalur Freebeat single). Penempelan sisi-server di jalur single dihapus
  (klien = single source; generate-all tetap bangun VO di server).
- `enforceNoVoiceover()` (dipakai saat audio OFF) juga menyapu blok format baru `Audio — voiceover:`.
- Aturan tempo/word-count narasi ada di `aiController.js` (~1.5 kata/detik, batas kata per durasi;
  ada truncation otomatis agar tidak kepanjangan).

---

## 12. Konvensi Kerja & Verifikasi (WAJIB DIBACA AI)

**Alur:** buat branch dari `master` → ubah kode → **VERIFIKASI** → push → buka **Pull Request** →
user bilang "Merge PR #X" → **squash-merge** ke `master` (memicu deploy).

**KENDALA:** `npm` DIBLOKIR di sandbox (tidak bisa build/bundle, registry 403). Maka verifikasi manual:

- **Backend:** `node -c file.js` (cek sintaks). Modul yang `require('sqlite3')` native tak bisa
  di-run penuh — cukup `node -c`.
- **Frontend (JSX tak bisa `node -c`):** hitung keseimbangan karakter — jumlah `{` == `}`,
  `(` == `)`, `<div>` == `</div>`, `<>` == `</>` (semua selisih harus 0). Tips: bandingkan delta
  vs versi `HEAD` (git) agar false-positive lama (mis. `[` dalam kelas Tailwind atau `<span/>`
  self-closing) tidak dianggap error — yang penting delta perubahan berimbang.
- **Scan TDZ (WAJIB — pernah bikin layar blank):** pastikan dependency array `useEffect/useMemo`
  TIDAK merujuk `useState`/const yang dideklarasikan **setelah** hook itu. Taruh `useEffect`
  setelah deklarasi state yang dipakainya. (Dependency array dievaluasi eager saat render → TDZ
  "Cannot access X before initialization" → seluruh app blank.)
- **Tes API Magica live (opsional):** jalankan node kecil memakai `services/magicaClient.js`
  (read-only atau job murah) untuk verifikasi skema/biaya.

**Selalu balas Bahasa Indonesia. Jangan sentuh jalur Freebeat.**

---

## 13. Gotchas / Jebakan

- Auto-deploy Railway kadang meleset → "Deploy latest commit" manual.
- Hook order/TDZ (lihat Bagian 12) — penyebab utama layar blank.
- `PUBLIC_URL` wajib untuk fitur berbasis gambar-referensi Magica (image-to-image/video/3D).
- LLM vision (base64) selalu pakai provider default, bukan Magica.
- Satuan kredit campur: Magica = microcredit (÷1e6); Freebeat = unit sendiri → pakai `fmtCredit`.
- **Kredit Magica per-AKUN:** tambah key dari akun SAMA tak menambah saldo; untuk saldo lebih,
  tambah key dari akun Magica LAIN. (Berpengaruh ke Total Saldo — lihat #41: total di-dedupe
  per-akun bila API beri identitas akun, kalau tidak ada peringatan "bisa dobel-hitung".)
- Keamanan: JANGAN echo/commit API key. Key `gx_` yang pernah dipakai sebaiknya di-revoke & buat
  baru, dimasukkan lewat Admin → API Magica (bukan di kode).

---

## 14. Riwayat Fitur (kronologis) — apa yang sudah ditambahkan

Semua sudah ter-merge ke `master` kecuali yang ditandai closed/superseded.

- **PR #17** — Notifikasi: ganti SEMUA `alert()/confirm()` native (43 buah) dengan sistem toast +
  confirm-modal on-brand (dark + emas), tanpa dependensi.
- **PR #18** — Perbaikan prompt video: I2V = HANYA arahan kamera/pencahayaan/gerak (bukan
  "buat/ciptakan produk"), ikut storyboard; framing anti-crop untuk gaya transform; kamera ASMR lebih lebar.
- **PR #19** — 3 gaya layout baru: `bts_practical_fx`, `mini_restoration_asmr`, `jelly_character_asmr`.
- **PR #20** — Audit mobile iOS/Android (Capacitor WebView): scroll, safe-area, keyboard.
- **PR #21** — Fidelity per-gaya: untuk 6 gaya transform kreatif, referensi = INSPIRASI; gaya lain tetap ketat.
- **PR #22** — Pull-to-refresh gating (hanya tarik sengaja dari paling atas).
- **PR #23** — Anti-grid video prompts (jangan animasikan lembar grid); audit 30 gaya; `sanitizeCameraForVideo()`.
- **PR #24** — Backup & Restore DB (admin export/import JSON semua tabel: link + settings, bukan file video).
- **PR #25** — Tuning gaya transform (cube: tekan tombol → lempar → auto-unfold; shape tetap mekanis; asmr = die-cast premium).
- **PR #26** — Magica provider Bagian 1+2: fondasi (kolam key `magica_api_keys`, izin per-user,
  pilihan provider, REST client) + routing generate gambar & video ke Magica.
- **PR #27** — Magica Bagian 3: pemilih provider-aware (list key/model/metode ikut Magica).
- **PR #28** — Dropdown API Key Magica bisa dipilih + opsi Auto; input schema-driven untuk SEMUA
  model (perbaiki crash grok "expected array"); katalog + saldo per key.
- **PR #29** — HOTFIX layar blank (TDZ): pindah `useEffect` clamp setelah deklarasi state.
- **PR #30** — Fix dropdown bikin halaman "geser sendiri" (focusin scrollIntoView) + select Magica value selalu valid.
- **PR #31** — LLM via Magica: admin pilih Provider LLM (Default/Magica), key acak, model LLM Magica; vision → tetap default.
- **PR #32** — (CLOSED, digabung ke #33) Aturan key 5 kredit + pre-flight biaya video.
- **PR #33** — Estimasi biaya sebelum generate + kredit terpakai + Tab 3D (Meshy V6) dengan `<model-viewer>`.
- **PR #34** — 3D: pemilih API Key (Auto + list) + 3D terbuka untuk semua user (tanpa izin per-user).
- **PR #35** — (CLOSED, digabung ke #36) 3D preview besar + history strip.
- **PR #36** — Tampilkan error Magica asli untuk gambar & 3D (video sudah). (Termasuk layout #35.)
- **PR #37** — README lengkap (tutorial, arsitektur Mermaid, konfigurasi, API, troubleshooting, gambar).
- **PR #38** — **Studio 3D: pemilih animasi berupa NAMA** (Idle/Walk/Run dll) menggantikan input
  angka `animation_action_id`; dipetakan ke Meshy Animation Library; default Idle (0). Frontend saja.
- **PR #39** — **Estimasi TOTAL di Generator** = biaya per-gambar × jumlah halaman (dari engine +
  durasi). Tambah field `pages` di `ENGINE_DURATIONS` + helper `pagesForDuration`. Frontend saja, khusus Magica.
- **PR #40** — **Voice-over veo: direktif ter-anchor timing** (narator off-screen, merata sepanjang
  klip, sinkron aksi, tanpa subtitle) menggantikan tempelan polos; satu format konsisten via helper
  `buildVoiceoverDirective` (Video Studio + generate-all); **FIX bug VO dobel** di jalur Freebeat
  single; `enforceNoVoiceover` menyapu format baru. Jalur Freebeat (key/CLI) tidak disentuh.
- **PR #41** — **Admin: Total Saldo semua key Magica.** Endpoint baru `GET /api/admin/magica/balances`
  (saldo per-key + total), **dedupe per-akun** (bila API beri identitas akun) + flag `mayDoubleCount`;
  kartu Total Saldo di tab API Magica (chip saldo per-key + tombol Refresh, auto-refresh saat tab
  dibuka / daftar key berubah).

---

## 15. Status Saat Ini & Pending

**Selesai:** semua fitur Bagian 14 (termasuk #37–#41) ada di `master` & live (setelah deploy).

**Pending (aktivasi oleh user/admin — bukan kode):**

- Set `PUBLIC_URL` di Railway.
- Revoke key `gx_` lama, buat baru → Admin → API Magica → Tes Koneksi.
- Top up / tambah key dari **akun Magica lain** agar saldo ≥ 5 untuk gambar/video (3D cukup ~0.8).
- Grant user `can_use_magica` + user pilih Provider = Magica (untuk gambar/video/LLM; 3D bebas).

**Ide lanjutan (opsional) — yang MASIH tersisa:**

- Auto-fallback ke Freebeat saat semua key Magica < 5 kredit (khusus gambar/video).
- Tombol "Salin error".

_(Sudah selesai & dipindah ke Riwayat: Total saldo Magica di Admin = #41; Nama animasi 3D = #38;
Estimasi total per-gambar × halaman = #39.)_

---

## 16. Cara melanjutkan (contoh perintah ke AI lain)

> "Baca STORYMAX_HANDOFF.md. Aku mau tambah fitur X. Buat branch dari `master`, ubah kodenya,
> verifikasi sesuai Bagian 12 (npm diblokir → `node -c` + hitung keseimbangan + scan TDZ), lalu
> buka Pull Request. Jangan sentuh jalur Freebeat. Balas Bahasa Indonesia."
