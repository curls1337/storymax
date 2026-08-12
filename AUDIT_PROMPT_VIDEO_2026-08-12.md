# Audit Prompt Video Storymax

## Kesimpulan

**Prompt video saat ini sudah memiliki banyak guardrail visual yang baik, tetapi flow-nya belum stabil sebagai kontrak produksi.** Sistem telah memisahkan prompt I2V dan T2V, memiliki sanitasi kebocoran narasi, memuat aturan style transformasi, serta menerapkan audio directive di server. Namun ada beberapa masalah P0 pada unit kerja scene, schema `video_prompts`, fallback LLM, dan durasi. Masalah-masalah ini dapat menyebabkan prompt yang salah dipilih, prompt generik dipakai untuk semua video, atau data prompt hilang setelah marketing copy diperbarui. [1] [2]

> **Diagnosis utama:** satu image storyboard saat ini adalah **satu halaman sheet berisi banyak panel**, tetapi sistem prompt video memperlakukannya sebagai **satu scene video**. Kontrak ini belum diputuskan secara eksplisit dan bertentangan dengan sejumlah instruksi internal yang masih berbicara tentang panel individual.

## Flow Saat Ini

```mermaid
flowchart LR
  A[Storyboard page image: sheet multi-panel] --> B[Vision LLM: generateVideoPromptsInternal]
  B --> C[video_prompts: scenes[]]
  C --> D{Generation path}
  D --> E[Video Studio tunggal: prompt dari UI]
  D --> F[Batch: prompt dari scenes[scene_idx]]
  E --> G[Freebeat atau Magica]
  F --> G
  H[Marketing copy] --> I[Berpotensi menulis ulang video_prompts]
```

Satu storyboard page image dikirim ke vision LLM sebagai satu data URI. LLM diminta memahami seluruh sheet, lalu menghasilkan satu item `scenes[]` untuk setiap page image. Ketika video dibuat, video tunggal memakai prompt yang ada di editor UI; batch memilih `imageToVideoPrompt` atau `textToVideoPrompt` berdasarkan generation type. [1] [2] [3]

## Kontrak yang Seharusnya Dikunci

| Kontrak | Perilaku sekarang | Kontrak target |
|---|---|---|
| Unit video | Ambigu antara page, panel, beat, dan scene. | Tetapkan **segment** sebagai satu video; `sourcePageIndex` dan `sourcePanelIndices` wajib eksplisit. |
| Prompt persistence | `video_prompts` TEXT tanpa version/schema. | Object versioned: `{ version, segments, metadata }`. |
| Durasi | Auto generation dapat menerima total project duration sebagai durasi satu scene. | `segmentDuration` selalu dikirim ke prompt video dan provider. |
| I2V | Harus motion-only untuk aset yang sudah terlihat. | I2V menerima satu sumber visual yang jelas: satu image segment atau crop/canonical scene image. |
| T2V | Deskripsi lengkap per scene. | T2V memakai canonical segment plan, bukan interpretasi ulang sheet. |
| Audio | Konfigurasi sebagian server-authoritative, sebagian masih bergantung caller. | `generation_params` menjadi satu sumber kebenaran untuk enable/voice profile; UI hanya mengaktifkan rendering audio bila diizinkan. |
| Regenerasi/mutasi | Marketing copy dapat mengubah bentuk data prompt. | Marketing copy disimpan terpisah dan tidak pernah menulis `segments`. |

## Temuan

