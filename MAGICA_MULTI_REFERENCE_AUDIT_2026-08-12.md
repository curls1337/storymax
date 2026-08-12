# Audit Referensi Multi-Gambar Magica — Storymax

**Kesimpulan:** **bisa dan sebaiknya dilakukan secara schema-driven.** Magica tidak menggunakan satu bentuk input gambar yang universal; aplikasi perlu melihat schema submodel aktif. Bila schema gambar yang dipilih memiliki field `string[]`, Storymax dapat mengirim beberapa URL gambar referensi secara terpisah dalam satu request. Bila schema hanya menyediakan `string`, Storymax harus mengirim satu gambar yang paling prioritas—**tanpa membuat kolase sebagai pengganti diam-diam**. [1] [2]

## Status Implementasi Saat Ini

| Lapisan | Status | Temuan |
|---|---|---|
| Antarmuka Generator | **Sudah benar** | `selectedRefImages` dikirim sebagai array `refImages` ke endpoint generate. [3] |
| Wrapper Magica | **Sudah siap sebagian** | `generateOneImageMagica()` sudah menerima `opts.refUrls`, memetakan schema image array, dan membatasi daftar ke 3 URL publik. [4] |
| Pipeline storyboard awal | **Belum benar untuk Magica** | Gambar-gambar disimpan, lalu digabung menjadi `combined_ref_*.png` sebelum render provider. [5] |
| Pemanggilan Magica awal | **Belum memakai array** | Job hanya meneruskan `refUrl: pageRefPath`, sehingga wrapper tidak pernah menerima daftar gambar asli. [6] |
| Regenerasi halaman | **Belum benar** | Regenerate kembali memuat satu `finalRefImagePath` dan mengirim `refUrl` tunggal. [7] |

> **Akar masalah:** kemampuan multi-reference sudah ada di wrapper Magica, tetapi alur storyboard menghancurkan daftar itu lebih awal menjadi satu kolase, lalu memanggil API dengan parameter legacy `refUrl`.

## Yang Dikonfirmasi oleh Dokumentasi Magica

Dokumentasi Magica mengharuskan klien mengambil schema model/submodel dengan `GET /api/v1/models/{modelId}/schema` sebelum menjalankan model. Schema mengembalikan definisi field, termasuk `dataType`; dokumentasi menyebut `string[]` sebagai salah satu tipe input yang mungkin. Request run kemudian meneruskan field tersebut dalam object `input`. Karena itu, dukungan banyak gambar adalah **kemampuan per model/submodel**, bukan asumsi global untuk seluruh katalog. [1] [2]

Dengan implementasi wrapper Storymax saat ini, perilaku berikut sebenarnya sudah tepat:

| Bentuk field pada schema Magica | Perilaku yang seharusnya |
|---|---|
| `uploadedImages`, `image_urls`, atau field gambar lain bertipe `string[]` | Kirim semua referensi yang dipilih, dengan urutan prioritas yang jelas. |
| Field gambar bertipe `string` | Kirim satu gambar referensi paling prioritas; tampilkan informasi bahwa model tersebut mendukung satu gambar. |
| Tidak ada field gambar | Jangan jalankan `image-to-image`; gunakan text-to-image atau minta user memilih model yang sesuai. |

Wrapper `magicaGen.js` telah mendeteksi field image array dan field image tunggal secara dinamis. Ia juga sudah mengubah path lokal menjadi URL publik serta melakukan pra-cek reachability per URL. [4]

## Alur yang Membuat Referensi Menjadi Kolase

Saat ini, `storyboardJobs.js` menyimpan semua `refImages`, lalu melakukan salah satu dari dua hal berikut.

