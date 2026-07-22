// AI splitter: turns one concept into N sequential per-page prompts.
const http = require('http');
const https = require('https');

// A11: when the AI splitter is unavailable, do NOT fill every page with the
// identical concept (which makes all pages render the same). Annotate each page
// so the model still varies them into a continuous sequence.
function fallbackSplit(concept, pageCount) {
  if (pageCount <= 1) return [concept];
  return Array.from({ length: pageCount }, (_, i) => {
    const role = i === 0
      ? 'pengenalan / awal penggunaan'
      : (i === pageCount - 1 ? 'hasil akhir / call to action' : 'tahap pengembangan secara detail');
    return `${concept} (Bagian ${i + 1} dari ${pageCount} — adegan berkesinambungan: ${role}).`;
  });
}

async function splitStoryboardPromptWithAI(concept, pageCount, db, secondsPerPage = 15) {
  try {
    const settings = await db.get('SELECT * FROM ai_settings LIMIT 1');
    if (!settings || !settings.api_key) {
      console.log('[AI Split] No AI key configured. Using raw prompt fallback.');
      return fallbackSplit(concept, pageCount);
    }

    const apiHost = settings.endpoint || 'http://localhost:8045/v1';
    const apiToken = settings.api_key;
    const model = settings.model || 'gemini-3-flash';

    const payload = {
      model: model,
      messages: [
        {
          role: 'system',
          content: `Anda adalah asisten sutradara video komersial.
Tugas Anda adalah memecah konsep cerita iklan produk dari pengguna menjadi ${pageCount} bagian cerita/tahapan visual yang saling berurutan dan berkelanjutan (sekuensial).
Setiap bagian mewakili satu halaman storyboard berdurasi ${secondsPerPage} detik.
Pastikan:
- Halaman 1: Pengenalan produk, unboxing, atau awal mula penggunaan.
- Halaman berikutnya: Tahap demi tahap pengerjaan/penggunaan secara detail dan fokus pada keunggulan.
- Halaman terakhir: Hasil akhir yang memuaskan, penyajian, atau call to action visual.
Berikan deskripsi detail visual yang singkat dan padat untuk masing-masing halaman (1 paragraf ringkas per halaman).

PENTING UNTUK GAYA CUBE BOX / TRANSITION EDITION (FOTOREALISTIS, ala video viral):
Jika konsep memakai transisi kubus:
1. Awal: sebuah TANGAN memegang kubus KECIL bergaya "armored puzzle-cube" (panel logam bersegmen, rivet, dan EMBLEM/logo produk timbul di sisi ATAS, warna disesuaikan produk) di atas MEJA PUTIH polos; jempol menekannya lalu meletakkannya. Gaya FOTOREALISTIS (bukan CGI kartun), depth of field dangkal, kamera nyaris diam dengan orbit pelan.
2. Tengah: panel-panel kubus TERBUKA & MEMANJANG keluar dengan MULUS layaknya mainan transformasi premium (lipatan mekanis yang memuaskan, tetap rendah — BUKAN robot berdiri) lalu membentuk ulang jadi miniatur die-cast super detail dari produk, emblem tetap di atas. TANPA cahaya/energi, TANPA bagian meledak/terbang acak, BUKAN robot humanoid/Transformer.
3. Akhir: hasil akhir MINIATUR die-cast koleksi dari produk, mengkilap & sangat detail, di MEJA PUTIH yang sama (close-up hero).

PENTING UNTUK KONSISTENSI VISUAL (CHARACTER/PRODUCT CONSISTENCY):
1. Identifikasi karakter utama (jika ada) dan produk utama dari konsep cerita pengguna.
2. Buat deskripsi fisik yang sangat spesifik untuk karakter tersebut (misal: "pria Asia 25 tahun, rambut hitam pendek acak, memakai hoodie abu-abu polos") dan produk tersebut (misal: "botol tumbler stainless steel warna hijau toska").
3. Anda WAJIB menuliskan deskripsi fisik yang KONSISTEN dan SAMA PERSIS ini di setiap paragraf halaman (Halaman 1, Halaman 2, dst.). Jangan hanya menulis "pria itu" atau "tas itu", tetapi ulangi deskripsi fisiknya secara lengkap agar gambar dari satu halaman ke halaman berikutnya tidak meleset modelnya.

Anda harus mengembalikan respon hanya dalam format JSON mentah dengan key 'pages' berupa array string berukuran ${pageCount}. Jangan pakai pembungkus markdown (jangan pakai \`\`\`json).
Contoh output untuk 2 halaman:
{
  "pages": [
    "Seorang wanita muda Asia berusia 24 tahun berambut cokelat panjang memakai kemeja putih sedang unboxing tas ransel kulit hitam minimalis dari kotak cokelat di atas meja kayu.",
    "Wanita muda Asia berusia 24 tahun berambut cokelat panjang memakai kemeja putih berjalan di koridor kampus memakai tas ransel kulit hitam minimalis di pundaknya."
  ]
}`
        },
        {
          role: 'user',
          content: `Konsep Kasar Cerita: ${concept}`
        }
      ],
      temperature: 0.7
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
      return fallbackSplit(concept, pageCount);
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

    return fallbackSplit(concept, pageCount);
  } catch (err) {
    console.warn('[AI Split] Error splitting prompt:', err.message);
    return fallbackSplit(concept, pageCount);
  }
}

module.exports = { splitStoryboardPromptWithAI };