| Prioritas | Temuan | Bukti | Dampak | Perbaikan minimum |
|---:|---|---|---|---|
| **P0** | Page sheet dan panel diperlakukan ambigu sebagai scene video. | Vision prompt menyebut `panelImages.length` sebagai jumlah “pages (scenes)”, tetapi setiap image berisi grid beberapa panel. [1] | Video dapat mencoba merangkum banyak beat dalam satu clip atau membaca panel sebagai rangkaian shot yang tidak realistis. | Pilih satu model: **satu video per page** atau **satu video per panel**. Simpan source mapping dalam segment plan. |
| **P0** | Marketing copy menimpa schema `{ scenes: [] }`. | `regenerateStoryboardMarketingCopy()` hanya mempertahankan raw array; object `scenes` di-reset ke `[]` sebelum disimpan. [4] | I2V, T2V, narration, dan metadata scene dapat hilang setelah regenerate marketing copy. | Gunakan normalizer versioned; simpan marketing copy di kolom storyboard yang sudah tersedia. Jangan mutasi `video_prompts`. |
| **P0** | Fallback output LLM dianggap sukses dan membuat prompt yang hampir sama untuk semua scene. | Pada JSON parse gagal, fallback membuat satu `cleanText.substring(0, 200)` untuk setiap scene. [1] | Batch dapat menghasilkan semua video dari prompt generik yang tidak selaras dengan scene masing-masing. | Lakukan satu repair request; jika masih gagal, return error/`needs_regeneration`, bukan persist fallback generik. |
| **P0** | Auto-generate meneruskan `task.totalDuration` sebagai `videoDuration` untuk prompt per-page. | Job storyboard memanggil generator dengan `videoDuration: task.totalDuration`. [5] | Setiap scene dapat dirancang untuk total durasi proyek, bukan durasi clip/segment. | Kirim `task.secondsPerPage` atau `GenerationPlan.segmentDuration`. |
| **P1** | Jumlah gambar yang berhasil dibaca dapat lebih kecil daripada `totalScenes`. | `totalScenes` dihitung dari `panelImages`, tetapi `imageParts` dapat berkurang bila file/URL gagal dimuat. [1] | Vision LLM melihat N-1 gambar tetapi diminta membuat N prompt; index dapat bergeser. | Validasi `imageParts.length === panelImages.length`; gagal jelas atau catat source index untuk setiap image. |
| **P1** | Validasi respons hanya memeriksa bahwa `scenes` adalah array. | Tidak ada validasi count, uniqueness `scene_idx`, field wajib, version, atau panjang/purity prompt. [1] | Scene kosong, duplikat, atau out-of-order dapat masuk ke UI/batch secara diam-diam. | Tambahkan schema validator dan repair dengan error spesifik. |
| **P1** | Batch VO tidak selalu memakai source of truth yang sama seperti single generate. | Video tunggal menghitung `hasVo` dari `generation_params`; batch memakai `generateAudio && sceneNarration`. [2] [3] | Narasi stale berpotensi aktif walau VO storyboard telah dimatikan. | Gunakan `resolveVoConfig(storyboard)` pada kedua jalur dan validasi narration hanya jika `enableVo` benar. |
| **P1** | Tulis ulang prompt pada Dashboard masih melakukan overwrite semua `video_prompts`. | Endpoint membuat seluruh JSON baru setelah satu request. [1] [3] | Regenerate satu type atau page dapat menghapus field lain / metadata masa depan. | Patch immutably pada `segments[segmentIdx]` dengan normalizer. |
| **P2** | Konsumen legacy tidak konsisten. | Dashboard mendukung `{scenes}`, raw object, dan text; Seedance Studio dapat turun ke `storyboard.prompt`; export full hanya membaca `{scenes}`. [3] [6] | Kerusakan schema sering tersamarkan oleh fallback; hasil video dapat generik tanpa error yang jelas. | Satu `normalizeVideoPrompts()` dipakai semua reader; migrasi lazy record lama. |

## Hal yang Sudah Baik

Sistem sudah memiliki beberapa fondasi yang tepat. Prompt I2V secara eksplisit diarahkan untuk hanya menjelaskan kamera, gerak, cahaya, dan atmosfer—bukan mendeskripsikan ulang subject. Prompt juga melarang video merender grid, panel, header, badge, dan teks dari storyboard sheet. Sanitizer `stripSpeechLeak` menghapus kebocoran VO atau teks planning dari I2V. Selain itu, `applyAudioDirectives()` menambahkan directive audio pada server, bukan mempercayai UI sepenuhnya. [1] [2]

Namun, guardrail prose tersebut tidak cukup bila unit sumbernya masih ambigu. Sebelum menambah detail prompt, sistem harus menentukan apakah satu image sheet adalah satu clip atau input untuk banyak clip.

## Rekomendasi Arsitektur

### Opsi A — Satu video per page sheet

Opsi ini paling sedikit perubahan. Satu image page merupakan satu segment video; prompt I2V meminta satu long-take/mini-montage yang mengalir melalui beat pada sheet. Kontrak harus menyatakan bahwa `segment.sourcePageIndex` adalah satu-satunya source image dan `sourcePanelIndices` adalah daftar beat internal. Durasi segment adalah `secondsPerPage`.

Kelemahannya: model I2V hanya menerima gambar sheet, bukan visual bersih masing-masing panel. Untuk hasil lebih stabil, crop atau render asset scene terpisah tetap lebih baik.

