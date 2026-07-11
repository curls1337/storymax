# storymax - AI Storyboard Generator (15 Seconds)

storymax adalah aplikasi web SaaS premium untuk men-generate storyboard video promosi berdurasi **15 detik** secara otomatis menggunakan model **GPT-Image 2 (Model 108)** melalui Freebeat API. 

Aplikasi ini mendukung multi-user dengan hak akses terpisah (isolasi data) dan Panel Administrasi untuk manajemen pooling API Key Freebeat.

---

## ✨ Fitur Utama
1. **Sistem Multi-User**: Autentikasi JWT yang aman. User tidak bisa melihat storyboard milik user lain.
2. **Locked 15-Second Pacing**: Semua template preset dikunci otomatis pada durasi 15 detik.
3. **Template Generator Pilihan**:
   * *Step-by-Step Cooking Grid* (Sinematik/Gelap)
   * *Video Storyboard Sheet* (Tabel Terang/Aesthetic)
   * *Product Identity Sheet* (Spesifikasi Produk/Bersih)
   * *Commercial UGC Guide* (Panduan UGC/Segar)
4. **Admin Panel**:
   * *User Management* (CRUD pengguna, edit role, reset/ganti password).
   * *Freebeat API Key Pool* (Input API Key secara satu per satu atau **Bulk Import** melalui teks/CSV).
   * Pengguna dapat memilih kunci API aktif mana yang akan digunakan dari daftar pooling admin.

---

## 🛠️ Cara Menjalankan Lokal

### 1. Prasyarat
* Node.js & npm terinstal di komputer.
* `freebeat-cli` terinstal secara global (`npm install -g freebeat-cli@latest`).

### 2. Instalasi Dependensi
Jalankan perintah ini di direktori root proyek untuk menginstal modul backend dan frontend sekaligus:
```bash
npm run install-all
```

### 3. Jalankan Mode Development
Jalankan server Express dan server pengembangan Vite (React) secara bersamaan:
```bash
npm run dev
```
* Frontend berjalan di: `http://localhost:5173`
* Backend API berjalan di: `http://localhost:5000`

### 4. Akun Admin Default
Saat database SQLite dibuat pertama kali, akun admin berikut akan otomatis ditambahkan:
* **Username**: `admin`
* **Password**: `adminpassword`

---

## 🚀 Panduan Deploy (Railway & Sevalla)

Aplikasi ini dirancang sebagai **Single-Service Node.js App** agar mudah dideploy di server seperti Railway atau Sevalla:

1. **Build Proyek**: Sebelum dideploy, compile React frontend ke folder statis:
   ```bash
   npm run build
   ```
2. **Koneksikan ke GitHub**: Buat repositori baru di GitHub dan upload seluruh file proyek ini.
3. **Deploy di Railway/Sevalla**:
   * Sambungkan repositori GitHub Anda.
   * Server akan secara otomatis mendeteksi proyek Node.js.
   * Command start default: `npm start` (menjalankan `node backend/server.js` yang akan otomatis melayani backend API sekaligus menyajikan file frontend statis dari `frontend/dist`).
   * Pastikan Anda menginstal `freebeat-cli` secara global di server atau environment build Anda jika ingin menjalankan generator di server.
