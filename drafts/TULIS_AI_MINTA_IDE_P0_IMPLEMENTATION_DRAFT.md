# Draf Kode P0 — Tulis AI, Minta Ide, dan Kontrak Flow Panel

> **Status:** draf implementasi, belum diterapkan ke branch `master`.  
> **Cakupan P0:** mengganti output AI bebas menjadi `StoryboardPlan` tervalidasi, menghapus fallback plain-text yang dianggap sukses, dan memisahkan **candidate result** dari draft form sampai pengguna menekan **Terapkan**.

## Sasaran Kontrak

Setiap hasil Tulis AI atau Minta Ide harus memiliki struktur yang sama. `description` lama hanya proyeksi tampilan kompatibilitas; ia bukan sumber rencana cerita.

```json
{
  "version": 1,
  "title": "Kopi Pagi yang Presisi",
  "layout": "recipe_cooking",
  "projectBrief": "Iklan espresso artisan dengan ritual pagi yang tenang.",
  "pages": [
    {
      "pageIndex": 0,
      "goal": "Hook dan persiapan espresso",
      "beats": [
        { "index": 0, "action": "Biji kopi jatuh ke grinder", "camera": "macro top-down" },
        { "index": 1, "action": "Barista menekan portafilter", "camera": "medium close-up" }
      ]
    }
  ],
  "ideaMetadata": { "mode": "expand", "seed": null }
}
```

| Tanggung jawab | Sebelum | Sesudah P0 |
|---|---|---|
| LLM | Mengisi string panel panjang yang ambigu. | Menghasilkan JSON `StoryboardPlan`. |
| Backend | Regex parse lalu menganggap teks bebas sukses. | Validasi plan, repair sekali, atau return 422 tanpa mutasi. |
| Frontend | Langsung `setTitle`, `setPrompt`, `setStyle`. | Menyimpan candidate dan menunggu **Terapkan**. |
| Generator storyboard | Membagi ulang string bebas. | Menggunakan `storyPlan.pages[pageIndex]` bila tersedia. |

## 1. Tambahkan Helper `backend/prompts/storyboardPlan.js`

