# Audit Tulis AI: Referensi Gambar dan Master Prompt

## Kesimpulan Eksekutif

**Kondisi saat ini belum sesuai kebutuhan.** Fitur **Tulis AI** menerima indikator bahwa gambar referensi tersedia, tetapi **tidak benar-benar mengirim konten gambar ke model visi**. Karena itu, hasil yang muncul di textarea `PROMPT`—seperti daftar `Panel 1`, `Panel 2`, dan seterusnya—hanya merupakan **rencana/deskripsi storyboard berbasis teks**, bukan deskripsi yang telah memeriksa bentuk, warna, merek, material, atau detail nyata dari gambar referensi.

Master prompt gambar memang dibentuk kemudian ketika pengguna menekan **Generate Storyboard AI**, tetapi prompt tersebut hanya hidup sebagai variabel `pagePrompt` pada background job. Sistem hanya menulis potongan 120 karakter ke log; master prompt lengkap tidak disimpan sebagai artefak terstruktur dan tidak ditampilkan di Generator maupun Dashboard.

> Textarea yang ditandai pada Generator adalah **Prompt/Storyboard Plan** yang dapat diedit pengguna. Ia **bukan** master prompt efektif yang diterima provider gambar.

## Alur Aktual

| Tahap | Input referensi gambar | Keluaran yang terlihat | Kondisi |
|---|---|---|---|
| **Tulis AI** | Frontend hanya mengirim `hasRefImage` dan gambar pertama pada `refImage`. | `title`, `description`, `layout`; `description` diproyeksikan ke textarea sebagai daftar panel. | **Tidak memakai piksel gambar.** Backend membangun payload LLM berbasis teks saja. |
| **Generate Storyboard** | Frontend mengirim seluruh `refImages`; background job menyimpan dan menormalisasi setiap gambar. | Gambar storyboard per halaman. | Reference benar-benar dianalisis melalui descriptor subjek dan dipakai untuk consistency/rendering. |
| **Master prompt per halaman** | `subjectDescriptor`, page concept, style, face mode, grid, rasio, VO, dan status referensi. | Saat ini hanya cuplikan di log internal. | **Tidak disimpan/diperlihatkan penuh.** |

## Bukti Implementasi

Pada frontend, `handleGenerateAiPrompt()` hanya meneruskan satu gambar pertama sebagai `refImage` (`Generator.jsx`, sekitar baris 390–405). Endpoint `writePrompt()` menerima parameter itu, tetapi payload LLM di `aiController.js` hanya berisi dua pesan teks: `systemInstruction` dan `userMessageContent` (`aiController.js`, sekitar baris 453–467). `refImage` tidak pernah dipanggil dengan `resolveImageDataUrl()` dan tidak pernah menjadi `image_url` atau `inline_data` pada request LLM.

Backend memang menambahkan kalimat teks generik bahwa pengguna mengunggah gambar referensi (`aiController.js`, sekitar baris 446–448). Kalimat ini tidak memuat observasi visual nyata, sehingga model masih dapat membayangkan produk yang keliru walaupun gambar sudah dipilih.

Sebaliknya, sesudah submit storyboard, background job memproses semua gambar referensi (`storyboardJobs.js`, sekitar baris 145–290). Ia membuat `subjectDescriptor` melalui vision analyzer lalu menggabungkannya ke konteks master prompt (`storyboardJobs.js`, sekitar baris 339–370). Master prompt itu dikirim ke provider gambar, tetapi hanya dilog dengan `substring(0, 120)` dan tidak disimpan sebagai manifest halaman.

## Kontrak Target yang Dianjurkan

### 1. Tulis AI harus memakai referensi secara nyata

Tulis AI perlu menerima `refImages[]`, bukan hanya `refImage` tunggal. Server harus membuat **ReferenceBrief** terlebih dahulu dengan model visi untuk setiap gambar atau kumpulan gambar yang didukung. Ringkasan ini harus memuat fakta visual yang dapat diverifikasi: subjek utama, kategori produk, bentuk, warna dominan, material, teks/merek bila terbaca, bagian pembeda, dan batasan identitas.

```json
{
  "version": 1,
  "references": [
    {
      "index": 0,
      "role": "product",
      "observedSubject": "botol serum kaca amber dengan pipet putih",
      "identityAnchors": ["kaca amber", "pipet putih", "label krem", "cairan bening"],
      "visibleText": ["..."],
      "confidence": "high"
    }
  ]
}
```

`ReferenceBrief` tersebut harus dimasukkan sebagai fakta yang tidak boleh diubah dalam prompt Tulis AI. LLM tidak boleh diberi kebebasan untuk mengganti produk dengan niche acak atau detail generik. Hasil Tulis AI tetap berupa candidate storyboard plan, tetapi plan membawa `referenceSummary` dan `referenceCount` agar pengguna tahu konteks visual benar-benar dipakai.