| Kondisi | Perilaku saat ini | Masalah untuk Magica |
|---|---|---|
| Tidak ada karakter konsisten; terdapat >1 gambar | Semua gambar disatukan side-by-side dan dijadikan `finalRefImagePath`. | Model melihat satu gambar kolase, bukan beberapa gambar dengan identitas terpisah. |
| Ada karakter konsisten + >1 gambar produk | Foto karakter dipakai sebagai satu referensi visual; gambar produk lain digabung untuk analisis deskripsi saja. | Render Magica tidak menerima gambar produk sebagai referensi visual tambahan. |
| Regenerasi halaman | Hanya `finalRefImagePath` yang dipulihkan dari state. | Perilaku awal dan regenerate dapat menyimpang atau tetap memakai kolase. |

Untuk Freebeat, kolase tetap dapat dipertahankan sebagai **jalur kompatibilitas provider tunggal**. Namun untuk Magica, kolase tidak boleh menjadi artefak wajib sebelum `generateOneImageMagica()` dipanggil.

## Perubahan yang Direkomendasikan

### P0 — Simpan daftar referensi asli dan perannya

Tambahkan field canonical yang tidak bergantung provider ke task state, misalnya `referenceImages`.

```js
referenceImages: [
  { path: '/uploads/ref_character.png', role: 'identity', priority: 0 },
  { path: '/uploads/ref_product_front.png', role: 'product', priority: 1 },
  { path: '/uploads/ref_product_detail.png', role: 'detail', priority: 2 }
]
```

Urutan harus bermakna. Foto karakter atau produk yang paling menentukan identitas ditempatkan pertama. Jangan hanya menyimpan `finalRefImagePath` sebagai sumber kebenaran; field itu boleh tetap ada untuk kompatibilitas Freebeat lama.

### P0 — Pisahkan strategy provider setelah gambar disimpan

Setelah seluruh gambar disimpan dan dinormalisasi, buat dua turunan yang berbeda.

```js
const originalRefPaths = savedRefMeta.map((item) => item.path);
const magicaRefPaths = originalRefPaths.slice(0, 3);
const freebeatRefPath = originalRefPaths.length > 1
  ? await stitchImagesSideBySide(originalRefPaths, publicDir)
  : (originalRefPaths[0] || '');

task.referenceImages = savedRefMeta;
task.finalRefImagePath = freebeatRefPath; // legacy/Freebeat only
```

Jangan memanggil `stitchImagesSideBySide()` untuk menentukan input Magica.

### P0 — Teruskan `refUrls` pada render awal Magica

Ubah pemanggilan awal pada `storyboardJobs.js` dari satu parameter legacy menjadi array:

```js
const magicaRefPaths = (task.referenceImages || [])
  .sort((a, b) => a.priority - b.priority)
  .map((item) => item.path)
  .filter(Boolean)
  .slice(0, 3);

const { result: magicaRes } = await magicaGen.executeWithMagicaFailover(
  db,
  task.magicaKeyId,
  async (keyRec) => magicaGen.generateOneImageMagica(keyRec.key_value, pagePrompt, {
    aspectRatio: task.aspectRatio,
    refUrls: magicaRefPaths,
    nodeType: task.magicaModel,
    onLog: (message) => { task.logs += `${message}\n`; },
  }),
  (message) => { task.logs += `${message}\n`; },
);
```

Wrapper saat ini sudah memilih mode `image-to-image` bila `refUrls` berisi nilai dan sudah mengisi field `string[]` sesuai schema. [4]

### P0 — Gunakan daftar yang sama pada regenerate

Jalur regenerate juga harus memuat `taskData.referenceImages`, bukan hanya `finalRefImagePath`.

```js
const referenceImages = Array.isArray(taskData.referenceImages)
  ? taskData.referenceImages
  : [];
const magicaRefPaths = referenceImages
  .sort((a, b) => a.priority - b.priority)
  .map((item) => item.path)
  .filter(Boolean)
  .slice(0, 3);

await magicaGen.generateOneImageMagica(keyRec.key_value, pagePrompt, {
  aspectRatio,
  refUrls: magicaRefPaths,
  nodeType: genParams.magicaModel || 'gpt_image_2',
  onLog: (message) => { activeTasks[taskId].logs += `${message}\n`; },
});
```

### P1 — Jadikan dukungan model terlihat, bukan diam-diam fallback

