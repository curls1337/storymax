# Temuan Dokumentasi Magica — Awal

- URL yang diberikan pengguna: `https://magica.com/docs/authentication`.
- Halaman dokumentasi menampilkan autentikasi menggunakan API key dan contoh untuk cURL, Node.js, serta Python.
- Navigasi dokumentasi menyediakan endpoint model, termasuk **Get model input schema** dan **POST Run a model**.
- Peninjauan berikutnya perlu memverifikasi schema input node/model untuk mengetahui apakah endpoint menerima satu URL gambar atau daftar URL gambar referensi.

Source: https://magica.com/docs/authentication

## Temuan Schema Input dan Eksekusi Model

Dokumentasi Magica menyatakan bahwa input model bersifat **schema-driven**. Endpoint `GET /api/v1/models/{modelId}/schema` mengembalikan field input beserta tipe data, required flag, default, opsi, kondisi, dan batas. Dokumentasi secara eksplisit menyebut bahwa tipe data yang mungkin termasuk `string` dan `string[]`; field yang dikembalikan harus dipakai untuk membangun serta memvalidasi payload sebelum menjalankan model.

Endpoint eksekusi adalah `POST /api/v1/nodes/{nodeType}/run`, dengan body yang berisi `subModelId` untuk model multi-mode dan object `input`. Model/submodel yang benar, termasuk schema input-nya, harus ditemukan secara dinamis sebelum run. Dokumentasi API publik tidak menjamin semua model image-to-image menerima beberapa referensi; dukungan tersebut harus ditentukan dari schema submodel yang dipilih. Jika field gambar bertipe `string[]`, beberapa URL gambar dapat dikirim pada field itu. Jika hanya `string`, hanya satu URL gambar dapat dikirim.

Sumber:

- https://magica.com/docs/api-reference/nodes/model-schema.md
- https://magica.com/docs/api-reference/nodes/run.md
- https://magica.com/docs/introduction/quickstart.md
- https://magica.com/docs/openapi.json
