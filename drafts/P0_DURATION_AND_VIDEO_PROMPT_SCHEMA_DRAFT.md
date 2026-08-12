# Draf P0 — Kontrak Durasi dan Schema `video_prompts`

> **Status:** draf implementasi; belum diterapkan pada source branch.  
> **Tujuan:** membuat seluruh tahap Storymax memakai satu timeline per halaman dan mencegah `video_prompts` visual tertimpa oleh fitur lain.

## 1. Kontrak Baru yang Harus Dipakai Bersama

Gunakan satu `generationPlan` yang dibuat **sekali** saat storyboard dibuat dan dipersisten di `generation_params`. Jangan menghitung ulang `secondsPerPage` secara terpisah di controller, job, LLM master prompt, regenerasi, dan prompt video.

```js
{
  version: 1,
  requestedProjectDuration: 30,
  renderProjectDuration: 30,
  videoEngine: 'seedance',
  segmentRenderDuration: 15,
  pageCount: 2,
  segments: [
    { pageIndex: 0, timeStart: 0, timeEnd: 15, renderDuration: 15 },
    { pageIndex: 1, timeStart: 15, timeEnd: 30, renderDuration: 15 }
  ]
}
```

Untuk durasi yang tidak habis dibagi kemampuan engine, simpan `requestedProjectDuration` dan `renderProjectDuration` terpisah. Contoh: permintaan 31 detik dengan engine 8 detik berarti 4 segmen, `renderProjectDuration: 32`, dan tiap segmen tetap memiliki `renderDuration: 8`. Ini lebih jujur daripada menyuruh sebagian modul memakai 31 dan modul lain memakai 32.

## 2. Tambahkan Helper Timeline Kanonik

Buat file baru: `backend/prompts/generationPlan.js`.

```js
const ENGINE_SEGMENT_SECONDS = Object.freeze({
  seedance: 15,
  omni: 10,
  veo: 8,
});

function toPositiveNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function segmentSecondsForEngine(videoEngine) {
  const key = String(videoEngine || 'seedance').toLowerCase();
  if (key.startsWith('veo')) return ENGINE_SEGMENT_SECONDS.veo;
  return ENGINE_SEGMENT_SECONDS[key] || ENGINE_SEGMENT_SECONDS.seedance;
}

function createGenerationPlan({ requestedProjectDuration, videoEngine }) {
  const requested = toPositiveNumber(requestedProjectDuration, 15);
  const segmentRenderDuration = segmentSecondsForEngine(videoEngine);
  const pageCount = Math.max(1, Math.min(8, Math.ceil(requested / segmentRenderDuration)));
  const renderProjectDuration = pageCount * segmentRenderDuration;

  return {
    version: 1,
    requestedProjectDuration: requested,
    renderProjectDuration,
    videoEngine: videoEngine || 'seedance',
    segmentRenderDuration,
    pageCount,
    segments: Array.from({ length: pageCount }, (_, pageIndex) => ({
      pageIndex,
      timeStart: pageIndex * segmentRenderDuration,
      timeEnd: (pageIndex + 1) * segmentRenderDuration,
      renderDuration: segmentRenderDuration,
    })),
  };
}

// Compatibility reader for existing records created before generationPlan existed.
function getGenerationPlan(generationParams = {}, imageCount) {
  const current = generationParams.generationPlan;
  if (
    current && current.version === 1 && Array.isArray(current.segments) &&
    current.segments.length > 0
  ) return current;

  const legacyDuration = toPositiveNumber(generationParams.duration, 15);
  const legacyPlan = createGenerationPlan({
    requestedProjectDuration: legacyDuration,
    videoEngine: generationParams.videoEngine || 'seedance',
  });

  // Existing image arrays are authoritative for a legacy storyboard already rendered.
  if (Number.isInteger(imageCount) && imageCount > 0 && imageCount !== legacyPlan.pageCount) {
    const segmentRenderDuration = segmentSecondsForEngine(generationParams.videoEngine);
    return {
      ...legacyPlan,
      pageCount: imageCount,
      renderProjectDuration: imageCount * segmentRenderDuration,
      segments: Array.from({ length: imageCount }, (_, pageIndex) => ({
        pageIndex,
        timeStart: pageIndex * segmentRenderDuration,
        timeEnd: (pageIndex + 1) * segmentRenderDuration,
        renderDuration: segmentRenderDuration,
      })),
    };
  }

  return legacyPlan;
}

module.exports = {
  createGenerationPlan,
  getGenerationPlan,
  segmentSecondsForEngine,
};
```