```js
const { LAYOUT_STYLES } = require('../constants/layoutStyles');

const SUPPORTED_VERSION = 1;
const VALID_LAYOUT_IDS = new Set(LAYOUT_STYLES.map((item) => item.value));

function asText(value, maxLength = 1000) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function toPositiveInt(value, fallback, max) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return fallback;
  return Math.min(n, max);
}

function secondsPerPage(videoEngine) {
  const engine = String(videoEngine || 'seedance').toLowerCase();
  if (engine === 'omni') return 10;
  if (engine.startsWith('veo')) return 8;
  return 15;
}

function normalizeGeneration(value = {}) {
  const projectDuration = toPositiveInt(value.projectDuration ?? value.duration, 15, 120);
  const gridCount = toPositiveInt(value.gridCount, 6, 12);
  const videoEngine = String(value.videoEngine || 'seedance');
  const pageCount = Math.max(1, Math.min(8, Math.ceil(projectDuration / secondsPerPage(videoEngine))));
  return {
    projectDuration,
    gridCount,
    videoEngine,
    aspectRatio: String(value.aspectRatio || '9:16'),
    pageCount,
    segmentDuration: secondsPerPage(videoEngine),
  };
}

function extractJsonObject(raw) {
  const text = String(raw || '').trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch (_) { return null; }
}

function validateStoryboardPlan(value, { generation, layoutPreference, mode }) {
  const errors = [];
  const lockedLayout = layoutPreference && layoutPreference !== 'auto' ? layoutPreference : null;
  const layout = asText(value?.layout, 100);
  const pages = Array.isArray(value?.pages) ? value.pages : [];

  if (value?.version !== SUPPORTED_VERSION) errors.push('version must be 1');
  if (!asText(value?.title, 80)) errors.push('title is required');
  if (!asText(value?.projectBrief, 2000)) errors.push('projectBrief is required');
  if (!VALID_LAYOUT_IDS.has(layout)) errors.push('layout is not a supported style');
  if (lockedLayout && layout !== lockedLayout) errors.push('layout differs from locked layout');
  if (pages.length !== generation.pageCount) errors.push(`expected ${generation.pageCount} pages`);

  const normalizedPages = pages.map((page, pageIndex) => {
    const beats = Array.isArray(page?.beats) ? page.beats : [];
    if (Number(page?.pageIndex) !== pageIndex) errors.push(`page ${pageIndex} has an invalid pageIndex`);
    if (!asText(page?.goal, 240)) errors.push(`page ${pageIndex} needs a goal`);
    if (beats.length !== generation.gridCount) {
      errors.push(`page ${pageIndex} must contain ${generation.gridCount} beats`);
    }
    return {
      pageIndex,
      goal: asText(page?.goal, 240),
      beats: beats.map((beat, beatIndex) => {
        if (Number(beat?.index) !== beatIndex) errors.push(`beat ${pageIndex}.${beatIndex} has an invalid index`);
        if (!asText(beat?.action, 420)) errors.push(`beat ${pageIndex}.${beatIndex} needs an action`);
        if (!asText(beat?.camera, 160)) errors.push(`beat ${pageIndex}.${beatIndex} needs a camera`);
        return {
          index: beatIndex,
          action: asText(beat?.action, 420),
          camera: asText(beat?.camera, 160),
        };
      }),
    };
  });

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      version: SUPPORTED_VERSION,
      title: asText(value.title, 80),
      layout,
      projectBrief: asText(value.projectBrief, 2000),
      pages: normalizedPages,
      ideaMetadata: {
        mode: ['expand', 'clean_product_copy', 'random_idea'].includes(mode) ? mode : 'expand',
        seed: value?.ideaMetadata?.seed || null,
      },
    },
  };
}

function planToLegacyDescription(plan) {
  return plan.pages.map((page) => [
    `HALAMAN ${page.pageIndex + 1}: ${page.goal}`,
    ...page.beats.map((beat) => `Panel ${beat.index + 1}: ${beat.action} [CAM: ${beat.camera}]`),
  ].join('\n')).join('\n\n');
}

function pageToConcept(page) {
  return [
    page.goal,
    ...page.beats.map((beat) => `Panel ${beat.index + 1}: ${beat.action}. Camera: ${beat.camera}.`),
  ].join(' ');
}

module.exports = {
  extractJsonObject,
  normalizeGeneration,
  pageToConcept,
  planToLegacyDescription,
  validateStoryboardPlan,
};
```

## 2. Ganti Kontrak Request `POST /ai/write-prompt`

Pertahankan endpoint yang sama agar perubahan rute tidak diperlukan, tetapi gunakan request eksplisit. Hapus pengiriman `refImage` karena endpoint saat ini tidak memproses visualnya.

```json
{
  "mode": "expand",
  "brief": "Iklan parfum mewah untuk suasana hujan malam.",
  "layoutPreference": "auto",
  "generation": {
    "videoEngine": "seedance",
    "projectDuration": 30,
    "gridCount": 6,
    "aspectRatio": "9:16"
  },
  "reference": { "hasImage": false }
}
```

Untuk kompatibilitas sementara, backend boleh menerjemahkan `concept`, `style`, `duration`, dan `hasRefImage` lama ke request baru. Namun, hapus dukungan `minta_ide_acak:` setelah frontend baru dirilis.

