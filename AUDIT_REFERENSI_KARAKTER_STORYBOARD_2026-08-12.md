# Audit Referensi Karakter pada Storyboard Storymax

## Kesimpulan

**Ya, karakter yang dipilih memang masuk ke alur storyboard**, tetapi kontrak referensinya belum cukup kuat untuk menjamin kemiripan. Sistem saat ini memakai **satu** `sheet_image_url` karakter sebagai gambar edit/reference dan menambahkan deskripsi fisik hasil vision ke master prompt. Jadi karakter tidak hilang sepenuhnya. Namun, storyboard adalah satu lembar grid berisi banyak panel dan setiap halaman dirender dari satu panggilan image-to-image; provider hanya menerima satu gambar karakter, sementara instruksi meminta ia menampilkan banyak pose, sudut, jarak kamera, aktivitas, dan kadang wardrobe berbeda pada satu canvas. Kondisi ini membuat drift identitas tetap sangat mungkin.

## Alur Aktual

| Tahap | Implementasi saat ini | Status |
|---|---|---|
| Pemilihan di Generator | `chosenCharacter.id` dikirim sebagai `characterId`. Bila ada `trigger_prompt`, teks itu juga dapat diprefix ke konsep pengguna. | Diteruskan. |
| Memuat karakter pada job | Job mengambil record `characters` berdasarkan `characterId`. Bila `sheet_image_url` tersedia, URL tersebut ditambahkan sebagai `isCharacterRef: true`. | Diteruskan **hanya jika** `sheet_image_url` tersedia. |
| Analisis identitas | `characterAnalyzer` membaca `sheet_image_url` dengan vision model dan membuat descriptor gender/usia/skin tone/rambut/wajah/body type. | Diteruskan ke master prompt jika analisis berhasil. |
| Master prompt | Builder LLM dan deterministik memasukkan `CHARACTER` identity anchor dan negative drift clause. | Secara tekstual sudah kuat. |
| Render awal | Freebeat menerima satu `--image pageRefPath`; Magica menerima satu `refUrl: pageRefPath`. | Hanya satu gambar, bukan array referensi karakter. |
| Regenerate | Mengambil ulang `finalRefImagePath`, re-analisis descriptor bila perlu, lalu tetap mengirim satu `refUrl` atau satu `--image`. | Tetap hanya satu gambar. |

## Titik Penyebab Karakter Tetap Berubah

### 1. `sheet_image_url` adalah satu-satunya anchor visual yang benar-benar dipakai

UI dapat menampilkan fallback `reference_images[0]` pada kartu karakter, tetapi background job hanya menyuntikkan `char.sheet_image_url`. Bila record karakter memiliki gambar referensi namun belum memiliki `sheet_image_url` yang valid, user dapat merasa karakter sudah dipilih padahal job tidak mendapatkan gambar visual anchor sama sekali.

### 2. Semua panel dalam satu poster menuntut variasi besar dari satu gambar

Satu render storyboard membuat banyak panel sekaligus. Model diminta menampilkan karakter yang sama pada berbagai kamera, aktivitas, dan posisi. Referensi satu portrait/sheet tidak mencakup informasi multi-angle, full body, profile, atau ekspresi. Prompt text membantu, namun image model tetap dapat mengubah wajah antarpanel dalam satu poster.

### 3. Pipeline storyboard tidak meneruskan `reference_images[]` karakter ke provider

Adapter Magica sebenarnya mendukung `refUrls` dan meneruskan array ke schema model yang memiliki field `string[]`. Namun job storyboard hanya memanggil `generateOneImageMagica(..., { refUrl: pageRefPath })`. Jadi dukungan multi-reference yang tersedia di adapter tidak dipakai untuk karakter storyboard.

### 4. Identity analyzer dapat gagal secara diam-diam

`analyzeCharacterSubject()` bersifat bounded dan mengembalikan string kosong pada file tidak tersedia, unduhan CDN gagal, ukuran di atas 8 MB, timeout, atau kegagalan model visi. Job tetap generate agar tidak macet, tetapi kehilangan anchor teks penting. Saat ini UI tidak memperlihatkan apakah `characterDescriptor` berhasil dibuat atau kosong.

### 5. Kontrak face mode dapat bertentangan dengan karakter manusia

Jika user memilih `Tanpa Wajah` atau style memiliki kebijakan yang menutup/menolak wajah, prompt memasang CHARACTER descriptor sekaligus aturan face-negative. Ini tidak selalu salah—karakter masih dapat dikenali melalui tubuh/rambut—tetapi tidak cocok bila pengguna berharap wajah referensi yang sama secara kuat. UI belum memberi warning konflik tersebut.

## Perbaikan Prioritas

