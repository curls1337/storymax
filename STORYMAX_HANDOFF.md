# StoryMax — Panduan Lengkap & Handoff untuk AI

> **Cara pakai file ini:** Berikan file ini (utuh) sebagai pesan pertama ke AI lain
> (ChatGPT / Claude / Cursor / Copilot), lalu beri AI itu akses ke repo GitHub
> `curls1337/storymax` (atau clone lokal). Minta AI melanjutkan pengembangan dengan
> mengikuti **Konvensi Kerja & Verifikasi (Bagian 12)**. **Selalu balas Bahasa Indonesia.**
> Format terbaik untuk AI = `.md` (AI membaca markdown natif).

_Terakhir diperbarui: 27 Juli 2026 — mencakup sampai PR #54._

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
  `getCreditBalance`, `estimateCredits`, `runModel` (menerima objek `webhook` opsional), `getRun`, `pollRun`,
  `testConnection`.
- `services/magicaGen.js` — SEMUA logika Magica:
  - Pilih key: `pickMediaMagicaKey` (≥5 kredit, untuk gambar/video/3D),
    `pickRandomMagicaKey` (LLM, utamakan key <5 kredit), `getKeyBalances` (cache 60 dtk),
    `pickMagicaKey` (by id/auto), `MEDIA_MIN_MICRO = 5_000_000`.
  - Build input schema-driven: `buildInput`, `buildMeshyInput`, `resolveSubModel`,
    `getSchemaCached`, `getModelsCached`. `isSingleImageField` memetakan gambar ke SEMUA field gambar-tunggal
    model i2v/referensi (termasuk `start_image_url` milik kling) — **#47**; `generateVideoMagica` fail-fast
    bila model butuh gambar tapi tak ada URL publik.
  - Webhook (async): `buildWebhook`/`onRunStart` menyimpan `magica_run_id`+`magica_key_id`+`webhook_token`
    per-run; `extractMeshyResult` untuk hasil 3D — **#48**.
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
    ai-settings, backup/restore, izin user, **saldo Magica**, **pemakaian Magica per-user**), `authController.js`.
  - `googleController.js` — pengaturan Google + **3 ekspor sebagai BACKGROUND JOB** (`exportToGoogleSheets`,
    `exportToCSV`, `exportFullCSV` via `exportCsvJob`): balas `{jobId,status:'processing',message}` seketika,
    kerja berat di IIFE async, catat progres di `user_google_exports`. Helper `buildSimpleRows` (6 kolom),
    `buildFullRows` (per-scene, semua prompt+link), `rowsToCsv` (BOM UTF-8), `saveExportCsv` (tulis ke
    `uploads/exports/`), `buildGoogleAuth` (SA JWT / OAuth2). Judul/caption diambil dari **AI Marketing Copy**
    (`getMarketingCopyForStoryboard`, auto-generate via `videoController.generateMarketingCopyInternal` bila kosong).
- `services/googleOAuth.js` — **OAuth Google per-user**: SCOPES (`drive.file`, `spreadsheets`, userinfo),
  `getAuthUrl`/`exchangeCode`/`fetchProfile`, `signState`/`verifyState` (JWT `state` 15 mnt),
  `getAuthorizedClientForUser` (auto-refresh token), `upsert/get/deleteAccount`, `recordExport`, `listExports`.
- `jobs/storyboardJobs.js` — job latar render tiap halaman storyboard (cabang Magica per halaman).
- `routes/magicaRoutes.js` — `/api/magica`: `catalog`, `keys`, `estimate`, `3d/generate`,
  `3d/task/:id`, `3d/list`, `3d/:id` (DELETE — hapus item history). Semua `authenticateToken`.
- `routes/magicaWebhook.js` — **PUBLIC** `POST /api/magica/webhook` (dipanggil Magica, bukan browser):
  cocokkan `metadata.token` == `webhook_token` DB & selesaikan pakai `magica_key_id` yang tepat. Di-mount
  SEBELUM router `/api/magica` ber-auth.