```js
function normalizeWritePromptRequest(body = {}) {
  const legacyRandom = String(body.concept || '').startsWith('minta_ide_acak:');
  const mode = ['expand', 'clean_product_copy', 'random_idea'].includes(body.mode)
    ? body.mode
    : (legacyRandom ? 'random_idea' : 'expand');
  const legacyBrief = legacyRandom
    ? String(body.concept).slice('minta_ide_acak:'.length).trim()
    : body.concept;

  return {
    mode,
    brief: String(body.brief ?? legacyBrief ?? '').trim(),
    layoutPreference: body.layoutPreference ?? body.style ?? 'auto',
    generation: normalizeGeneration(body.generation || {
      videoEngine: body.videoEngine,
      duration: body.duration,
      gridCount: body.gridCount,
      aspectRatio: body.aspectRatio,
    }),
    reference: { hasImage: Boolean(body.reference?.hasImage ?? body.hasRefImage) },
  };
}
```

## 3. Ubah `writePrompt` di `backend/controllers/aiController.js`

Tambahkan import di bagian atas controller.

```js
const {
  extractJsonObject,
  normalizeGeneration,
  planToLegacyDescription,
  validateStoryboardPlan,
} = require('../prompts/storyboardPlan');
```

Ganti destructuring lama dan deteksi sentinel dengan request normalizer.

```js
async function writePrompt(req, res) {
  const request = normalizeWritePromptRequest(req.body);
  if (!request.brief && request.mode !== 'random_idea') {
    return res.status(400).json({ message: 'Ide kasar (brief) harus diisi.' });
  }

  const { mode, brief, layoutPreference, generation, reference } = request;
  const lockedLayout = layoutPreference !== 'auto' ? layoutPreference : null;
  if (lockedLayout && !LAYOUT_STYLES.some((item) => item.value === lockedLayout)) {
    return res.status(400).json({ message: 'Gaya layout yang dipilih tidak dikenal.' });
  }

  // Gunakan context matriks ide lama hanya saat mode === 'random_idea'.
  const userContext = buildIdeationUserContext({
    mode, brief, layoutPreference, generation, reference,
  });
  const systemInstruction = buildStoryboardPlanSystemPrompt({
    mode, lockedLayout, generation,
    layoutListText: LAYOUT_STYLES.map((style) => `- ${style.value}: ${style.label}`).join('\n'),
  });

  const firstRaw = await requestPlanFromLLM({ db, systemInstruction, userContext });
  let validation = validateStoryboardPlan(extractJsonObject(firstRaw), {
    generation,
    layoutPreference,
    mode,
  });

  // Satu repair call. Tidak ada regex/plain-text success fallback.
  if (!validation.ok) {
    const repairInstruction = `${systemInstruction}\n\nOUTPUT SEBELUMNYA TIDAK VALID: ${validation.errors.join('; ')}. Kembalikan HANYA JSON valid sesuai schema.`;
    const repairedRaw = await requestPlanFromLLM({
      db,
      systemInstruction: repairInstruction,
      userContext: `Brief asli:\n${userContext}\n\nOutput yang harus diperbaiki:\n${firstRaw}`,
    });
    validation = validateStoryboardPlan(extractJsonObject(repairedRaw), {
      generation,
      layoutPreference,
      mode,
    });
  }

  if (!validation.ok) {
    return res.status(422).json({
      code: 'AI_PLAN_INVALID',
      message: 'AI belum menghasilkan rencana storyboard yang valid. Draft Anda tidak diubah.',
      errors: validation.errors,
    });
  }

  const plan = validation.value;
  return res.json({
    candidate: {
      plan,
      legacy: {
        title: plan.title,
        description: planToLegacyDescription(plan),
        layout: plan.layout,
      },
    },
  });
}
```

`buildStoryboardPlanSystemPrompt` harus meminta JSON, bukan `description`. Bentuk minimum instruksinya:

```text
Return JSON only.
Schema:
{
  "version": 1,
  "title": "max 5 words",
  "layout": "allowed layout id",
  "projectBrief": "faithful concise brief",
  "pages": [
    {
      "pageIndex": 0,
      "goal": "one concise page goal",
      "beats": [{ "index": 0, "action": "visual action", "camera": "camera framing" }]
    }
  ],
  "ideaMetadata": { "mode": "...", "seed": null }
}
Generate exactly ${generation.pageCount} pages and exactly ${generation.gridCount} beats per page.
${lockedLayout ? `Layout MUST equal "${lockedLayout}".` : 'Choose exactly one layout id from the supplied list.'}
```