| Prioritas | Perbaikan | Dampak |
|---|---|---|
| **P0** | Validasi sebelum generate: karakter harus memiliki `sheet_image_url` yang dapat diunduh/diakses provider. Jika hanya `reference_images` tersedia, pilih/normalisasi salah satunya sebagai anchor yang jelas atau blok generate dengan pesan yang dapat ditindaklanjuti. | Menghindari generate tanpa reference visual sungguhan. |
| **P0** | Simpan `characterReferenceManifest`: `characterId`, `anchorImagePaths[]`, `descriptor`, hasil status vision, dan `faceMode` dalam `active_task_data`/manifest storyboard. | Memberikan audit trail dan menghindari anchor hilang saat regenerate. |
| **P0** | Tampilkan panel **Referensi Karakter Aktif** sebelum Generate: thumbnail, nama, jumlah image anchors, descriptor yang dideteksi, mode wajah, dan peringatan bila descriptor gagal/face mode bertentangan. | User tahu karakter benar-benar terkunci sebelum membayar render. |
| **P1** | Untuk Magica, teruskan hingga 3 reference images karakter melalui `refUrls` bila schema model mendukung array; fallback ke sheet tunggal bila hanya field string tersedia. | Meningkatkan consistency pada pose/sudut berbeda. |
| **P1** | Gunakan character sheet khusus: headshot depan, 3/4, side profile, dan full body dengan background netral. Jangan gunakan foto karakter kecil/crop semata. | Memberi model informasi identitas yang cukup lintas panel. |
| **P1** | Tambahkan pemeriksaan conflict: bila karakter aktif dan `faceMode=faceless`, tampilkan keputusan eksplisit “body/wardrobe anchor saja” atau sarankan Full Face. | Mengurangi ekspektasi salah dan instruksi berlawanan. |
| **P2** | Tambahkan score/preview “Identity lock ready” sebelum generate serta tombol pilih ulang gambar anchor. | UX dan debugging lebih baik. |

## Kontrak Target

```json
{
  "characterReference": {
    "characterId": 42,
    "anchorImages": [
      "/uploads/character_front.png",
      "/uploads/character_three_quarter.png",
      "/uploads/character_full_body.png"
    ],
    "descriptor": "young adult woman, warm medium skin tone, oval face, ...",
    "descriptorStatus": "ready",
    "faceMode": "full",
    "providerReferenceMode": "multi_image"
  }
}
```

Master prompt harus memasukkan descriptor tersebut sebagai anchor teks. Pada provider, Magica menerima `refUrls: anchorImages`; provider dengan satu field gambar menerima `primaryAnchorImage`. UI harus menampilkan provider mode yang benar-benar digunakan, bukan hanya jumlah gambar yang telah diunggah.

## Acceptance Criteria

1. Memilih karakter yang tidak memiliki anchor image valid memblokir generate dengan pesan jelas, bukan melanjutkan tanpa referensi.
2. Sebelum Generate, UI menampilkan thumbnail anchor, hasil descriptor, status vision, face mode, dan provider reference mode.
3. `characterReference` dipersistensikan sehingga Regenerate memakai gambar serta descriptor yang sama.
4. Untuk schema Magica multi-image, seluruh anchor sampai batas schema dikirim sebagai array; schema single-image memilih anchor utama dan menampilkan warning eksplisit.
5. Jika `faceMode=faceless`, UI menjelaskan bahwa kemiripan wajah tidak dapat dijamin dan meminta konfirmasi/saran mode wajah penuh.
6. Master prompt efektif per halaman menyertakan `CHARACTER` anchor dan informasi reference mode yang dapat diaudit tanpa mengekspos API key.

## Referensi Kode

[1]: https://github.com/curls1337/storymax/blob/master/frontend/src/pages/Generator.jsx#L432-L480 "Pengiriman characterId dari Generator"
[2]: https://github.com/curls1337/storymax/blob/master/backend/jobs/storyboardJobs.js#L79-L115 "Pemuatan sheet image dan descriptor karakter"
[3]: https://github.com/curls1337/storymax/blob/master/backend/jobs/storyboardJobs.js#L329-L387 "Master prompt serta payload Magica storyboard awal"
[4]: https://github.com/curls1337/storymax/blob/master/backend/prompts/masterPrompt.js#L177-L256 "Identity anchor dan negative drift pada prompt deterministik"
[5]: https://github.com/curls1337/storymax/blob/master/backend/prompts/masterPromptLLM.js#L8-L103 "Identity anchor pada prompt LLM"
[6]: https://github.com/curls1337/storymax/blob/master/backend/services/magicaGen.js#L505-L537 "Dukungan refUrls multi-gambar Magica"
