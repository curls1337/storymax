// AI splitter: turns one concept into N sequential per-page prompts.
const http = require('http');
const https = require('https');
const { resolveStyleId } = require('./styleLibrary');

// A11: when the AI splitter is unavailable, do NOT fill every page with the
// identical concept (which makes all pages render the same). Annotate each page
// so the model still varies them into a continuous sequence.
function fallbackSplit(concept, pageCount, secondsPerPage = 15) {
  if (pageCount <= 1) return [concept];
  return Array.from({ length: pageCount }, (_, i) => {
    const role = i === 0
      ? 'pengenalan / hook & awal penggunaan'
      : (i === pageCount - 1 ? 'hasil akhir & call to action' : 'tahap pengembangan / demo');
    const start = i * secondsPerPage;
    const end = (i + 1) * secondsPerPage;
    const handoff = i === 0
      ? 'mulai dari awal cerita'
      : `lanjut MULUS tepat dari akhir Bagian ${i} (waktu berlanjut, jangan ulang pembukaan)`;
    return `${concept} (Bagian ${i + 1}/${pageCount}, detik ${start}-${end} — ${role}; ${handoff}; pertahankan subjek, setting, pencahayaan & palet warna yang SAMA).`;
  });
}

async function splitStoryboardPromptWithAI(concept, pageCount, db, secondsPerPage = 15, styleId = null) {
  try {
    const settings = await db.get('SELECT * FROM ai_settings LIMIT 1');
    if (!settings || !settings.api_key) {
      console.log('[AI Split] No AI key configured. Using raw prompt fallback.');
      return fallbackSplit(concept, pageCount, secondsPerPage);
    }

    const apiHost = settings.endpoint || 'http://localhost:8045/v1';
    const apiToken = settings.api_key;
    const model = settings.model || 'gemini-3-flash';

    const { getInitialContainerDescription } = require('./containerShapes');

    // Style-aware: ONLY inject the cube-transformation guidance when the cube
    // style is actually selected. Previously this block was sent for EVERY style,
    // which leaked cube scenes into Before-After / UGC / etc. page concepts.
    const resolvedStyle = resolveStyleId(styleId);
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

    const payload = {
      model: model,
      messages: [
        {
          role: 'system',
          content: `Anda adalah asisten sutradara video komersial. Pecah konsep iklan produk pengguna menjadi ${pageCount} bagian (halaman) storyboard yang BERURUTAN & BERKESINAMBUNGAN — SATU video utuh ${totalSec} detik, tiap halaman ${secondsPerPage} detik. Jendela waktu: ${windows}.

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

Deskripsi tiap halaman: 1 paragraf ringkas & padat yang SUDAH memuat semua anchor terkunci di atas.
${cubeBlock}

Balas HANYA JSON mentah: {"pages": [ ... ]} berisi ${pageCount} string. Tanpa markdown (jangan pakai \`\`\`json).
Contoh (2 halaman — subjek & setting dikunci sama, ADA handoff):
{"pages":["Wanita Asia 24th rambut cokelat panjang, kemeja putih, cahaya pagi hangat di meja kayu — unboxing tas ransel kulit hitam minimalis (Bagian 1/2, detik 0-${secondsPerPage}).","Wanita Asia 24th rambut cokelat panjang, kemeja putih (SAMA), cahaya pagi hangat yang sama — LANJUT dari adegan unboxing tadi, kini berdiri memakai tas ransel kulit hitam minimalis di pundak sambil tersenyum ke kamera (Bagian 2/2, detik ${secondsPerPage}-${2 * secondsPerPage})."]}`
        },
        {
          role: 'user',
          content: `Konsep Kasar Cerita: ${concept}`
        }
      ],
      temperature: 0.4
    };

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiToken}`
    };

    const response = await new Promise((resolve, reject) => {
      const urlParsed = new URL(`${apiHost}/chat/completions`);
      const client = urlParsed.protocol === 'https:' ? https : http;
      const port = urlParsed.port || (urlParsed.protocol === 'https:' ? 443 : 80);

      const options = {
        hostname: urlParsed.hostname,
        port: port,
        path: urlParsed.pathname + urlParsed.search,
        method: 'POST',
        headers: headers,
        timeout: 45000 // 45 seconds for cloud environments like Railway
      };

      const req = client.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Timeout'));
      });

      req.write(JSON.stringify(payload));
      req.end();
    });

    if (response.statusCode !== 200) {
      console.warn('[AI Split] API failed with status:', response.statusCode, response.body);
      return fallbackSplit(concept, pageCount, secondsPerPage);
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

    return fallbackSplit(concept, pageCount, secondsPerPage);
  } catch (err) {
    console.warn('[AI Split] Error splitting prompt:', err.message);
    return fallbackSplit(concept, pageCount, secondsPerPage);
  }
}

module.exports = { splitStoryboardPromptWithAI };