> `requestPlanFromLLM` dapat memakai panggilan `llmChatViaSettings` yang sudah ada; pindahkan pemanggilan dan `parseAiContent` lama ke helper itu. Jangan mengembalikan response LLM mentah kepada client.

## 4. Simpan Candidate Terpisah pada `Generator.jsx`

Tambahkan state dekat state AI yang sudah ada.

```jsx
const [aiCandidate, setAiCandidate] = useState(null);
const [draftSnapshot, setDraftSnapshot] = useState(null);
const [appliedStoryboardPlan, setAppliedStoryboardPlan] = useState(null);
```

Ganti `handleGenerateAiPrompt`. Tidak boleh memanggil `setTitle`, `setPrompt`, atau `setStyle` setelah request sukses.

```jsx
const handleGenerateAiPrompt = async (mode = 'expand') => {
  const brief = aiInput.trim() || prompt.trim();
  if (!brief && mode !== 'random_idea') {
    setAiError('Masukkan ide kasar atau deskripsi yang ingin dirapikan.');
    return;
  }

  setAiLoading(true);
  setAiError('');
  setAiMatchedLayout(null);
  try {
    const res = await api.post('/ai/write-prompt', {
      mode,
      brief,
      layoutPreference: autoLayout ? 'auto' : style,
      generation: {
        videoEngine,
        projectDuration: Number(duration),
        gridCount: Number(gridCount),
        aspectRatio,
      },
      reference: { hasImage: selectedRefImages.length > 0 },
    });
    setAiCandidate(res.data.candidate);
  } catch (err) {
    setAiError(err.response?.data?.message || 'AI belum dapat membuat rencana yang valid. Draft Anda tidak diubah.');
  } finally {
    setAiLoading(false);
  }
};

const applyAiCandidate = () => {
  if (!aiCandidate?.plan) return;
  setDraftSnapshot({ title, prompt, style, autoLayout, appliedStoryboardPlan });
  setTitle(aiCandidate.legacy.title);
  setPrompt(aiCandidate.legacy.description);
  setStyle(aiCandidate.legacy.layout);
  setAutoLayout(false);
  setAppliedStoryboardPlan(aiCandidate.plan);
  setAiMatchedLayout(LAYOUT_STYLES.find((item) => item.value === aiCandidate.plan.layout)?.label || null);
  setAiCandidate(null);
  setAiInput('');
};

const undoApplyAiCandidate = () => {
  if (!draftSnapshot) return;
  setTitle(draftSnapshot.title);
  setPrompt(draftSnapshot.prompt);
  setStyle(draftSnapshot.style);
  setAutoLayout(draftSnapshot.autoLayout);
  setAppliedStoryboardPlan(draftSnapshot.appliedStoryboardPlan);
  setDraftSnapshot(null);
};
```

Ubah tombol menjadi mode eksplisit.

```jsx
<button type="button" onClick={() => handleGenerateAiPrompt('expand')}>
  Tulis AI
</button>
<button type="button" onClick={() => handleGenerateAiPrompt('random_idea')}>
  Minta Ide
</button>
```

Tambahkan preview sebelum field title/prompt yang dapat diedit.

