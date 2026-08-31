// AI splitter: turns one concept into N sequential per-page prompts.
const http = require('http');
const https = require('https');
const { resolveStyleId, getStyleSpec } = require('./styleLibrary');

// A11: when the AI splitter is unavailable, do NOT fill every page with the
// identical concept (which makes all pages render the same). Annotate each page
// so the model still varies them into a continuous sequence.
//
// The page/handoff tag is placed BEFORE the raw concept (not appended after it)
// so it survives masterPrompt.js's character-budget trimmer, which shortens this
// string from the END when the total prompt is too long. Previously the handoff
// clause ('lanjut MULUS tepat dari akhir Bagian N...') was the LAST thing in the
// string, so a long user concept could push it past the cutoff — making page 2+
// look like a fresh restart instead of a continuation. The "keep same subject /
// setting / lighting / palette" instruction is already enforced (and never
// trimmed) by masterPrompt.js's pageScope/CONT lines, so it is not duplicated
// here anymore — that duplication could also conflict if only one copy survived
// trimming.
//
// A12: styles with `independentScenes: true` (e.g. "Konten Sosial IG/TikTok/
// Shorts") are NOT one continuous story — each page is its own standalone
// everyday moment/activity for the SAME character. Using the old "lanjutan
// LANGSUNG dari halaman sebelumnya" handoff language for these styles produced
// mismatched results, since masterPrompt.js already treats independentScenes
// pages as separate self-contained moments. This fallback (and the AI-split
// system prompt below) now branch on that flag instead of always assuming a
// single continuous narrative.
function fallbackSplit(concept, pageCount, secondsPerPage = 15, independentScenes = false) {
  if (pageCount <= 1) return [concept];
  if (independentScenes) {
    return Array.from({ length: pageCount }, (_, i) => {
      const start = i * secondsPerPage;
      const end = (i + 1) * secondsPerPage;
      return `Fokus pada bagian MOMEN/AKTIVITAS KESEHARIAN ${i + 1} dari ${pageCount} (detik ${start}-${end}, karakter yang sama, momen berdiri sendiri, BUKAN lanjutan dari halaman lain) dari konsep cerita berikut: ${concept}`;
    });
  }
  return Array.from({ length: pageCount }, (_, i) => {
    const role = i === 0
      ? 'Fokus pada bagian PEMBUKA/pengenalan produk & hook awal'
      : (i === pageCount - 1
          ? 'Fokus pada bagian PENUTUP/hasil akhir & call to action'
          : `Fokus pada bagian PENGGUNAAN/demo produk & tahapan aksi lanjutan (Bagian ${i + 1} dari ${pageCount})`);
    const start = i * secondsPerPage;
    const end = (i + 1) * secondsPerPage;
    const stage = i === 0
      ? `Halaman ${i + 1} dari ${pageCount} (detik ${start}-${end}) — ${role} dari cerita berikut:`
      : `Halaman ${i + 1} dari ${pageCount} (detik ${start}-${end}, lanjutan langsung dari akhir Halaman ${i} — waktu berlanjut, jangan ulangi pembukaan) — ${role} dari cerita berikut:`;
    return `${stage} ${concept}`;
  });
}

function buildFallbackConceptForPage(concept, pageIdx, pageCount, secondsPerPage = 15, independentScenes = false) {
  if (pageCount <= 1) return concept;
  const list = fallbackSplit(concept, pageCount, secondsPerPage, independentScenes);
  return list[pageIdx] || concept;
}

function splitByExplicitPanels(concept, pageCount) {
  if (!concept || typeof concept !== 'string' || pageCount <= 1) return null;
  const hasPanels = /Panel\s*1\s*[:\-]/i.test(concept);
  if (!hasPanels) return null;

  const panelRegex = /Panel\s*(\d+)\s*[:\-]\s*([\s\S]*?)(?=(?:Panel\s*\d+\s*[:\-])|$)/gi;
  const panels = [];
  let match;
  while ((match = panelRegex.exec(concept)) !== null) {
    const num = parseInt(match[1], 10);
    const desc = match[2].trim();
    if (desc) {
      panels.push({ num, text: `Panel ${num}: ${desc}` });
    }
  }

  if (panels.length < 2) return null;

  const pages = [];
  const perPage = Math.ceil(panels.length / pageCount);
  for (let i = 0; i < pageCount; i++) {
    const pagePanels = panels.slice(i * perPage, (i + 1) * perPage);
    if (pagePanels.length > 0) {
      pages.push(pagePanels.map(p => p.text).join('\n\n'));
    }
  }

  if (pages.length === pageCount) {
    console.log(`[Explicit Panel Splitter] Successfully sliced ${panels.length} panels across ${pageCount} pages (${perPage} panels/page).`);
    return pages;
  }
  return null;
}

