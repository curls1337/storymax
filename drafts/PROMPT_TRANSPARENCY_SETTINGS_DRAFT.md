# Draf Perbaikan — Transparansi Pengaturan dan Prompt Efektif

## Keputusan

**Ya, bagian yang ditandai perlu diperbaiki.** Saat ini pengguna hanya melihat `videoStudioPrompt` pada textarea kecil setinggi `h-16` (sekitar empat baris). Isi ini adalah **prompt dasar** yang dapat diedit, tetapi bukan selalu prompt lengkap yang dikirim ke Freebeat atau Magica. Saat generate, server menambahkan atau menghapus directive audio, voice-over, backsound, serta profil suara karakter melalui `applyAudioDirectives()`. Karena prompt akhir tidak ditampilkan dan pada jalur video tunggal tidak disimpan ulang setelah directive diterapkan, pengguna tidak bisa memverifikasi prompt yang benar-benar dikirim. [1] [2]

Permintaan “tampilkan semua isi prompt, jangan sembunyikan” sebaiknya diterapkan sebagai **dua bidang yang berbeda**, bukan sekadar memperbesar textarea lama.

| Bagian | Status/editability | Isi yang harus terlihat penuh |
|---|---|---|
| **Prompt dasar** | Dapat diedit pengguna. | I2V atau T2V yang tersimpan untuk segment aktif. |
| **Prompt efektif — akan dikirim ke provider** | Read-only dan selalu terbuka. | Prompt dasar setelah audio/no-voice, backsound, narration, language, tone, durasi, dan profil suara diterapkan server. |
| **Ringkasan pengaturan aktif** | Read-only. | Provider, key label/auto mode, method, model, durasi, resolusi, rasio, audio, backsound, mode wajah, style, dan reference mode. |

> **Tidak boleh menampilkan nilai API key rahasia.** UI cukup menampilkan label key yang dipilih atau status `Pilih Otomatis`; token/key value tidak boleh masuk ke preview maupun log UI.

## Temuan dari Pengaturan yang Ditandai

### Generator Storyboard

Kontrol yang ditandai pada Generator memang diteruskan ke endpoint `/storyboards/generate`: `magicaKeyId`, `faceMode`, pilihan voice-over (`enableVo`, `enableVoScript`, `enableVoImage`), bahasa/tone, model Magica, dan sumber gambar. [3] Nilai tersebut masuk ke `generation_params`/task dan digunakan pada pembuatan storyboard serta prompt video otomatis.

Namun, layar ini baru menampilkan **input konsep** (`prompt`) dengan tinggi tiga baris. Ia tidak dapat menunjukkan master prompt gambar yang benar-benar dibuat kemudian, karena master prompt bergantung pada split per page, descriptor referensi, style policy, dan fallback LLM di background job. Jadi jangan menyebut textarea ini sebagai “prompt final”.

### Video Studio

Di Video Studio, textarea **Custom Prompt** hanya setinggi `h-16`, memakai `resize-none`, dan berada pada sidebar sempit. [4] Ia menerima nilai I2V/T2V base prompt. Setelah tombol **Buat Video** ditekan, server menambahkan audio directive pada kedua provider, tetapi `generated_videos.prompt` awalnya disimpan sebelum transformasi itu. [1] [2]

Artinya, preview yang tampil sekarang dapat berbeda dengan prompt provider. Perbedaan ini paling besar saat voice-over, backsound, atau profil suara karakter aktif.

## Perubahan UI yang Direkomendasikan

### 1. Ganti textarea kecil menjadi editor prompt penuh

Pertahankan field edit, tetapi tampilkan seluruh teks tanpa `h-16` atau batas scroll. Gunakan tinggi minimum yang nyaman, tampilan wrap, serta `resize-y` agar user dapat membesarkan bila perlu.

```jsx
<div className="space-y-1.5">
  <div className="flex items-center justify-between gap-3">
    <label className="text-[8px] font-bold uppercase tracking-widest text-[#cfae80]">
      Prompt Dasar yang Dapat Diedit
    </label>
    <span className="text-[8px] font-mono text-slate-500">
      {videoStudioPrompt.length.toLocaleString('id-ID')} karakter
    </span>
  </div>
  <textarea
    value={videoStudioPrompt}
    onChange={(event) => setVideoStudioPrompt(event.target.value)}
    placeholder="Masukkan deskripsi detail gerakan video..."
    rows={12}
    className="w-full min-h-[260px] bg-black/40 border border-[#2a2725] rounded-lg px-3 py-2.5 text-white text-[11px] leading-relaxed whitespace-pre-wrap break-words focus:outline-none focus:border-[#cfae80] font-medium resize-y scrollbar-thin"
  />
  <p className="text-[8px] leading-relaxed text-slate-500">
    Ini adalah prompt dasar. Prompt efektif di bawah akan menambahkan aturan audio sesuai pengaturan aktif.
  </p>
</div>
```

Field ini memenuhi permintaan supaya seluruh prompt bisa dibaca dan diperiksa, tetapi masih jelas bahwa field tersebut belum mencakup directive server.