```jsx
{aiCandidate?.plan && (
  <section className="rounded-xl border border-[#cfae80]/40 bg-[#cfae80]/5 p-3 space-y-2">
    <p className="text-[9px] font-bold uppercase tracking-widest text-[#cfae80]">Pratinjau AI — draft belum diubah</p>
    <p className="text-sm font-semibold text-white">{aiCandidate.plan.title}</p>
    <p className="text-[11px] text-slate-300">{aiCandidate.plan.projectBrief}</p>
    <p className="text-[10px] text-slate-400">{aiCandidate.plan.pages.length} halaman · {aiCandidate.plan.pages[0]?.beats.length || 0} panel per halaman</p>
    <div className="flex gap-2">
      <button type="button" onClick={applyAiCandidate}>Terapkan</button>
      <button type="button" onClick={() => setAiCandidate(null)}>Pertahankan Draft</button>
      <button type="button" onClick={() => handleGenerateAiPrompt(aiCandidate.plan.ideaMetadata.mode)}>Ide Lain</button>
    </div>
  </section>
)}
{draftSnapshot && <button type="button" onClick={undoApplyAiCandidate}>Undo perubahan AI</button>}
```

## 5. Teruskan Plan yang Sudah Diterapkan ke Generator Storyboard

Saat `handleGenerate` mengirim request ke `/storyboards/generate`, tambahkan:

```jsx
storyboardPlan: appliedStoryboardPlan || undefined,
```

Di `storyboardController.js`, validasi ulang memakai `validateStoryboardPlan` dengan generation yang sama, lalu persist di `generation_params`.

```js
const validatedPlan = storyboardPlan
  ? validateStoryboardPlan(storyboardPlan, {
      generation: generationPlan,
      layoutPreference: style,
      mode: storyboardPlan?.ideaMetadata?.mode || 'expand',
    })
  : null;

if (validatedPlan && !validatedPlan.ok) {
  return res.status(400).json({ message: 'Storyboard plan dari Tulis AI tidak valid.', errors: validatedPlan.errors });
}

const generationParams = {
  // existing params,
  storyboardPlan: validatedPlan?.value || null,
};
```

Di `storyboardJobs.js`, jangan jalankan `splitStoryboardPromptWithAI` bila `storyboardPlan` tersedia.

```js
const planPage = task.generationParams?.storyboardPlan?.pages?.[pageIdx] || null;
const pageConcept = planPage
  ? pageToConcept(planPage)
  : (subPrompts?.[pageIdx] || task.prompt);
```

Untuk regenerasi halaman, baca page yang sama dari `generation_params.storyboardPlan.pages[pageIdx]`. Jangan memanggil splitter lagi kecuali pengguna menekan aksi eksplisit **Rencanakan Ulang Cerita**.

## 6. Pengujian Regresi Wajib

| Kasus | Asersi |
|---|---|
| Tulis AI dengan `aiInput` kosong dan `prompt` terisi | Request tetap dibuat menggunakan `prompt`; jika keduanya kosong, tampilkan error. |
| JSON LLM tidak valid dua kali | Endpoint memberi 422; `title`, `prompt`, dan `style` di UI tidak berubah. |
| Project 30 detik / Seedance / grid 6 | Candidate memiliki 2 page dan tepat 6 beat per page. |
| Locked layout `recipe_cooking` | Candidate ditolak bila layout LLM bukan `recipe_cooking`. |
| Auto layout invalid | Candidate ditolak/repair; tidak pernah menjadi `premium_vertical_row` secara diam-diam. |
| Klik Minta Ide | Request memakai `mode: random_idea`, tidak memakai `minta_ide_acak:`. |
| Candidate sukses | Form tidak berubah sampai klik Terapkan. |
| Terapkan lalu Undo | Title, prompt, style, `autoLayout`, dan plan sebelumnya kembali persis seperti semula. |
| Generate storyboard dari candidate | Job memakai `storyboardPlan.pages[pageIdx]`, bukan memecah ulang description bebas. |

## Urutan Merge Aman

1. Tambahkan `storyboardPlan.js` dan unit test validation tanpa mengubah UI.
2. Tambahkan endpoint response `candidate` serta repair once; pertahankan adapter legacy sementara.
3. Rilis frontend preview/Apply/Undo dan explicit request mode.
4. Persist plan di `generation_params`; gunakan plan pada job awal dan regenerasi.
5. Setelah telemetry memastikan klien lama tidak dipakai, hapus sentinel `minta_ide_acak:` dan parser regex lama.