## 3. Ubah `storyboardController.js` agar Hanya Membuat Timeline Sekali

Tambahkan import:

```js
const { createGenerationPlan } = require('../prompts/generationPlan');
```

Ganti blok perhitungan `selectedEngine`, `secondsPerPage`, dan `pageCount` dengan berikut ini.

```js
const selectedEngine = videoEngine || 'seedance';
const totalDuration = duration ? Number(duration) : 15;
const generationPlan = createGenerationPlan({
  requestedProjectDuration: totalDuration,
  videoEngine: selectedEngine,
});
const pageCount = generationPlan.pageCount;
const secondsPerPage = generationPlan.segmentRenderDuration;
```

Tambahkan `generationPlan` ke object `generationParams` dan `initialTaskState`.

```js
const generationParams = JSON.stringify({
  // ...field yang sudah ada...
  duration: totalDuration, // legacy compatibility only; do not consume directly in new code.
  generationPlan,
});

const initialTaskState = {
  // ...field yang sudah ada...
  generationPlan,
  pageCount: generationPlan.pageCount,
  secondsPerPage: generationPlan.segmentRenderDuration,
};
```

## 4. Berikan Page Segment yang Sama ke Kedua Builder Master Prompt

### 4.1 Ubah context builder pada `storyboardJobs.js`

Sebelum menyusun `genCtx` di dalam loop page, ambil segmen dari plan.

```js
const { getGenerationPlan } = require('../prompts/generationPlan');

const generationPlan = task.generationPlan || getGenerationPlan({
  duration: task.totalDuration,
  videoEngine: task.videoEngine,
});
const segment = generationPlan.segments[pageIdx];
```

Ganti field waktu `genCtx` dengan field eksplisit berikut.

```js
const genCtx = {
  // ...subject, concept, faceMode, gridCount, startScene...
  totalDuration: generationPlan.requestedProjectDuration,
  segmentDuration: segment.renderDuration,
  timeStart: segment.timeStart,
  timeEnd: segment.timeEnd,
  pageNum,
  pageCount: generationPlan.pageCount,
  // ...field lain...
};
```

### 4.2 Ubah `masterPrompt.js`

Tambahkan ke destructuring context.

```js
segmentDuration,
timeStart,
timeEnd,
```

Ganti perhitungan `perPage`, `winStart`, dan `winEnd` dengan:

```js
const perPage = Number(segmentDuration) > 0
  ? Number(segmentDuration)
  : (Number(secondsPerPage) > 0
      ? Number(secondsPerPage)
      : (pageCount > 1
          ? Math.max(1, Math.round(Number(totalDuration || 15) / pageCount))
          : Number(totalDuration || 15)));

const winStart = Number.isFinite(Number(timeStart))
  ? Number(timeStart)
  : (pageNum - 1) * perPage;
const winEnd = Number.isFinite(Number(timeEnd))
  ? Number(timeEnd)
  : winStart + perPage;
const dur = fmtDuration(perPage);
```

### 4.3 Ubah `masterPromptLLM.js`

Saat ini jalur LLM meneruskan `fmtDuration(totalDuration)` sebagai durasi halaman. Itu harus diganti dengan durasi segmen yang sama dengan builder deterministik.

Tambahkan context:

```js
secondsPerPage,
segmentDuration,
timeStart,
timeEnd,
```

Lalu, sebelum `payload`, hitung:

```js
const pageDuration = Number(segmentDuration) > 0
  ? Number(segmentDuration)
  : (Number(secondsPerPage) > 0
      ? Number(secondsPerPage)
      : Math.max(1, Math.round(Number(totalDuration || 15) / Number(pageCount || 1))));
const pageTimeStart = Number.isFinite(Number(timeStart))
  ? Number(timeStart)
  : (pageNum - 1) * pageDuration;
const pageTimeEnd = Number.isFinite(Number(timeEnd))
  ? Number(timeEnd)
  : pageTimeStart + pageDuration;
```

Ganti bagian `PARAMS` dengan field waktu ber-scope jelas.

```js
PARAMS: {
  // ...field existing...
  projectDuration: fmtDuration(totalDuration),
  segmentDuration: fmtDuration(pageDuration),
  timeStart: pageTimeStart,
  timeEnd: pageTimeEnd,
  page: pageNum,
  totalPages: pageCount,
}
```

Ubah aturan system prompt nomor 4 menjadi:

```text
4. PAGE TIME — this prompt describes only PARAMS.page. Use PARAMS.segmentDuration
for the page badge and per-panel timing. Use the exact PARAMS.timeStart–PARAMS.timeEnd
window to keep pages in chronological order. PARAMS.projectDuration is context only;
never print it as this page's duration.
```

