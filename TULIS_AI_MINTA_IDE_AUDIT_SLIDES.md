## Cover

# Audit Tulis AI & Minta Ide

### Stabilkan kontrak cerita, panel, dan draft pengguna

**Storymax — Ringkasan teknis**

## Slide 1

# Kesimpulan: flow belum cukup aman

- Tulis AI dan Minta Ide sudah mampu menyusun ide, memilih layout, dan mengisi prompt.
- Namun satu endpoint kini mencampur rewriting, random ideation, layout selection, dan panel planning.
- Output yang terlihat sukses belum tentu cocok dengan halaman/panel yang nantinya dirender.

## Slide 2

# Tiga sumber ketidaksesuaian utama

| Masalah | Dampak |
|---|---|
| `description` tunggal memuat semua panel | Cerita multi-halaman mudah terpotong atau berulang |
| Fallback plain text dianggap sukses | Prompt tanpa struktur dapat masuk ke pipeline |
| Hasil AI langsung diterapkan | Draft pengguna dapat tertimpa tanpa persetujuan |

## Slide 3

# Flow saat ini mengulang perencanaan

1. Pengguna mengirim ide atau meminta ide acak.
2. LLM menulis judul, description, dan layout dalam satu respons.
3. Frontend langsung menimpa field form.
4. Generator storyboard kembali memecah description menjadi halaman.

> Satu cerita direncanakan dua kali: oleh Tulis AI dan oleh proses storyboard.

## Slide 4

# Kontrak baru: StoryboardPlan

```text
StoryboardPlan
├─ version, title, layout, projectBrief
└─ pages[]
   ├─ pageIndex, goal
   └─ beats[]
      ├─ index
      ├─ action
      └─ camera
```

- LLM menghasilkan page dan beat yang sudah sesuai generation plan.
- `description` menjadi proyeksi kompatibilitas, bukan sumber kebenaran.
- Job storyboard memakai `pages[pageIndex]` langsung; tidak perlu memecah ulang teks bebas.

## Slide 5

# P0: validasi sebelum hasil dianggap sukses

- Validasi versi schema, style enum, jumlah halaman, jumlah beat, indeks, dan field wajib.
- Bila output LLM tidak valid, lakukan satu repair request dengan error yang jelas.
- Bila repair gagal, return 422 dan **jangan ubah draft pengguna**.

| Sebelum | Sesudah |
|---|---|
| Regex/plain text fallback | Typed validation error |
| Layout default diam-diam | Layout valid atau candidate ditolak |

## Slide 6

# P0: candidate dulu, Apply kemudian

```text
editing → requesting → previewing → applied
                    ↘ rejected → editing
previewing → dismissed → editing
applied → undo_available → editing
```

- Respons AI disimpan sebagai candidate, terpisah dari form.
- Pengguna memilih: Terapkan, Pertahankan Draft, Ide Lain, atau Undo.
- Snapshot diambil tepat sebelum Apply untuk mengembalikan title, prompt, layout, dan plan.

## Slide 7

# Minta Ide membutuhkan mode eksplisit

| Sebelum | Sesudah |
|---|---|
| `minta_ide_acak:` di dalam text | `mode: random_idea` di request |
| Ide acak sulit ditelusuri | Return seed dan metadata ide |
| Satu hasil langsung menimpa form | Beberapa candidate untuk dipilih |

**Mode yang dipisahkan:** `expand`, `clean_product_copy`, `random_idea`, dan `layout_recommendation`.

## Slide 8

# Urutan implementasi aman

1. Tambahkan helper `StoryboardPlan` dan test validator.
2. Ubah endpoint agar menghasilkan candidate tervalidasi dan repair sekali.
3. Rilis preview, Apply, Dismiss, dan Undo di Generator.
4. Persist plan di `generation_params`; pakai plan pada generate dan regenerate.
5. Hapus sentinel lama serta parser regex setelah kompatibilitas selesai.

## Slide 9

# Keputusan yang dibutuhkan tim

### Setujui P0 sebelum menambah prompt baru

**Hasil yang dituju:**

- Satu sumber kebenaran untuk alur halaman dan panel.
- Output AI tervalidasi sebelum memengaruhi proyek.
- Draft pengguna tetap aman dan dapat dipulihkan.