- `routes/googleAuthRoutes.js` — `/api/google/oauth`: `/url`, `/status`, `/exports`, `/disconnect` (auth),
  `/exports/:id/download` (auth via query-token, streaming CSV), dan **`/callback` PUBLIC** (Google redirect
  browser ke sini; identitas user dibawa lewat `state` bertandatangan). Di-mount SEBELUM middleware auth global.
- `routes/` lain: `adminRoutes.js`, `authRoutes.js`, `storyboardRoutes.js` (+ `export-google-sheets`,
  `export-csv`, `export-full-csv`), `videoRoutes.js`.
- `server.js` — mount routes; `/api/magica/webhook` & `/api/google/oauth` di-mount sebelum auth global.

### FRONTEND (`frontend/src/`)

- `App.jsx` — layout + tab: `dashboard | generator | 3d | settings | admin` (nav sidebar
  desktop + bar bawah mobile). Handler `focusin` (nudge keyboard mobile — kecuali `<select>`,
  hanya layar sentuh, hanya bila field tertutup) + pull-to-refresh (hanya dari paling atas).
- `pages/Generator.jsx` — buat storyboard (Freebeat/Magica): pilih gaya, model, ref image,
  pemilih API key, **estimasi biaya gambar + TOTAL (per-gambar × jumlah halaman)**, banner error merah.