async function splitStoryboardPromptWithAI(concept, pageCount, db, secondsPerPage = 15, styleId = null) {
  // Resolve style-driven flags up front (no DB access needed) so every
  // fallback path — including the catch block below — can honor them.
  const resolvedStyle = resolveStyleId(styleId);
  const styleSpec = getStyleSpec(styleId) || {};
  const independentScenes = !!styleSpec.independentScenes;

  try {
    // 0. Check if concept already contains explicit Panel 1:, Panel 2: ... definitions
    const explicitPages = splitByExplicitPanels(concept, pageCount);
    if (explicitPages) {
      return explicitPages;
    }

    const settings = await db.get('SELECT * FROM ai_settings LIMIT 1');
    if (!settings || !settings.api_key) {
      console.log('[AI Split] No AI key configured. Using raw prompt fallback.');
      return fallbackSplit(concept, pageCount, secondsPerPage, independentScenes);
    }

    const apiHost = settings.endpoint || 'http://localhost:8045/v1';
    const apiToken = settings.api_key;
    const model = settings.model || 'gemini-3-flash';

    const { getInitialContainerDescription } = require('./containerShapes');

    // Style-aware: ONLY inject the cube-transformation guidance when the cube
    // style is actually selected. Previously this block was sent for EVERY style,
    // which leaked cube scenes into Before-After / UGC / etc. page concepts.
    const isCube = ['cube_box_transform', 'asmr_toy_transform', 'shape_morph_transform'].includes(resolvedStyle);
    const isShapeMorph = resolvedStyle === 'shape_morph_transform';

    let shapeInstruction = 'sebuah KOTAK / KUBUS KECIL super detail (panel armored, garis-sambungan mekanis, aksen LED/logo subjek)';
    if (isShapeMorph) {
      const containerDesc = getInitialContainerDescription(concept, 'auto');
      shapeInstruction = `SATU WADAH MEKANIS PRESIASI BERBENTUK ${containerDesc.shapeId.toUpperCase()}`;
    }

    const cubeBlock = isCube ? `

PENTING UNTUK GAYA TRANSFORMASI MEKAR / MEKANIS:
Aturan Alur Pembukaan & Transformasi (SANGAT KETAT):
1. Halaman/Panel 1 (Wajib Awal): WAJIB dimulai dari ${shapeInstruction} yang diletakkan/berdiri statis di atas permukaan/meja. DILARANG KERAS LANGSUNG MENAMPILKAN BENTUK UTUH SUBJEK/MAINAN DI PANEL 1. TANPA tangan manusia, wadah berdiri sendiri di atas permukaan. Gaya FOTOREALISTIS, depth of field dangkal.
2. Halaman/Panel Berikutnya (Proses Mekar): Wadah tersebut mulai aktif secara otomatis, panel-panelnya TERBUKA, BERGESER & MENGEMBANG (*self-unfolding/morphing*) secara bertahap dan MULUS, secara mekanis membangun/membentuk ulang dari bentuk wadah awal menjadi bentuk akhir SUBJEK yang diinginkan (${concept}). TANPA tangan manusia, TANPA bagian meledak/terbang acak, TANPA sihir cahaya, dan DILARANG KERAS BERGANTI-GANTI BENTUK WADAH (JANGAN BERUBAH DARI BOLA KE KUBUS KE SILINDER). Bentuk wadah HARUS KONSISTEN 1 BENTUK TUNGGAL sejak Panel 1 hingga mekar.
3. Halaman/Panel Akhir (Hasil akhir): Subjek tampil utuh dalam bentuk akhir yang memuaskan di atas permukaan/meja yang sama.` : '';

    // pageCount-aware timeline: total video length + each page's absolute second window.
    const totalSec = pageCount * secondsPerPage;
    const windows = Array.from({ length: pageCount }, (_, i) => `Hal ${i + 1}=detik ${i * secondsPerPage}-${(i + 1) * secondsPerPage}`).join(', ');

    // A12: independentScenes styles (e.g. Konten Sosial IG/TikTok/Shorts) get a
    // dedicated system prompt: SAME character, but each page is its own
    // standalone everyday moment/activity — never a continuous handoff story.
    const systemPrompt = independentScenes ? `Anda adalah asisten kreator konten sosial (IG/TikTok/Shorts). Pecah konsep pengguna menjadi ${pageCount} MOMEN/AKTIVITAS KESEHARIAN YANG BERBEDA & BERDIRI SENDIRI (BUKAN satu cerita berkelanjutan) untuk SATU karakter yang sama — total durasi konten ${totalSec} detik, tiap halaman ${secondsPerPage} detik. Jendela waktu: ${windows}.

ATURAN 1 — SATU KARAKTER SAJA (JANGAN MELENCENG):
Seluruh ${pageCount} halaman WAJIB menampilkan KARAKTER yang SAMA PERSIS dari konsep (wajah, rambut, warna kulit, bentuk tubuh harus tetap konsisten; outfit boleh menyesuaikan aktivitas). DILARANG mengganti identitas karakter di halaman mana pun.

ATURAN 2 — KUNCI ANCHOR IDENTITAS (agar semua halaman tampak 1 orang yang sama):
Tetapkan di awal lalu TULIS ULANG SAMA PERSIS (verbatim) ciri fisik karakter di SETIAP halaman (mis. "wanita Asia 25th, rambut hitam bergelombang sebahu, kulit sawo matang"). Jangan menulis "wanita itu"/"pria itu" — ulangi deskripsi lengkapnya di tiap halaman.

ATURAN 3 — SETIAP HALAMAN = MOMEN/AKTIVITAS TERSENDIRI (BUKAN LANJUTAN CERITA):
- Setiap dari ${pageCount} halaman adalah AKTIVITAS/MOMEN KESEHARIAN YANG BERBEDA & BERDIRI SENDIRI (misalnya: lari pagi, belanja, dinner, kerja, santai di kafe — pilih sesuai konsep pengguna), masing-masing dengan lokasi/waktu/aktivitasnya sendiri.
- DILARANG memakai kata "lanjutan dari halaman sebelumnya" / "waktu berlanjut" / "masih di lokasi yang sama" — setiap halaman adalah potongan momen candid yang TERPISAH.
- Gaya foto: candid, ala kamera HP asli, bukan studio/CGI yang terlalu sempurna.

ATURAN 4 — PANJANG KALIMAT: Jaga setiap deskripsi halaman ringkas, maksimal kurang lebih 400 karakter, sebutkan aktivitas & lokasi momen tersebut di awal kalimat.

Deskripsi tiap halaman: 1 paragraf ringkas & padat yang SUDAH memuat anchor identitas karakter terkunci di atas + aktivitas/momen unik halaman itu.

Balas HANYA JSON mentah: {"pages": [ ... ]} berisi ${pageCount} string. Tanpa markdown (jangan pakai \`\`\`json).
Contoh (2 halaman — karakter dikunci sama, TIAP halaman momen berbeda & berdiri sendiri):
{"pages":["Wanita Asia 25th, rambut hitam bergelombang sebahu, kulit sawo matang, memakai setelan olahraga abu — momen lari pagi candid di trotoar taman kota, cahaya matahari pagi hangat, foto ala kamera HP.","Wanita Asia 25th, rambut hitam bergelombang sebahu, kulit sawo matang (SAMA), kini memakai dress kasual, momen candid duduk santai di kafe sambil memegang cangkir kopi, cahaya siang alami dari jendela, foto ala kamera HP."]}` : `Anda adalah asisten sutradara video komersial. Pecah konsep iklan produk pengguna menjadi ${pageCount} bagian (halaman) storyboard yang BERURUTAN & BERKESINAMBUNGAN — SATU video utuh ${totalSec} detik, tiap halaman ${secondsPerPage} detik. Jendela waktu: ${windows}.

ATURAN 1 — SATU SUBJEK SAJA (JANGAN MELENCENG):
Seluruh ${pageCount} halaman WAJIB tentang PRODUK/SUBJEK/HIDANGAN yang SAMA PERSIS dari konsep. DILARANG mengganti atau menambah produk/bahan utama/tema lain di halaman mana pun. Contoh: jika Halaman 1-2 memasak MIE, Halaman 3-4 HARUS MIE yang SAMA. Yang boleh berubah antar halaman HANYA tahapan/adegan/sudut kamera — BUKAN subjeknya.

ATURAN 2 — KUNCI ANCHOR VISUAL (agar semua halaman tampak SATU pengambilan yang sama):
Tetapkan di awal lalu TULIS ULANG SAMA PERSIS (verbatim) di SETIAP halaman:
- Subjek/produk: deskripsi fisik super spesifik (mis. "botol tumbler stainless steel hijau toska, tutup hitam, logo bundar 'AQUA'").
- Karakter (jika ada): fisik + pakaian spesifik (mis. "pria Asia 25th, rambut hitam pendek, hoodie abu polos").
- Setting/lokasi, pencahayaan, waktu (siang/malam), dan PALET WARNA — WAJIB sama di semua halaman.
Jangan menulis "produk itu"/"pria itu" — ulangi deskripsi lengkapnya di tiap halaman.

ATURAN 3 — SAMBUNGAN ANTAR HALAMAN (HANDOFF, INI KUNCI KESINAMBUNGAN):
- Halaman 1: hook & pengenalan subjek (awal cerita).
- Halaman 2..${pageCount}: setiap halaman MULAI TEPAT dari kondisi AKHIR halaman sebelumnya (waktu berlanjut) — JANGAN mengulang pembukaan; tunjukkan tahap berikutnya.
- Halaman ${pageCount}: hasil akhir yang memuaskan + call to action visual.
Buat peralihan terasa mulus & logis (kelanjutan momen, bukan loncatan).

ATURAN 4 — URUTAN & PANJANG KALIMAT (agar tidak terpotong sistem): MULAI setiap deskripsi halaman (kecuali Halaman 1) dengan tag singkat kesinambungannya, misalnya "Lanjutan langsung dari Halaman ${'${i}'}, ...", SEBELUM detail subjek/anchor — jangan letakkan tag ini di akhir kalimat. Jaga setiap deskripsi halaman ringkas, maksimal kurang lebih 400 karakter.

Deskripsi tiap halaman: 1 paragraf ringkas & padat yang SUDAH memuat semua anchor terkunci di atas.
${cubeBlock}

Balas HANYA JSON mentah: {"pages": [ ... ]} berisi ${pageCount} string. Tanpa markdown (jangan pakai \`\`\`json).
Contoh (2 halaman — subjek & setting dikunci sama, ADA handoff DI AWAL kalimat halaman 2):
{"pages":["Wanita Asia 24th rambut cokelat panjang, kemeja putih, cahaya pagi hangat di meja kayu — unboxing tas ransel kulit hitam minimalis (Bagian 1/2, detik 0-${secondsPerPage}).","Lanjutan langsung dari Bagian 1 (waktu berlanjut, jangan ulangi pembukaan) — Wanita Asia 24th rambut cokelat panjang, kemeja putih (SAMA), cahaya pagi hangat yang sama, kini berdiri memakai tas ransel kulit hitam minimalis di pundak sambil tersenyum ke kamera (Bagian 2/2, detik ${secondsPerPage}-${2 * secondsPerPage})."]}`;

    const payload = {
      model: model,
      messages: [
        {
          role: 'system',
          content: systemPrompt
        },
        {
          role: 'user',
          content: `Konsep Kasar Cerita: ${concept}`
        }
      ],
      temperature: 0.4
    };

    // Honor the admin LLM-provider setting (Magica for text-only, else default host).
    const { llmChatViaSettings } = require('./aiClient');

    const MAX_RETRIES = 2;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (attempt > 0) {
          console.log(`[AI Split] Mencoba ulang request AI Split (percobaan ${attempt + 1}/${MAX_RETRIES + 1})...`);
          await new Promise(r => setTimeout(r, 1500 * attempt));
        }

        const response = await llmChatViaSettings(payload, { db, timeoutMs: 45000 });

        if (response.statusCode !== 200) {
          console.warn(`[AI Split] API status ${response.statusCode} (percobaan ${attempt + 1}/${MAX_RETRIES + 1}):`, response.body);
          if (attempt < MAX_RETRIES) continue;
          return fallbackSplit(concept, pageCount, secondsPerPage, independentScenes);
        }

        const resJson = JSON.parse(response.body);
        const content = resJson.choices?.[0]?.message?.content || '';
        let cleanText = content.trim();
        if (cleanText.startsWith('```')) {
          cleanText = cleanText.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '');
        }

        const parsed = JSON.parse(cleanText.trim());
        if (parsed && Array.isArray(parsed.pages) && parsed.pages.length === pageCount) {
          console.log('[AI Split] Successfully split prompts:', parsed.pages);
          return parsed.pages;
        }

        if (attempt < MAX_RETRIES) continue;
      } catch (callErr) {
        console.warn(`[AI Split] Percobaan ${attempt + 1} gagal:`, callErr.message);
        if (attempt < MAX_RETRIES) continue;
      }
    }

    return fallbackSplit(concept, pageCount, secondsPerPage, independentScenes);
  } catch (err) {
    console.warn('[AI Split] Error splitting prompt:', err.message);
    return fallbackSplit(concept, pageCount, secondsPerPage, independentScenes);
  }
}

module.exports = { splitStoryboardPromptWithAI, fallbackSplit, buildFallbackConceptForPage };