## 5. Version dan Normalkan `video_prompts`

Buat file baru: `backend/prompts/videoPromptSchema.js`.

```js
const VIDEO_PROMPT_SCHEMA_VERSION = 1;

function emptyVideoPromptSet() {
  return {
    version: VIDEO_PROMPT_SCHEMA_VERSION,
    scenes: [],
    marketing: null,
  };
}

function parseVideoPromptSet(raw) {
  if (!raw) return emptyVideoPromptSet();

  let parsed = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch (_) {
      return {
        ...emptyVideoPromptSet(),
        scenes: [{ scene_idx: 0, textToVideoPrompt: raw }],
      };
    }
  }

  // Current supported schema.
  if (parsed && !Array.isArray(parsed) && Array.isArray(parsed.scenes)) {
    return {
      version: VIDEO_PROMPT_SCHEMA_VERSION,
      scenes: parsed.scenes,
      marketing: parsed.marketing || null,
    };
  }

  // Legacy array schema created by older marketing-copy code.
  if (Array.isArray(parsed)) {
    return {
      version: VIDEO_PROMPT_SCHEMA_VERSION,
      scenes: parsed.filter((item) => item && (
        item.imageToVideoPrompt || item.textToVideoPrompt || item.narration
      )),
      marketing: parsed.find((item) => item?.marketing_title || item?.marketing_description)
        ? {
            title: parsed.find((item) => item?.marketing_title)?.marketing_title || '',
            description: parsed.find((item) => item?.marketing_description)?.marketing_description || '',
          }
        : null,
    };
  }

  // Legacy single-prompt object.
  if (parsed && (parsed.imageToVideoPrompt || parsed.textToVideoPrompt || parsed.visualPrompt)) {
    return {
      ...emptyVideoPromptSet(),
      scenes: [{
        scene_idx: 0,
        imageToVideoPrompt: parsed.imageToVideoPrompt || '',
        textToVideoPrompt: parsed.textToVideoPrompt || parsed.visualPrompt || '',
        narration: parsed.narration || null,
      }],
    };
  }

  return emptyVideoPromptSet();
}

function serializeVideoPromptSet(value) {
  const normalized = parseVideoPromptSet(value);
  return JSON.stringify(normalized);
}

function getScenePrompt(value, sceneIdx) {
  const set = parseVideoPromptSet(value);
  return set.scenes.find((scene) => Number(scene.scene_idx) === Number(sceneIdx)) ||
    set.scenes[sceneIdx] || null;
}

function replaceScenePrompt(value, sceneIdx, nextScene) {
  const set = parseVideoPromptSet(value);
  const index = set.scenes.findIndex((scene) => Number(scene.scene_idx) === Number(sceneIdx));
  const normalizedScene = { ...nextScene, scene_idx: Number(sceneIdx) };
  if (index >= 0) set.scenes[index] = normalizedScene;
  else set.scenes.push(normalizedScene);
  set.scenes.sort((a, b) => Number(a.scene_idx) - Number(b.scene_idx));
  return set;
}

module.exports = {
  VIDEO_PROMPT_SCHEMA_VERSION,
  emptyVideoPromptSet,
  parseVideoPromptSet,
  serializeVideoPromptSet,
  getScenePrompt,
  replaceScenePrompt,
};
```

## 6. Perubahan Konsumen dan Penulis Schema

| File | Perubahan draf |
|---|---|
| `backend/controllers/aiController.js` | Gunakan `parseVideoPromptSet` saat membaca data lama. Setelah vision LLM selesai, simpan `{ version: 1, scenes: parsed.scenes, marketing: existing.marketing }`, bukan object/array ad hoc. |
| `backend/controllers/videoController.js` | Ganti seluruh `JSON.parse(storyboard.video_prompts)` dengan `parseVideoPromptSet`. Pada batch video, baca `set.scenes`. |
| `regenerateStoryboardMarketingCopy` | Jangan mengubah `video_prompts` menjadi array. Hanya update `set.marketing`, lalu simpan `serializeVideoPromptSet(set)`. Kolom `marketing_title` dan `marketing_description` tetap diupdate seperti saat ini. |
| `frontend/src/pages/Dashboard.jsx` | Pastikan parser UI menerima `{ version, scenes, marketing }`; untuk record lama, pertahankan fallback array/single object hingga migrasi selesai. |

Contoh pengganti aman untuk `regenerateStoryboardMarketingCopy` di `videoController.js`:

```js
const {
  parseVideoPromptSet,
  serializeVideoPromptSet,
} = require('../prompts/videoPromptSchema');

const videoPromptSet = parseVideoPromptSet(storyboard.video_prompts);
videoPromptSet.marketing = {
  title: marketingCopy.title,
  description: marketingCopy.description,
  updatedAt: new Date().toISOString(),
};

await db.run(
  'UPDATE storyboards SET video_prompts = ?, marketing_title = ?, marketing_description = ? WHERE id = ?',
  [
    serializeVideoPromptSet(videoPromptSet),
    marketingCopy.title,
    marketingCopy.description,
    id,
  ]
);
```

Contoh penggunaan pada `generateAllVideos`:

```js
const { parseVideoPromptSet, getScenePrompt } = require('../prompts/videoPromptSchema');
const videoPromptSet = parseVideoPromptSet(storyboard.video_prompts);
const matchingPrompt = getScenePrompt(videoPromptSet, sceneIdx);
```

## 7. Durasi Prompt Video Otomatis

Di `storyboardJobs.js`, pemicu otomatis saat storyboard selesai saat ini meneruskan durasi total proyek ke penulis prompt video. Teruskan durasi segmen dari plan.

```js
const generationPlan = task.generationPlan || getGenerationPlan({
  duration: task.totalDuration,
  videoEngine: task.videoEngine,
});

await generateVideoPromptsInternal({
  storyboardId,
  promptType: 'image-to-video',
  regenerate: true,
  enableVo: isVoScriptActive,
  voMaxWords: task.voMaxWords || 10,
  voLanguage: isVoScriptActive ? task.voLanguage : undefined,
  voTone: isVoScriptActive ? task.voTone : undefined,
  segmentDuration: generationPlan.segmentRenderDuration,
});
```

Di `aiController.js`, ubah signature menjadi:

```js
async function generateVideoPromptsInternal({
  storyboardId, promptType, regenerate, enableVo, voMaxWords,
  voLanguage, voTone, videoDuration, segmentDuration,
})
```

Prioritaskan parameter `videoDuration` bila pengguna sengaja memilih durasi manual di UI. Bila tidak ada, ambil `generationPlan.segmentRenderDuration` dari `generation_params`. Gunakan nama `effectiveSegmentDuration` pada `durationClause`, lalu ubah semua instruksi dari “scene/panel” menjadi **“page segment”** agar cocok dengan pemetaan implementasi yang ada.

```js
const params = storyboard.generation_params ? JSON.parse(storyboard.generation_params) : {};
const generationPlan = getGenerationPlan(params, panelImages.length);
const effectiveSegmentDuration = Number(videoDuration) > 0
  ? Number(videoDuration)
  : Number(segmentDuration) > 0
    ? Number(segmentDuration)
    : generationPlan.segmentRenderDuration;

const durationClause = `Each page-segment video has a target duration of: ${effectiveSegmentDuration} seconds.`;
```

## 8. Pengujian Regresi Minimum

Karena project belum memiliki runner test backend, tambahkan test Node sederhana atau gunakan test framework sebelum merge. Kasus berikut harus lulus.

| Kasus | Asersi |
|---|---|
| Seedance, 30 detik | Plan berisi dua segmen: 0–15 dan 15–30; LLM dan deterministic builder sama-sama menerima 15 detik per halaman. |
| VEO, 31 detik | Plan mencatat request 31, render 32, dan empat segmen 8 detik. |
| Legacy `generation_params` tanpa plan | `getGenerationPlan` membuat fallback kompatibel tanpa error. |
| Video prompt baru | Data tersimpan sebagai object `{ version: 1, scenes, marketing }`. |
| Marketing copy pada prompt set baru | Jumlah dan isi `scenes` tidak berubah. |
| Legacy `video_prompts` berupa array | Pembaca masih dapat memilih I2V/T2V tiap scene yang ada. |
| Batch video setelah marketing copy | Prompt spesifik scene dipakai, bukan fallback `storyboard.prompt`. |

## 9. Urutan Merge Aman

1. Tambahkan dua helper dan unit test-nya tanpa mengubah flow produksi.
2. Ganti pembacaan schema menjadi normalizer kompatibel mundur.
3. Ubah penulisan `video_prompts` agar selalu version 1.
4. Tambahkan `generationPlan` pada pembuatan baru dan fallback reader untuk data lama.
5. Ubah semua builder serta job untuk memakai plan.
6. Deploy, lalu konversi record lama secara lazy saat record dibaca/ditulis; jangan melakukan migrasi massal tanpa backup database.