- `pages/Dashboard.jsx` — daftar storyboard + Video Studio: buat video dengan **Metode Pembuatan dulu**
  (text/image/reference), lalu model Magica difilter sesuai metode (durasi/resolusi/rasio ikut model),
  **Gaya Bahasa Narasi lebih besar + deskripsi** (#45), estimasi biaya, kredit terpakai (`fmtCredit`),
  panel error merah, prompt video + **direktif voiceover**. **Ekspor (CSV / Full / Cloud) memicu BACKGROUND
  JOB** → balas `{jobId}` → toast "cek di Settings → Riwayat Export" (tak ada blob/modal lagi; #54).
- `pages/ThreeD.jsx` — Studio 3D (Meshy): text/image-to-3D, setting lengkap Meshy, pemilih API Key,
  estimasi, preview besar `<model-viewer>`, **pemilih Animasi berupa nama (Idle/Walk/Run dll)** (#38),
  **panel Logs + status proses jelas** (#44), **History di bawah lebar-penuh + tombol Hapus item** (#44/#46).
- `pages/AdminPanel.jsx` — tab: API Freebeat, **API Magica** (kelola key konsolidasi + Tes Koneksi +
  **kartu Total Saldo semua key**), Pengaturan AI (Provider LLM + model LLM Magica), Manajemen User
  (izin Magica per-user + **kolom Magica-terpakai per-user**, #43), **Google** (OAuth-first: Client ID/Secret/
  Redirect URI; upload JSON OAuth Client auto-isi 3 field; Service Account di "Opsi Lanjutan", #49/#51),
  Backup/Restore.
- `pages/Settings.jsx` — user pilih Provider (Freebeat/Magica) + **Hubungkan Akun Google** (OAuth per-user)
  + **Riwayat Export** (tipe Cloud/CSV/Full, badge status Diproses/Selesai/Gagal, tombol Buka/Download,
  polling otomatis tiap 4 dtk selama ada job berjalan; #50/#53/#54).
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
  resolution, status, task_id, video_url, used_credits, error_message, logs` + **`magica_run_id,
  magica_key_id, webhook_token`** (untuk penyelesaian webhook async, #48).
- `generated_3d` : `user_id, mode` ('text'|'image'), `prompt, model_url` (.glb), `thumb_url` (.png),
  `credit_used, status, error_message, created_at` + **`logs, magica_run_id, magica_key_id, webhook_token`**.
- `google_settings` (1 baris): `client_id, client_secret, redirect_uri` (OAuth per-user, #50/#51) +
  `service_account_json` (opsi lanjutan, #49) + field lama Drive/Sheets.
- `user_google_accounts` (**#50**, PK `user_id`): `email, name, picture, access_token, refresh_token,
  expiry_date, spreadsheet_id, spreadsheet_url` — koneksi Google per-user (refresh token). FK→users (CASCADE).
- `user_google_exports` (**#53/#54**): `id, user_id, type` (cloud|csv|full)`, status` (processing|success|failed)`,
  spreadsheet_id, spreadsheet_url, file_path` (CSV di server)`, title, item_count, total, error, created_at,
  updated_at` — riwayat/antrean ekspor (background job). FK→users (CASCADE).
- `downloaded_files`.
- **Catatan:** "pemakaian Magica per-user" (#43) BUKAN kolom tersimpan — dihitung on-the-fly di
  `adminController` (SUM `used_credits` storyboard ber-flag magica + video `model LIKE 'magica:%'` + semua 3D).
- **Backup/Restore (#54, versi 3):** `BACKUP_TABLES` mencakup **seluruh 11 tabel** termasuk
  `user_google_accounts` & `user_google_exports`; backup pakai `SELECT *` + restore intersect schema
  (kolom baru otomatis ikut), backward-compatible dgn backup versi 2.

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
- Video: field gambar-tunggal beda tiap model — `image_url`, `start_image_url` (kling), dll. `buildInput`
  memetakan gambar storyboard ke **semua** varian ini via `isSingleImageField` (#47); durasi/resolusi/rasio beda tiap model.
- **Webhook (opsional, #48):** body run boleh menyertakan objek `webhook` (Svix). Lihat **Bagian 17**.
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
  (poll baris DB), `GET /magica/3d/list`, **`DELETE /magica/3d/:id`** (hapus item history, #46).
  Pilih key via `magicaKeyId` ('auto'=saldo tertinggi). **Job 'processing' basi >30 menit
  di-auto-gagalkan** agar tak stuck selamanya (#46).
- Frontend `ThreeD.jsx`: mode Text/Image, setting Meshy lengkap, pemilih API key, estimasi live,
  preview besar `<model-viewer>` (440px, camera-controls + auto-rotate + autoplay animasi),
  tampilan error. **#44/#46:** **panel Logs** + status proses lebih jelas, **History dipindah ke bawah
  (lebar penuh)**, dan tiap item punya **tombol Hapus**.
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
- **PR #42** — **Dokumen handoff ini** (`STORYMAX_HANDOFF.md`). _(Awalnya s/d #41; kini diperbarui s/d #54.)_
- **PR #43** — **Admin: pemakaian Magica per-user** (kolom di Manajemen User, dihitung dari storyboard
  ber-flag magica + video `magica:%` + semua 3D) + **konsolidasi kartu key Magica** (buang tabel padat,
  ganti manajemen key yang ringkas) + **backup menyertakan `generated_3d`**.
- **PR #44** — **3D: panel Logs + status proses jelas**, dan **History dipindah ke bawah (lebar penuh)**
  supaya preview utama lebih lega.
- **PR #45** — **Video: "Metode Pembuatan" didahulukan** (text/image/reference) lalu daftar model Magica
  **difilter sesuai metode**; **"Gaya Bahasa Narasi" dibuat lebih besar + deskripsi** tiap pilihan.
- **PR #46** — **3D: tombol Hapus item history** (+ route `DELETE /magica/3d/:id`) dan **auto-gagalkan job
  'processing' yang basi > 30 menit** agar tak stuck selamanya.
- **PR #47** — **Fix gambar i2v/referensi Magica selalu terkirim.** `buildInput` kini memetakan gambar
  storyboard ke SEMUA field gambar-tunggal (termasuk `start_image_url` kling) via `isSingleImageField`;
  `generateVideoMagica` **fail-fast** bila model butuh gambar tapi tak ada URL publik (dulu hasil melenceng
  karena gambar tak ikut terkirim).
- **PR #48** — **Webhook Magica async (via API)** untuk video & 3D. Tiap run dimulai dgn `webhook` + token acak;
  DB record menyimpan `magica_run_id`+`magica_key_id`+`webhook_token`. Receiver PUBLIC
  `POST /api/magica/webhook` menyelesaikan record pakai **key yang tepat** (runId scoped per-key → aman untuk
  multi-key/bulk). **Polling tetap jalur utama**, webhook = cadangan (mis. server restart). Lihat Bagian 17.
- **PR #49** — **Export "Full"** (CSV per-scene: semua prompt gambar+video, narasi, semua link, kredit,
  marketing copy — link saja, rapi) + dukung **Google Service Account JSON** sebagai auth ekspor + panduan
  setup Google Console.
- **PR #50** — **Login Google per-user.** Admin cukup sediakan OAuth App sekali; tiap USER hubungkan akun
  Google-nya sendiri di Settings; ekspor tulis Sheet ke Drive user itu (dibagikan `anyone: writer` = editor,
  bukan private). Tabel `user_google_accounts`, service `googleOAuth.js`, route `/api/google/oauth`
  (`/callback` PUBLIC, identitas via `state` JWT bertandatangan).
- **PR #51** — **Sederhanakan setup Google di Admin:** OAuth-first (cukup Client ID + Secret + Redirect URI);
  upload JSON "OAuth Client" **auto-isi 3 field**; Service Account dipindah ke "Opsi Lanjutan". (Menjawab
  kebingungan "Service Account JSON tidak valid" saat user menempel JSON OAuth Client di field yang salah.)
- **PR #52** — **Export ambil Judul & Caption dari AI Marketing Copy**; bila kosong, **auto-generate**
  (`generateMarketingCopyInternal`) lalu disimpan, jadi kolom judul/caption tidak lagi salah/kosong.
- **PR #53** — **Tiap export = spreadsheet BARU** (tidak menimpa/menyatu dgn yang lama) + **daftar spreadsheet
  di Settings** (di bawah login Google) agar mudah tahu mana yang sudah dipakai. Tabel `user_google_exports`.
- **PR #54** — **Semua export jadi BACKGROUND JOB** (Cloud + CSV + Full): request balik seketika `{jobId}`,
  kerja berat lanjut di server (**anti-502**, **tetap jalan walau pindah tab / tab ditutup**). **Settings →
  Riwayat Export** menampilkan tipe + status (Diproses/Selesai/Gagal) + **Buka** (cloud) / **Download** (CSV,
  via `/exports/:id/download`), auto-refresh (polling 4 dtk). **Backup/Restore versi 3** menyertakan
  `user_google_accounts` & `user_google_exports` (audit: seluruh 11 tabel tercakup).

---

## 15. Status Saat Ini & Pending

**Selesai:** semua fitur Bagian 14 (termasuk #37–#54) ada di `master` & live (setelah deploy).

**Pending (aktivasi oleh user/admin — bukan kode):**

- Set `PUBLIC_URL` di Railway (dipakai gambar-referensi Magica, **callback OAuth Google**, & **webhook Magica**).
- **Keamanan — WAJIB rotate:** API key Magica `gx_…` dan **Google Client Secret** yang pernah tampil di
  chat/screenshot harus di-revoke & dibuat ulang, lalu dimasukkan lewat Admin (bukan di kode).
- Revoke key `gx_` lama, buat baru → Admin → API Magica → Tes Koneksi.
- Top up / tambah key dari **akun Magica lain** agar saldo ≥ 5 untuk gambar/video (3D cukup ~0.8).
- Grant user `can_use_magica` + user pilih Provider = Magica (untuk gambar/video/LLM; 3D bebas).
- **Ekspor Cloud (Google):** Admin → tab **Google** isi Client ID + Secret + Redirect URI
  (`https://story.devcurl.me/api/google/oauth/callback`); daftarkan redirect URI itu di Google Console;
  **Publish** OAuth consent (atau tambah Test users) agar user tak kena `access_denied`. Lalu tiap user
  **Hubungkan Akun Google** di Settings. Lihat Bagian 16.

**Ide lanjutan (opsional) — yang MASIH tersisa:**

- Auto-fallback ke Freebeat saat semua key Magica < 5 kredit (khusus gambar/video).
- Tombol "Salin error".
- Tombol **Hapus** di Riwayat Export (hapus baris + file CSV di server).
- Judul spreadsheet ekspor dari nama storyboard (bukan timestamp).
- Pembersihan berkala file `uploads/exports/*.csv` yang sudah lama diunduh.

_(Sudah selesai & dipindah ke Riwayat: Total saldo Magica di Admin = #41; Nama animasi 3D = #38;
Estimasi total per-gambar × halaman = #39; Export Full/CSV/Cloud = #49–#54.)_

---

## 16. Ekspor Data & Integrasi Google (CSV / Full / Cloud)

Dari **Dashboard**, centang storyboard lalu pilih salah satu ekspor. **Ketiganya = BACKGROUND JOB (#54):**
request balik seketika `{jobId}`, kerja lanjut di server (anti-502, tetap jalan walau pindah/tutup tab),
hasil & progres muncul di **Settings → Riwayat Export**.

- **Export CSV** — ringkas (6 kolom). **Export Full** — per-scene lengkap (semua prompt gambar+video, narasi,
  semua link, kredit, marketing copy; link saja, rapi). Keduanya disimpan di `uploads/exports/` dan diunduh via
  `GET /api/google/oauth/exports/:id/download?token=<JWT>` (owner-only, auth lewat query-token).
- **Export Cloud (Google Sheets)** — **per-user OAuth (#50)**: tiap export bikin **spreadsheet baru** (#53),
  dibagikan `anyone: writer` (editor, bukan private). **Judul & caption diambil dari AI Marketing Copy**,
  auto-generate bila kosong (#52).
- **Resolusi auth ekspor cloud:** akun Google user (OAuth per-user) **didahulukan**; bila belum ada, fallback
  ke konfigurasi admin global (Service Account JSON / OAuth global) via `buildGoogleAuth`.

**Setup Google (admin, sekali):** Admin → tab **Google** → isi **Client ID + Client Secret + Redirect URI**
(atau upload JSON "OAuth Client", 3 field auto-terisi; #51). Redirect URI =
`https://story.devcurl.me/api/google/oauth/callback` — **daftarkan URI ini** di Google Cloud Console
(APIs & Services → Credentials → OAuth client → Authorized redirect URIs). **Publish** OAuth consent screen
(atau tambahkan email penguji di Test users) supaya user tidak kena `Error 403 access_denied`. Scope yang
diminta: `drive.file`, `spreadsheets`, `userinfo.profile`, `userinfo.email`. Service Account JSON = **Opsi
Lanjutan** (butuh `client_email` + `private_key`; JANGAN tempel JSON OAuth Client ke sini).

**Setup per user:** Settings → **Hubungkan Akun Google** → login Google sendiri. Setelah itu tombol Export
Cloud menulis Sheet ke Drive user tersebut. `refresh_token` disimpan di `user_google_accounts` dan
di-refresh otomatis (`getAuthorizedClientForUser`).

---

## 17. Webhook Magica (penyelesaian async — #48)

**Untuk apa:** menyelesaikan job video/3D lewat callback, sebagai **cadangan** bila proses polling mati
(mis. server restart). **Polling tetap jalur utama.**

- **Mulai run:** body run menyertakan objek `webhook` (Svix) + `metadata` `{app:'storymax', recId, kind
  ('video'|'3d'), token}`. Record DB menyimpan `magica_run_id`, `magica_key_id`, dan `webhook_token` (token acak per-run).
- **Receiver:** `POST /api/magica/webhook` — **PUBLIC** (dipanggil Magica, bukan browser), di-mount SEBELUM
  router `/api/magica` ber-auth. Balas `200` dulu (agar Svix tak retry), baru proses.
- **Keamanan tanpa signing secret (API-only):** hanya bertindak bila `metadata.app==='storymax'` DAN
  `metadata.token === webhook_token` DB DAN record masih `processing` (idempotent).
- **Ketepatan multi-key/bulk (KRUSIAL):** penyelesaian memakai **key yang tepat** (`magica_key_id`) karena
  **runId ter-scope ke akun/key yang membuatnya** — key lain tak bisa membaca runId itu. Inilah alasan
  `magica_key_id` disimpan per-run.
- **Prasyarat:** `PUBLIC_URL` di Railway harus benar agar URL webhook yang dikirim ke Magica bisa dijangkau.

---

## 18. Cara melanjutkan (contoh perintah ke AI lain)

> "Baca STORYMAX_HANDOFF.md. Aku mau tambah fitur X. Buat branch dari `master`, ubah kodenya,
> verifikasi sesuai Bagian 12 (npm diblokir → `node -c` + hitung keseimbangan + scan TDZ), lalu
> buka Pull Request. Jangan sentuh jalur Freebeat. Balas Bahasa Indonesia."