`buildInput()` saat ini melakukan hal yang aman: apabila schema hanya mempunyai image field tunggal, ia memakai `imageUrls[0]`; jika field-nya array, ia memakai seluruh daftar hingga `maxImages`. [4] Namun pengguna dan log belum selalu mengetahui batas yang terpakai.

Tambahkan hasil capability dari schema, misalnya:

```js
{
  referenceMode: 'multi' | 'single' | 'none',
  referenceLimit: 3,
  mappedField: 'uploadedImages'
}
```

Tampilkan pesan seperti berikut di log atau UI:

> “Model ini menerima 3 referensi terpisah pada field `uploadedImages`; urutan: identity → product → detail.”

Atau bila hanya satu:

> “Model ini menerima satu referensi; Storymax memakai gambar identity prioritas pertama dan **tidak** menggabungkan sisanya.”

### P1 — Bedakan referensi visual dan referensi untuk analisis teks

`analyzeSubject()` saat ini menerima satu path. Ini tidak menghalangi render multi-reference, tetapi deskripsi teks produk mungkin masih hanya berasal dari satu gambar atau kolase. Untuk tahap awal, gunakan gambar `role: 'product'` berprioritas tertinggi sebagai input analyser. Tahap lanjutan dapat memperluas analyser menjadi multi-image vision agar detail dari depan, samping, dan close-up bergabung secara tekstual tanpa mengubah gambar input Magica.

## Ketentuan Kompatibilitas

| Provider/model | Input visual | Kebijakan yang disarankan |
|---|---|---|
| Freebeat | Satu gambar | Pertahankan kolase sebagai fallback khusus Freebeat. |
| Magica dengan field gambar `string[]` | Beberapa URL publik | Kirim referensi terpisah, maksimum sesuai schema dan batas produk. |
| Magica dengan field gambar `string` | Satu URL publik | Kirim referensi prioritas pertama; jangan membuat kolase otomatis. |
| Magica tanpa field gambar | Tidak ada input gambar | Tolak mode image-to-image dengan error yang dapat ditindaklanjuti. |

## Acceptance Criteria

1. Memilih tiga gambar dan provider Magica dengan schema array menghasilkan satu request `input` berisi tiga URL gambar terpisah; tidak ada file `combined_ref_*.png` yang dipakai sebagai input Magica.
2. Memilih tiga gambar dan model Magica single-image memakai gambar prioritas pertama, mencatat limit satu gambar, dan tidak mengirim kolase.
3. Jalur Freebeat dengan tiga gambar tetap menerima kolase seperti perilaku sebelumnya.
4. Menekan regenerate halaman menggunakan daftar referensi asli yang sama, dengan urutan dan limit yang sama seperti render awal.
5. Jika salah satu URL tidak publik, pra-cek menunjuk URL yang gagal dan tidak mengubah daftar referensi lain.
6. Bila ada karakter konsisten dan gambar produk, model Magica multi-reference menerima urutan `character → product`, sementara prompt tetap mengunci identity dan subject descriptor.

## References

[1]: https://magica.com/docs/api-reference/nodes/model-schema.md "Magica — Get model input schema"
[2]: https://magica.com/docs/api-reference/nodes/run.md "Magica — Run a model"
[3]: https://github.com/curls1337/storymax/blob/master/frontend/src/pages/Generator.jsx#L432-L480 "Generator request payload"
[4]: https://github.com/curls1337/storymax/blob/master/backend/services/magicaGen.js#L347-L537 "Schema-driven Magica input mapping and image run"
[5]: https://github.com/curls1337/storymax/blob/master/backend/jobs/storyboardJobs.js#L145-L290 "Reference-image saving and collage logic"
[6]: https://github.com/curls1337/storymax/blob/master/backend/jobs/storyboardJobs.js#L316-L410 "Initial Magica storyboard render"
[7]: https://github.com/curls1337/storymax/blob/master/backend/jobs/storyboardJobs.js#L884-L968 "Magica storyboard regeneration"