### 2. Tambahkan panel “Prompt Efektif — Dikirim ke Provider” yang selalu terbuka

Panel ini harus tampil **default terbuka**, tidak diberi `max-height`, dan memakai `<pre>` atau `<div>` dengan `whitespace-pre-wrap` agar baris, quotation, serta paragraph tetap terbaca. Salin prompt juga harus menyalin prompt efektif, bukan hanya base prompt.

```jsx
<div className="space-y-2 border-t border-[#2a2725]/45 pt-3">
  <div className="flex items-center justify-between gap-3">
    <div>
      <p className="text-[8px] font-bold uppercase tracking-widest text-emerald-300">
        Prompt Efektif — Dikirim ke Provider
      </p>
      <p className="mt-0.5 text-[8px] text-slate-500">
        Termasuk aturan audio, voice-over, backsound, durasi, dan profil suara yang aktif.
      </p>
    </div>
    <button type="button" onClick={() => navigator.clipboard.writeText(effectivePrompt || '')}>
      Salin Prompt Efektif
    </button>
  </div>

  <pre className="m-0 whitespace-pre-wrap break-words rounded-lg border border-emerald-500/20 bg-emerald-950/10 p-3 font-mono text-[10px] leading-relaxed text-slate-200">
    {effectivePreview.loading
      ? 'Memuat prompt efektif...'
      : (effectivePreview.effectivePrompt || 'Prompt efektif belum dapat dipreview.')}
  </pre>
</div>
```

Jangan membuat panel ini collapse by default. Jika desain membutuhkan compact mode di mobile, boleh diberi tombol “ringkas”, tetapi status default tetap seluruh prompt terlihat.

### 3. Tampilkan ringkasan pengaturan yang membentuk prompt

Di atas editor prompt, tampilkan tabel ringkas. Table tersebut menjawab hubungan antara setting yang dilingkari dan hasil prompt.

```jsx
<div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-[#2a2725] bg-black/20 p-3 text-[9px]">
  <Meta label="Provider" value={userProvider === 'magica' ? 'Magica' : 'Freebeat'} />
  <Meta label="API key" value={selectedKeyLabel || 'Pilih otomatis'} />
  <Meta label="Metode" value={selectedMethodLabel} />
  <Meta label="Model" value={selectedModelLabel} />
  <Meta label="Durasi clip" value={`${videoDuration || 'bawaan model'} detik`} />
  <Meta label="Audio" value={audioSummary} />
  <Meta label="Voice-over" value={voiceOverSummary} />
  <Meta label="Rasio" value={videoAspectRatio || 'bawaan model'} />
</div>
```

Untuk Generator, tampilkan summary serupa tepat di bawah mode wajah dan VO: API selection, face mode, VO mode, language/tone, reference count, Magica image model, grid, project duration, page duration, ratio, dan style. Ini adalah **configuration transparency**, bukan master prompt final.

## Kontrak Backend: Preview Harus Dibuat oleh Server

Jangan merakit prompt efektif hanya di React. Logika server `applyAudioDirectives()` juga mengakses narration tersimpan, `generation_params`, dan voice profile character. UI tidak memiliki semua informasi itu; client-side preview akan kembali berbeda dari prompt yang dikirim.

Tambahkan endpoint preview read-only ke `videoController.js`.

```js
async function previewEffectiveVideoPrompt(req, res) {
  const {
    storyboardId,
    sceneIdx,
    prompt,
    duration,
    generateAudio,
    backsound,
  } = req.body;

  if (!storyboardId || sceneIdx === undefined || !String(prompt || '').trim()) {
    return res.status(400).json({ message: 'storyboardId, sceneIdx, dan prompt wajib diisi.' });
  }

  try {
    const db = getDb();
    const storyboard = await db.get('SELECT * FROM storyboards WHERE id = ?', [storyboardId]);
    if (!storyboard) return res.status(404).json({ message: 'Storyboard tidak ditemukan.' });

    const voConfig = resolveVoConfig(storyboard);
    const hasVo = Boolean(generateAudio && voConfig.enableVo);
    const narration = hasVo ? getSceneNarration(storyboard, Number(sceneIdx)) : '';
    const voiceProfile = await getCharacterVoiceProfile(db, storyboard);
    const effectivePrompt = applyAudioDirectives(prompt, {
      hasVo,
      narration,
      voLanguage: voConfig.voLanguage,
      voTone: voConfig.voTone,
      durationSec: duration,
      backsound: Boolean(backsound),
      voiceProfile,
    });

    return res.json({
      basePrompt: String(prompt),
      effectivePrompt,
      audio: {
        enabled: hasVo,
        narrationPresent: Boolean(narration),
        backsound: Boolean(backsound),
        language: voConfig.voLanguage,
        tone: voConfig.voTone,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: 'Gagal membuat preview prompt efektif.', error: error.message });
  }
}
```

Tambahkan route spesifik sebelum route berparameter generik:

```js
router.post('/preview-prompt', previewEffectiveVideoPrompt);
```

Endpoint tidak boleh menerima atau mengembalikan `api_key_value`, token, atau secret provider.

## Frontend: Sinkronisasi Preview

Gunakan request terdebounce (misalnya 300–500 ms) ketika salah satu input berikut berubah: scene index, base prompt, durasi, `generateAudio`, backsound, atau storyboard aktif. Preview bukan syarat untuk generate; bila endpoint preview gagal, tombol generate tetap berjalan dan UI menampilkan error preview yang jelas.

```jsx
const [effectivePreview, setEffectivePreview] = useState({
  loading: false,
  effectivePrompt: '',
  error: '',
});

useEffect(() => {
  if (!selectedStoryboard || !videoStudioPrompt.trim()) return;

  const timer = window.setTimeout(async () => {
    setEffectivePreview((current) => ({ ...current, loading: true, error: '' }));
    try {
      const response = await api.post('/videos/preview-prompt', {
        storyboardId: selectedStoryboard.id,
        sceneIdx: modalCarouselIdx,
        prompt: videoStudioPrompt,
        duration: videoDuration === 'auto' ? undefined : Number(videoDuration),
        generateAudio: videoGenerateAudio,
        backsound: videoBacksound,
      });
      setEffectivePreview({ loading: false, effectivePrompt: response.data.effectivePrompt, error: '' });
    } catch (error) {
      setEffectivePreview({ loading: false, effectivePrompt: '', error: error.response?.data?.message || 'Preview prompt gagal dibuat.' });
    }
  }, 350);

  return () => window.clearTimeout(timer);
}, [selectedStoryboard?.id, modalCarouselIdx, videoStudioPrompt, videoDuration, videoGenerateAudio, videoBacksound]);
```

## Persistensi: Simpan Prompt yang Benar-Benar Dikirim

Di jalur **single generate**, record `generated_videos.prompt` dibuat sebelum `applyAudioDirectives()`. Perbaiki agar prompt efektif disimpan persis sebelum provider dipanggil, baik Freebeat maupun Magica.

```js
const finalPrompt = applyAudioDirectives(/* ... */);
await db.run('UPDATE generated_videos SET prompt = ? WHERE id = ?', [finalPrompt, videoRecordId]);
```

Dengan ini, riwayat setiap video menjadi audit trail nyata: prompt provider yang dipakai dapat ditampilkan kembali setelah video selesai. Jalur batch sudah lebih dekat ke perilaku ini karena `promptText` ditransformasikan sebelum insert, namun tetap perlu disamakan dengan kebijakan VO server-authoritative. [2]

## Master Prompt Storyboard

Prompt gambar storyboard yang dibangun di background tidak boleh diklaim sudah terlihat penuh pada form Generator sebelum pekerjaan berjalan. Agar prompt master per page dapat diaudit setelah generate, simpan manifest read-only terpisah, contohnya `storyboard_prompt_manifest`.

```json
{
  "version": 1,
  "pages": [
    {
      "pageIndex": 0,
      "source": "llm",
      "effectivePrompt": "...",
      "styleId": "cube_box_transform",
      "faceMode": "faceless",
      "referenceCount": 2
    }
  ]
}
```

Panel dashboard kemudian dapat menampilkan “Prompt Storyboard Halaman 1 — dipakai provider gambar” dengan seluruh text visible dan tombol salin. Jangan simpan key API di manifest tersebut.

## Acceptance Criteria

1. Prompt dasar I2V/T2V tampil penuh tanpa tinggi maksimum atau scroll internal tersembunyi; user dapat mengedit dan menyalin seluruh isi.
2. Prompt efektif tampil default terbuka dan identik byte-for-byte dengan value `--prompt` Freebeat atau `prompt` Magica setelah directive server diterapkan.
3. Mengubah durasi, generate audio, backsound, scene, atau base prompt memperbarui preview dalam waktu kurang dari satu detik setelah input berhenti berubah.
4. Memilih API key tertentu hanya menampilkan label dan saldo/availability; tidak ada token di DOM, API preview, log client, atau database manifest.
5. Record video tunggal menyimpan prompt efektif yang benar-benar terkirim; riwayat video dapat menampilkannya secara penuh setelah selesai.
6. Generator membedakan dengan jelas **Deskripsi/Ide pengguna**, **ringkasan pengaturan**, dan **master prompt per page** yang baru tersedia sesudah background job membangunnya.

## References

[1]: https://github.com/curls1337/storymax/blob/master/backend/controllers/videoController.js#L236-L259 "Server-side audio directives"
[2]: https://github.com/curls1337/storymax/blob/master/backend/controllers/videoController.js#L280-L505 "Single video creation and provider payload"
[3]: https://github.com/curls1337/storymax/blob/master/frontend/src/pages/Generator.jsx#L432-L479 "Generator request payload"
[4]: https://github.com/curls1337/storymax/blob/master/frontend/src/pages/Dashboard.jsx#L2454-L2462 "Custom prompt textarea"