### 2. Bedakan tiga teks pada antarmuka

| Area antarmuka | Kapan tersedia | Fungsi |
|---|---|---|
| **Brief pengguna / Rencana storyboard** | Setelah Tulis AI. | Daftar beat/panel yang bisa diedit. Bukan master prompt. |
| **Ringkasan referensi yang terdeteksi** | Setelah Tulis AI dengan gambar. | Menunjukkan fakta yang dilihat model dari gambar, thumbnail tiap referensi, dan jumlah gambar yang dipakai. |
| **Master Prompt Efektif per halaman** | Setelah Generate Storyboard membangun prompt. | Teks lengkap persis yang dikirim ke provider gambar: satu panel/halaman pada satu waktu. Read-only, default terbuka, dapat disalin. |

Generator tidak boleh memberi label textarea ide sebagai `Master Prompt`. Label yang tepat adalah **Rencana Storyboard / Deskripsi Panel**.

### 3. Persistensikan prompt efektif sebagai manifest

Tambahkan artefak terstruktur, misalnya `storyboard_prompt_manifest`, yang terpisah dari `prompt` pengguna dan `video_prompts`.

```json
{
  "version": 1,
  "referenceBrief": {
    "referenceCount": 2,
    "summary": "..."
  },
  "pages": [
    {
      "pageIndex": 0,
      "source": "llm",
      "styleId": "ugc_review",
      "hasReference": true,
      "effectivePrompt": "Prompt penuh yang dikirim ke provider gambar...",
      "provider": "magica",
      "model": "gpt_image_2"
    }
  ]
}
```

Background job perlu menyimpan entri tersebut **sebelum** memanggil Magica/Freebeat. Jika provider gagal, manifest tetap bermanfaat untuk debug. Bila pengguna regenerate halaman, entri halaman itu harus diperbarui dan video prompt turunannya ditandai stale.

## Urutan Perbaikan

| Prioritas | Perubahan | Alasan |
|---|---|---|
| **P0** | Ubah Tulis AI dari `refImage` tunggal menjadi `refImages[]`; buat `ReferenceBrief` berbasis visi; masukkan hasilnya ke prompt ideasi. | Saat ini klaim “gambar referensi” tidak setara dengan penggunaan visual nyata. |
| **P0** | Tambahkan manifest master prompt per halaman dan simpan sebelum render provider. | Tidak ada cara mengaudit prompt sebenarnya sesudah generate. |
| **P1** | Tampilkan thumbnail, jumlah gambar, reference summary, source (vision/LLM/deterministik), dan full master prompt di Generator/Dashboard. | Pengguna perlu dapat membuktikan referensi dan prompt sudah benar sebelum/selepas render. |
| **P1** | Gunakan array referensi terpisah pada Magica ketika schema model mendukung multi-image; fallback provider lain harus dijelaskan di UI. | Mencegah collage tersembunyi dan meningkatkan fidelity produk. |
| **P2** | Candidate preview untuk Tulis AI: Apply, Dismiss, Regenerate, Undo. | Mencegah output ide menimpa draft yang sedang diedit. |

## Acceptance Criteria

1. Menekan **Tulis AI** tanpa gambar menghasilkan plan teks biasa; UI menyatakan `0 gambar referensi dianalisis`.
2. Menekan **Tulis AI** dengan satu atau banyak gambar menghasilkan `ReferenceBrief` yang ditampilkan bersama thumbnail; fakta visualnya masuk ke request ideasi.
3. Hasil Tulis AI tidak menyebut detail produk yang bertentangan dengan `ReferenceBrief`.
4. Textarea rencana storyboard tidak diberi label atau diperlakukan sebagai master prompt.
5. Setiap halaman render memiliki `effectivePrompt` utuh yang tersimpan pada manifest, lengkap dengan provider/model/ref-count/source.
6. UI menampilkan prompt efektif utuh secara default terbuka, dengan tombol Salin, tanpa API key atau token.
7. Regenerate halaman memperbarui hanya entri prompt halaman terkait dan menandai prompt video terkait untuk diregenerate.

## Referensi Kode

[1]: https://github.com/curls1337/storymax/blob/master/frontend/src/pages/Generator.jsx#L390-L405 "Payload Tulis AI dari Generator"
[2]: https://github.com/curls1337/storymax/blob/master/backend/controllers/aiController.js#L149-L467 "Endpoint Tulis AI dan payload LLM berbasis teks"
[3]: https://github.com/curls1337/storymax/blob/master/backend/jobs/storyboardJobs.js#L145-L290 "Penyimpanan serta normalisasi gambar referensi"
[4]: https://github.com/curls1337/storymax/blob/master/backend/jobs/storyboardJobs.js#L339-L387 "Pembentukan master prompt per halaman dan render provider"