### Opsi B — Satu video per panel

Opsi ini lebih cocok untuk video pendek yang konsisten. Saat storyboard page dibuat, simpan panel plan dan crop/asset visual per panel. Prompt video kemudian dibuat untuk setiap panel, dan video batch menjalankan `segments.length = pageCount × gridCount`.

Keuntungannya: satu prompt, satu image sumber, satu aksi, satu durasi. Tidak ada lagi instruksi kontradiktif seperti “jangan render grid” tetapi “ikuti semua panel di dalam grid.” Opsi ini direkomendasikan bila tujuan produk adalah rangkaian short clips yang kemudian digabung.

## Schema Target

```json
{
  "version": 2,
  "unit": "page_segment",
  "metadata": {
    "projectDuration": 30,
    "segmentDuration": 15,
    "styleId": "cinematic_broll"
  },
  "segments": [
    {
      "segmentIndex": 0,
      "sourcePageIndex": 0,
      "sourcePanelIndices": [0, 1, 2, 3, 4, 5],
      "timeStart": 0,
      "timeEnd": 15,
      "imageToVideoPrompt": "...",
      "textToVideoPrompt": "...",
      "narration": "...",
      "status": "ready"
    }
  ]
}
```

Jika tim memilih video per panel, ubah `unit` menjadi `panel_segment`, `sourcePanelIndices` menjadi satu angka, dan `segments.length` harus sama dengan `pageCount × gridCount`.

## Urutan Perbaikan

| Urutan | Perubahan | Alasan |
|---:|---|---|
| 1 | Putuskan unit video: page segment atau panel segment. | Semua count, duration, dan index bergantung pada keputusan ini. |
| 2 | Introduksi `normalizeVideoPrompts()` dan schema v2. | Mencegah marketing, export, UI, dan batch membaca shape berbeda. |
| 3 | Pisahkan marketing copy dari `video_prompts`; perbaiki writer marketing. | Menutup risiko kehilangan data P0. |
| 4 | Ganti fallback generik dengan parse → repair once → error state. | Mencegah semua scene memakai prompt yang sama secara diam-diam. |
| 5 | Teruskan `segmentDuration`, `timeStart`, dan `timeEnd` dari canonical plan. | Menutup mismatch total duration vs clip duration. |
| 6 | Validasi source-image count dan response scene count/index. | Mencegah misalignment vision-to-scene. |
| 7 | Samakan single dan batch audio policy. | VO tetap konsisten saat dibuat satuan atau semua sekaligus. |

## Acceptance Criteria

1. Menghasilkan project dua page dengan `secondsPerPage = 15` menyimpan dua segment berdurasi 15 detik, bukan dua segment berdurasi 30 detik.
2. Menjalankan regenerate marketing copy tidak mengubah hash `segments` pada `video_prompts`.
3. Respons LLM dengan satu scene dari kebutuhan dua scene gagal dengan error schema; sistem tidak menyimpan fallback generik.
4. Batch dan video tunggal pada `segmentIndex = 1` memilih prompt, narration, image, duration, dan audio policy yang sama.
5. Bila satu storyboard image tidak dapat dimuat untuk vision analysis, generator tidak menghasilkan scene array dengan index yang terlihat lengkap tetapi sumber visualnya kurang.
6. Export, Dashboard, Seedance Studio, dan video batch membaca normalizer yang sama untuk schema v2 maupun legacy.

## References

[1]: https://github.com/curls1337/storymax/blob/master/backend/controllers/aiController.js#L551-L1047 "Video prompt generation, vision payload, validation, and persistence"
[2]: https://github.com/curls1337/storymax/blob/master/backend/controllers/videoController.js#L194-L260 "Voiceover resolution and server-side audio directives"
[3]: https://github.com/curls1337/storymax/blob/master/backend/controllers/videoController.js#L280-L619 "Single-video prompt handling and provider execution"
[4]: https://github.com/curls1337/storymax/blob/master/backend/controllers/videoController.js#L747-L796 "Marketing-copy regeneration writer"
[5]: https://github.com/curls1337/storymax/blob/master/backend/jobs/storyboardJobs.js#L741-L769 "Automatic video-prompt generation after storyboard render"
[6]: https://github.com/curls1337/storymax/blob/master/backend/controllers/googleController.js#L346-L389 "Full export reader for video prompts"
