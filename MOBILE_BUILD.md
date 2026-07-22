# StoryMax — Panduan Build Mobile (iOS & Android) + Auto-Update

Aplikasi mobile dibungkus **Capacitor**. Ada dua model update:

---

## ✅ Model AKTIF sekarang: Auto-Update (Live Server)

`frontend/capacitor.config.json` sekarang mengarah ke situs live:

```json
"server": { "androidScheme": "https", "url": "https://story.devcurl.me", "cleartext": false }
```

Artinya aplikasi native (iOS/Android) **memuat langsung web app dari server**. Efeknya:

- **Sideload / install CUKUP SEKALI.**
- Setiap kali backend/frontend di-deploy ke Railway, aplikasi HP **otomatis dapat versi terbaru** saat dibuka — **tanpa install ulang**.
- Tidak perlu set `VITE_API_URL` (aplikasi memuat dari domain yang sama, jadi `/api` otomatis benar).

**Perlu rebuild native HANYA jika:** menamb/menghapus plugin Capacitor, mengubah `capacitor.config.json`, ikon/nama app, atau izin (permissions). Perubahan UI/logika biasa **tidak** perlu rebuild.

⚠️ Konsekuensi: aplikasi butuh **internet** untuk jalan (wajar, ini alat online). Kalau server mati, app tidak memuat.

---

## 🔨 Cara Rebuild (sekali, untuk menerapkan config auto-update)

Butuh: **Node.js**, dan **Xcode** (untuk iOS, wajib macOS) / **Android Studio** (untuk Android).

```bash
# 1. Masuk ke folder frontend
cd frontend

# 2. Install dependency (sekali)
npm install

# 3. (kalau folder native belum ada) tambahkan platform
npx cap add ios
npx cap add android

# 3b. Generate IKON aplikasi (iOS & Android) dari logo StoryMax (public/logo.png)
npm run assets      # = siapkan assets/ dari logo + capacitor-assets generate

# 4. Build web + sinkronkan ke native (script sudah disiapkan)
npm run mobile      # = vite build && cap sync

# 5a. iOS  -> buka di Xcode, lalu Run/Archive ke perangkat
npm run open:ios

# 5b. Android -> buka di Android Studio, lalu Build APK / Run
npm run open:android
```

- **Android APK**: di Android Studio → Build → Build Bundle(s)/APK(s) → Build APK(s). File `.apk` untuk sideload.
- **iOS**: di Xcode pilih perangkat/Signing Team → Product → Archive (atau Run ke device). Untuk sideload tanpa akun berbayar, pakai AltStore/Sideloadly dengan `.ipa` hasil archive.

Setelah langkah ini sekali, update berikutnya cukup lewat deploy Railway — **tidak install ulang**.

---

## 🎨 Ikon Aplikasi (iOS & Android)

Ikon launcher diambil dari **`frontend/public/logo.png`** (logo StoryMax, 1024×1024).

Untuk menerapkannya ke aplikasi:
```bash
cd frontend
npm install                 # sekali, untuk mengambil @capacitor/assets
npx cap add ios / android   # kalau folder native belum ada
npm run assets              # generate semua ukuran ikon iOS & Android dari logo
npm run mobile              # sync ke native
# lalu rebuild di Xcode / Android Studio
```

`npm run assets` menyalin `public/logo.png` ke `frontend/assets/` lalu menjalankan `capacitor-assets` yang membuat semua ukuran ikon (iOS AppIcon set + Android mipmap & adaptive icon).

**Ganti ikon di masa depan:** cukup timpa `frontend/public/logo.png` dengan gambar 1024×1024 baru, jalankan `npm run assets` + rebuild. Ikon adalah bagian native, jadi perubahannya **perlu rebuild sekali** (tidak ikut auto-update live).

---

## 🔁 Alternatif untuk Produksi / App Store: OTA Update (Capgo)

Model live-server di atas **tidak lolos review App Store** (Apple menilai "cuma webview"). Kalau nanti mau rilis resmi ke App Store / Play Store, ganti ke **OTA bundled** memakai **[@capgo/capacitor-updater](https://capgo.app)**:

- Aplikasi tetap membundel web assets (bisa jalan offline, lolos review).
- Update web dikirim "over-the-air" secara diam-diam → user tetap **tidak perlu install ulang** untuk perubahan web.
- Tetap perlu rebuild native hanya untuk perubahan native.

Langkah singkat (nanti, saat mau ke store):
1. Hapus `server.url` dari `capacitor.config.json` (kembali ke bundled).
2. Set `VITE_API_URL=https://story.devcurl.me/api` saat build (buat `frontend/.env.production`).
3. `npm i @capgo/capacitor-updater`, lalu ikuti setup Capgo (akun gratis atau self-host) untuk upload bundle tiap update.

---

## Ringkasan
| Kebutuhan | Aksi |
|---|---|
| Update konten/logika (harian) | Deploy Railway → app HP auto-update. **Tanpa rebuild.** |
| Tambah plugin / ubah config native / ikon | Rebuild native (`npm run mobile` → Xcode/Android Studio) |
| Rilis resmi ke App Store/Play Store | Pindah ke OTA Capgo (lihat di atas) |
