// Deploy trigger: re-ship PR #18 (video-prompt I2V/camera direction + anti-crop
// framing for transform & ASMR styles). Railway missed the auto-deploy on merge
// df0efee, so this no-op marker forces a fresh build of the current master HEAD.
const { AI_API_HOST, AI_API_TOKEN } = require('../config/secrets');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { getDb } = require('../db');
const { uploadsDir } = require('../config');

async function resolveImageDataUrl(refImage) {
  if (!refImage || typeof refImage !== 'string') return null;
  const str = refImage.trim();
  if (str.startsWith('data:image/')) return str;
  if (str.startsWith('http://') || str.startsWith('https://')) return str;
  if (str.startsWith('/uploads/') || str.startsWith('uploads/')) {
    const filename = path.basename(str);
    const localPath = path.join(uploadsDir, filename);
    if (fs.existsSync(localPath)) {
      const ext = path.extname(filename).replace('.', '') || 'jpeg';
      const mime = ext === 'png' ? 'image/png' : (ext === 'webp' ? 'image/webp' : 'image/jpeg');
      const b64 = fs.readFileSync(localPath).toString('base64');
      return `data:${mime};base64,${b64}`;
    }
  }
  return null;
}

const LAYOUT_STYLES = require('../constants/layoutStyles');
const { resolveStyleId, getStyleSpec } = require('../prompts/styleLibrary');
const { llmChatViaSettings } = require('../prompts/aiClient');

// Styles whose VIDEO should get the full cinematic atmosphere (haze + subtle lens
// flare + shallow DOF). Every other style stays clean & crisp (DOF only, no
// haze/flare) so products/UGC/tutorials/comparisons read clearly and honestly.
const CINEMATIC_VIDEO_STYLES = new Set([
  'cube_box_transform', 'shape_morph_transform', 'short_story', 'cinematic_broll', 'luxury_mood',
  'product_assembly', 'liquid_splash', 'fashion_lookbook',
]);

// Styles where the subject changes SCALE or EXPANDS on screen (a cube/pod unfolds
// into a full product, parts converge into a product, a splash bursts). These crop
// easily when the camera sits too close, so the VIDEO prompt must be framed WIDE
// with margin for the LARGEST/final state of the motion — never tight on the small
// starting object.
const TRANSFORM_FRAMING_STYLES = new Set([
  'cube_box_transform', 'shape_morph_transform', 'asmr_toy_transform',
  'product_assembly', 'liquid_splash',
]);

// A few styles' `camera` grammar describes a LAYOUT (comic panels, infographic
// icons/arrows/callouts, split-screen). Written for the storyboard SHEET, those words
// leak into the video prompt and make the model animate the sheet/grid instead of a
// real scene. Neutralize the layout wording for the VIDEO path only — the storyboard
// image itself still uses the original camera grammar from styleLibrary.
function sanitizeCameraForVideo(cam) {
  return String(cam || '')
    .replace(/dynamic comic panels with action lines/gi, 'dynamic single-scene shots with action energy')
    .replace(/flat clean graphic composition with icons,? arrows and callouts/gi, 'clean animated explainer shots — one clear subject/action per shot, with minimal icon/arrow accents')
    .replace(/split or side[- ]by[- ]side comparison/gi, 'a clean single-frame before-then-after transition')
    .replace(/side[- ]by[- ]side comparison/gi, 'a clean single-frame comparison')
    .replace(/split[- ]?screen/gi, 'single full-frame framing')
    .replace(/\bcomic panels?\b/gi, 'single-scene shots')
    .replace(/\bgraphic composition\b/gi, 'clean scene composition')
    .replace(/\bgrid\b/gi, 'scene')
    .replace(/\bpanels?\b/gi, 'shots');
}


function httpRequest(url, headers, body) {
  return new Promise((resolve, reject) => {
    const urlParsed = new URL(url);
    const client = url.startsWith('https') ? https : http;
    const port = urlParsed.port || (url.startsWith('https') ? 443 : 80);

    const options = {
      hostname: urlParsed.hostname,
      port: port,
      path: urlParsed.pathname + urlParsed.search,
      method: 'POST',
      headers: headers,
      timeout: 90000 // 90 seconds timeout for large vision payloads
    };

    const req = client.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          body: data
        });
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request Timeout (90s)'));
    });

    req.write(JSON.stringify(body));
    req.end();
  });
}

// Resolve any image reference (data URL, /uploads/ path, http URL, or raw base64)
// into a proper `data:image/...;base64,...` URL for the vision LLM. Without this, a
// path like "/uploads/refgen_x.png" gets sent as inline_data.data and the API fails
// with "Base64 decoding failed".
async function resolveImageDataUrl(src) {
  if (!src || typeof src !== 'string') return null;
  if (src.startsWith('data:image')) return src;
  // Local upload (relative /uploads/... or absolute URL containing /uploads/)
  if (src.includes('/uploads/')) {
    try {
      const idx = src.indexOf('/uploads/');
      const rel = src.substring(idx + '/uploads/'.length).split('?')[0];
      const full = path.join(uploadsDir, rel);
      if (fs.existsSync(full)) {
        const ext = (full.split('.').pop() || 'png').toLowerCase();
        const mime = (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg' : (ext === 'webp' ? 'image/webp' : 'image/png');
        return `data:${mime};base64,${fs.readFileSync(full).toString('base64')}`;
      }
    } catch (e) {}
    return null;
  }
  // Remote http(s)
  if (src.startsWith('http')) {
    try {
      const r = await fetch(src);
      if (r.ok) {
        const buf = Buffer.from(await r.arrayBuffer());
        return `data:image/png;base64,${buf.toString('base64')}`;
      }
    } catch (e) {}
    return null;
  }
  // Otherwise assume it is already raw base64 bytes.
  return `data:image/png;base64,${src}`;
}

function writePrompt(req, res) {
  return generateAiAssistant(req, res, 'expand');
}

function generateRandomIdea(req, res) {
  return generateAiAssistant(req, res, 'random_idea');
}

async function generateAiAssistant(req, res, forcedMode) {
  const { concept, style, videoEngine, gridCount, duration, aspectRatio, mode: requestedMode = 'expand', refImages = [], refImage } = req.body || {};
  const mode = forcedMode || requestedMode;
  const isRandomIdea = mode === 'random_idea';
  const rawReferenceInputs = Array.isArray(refImages) ? refImages : [];
  const legacyReferences = rawReferenceInputs.length ? rawReferenceInputs : (refImage ? [refImage] : []);
  if (!isRandomIdea && !String(concept || '').trim() && legacyReferences.length === 0) {
    return res.status(400).json({ message: 'Tulis AI memerlukan ide teks atau minimal satu gambar referensi.' });
  }
  if (!['expand', 'random_idea'].includes(mode)) {
    return res.status(400).json({ message: 'Mode AI Assistant tidak valid.' });
  }

  // Dynamic AI Creative Matrix pools to generate infinite, ultra-broad commercial concepts
  const CREATIVE_NICHES = [
    "Gaming Gear & Esports (keyboard mekanikal RGB, mouse nirkabel ultralight, headset gaming)",
    "Smart Home & Robotics (vacuum cleaner robotik presisi, lampu pintar ambient, speaker pintar)",
    "Niche Artisan Coffee & Espresso (biji kopi roasted, mesin espresso manual, foam milk latte art)",
    "Electric Vehicles & Supercars (hypercar listrik, ban serat karbon, lampu LED futuristik)",
    "High-End Audio & Headphones (headphone kayu profesional, vinyl record player, tabung amplifier)",
    "Luxury Perfumerie & Fragrance (botol parfum kaca berukir, tetesan esensial lavender & mawar)",
    "Fitness & High-Performance Sports (sepatu marathon karbon, botol minum stainless, smartwatch fitness)",
    "Skincare & Organic Beauty (serum vitamin C, krim herbal bening, botol pipet kaca)",
    "Gourmet Culinary & Patisserie (croissant mentega renyah, cokelat leleh artisan, kue tart buah segar)",
    "Cyberpunk Streetwear & Fashion (jaket techwear matte, sneaker neon, aksesori perak)",
    "Horology & Mechanical Watches (jam tangan tourbillon kuningan, strap kulit buaya)",
    "Outdoor & Extreme Adventure (tas ransel gunung waterproof, tenda camping bersalju, kompas kuningan)",
    "Home Decor & Interior Design (vas keramik buatan tangan, lampu meja hangat, tanaman monstera)",
    "Luxury Eyewear & Sunglasses (kacamata titanium, lensa anti-reflektif, case kulit halus)",
    "Artisan Leather Goods (dompet kulit buatan tangan, tas kerja kulit grain, jahitan benang emas)",
    "Pet Luxury & Accessories (harness kucing/anjing premium, tempat tidur hewan berbahan beludru)",
    "Baby & Maternity Premium (stroller bayi aluminium ringan, botol bayi bebas BPA, selimut organik)",
    "Craft Beverages & Refreshment (soda buah alami berbusa, es batu kristal transparan, kaleng alumunium matte)",
    "Art Supplies & Creative Tools (kuas cat minyak, pensil sketsa grafit, kanvas bertekstur)",
    "Action Cameras & Drones (drone lipat 4K, kamera aksi waterproof, gimbal stabilizer)",
    "Sustainable Eco Fashion (pakaian katun organik, pewarna alami pewarna tanaman, serat bambu)",
    "Musical Instruments & Gear (gitar akustik kayu murni, saksofon kuningan berkilat, pedal efek)",
    "Aromatherapy & Wellness (lilin minyak esensial organik, diffuser mist halus, batu spa hangat)",
    "Automotive Detail & Car Care (pengkilap bodi mobil ceramic coating, busa pembersih makro)",
    "Fine Jewelry & Diamonds (cincin platinum berlian cut, kalung mutiara air tawar)",
    "Modern Stationery & Journaling (pulpen fountain pen tinta emas, buku catatan jilid kulit)",
    "Smart Lighting & Studio Optics (lampu RGB neon tube, lensa kamera kine 85mm)",
    "Organic Specialty Tea (daun teh hijau segar, cangkir porselen tradisional, uap air panas)",
    "High-End Dental & Personal Care (sikat gigi elektrik sonic, pembersih wajah mikro)",
    "Architectural Concepts & Tiny Homes (makiet rumah kayu minimalis, struktur kaca modern)",
    "Snacks & Premium Confectionery (keripik kentang renyah, permen jelly warna-warni)",
    "Cycling & Urban Commute (sepeda lipat titanium, helm sepeda urban, lampu keselamatan LED)",
    "Solar Power & Portable Energy (powerbank panel surya, baterai lithium portabel)",
    "Tactical & Survival Gear (senter LED ultra-terang, pisau lipat serbaguna, jam tahan banting)",
    "Footwear & Ergonomic Shoes (sepatu kerja kulit fleksibel, sandal outdoor sol karet cengkeram)",
    "Premium Kitchenware & Cutlery (pisau dapur baja Damascus, wajan cast iron)",
    "Virtual Reality & Mixed Reality (headset VR futuristik, pengontrol gerak haptic)",
    "Fresh Tropical Fruits & Juices (potongan mangga manis, siraman air kelapa segar)",
    "Luggage & Travel Cases (koper aluminium hardshell, roda spinner 360 derajat)",
    "Artisan Bakery & Sourdough (roti sourdough renyah, taburan tepung terigu, permukaan roti hangat)"
  ];

  const VISUAL_AESTHETICS = [
    "Cinematic Dark & Dramatic Rim-Light Studio (pencahayaan studio gelap dengan sorotan emas/kristal)",
    "Scandinavian Natural Warm Sunset (suasana hangat kayu, cahaya matahari senja menembus jendela)",
    "Cyberpunk Neon Rain & Urban Night (lampu kota malam hari dipantulkan permukaan jalan basah)",
    "Minimalist High-Fashion Editorial (desain bersih, warna pastel netral, kontras tajam)",
    "Surrealist Floating Elements (elemen melayang di udara dengan nuansa magis & elegan)",
    "Retro Vintage 90s Film Grain (nuansa sinematik klasik dengan tekstur warna hangat)",
    "High-Tech Industrial Futuristic (struktur logam brushed, LED cyan/magenta, garis presisi)",
    "Organic Biophilic Botanical (tanaman hijau segar, pencahayaan alami embun pagi, elemen bumi)",
    "Monochrome Ultra-Luxury Minimal (palet hitam-putih kontras tinggi dengan aksen metallic gold)",
    "Vibrant Pop Creative Studio (latar belakang warna solid energik dengan pencahayaan pop tajam)"
  ];

  const CAMERA_ACTIONS = [
    "360-degree smooth orbit tracking shot (kamera berputar melingkari produk secara halus)",
    "Macro close-up slow-motion liquid/texture splash (percikan cairan/tekstur makro lambat)",
    "Explode assembly in mid-air (komponen produk terpisah melayang lalu menyatu kembali presisi)",
    "Dynamic FP-shot fast push-in tracking (kamera meluncur cepat mendekati aksi hero produk)",
    "Reverse motion tactile ASMR interaction (sentuhan fisik produk dengan gerakan lambat memanjakan mata)",
    "Ultra slow-motion floating particles macro (butiran partikel melayang dalam pencahayaan rim-light)",
    "Cinematic whip-pan transition between panels (transisi pergerakan kamera cepat antar sudut pandang)",
    "Vertical top-down flatlay tilt & rise (sudut kamera dari atas secara tegak lurus melayang naik)"
  ];

  const RANDOM_CREATIVE_ANGLES = [
    "Ciptakan konsep yang berfokus pada teknologi canggih, presisi tinggi, dan inovasi masa depan.",
    "Ciptakan konsep dengan kehangatan alami, rasa tenang (mindfulness), dan estetika organik.",
    "Ciptakan konsep komersial berenergi tinggi, cepat, bergaya urban, dan penuh adrenalin.",
    "Ciptakan konsep sinematik super mewah (high-end luxury) dengan detail tekstur mikro yang memukau.",
    "Ciptakan konsep bertema gaya hidup modern yang bersih, efisien, dan bergaya editorial majalah.",
    "Ciptakan konsep eksperimental dengan permainan bayangan dramatis, refleksi kaca, dan pencahayaan kontras tinggi."
  ];

  const rawKeyword = isRandomIdea ? String(concept || '').trim() : '';
  const ideaSeed = isRandomIdea ? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}` : '';

  try {
    const db = getDb();
    const settings = await db.get('SELECT * FROM ai_settings LIMIT 1');
    
    // Default fallbacks if settings table is empty
    let apiHost = AI_API_HOST;
    let apiToken = AI_API_TOKEN;

    if (settings) {
      apiHost = settings.endpoint;
      apiToken = settings.api_key;
    }

    // Tulis AI may inspect up to three actual visual references. Invalid or unreadable
    // images are excluded rather than being described as if the model had seen them.
    const resolvedReferenceImages = [];
    if (!isRandomIdea) {
      for (const source of legacyReferences.slice(0, 3)) {
        const imageUrl = await resolveImageDataUrl(source);
        if (imageUrl) resolvedReferenceImages.push(imageUrl);
      }
    }
    const hasVisualReferences = resolvedReferenceImages.length > 0;
    const referenceDirective = hasVisualReferences
      ? `\nVISUAL REFERENCE CONTRACT:\n- You are receiving ${resolvedReferenceImages.length} actual product/reference image(s). Inspect them before writing.\n- Identify only objects, materials, colors, forms, labels, accessories, and people that are visibly supported by those image(s).\n- The product/subect in every panel MUST be the same visible reference; never substitute a generic tumbler, perfume, phone, or another product.\n- If a visual fact is unclear, describe it conservatively and do not invent a feature.\n- Return a concise Indonesian \"referenceSummary\" containing the concrete subject detected from the image(s).\n`
      : '';

    const layoutListText = LAYOUT_STYLES.map(s => `- "${s.value}": ${s.label}`).join('\n');
    const styleExists = style && LAYOUT_STYLES.some(s => s.value === style);
    let systemInstruction = '';

    const strictRules = `
PENTING & LARANGAN KERAS:
0. SETIA 100% PADA IDE ASLI PENGGUNA (JANGAN MENGADA-ADA PRODUK):
   - Kembangkan HANYA ide/konsep yang secara eksplisit ditulis oleh pengguna di "Ide Kasar Pengguna". DILARANG KERAS menyisipkan, mengganti, atau memunculkan produk, brand, atau barang dagangan APA PUN yang TIDAK disebutkan atau tidak tersirat jelas dalam ide pengguna tersebut.
   - Jika ide pengguna TIDAK menyebutkan produk/barang komersial sama sekali (misalnya sebuah cerita, momen personal, adegan non-komersial, dsb), maka HASIL AKHIR JUGA TIDAK BOLEH memuat produk apa pun — cukup kembangkan alur visual sesuai ide asli pengguna secara jujur dan setia, tanpa memaksakan unsur jualan.
1. FORMAT PENOMORAN PANEL WAJIB STANDAR:
   - Wajib menggunakan format tegas: "Panel 1: [deskripsi]", "Panel 2: [deskripsi]", "Panel 3: [deskripsi]", dst. Sesuai jumlah panel.
   - DILARANG KERAS menggunakan format gabungan seperti "P1-3:", "P4-6:", atau penomoran berjarak. Setiap panel HARUS berdiri sendiri!
2. REALISME PENJUALAN PRODUK E-COMMERCE (HANYA JIKA IDE PENGGUNA MEMANG TENTANG PRODUK):
   - HANYA berlaku jika ide pengguna secara eksplisit tentang produk dapur, elektronik, atau barang komersial: WAJIB menampilkan DEMONSTRASI FUNGSI NYATA PRODUK (contoh: Hand Blender memblender buah segar/smoothie/bumbu dapur asli, bukan elemen surealis abstrak melayang seperti emas/sihir), dan tunjukkan manfaat nyata produk yang membuat orang ingin membeli.
   - Jika ide pengguna BUKAN tentang produk, LEWATI aturan ini sepenuhnya — jangan menambahkan produk apa pun yang tidak ada di ide asli.
3. KONSISTENSI FISIK SUBJEK (SUBJECT LOCKING):
   - Warna, bentuk, bodi, aksen material subjek/produk (jika ada), serta model/presenter/karakter (jika ada) WAJIB DISATUKAN & DIKUNCI SAMA 100% dari Panel 1 sampai Panel terakhir. DILARANG berubah warna atau beda orang!
4. VARIASI AKSI & KAMERA (TIDAK BOLEH ADEGAN SAMA):
   - Panel 1: Opening Hook & Pengenalan Subjek / Masalah / Situasi Cerita.
   - Panel Tengah: Perkembangan Aksi Nyata 1 & Aksi/Fitur Utama 2 (gunakan sudut kamera berbeda: Wide Shot, Medium Shot, Macro Close-Up).
   - Panel Terakhir: Hasil Akhir / Resolusi Cerita + (HANYA jika ide memang tentang produk) Call To Action (CTA) Menjual.
   - DILARANG KERAS mengulang sudut kamera atau aksi visual yang sama di antar panel!
5. PEMBERSIHAN TEKS SAMPAH TOKO (NOISE STRIPPING):
   - DILARANG KERAS memasukkan teks garansi, syarat video unboxing, nomor WhatsApp, alamat pengiriman, atau kebijakan retur toko.
6. HANYA TEKS VISUAL MURNI:
   - DILARANG KERAS menyertakan awalan meta-header teknis seperti "storyboard seedance...", "cube_box_transform:", atau nama layout di dalam teks 'description'.
7. PANJANG TEKS: Total panjang 'description' HARUS DI BAWAH 1500 karakter. Jangan bertele-tele.
`;

    if (styleExists) {
      systemInstruction = `Anda adalah seorang Creative Director & Sutradara Visual World-Class yang SANGAT SETIA pada ide asli pengguna — Anda MENGEMBANGKAN, bukan MENGGANTI, ide yang pengguna tulis.
Tugas Anda adalah memfasilitasi ideasi storyboard kreatif pengguna berdasarkan PERSIS apa yang pengguna tulis di "Ide Kasar Pengguna", dan menghasilkan:
1. 'title': Judul Proyek yang padat dan sinematik, SESUAI TEMA ASLI ide pengguna (jika ide pengguna memang tentang sebuah produk, contoh: "Sonifer 5-in-1 Hand Blender Pro"; jika BUKAN tentang produk, buat judul yang mencerminkan tema/cerita aslinya — JANGAN memaksakan nama produk yang tidak ada. Maksimal 5 kata).
2. 'description': Deskripsi Storyboard rinci yang siap digunakan sebagai prompt AI (berisi detail visual, alur aksi, sudut kamera), SETIA mengikuti ide asli pengguna tanpa menambahkan produk/elemen yang tidak diminta, dan secara khusus diselaraskan dan cocok dengan gaya layout storyboard: "${style}".
3. 'layout': Wajib bernilai "${style}" (karena pengguna telah memilih gaya ini).

${strictRules}
${referenceDirective}
Anda harus mengembalikan respon hanya dalam format JSON mentah dengan key 'title', 'description', 'layout', dan 'referenceSummary'. Jangan bungkus dalam markdown (jangan pakai \`\`\`json). Contoh output:
{
  "title": "Judul Elegan",
  "description": "Panel 1: ...\nPanel 2: ...\nPanel 3: ...\nPanel 4: ...",
  "layout": "${style}",
  "referenceSummary": "Ringkasan objek yang benar-benar terlihat, atau string kosong bila tidak ada gambar."
}`;
    } else {
      systemInstruction = `Anda adalah seorang Creative Director & Sutradara Visual World-Class yang SANGAT SETIA pada ide asli pengguna — Anda MENGEMBANGKAN, bukan MENGGANTI, ide yang pengguna tulis.
Tugas Anda adalah memfasilitasi ideasi storyboard kreatif pengguna berdasarkan PERSIS apa yang pengguna tulis di "Ide Kasar Pengguna", dan menghasilkan:
1. 'title': Judul Proyek yang padat dan sinematik, SESUAI TEMA ASLI ide pengguna (jika ide pengguna memang tentang sebuah produk, contoh: "Sonifer 5-in-1 Hand Blender Pro"; jika BUKAN tentang produk, buat judul yang mencerminkan tema/cerita aslinya — JANGAN memaksakan nama produk yang tidak ada. Maksimal 5 kata).
2. 'description': Deskripsi Storyboard rinci yang siap digunakan sebagai prompt AI (berisi detail visual, alur aksi, sudut kamera), SETIA mengikuti ide asli pengguna tanpa menambahkan produk/elemen yang tidak diminta.
3. 'layout': Memilih satu Gaya Layout Storyboard yang PALING COCOK dan paling presisi untuk ide/konsep tersebut dari daftar gaya berikut:
${layoutListText}

${strictRules}
${referenceDirective}
Anda harus mengembalikan respon hanya dalam format JSON mentah dengan key 'title', 'description', 'layout', dan 'referenceSummary' (diisi dengan value/kode dari layout yang Anda pilih). Jangan bungkus dalam markdown (jangan pakai \`\`\`json). Contoh output:
{
  "title": "Judul Elegan",
  "description": "Panel 1: ...\nPanel 2: ...\nPanel 3: ...\nPanel 4: ...",
  "layout": "premium_vertical_row",
  "referenceSummary": "Ringkasan objek yang benar-benar terlihat, atau string kosong bila tidak ada gambar."
}`;
    }

  // Specialized Layout-to-Niche Matching Map to guarantee perfect soulmate products per layout
  const LAYOUT_MATCHING_NICHES = {
    asmr_satisfying: [
      "Perakitan Miniatur Kayu Presisi (tekstur kayu hangat, pinset makro, detail fitting presisi)",
      "Tetesan Serum Kristal Bening di Kaca (efek makro cairan kental berkilat, embun halus)",
      "Es Batu Kristal Jatuh ke Kopi Espresso Artisan (dentingan es, buih milk latte hangat)",
      "Pemotongan Roti Sourdough Renyah (tekstur renyah roti hangat, tepung terigu halus)",
      "Lilin Aromaterapi Kayu Cendana (lelehan lilin hangat, sumbu kayu terbakar halus)",
      "Sapuan Kuas Cat Minyak Bertekstur di Kanvas (tekstur warna cat tebal & memanjakan mata)",
      "Potongan Cokelat Leleh Artisan di Biskuit (lelehan cokelat kental)"
    ],
    asmr_toy_transform: [
      "Mainan Miniatur Die-Cast Logam Premium (logam presisi berkilat, cat halus, detail mekanis)",
      "Model Pesawat/Mobil Miniatur Kayu Presisi (detail komponen kayu kecil)",
      "Model Jam Tangan Mekanis Miniatur (roda gigi kuningan berputar halus)"
    ],
    recipe_cooking: [
      "Kopi Espresso & Cold Brew Artisan (es batu transparan, foam susu, cangkir porselen)",
      "Croissant Mentega & Pastry Oven (permukaan roti hangat berkilau, taburan gula halus)",
      "Steak Panggang & Saus Barbekyu (asap tipis, lelehan mentega di daging panggang)",
      "Soda Buah Segar Berbusa (gelembung soda, potongan buah segar, es batu pecah)"
    ],
    diy_build: [
      "Kerajinan Miniatur Rumah Kayu & Diorama (pemotongan presisi, lem kayu, komponen kecil)",
      "Dompet & Aksesori Kulit Grain Handcrafted (jahitan benang emas, pemotongan kulit halus)",
      "Perakitan Keyboard Mekanikal Custom (lubrikasi switch, keycaps PBT bertekstur)"
    ],
    cube_box_transform: [
      "Gadget Smartwatch Titanium & Earbuds (material logam brushed, mekar presisi)",
      "Sepatu Running Neon Futuristik (sol karbon flex, kain rajut breathability)",
      "Kamera Drone Lipat 4K Compact (lensa kine, bodi karbon matte)",
      "Botol Parfum Mewah Berukir (kaca tebal kristal, atomizer emas)"
    ],
    shape_morph_transform: [
      "Headphone Nirkabel Premium (bantalan kulit empuk, headband aluminium)",
      "Powerbank Panel Surya Portable (desain lipat presisi, indikator LED)",
      "Mouse Gaming Nirkabel Ultralight (cangkang berlubang honeycomb, sensor presisi)"
    ],
    product_assembly: [
      "Jam Tangan Otomatis Tourbillon (komponen roda gigi melayang lalu menyatu)",
      "Sepatu Sneakers Techwear (komponen sol, kain, & tali melayang menyatu presisi)",
      "Kamera Aksi Waterproof (lensa, pelindung casing, & baterai menyatu)"
    ],
    liquid_splash: [
      "Botol Serum Skincare Vitamin C (percikan cairan bening oranye berkuasa)",
      "Kaleng Soda Buah Dingin (cipratan es batu & bulir air embun)",
      "Botol Parfum Kristal (kabut uap parfum melayang di udara)"
    ],
    luxury_mood: [
      "Parfum Eksklusif & Fragrance Mewah (botol kaca gelap, aksen emas matte)",
      "Jam Tangan Mewah Emas & Titanium (pencahayaan rim studio gelap)",
      "Koper Aluminium Hardshell (permukaan logam bergaris, roda spinner)",
      "Perhiasan Cincin Berlian Platinum (sorotan cahaya kristal kontras tinggi)"
    ],
    fashion_lookbook: [
      "Jaket Techwear & Streetwear Cyberpunk (kain anti-air matte, zippers perak)",
      "Kacamata Fashion Titanium (lensa anti-reflektif, pose editorial)",
      "Tas Kerja Kulit Grain Premium (desain minimalis modern)"
    ],
    ugc_review: [
      "Skincare Moisturizer & Sunscreen (aplikasi di wajah, tekstur krim ringan)",
      "Vacuum Cleaner Robotik Pintar (demo pembersihan lantai, kontrol aplikasi HP)",
      "Sikat Gigi Elektrik Sonic (demo pembersihan mikro, bulu sikat halus)"
    ],
    tiktok_text_ad: [
      "Earbuds Wireless Noise-Cancelling (buka casing, koneksi instan)",
      "Pengkilap Bodi Mobil Ceramic Coating (sebelum kusam vs sesudah mengkilap)",
      "Keripik Kentang Renyah Premium (kemasan berbunyi renyah, potongan tebal)"
    ],
    tiny_world: [
      "Pekerja Miniatur Memperbaiki Produk Sepatu (karakter kecil membawa peralatan)",
      "Karakter Miniatur Merakit Kue Tart Cokelat (karakter mini mengoles krim)",
      "Pekerja Miniatur Membersihkan Kamera Lensa (karakter mini mengelap kaca lensa)"
    ]
  };

  let userMessageContent = '';
  if (isRandomIdea) {
    let pickNiche = '';
    // If user selected a specific layout style, pick a niche that is a PERFECT MATCH for that layout!
    if (styleExists && LAYOUT_MATCHING_NICHES[style]) {
      const matchedPool = LAYOUT_MATCHING_NICHES[style];
      pickNiche = matchedPool[Math.floor(Math.random() * matchedPool.length)];
    } else {
      pickNiche = CREATIVE_NICHES[Math.floor(Math.random() * CREATIVE_NICHES.length)];
    }

    const pickVisual = VISUAL_AESTHETICS[Math.floor(Math.random() * VISUAL_AESTHETICS.length)];
    const pickAction = CAMERA_ACTIONS[Math.floor(Math.random() * CAMERA_ACTIONS.length)];
    const pickAngle = RANDOM_CREATIVE_ANGLES[Math.floor(Math.random() * RANDOM_CREATIVE_ANGLES.length)];

    if (rawKeyword) {
      userMessageContent = `MODE: RANDOM IDEA. Seed variasi: ${ideaSeed}. Buatlah konsep ide iklan sinematik yang sangat unik, segar, dan berbeda dari ide sebelumnya berdasarkan kata kunci produk pengguna: "${rawKeyword}".
Padukan kata kunci produk tersebut secara harmonis dengan pengarahan estetik berikut:
- Pendekatan Ideasi: ${pickAngle}
- Tema Visual & Aesthetic: ${pickVisual}
- Gerakan Kamera & Aksi Visual: ${pickAction}`;
    } else {
      userMessageContent = `MODE: RANDOM IDEA. Seed variasi: ${ideaSeed}. Buatlah ide konsep video komersial lengkap yang SANGAT KREATIF, BARU, DAN BERBEDA DARI SEBELUMNYA.
${styleExists ? `PENTING: Pengguna telah memilih gaya layout "${style}". Pilihlah subjek/objek produk (${pickNiche}) yang SECARA ALAMI & LOGIS PALING COCOK DAN TERBAIK untuk gaya layout tersebut (DILARANG memilih objek yang tidak cocok seperti kendaraan besar atau robot untuk gaya ASMR/detail).` : 'DILARANG KERAS mengulang ide pasaran, melainkan buatlah ideasi komersial yang segar, out-of-the-box, dan sangat beragam!'}

Gunakan kombinasi pengarahan matriks ideasi acak berikut:
- Kategori / Niche Produk Terpilih: ${pickNiche}
- Pendekatan Ideasi: ${pickAngle}
- Gaya Visual & Pencahayaan: ${pickVisual}
- Pergerakan Kamera & Aksi: ${pickAction}`;
    }
    } else {
      userMessageContent = String(concept || '').trim()
        ? `Ide Kasar Pengguna: ${String(concept).trim()}`
        : 'Tidak ada brief teks. Bangun storyboard hanya dari objek yang benar-benar terlihat pada gambar referensi.';
    }

    // Calculate pageCount and totalPanels based on video engine and duration
    let secondsPerPage = 15;
    const engine = videoEngine || 'seedance';
    if (engine === 'omni') {
      secondsPerPage = 10;
    } else if (engine === 'veo') {
      secondsPerPage = 8;
    }
    const durVal = duration ? Number(duration) : 15;
    const gCount = gridCount ? Number(gridCount) : 6;
    const pageCount = Math.max(1, Math.min(8, Math.ceil(durVal / secondsPerPage)));
    const totalPanels = pageCount * gCount;

    // Append context parameters if available to enrich LLM response
    let contextClause = "\n\nKonteks parameter tambahan untuk diselaraskan dalam prompt deskripsi:";
    if (videoEngine) contextClause += `\n- Video Engine yang digunakan: ${videoEngine}`;
    contextClause += `\n- Jumlah halaman storyboard: ${pageCount} Halaman`;
    contextClause += `\n- Jumlah panel per halaman: ${gCount} Panel`;
    contextClause += `\n- Total panel sekuensial secara keseluruhan: ${totalPanels} Panel`;
    if (duration) contextClause += `\n- Total durasi video: ${durVal} detik`;
    if (aspectRatio) contextClause += `\n- Ukuran gambar/Rasio aspek: ${aspectRatio}`;
    if (hasVisualReferences) {
      contextClause += `\n- Bukti visual: ${resolvedReferenceImages.length} gambar referensi dilampirkan dan WAJIB menjadi sumber kebenaran produk/subjek di seluruh panel.`;
    }
    contextClause += `\n\nSesuaikan deskripsi visual agar selaras dengan parameter-parameter tersebut. Karena durasi video adalah ${durVal} detik dengan engine ${engine}, storyboard ini akan memiliki ${pageCount} halaman dengan ${gCount} panel per halaman (Total: ${totalPanels} panel sekuensial). Alur cerita dalam deskripsi Anda WAJIB merinci pembagian alur panel dari Panel 1 sampai Panel ${totalPanels} secara kronologis untuk mencakup seluruh durasi tersebut agar gambar di setiap halaman tidak berulang.`;

    userMessageContent += contextClause;

    // Vision references are appended as actual image content. `llmChatViaSettings`
    // automatically routes this multimodal request to the configured vision endpoint.
    const userContent = hasVisualReferences
      ? [
          { type: 'text', text: userMessageContent },
          ...resolvedReferenceImages.map((url) => ({ type: 'image_url', image_url: { url } }))
        ]
      : userMessageContent;
    const payload = {
      model: settings?.model || 'gemini-3-flash',
      messages: [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: userContent }
      ],
      temperature: isRandomIdea ? 0.95 : 0.45
    };

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiToken}`
    };

    let response;
    let visualFallbackUsed = false;
    try {
      response = await llmChatViaSettings(payload, { db });
    } catch (visionError) {
      // A vision outage must never be disguised as successful image recognition. If
      // the user supplied a text brief, preserve the request via a clearly labelled
      // text-only fallback; image-only requests fail safely instead of inventing.
      if (!hasVisualReferences) throw visionError;
      if (!String(concept || '').trim()) {
        return res.status(503).json({
          message: 'Analisis gambar referensi sedang tidak tersedia. Coba lagi; Storymax tidak akan menebak produk tanpa membaca gambarnya.'
        });
      }
      console.warn('[writePrompt] Vision request failed; using labelled text-only fallback:', visionError.message);
      visualFallbackUsed = true;
      const textOnlySystemInstruction = `${systemInstruction.replace(referenceDirective, '')}\nVISUAL FALLBACK: gambar referensi gagal dimuat. Jangan mengaku telah melihat gambar; gunakan hanya brief teks pengguna dan jangan menebak detail produk.`;
      const textOnlyUserMessage = userMessageContent.replace(/\n- Bukti visual:[^\n]*/g, '');
      response = await llmChatViaSettings({
        ...payload,
        messages: [
          { role: 'system', content: textOnlySystemInstruction },
          { role: 'user', content: textOnlyUserMessage }
        ]
      }, { db });
    }

    // Some providers return non-200 rather than throwing for an unsupported vision
    // request. Treat that exactly like a vision failure and retry text-only only when
    // a user brief exists; never fabricate an image-only product description.
    if (response.statusCode !== 200 && hasVisualReferences && !visualFallbackUsed) {
      if (!String(concept || '').trim()) {
        return res.status(503).json({
          message: 'Analisis gambar referensi sedang tidak tersedia. Coba lagi; Storymax tidak akan menebak produk tanpa membaca gambarnya.'
        });
      }
      console.warn('[writePrompt] Vision response was non-200; using labelled text-only fallback:', response.statusCode);
      visualFallbackUsed = true;
      const textOnlySystemInstruction = `${systemInstruction.replace(referenceDirective, '')}\nVISUAL FALLBACK: gambar referensi gagal dimuat. Jangan mengaku telah melihat gambar; gunakan hanya brief teks pengguna dan jangan menebak detail produk.`;
      const textOnlyUserMessage = userMessageContent.replace(/\n- Bukti visual:[^\n]*/g, '');
      response = await llmChatViaSettings({
        ...payload,
        messages: [
          { role: 'system', content: textOnlySystemInstruction },
          { role: 'user', content: textOnlyUserMessage }
        ]
      }, { db });
    }

    if (response.statusCode !== 200) {
      console.error('[writePrompt API Non-200 Error]:', response.statusCode, response.body);
      return res.status(500).json({ message: 'Gagal menghubungi server AI.', error: response.body });
    }

    const { parseAiContent } = require('../prompts/aiClient');
    const content = parseAiContent(response.body);
    
    function parseAiJson(raw) {
      let str = String(raw || '').trim();
      if (str.startsWith('```')) {
        str = str.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '').trim();
      }
      const jsonMatch = str.match(/\{[\s\S]*\}/);
      if (jsonMatch) str = jsonMatch[0];

      // Tier 1: Direct JSON.parse
      try { return JSON.parse(str); } catch (e) {}

      // Tier 2: Escape unescaped newlines in JSON string values
      try {
        const sanitized = str.replace(/"description"\s*:\s*"([\s\S]*?)"\s*,\s*"layout"/i, (m, desc) => {
          const escapedDesc = desc.replace(/\r?\n/g, '\\n');
          return `"description": "${escapedDesc}", "layout"`;
        });
        return JSON.parse(sanitized);
      } catch (e) {}

      // Tier 3: Regex extraction
      const titleMatch = str.match(/"title"\s*:\s*"([^"]+)"/i);
      const descMatch = str.match(/"description"\s*:\s*"([\s\S]*?)"\s*,\s*"(?:layout|title)"/i) || str.match(/"description"\s*:\s*"([\s\S]*?)"\s*\}/i);
      const layoutMatch = str.match(/"layout"\s*:\s*"([^"]+)"/i);

      if (titleMatch || descMatch) {
        return {
          title: titleMatch ? titleMatch[1] : null,
          description: descMatch ? descMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"') : null,
          layout: layoutMatch ? layoutMatch[1] : null
        };
      }
      return null;
    }

    const parsed = parseAiJson(content);
    if (parsed && (parsed.title || parsed.description)) {
      const selectedLayout = LAYOUT_STYLES.some(s => s.value === parsed.layout) ? parsed.layout : 'premium_vertical_row';
      let cleanDesc = String(parsed.description || concept).trim();
      cleanDesc = cleanDesc.replace(/^storyboard\s+[^:\n]+:\s*/i, '').trim();
      cleanDesc = cleanDesc.replace(/^storyboard\s+.*?\d+\s*panel[^\n:]*:\s*/i, '').trim();
      cleanDesc = cleanDesc.replace(/^[a-z0-9_-]+:\s*(panel\s+terasa|panel\s+1|halaman)/i, '$1').trim();

      return res.json({
        mode: isRandomIdea ? 'random_idea' : 'expand',
        title: parsed.title || 'Untitled AI Project',
        description: cleanDesc,
        layout: selectedLayout,
        referenceSummary: hasVisualReferences && !visualFallbackUsed ? String(parsed.referenceSummary || '').trim() : '',
        referenceCount: resolvedReferenceImages.length,
        referenceAnalysisStatus: hasVisualReferences ? (visualFallbackUsed ? 'text_fallback' : 'analyzed') : 'not_requested',
        ideaSeed
      });
    } else {
      console.warn('[writePrompt Fallback]: LLM returned plain text:', content.substring(0, 100));
      let cleanDesc = content.trim();
      cleanDesc = cleanDesc.replace(/^storyboard\s+[^:\n]+:\s*/i, '').trim();
      cleanDesc = cleanDesc.replace(/^storyboard\s+.*?\d+\s*panel[^\n:]*:\s*/i, '').trim();

      return res.json({
        mode: isRandomIdea ? 'random_idea' : 'expand',
        title: String(concept || (isRandomIdea ? 'Ide Acak' : 'Project')).substring(0, 25).trim(),
        description: cleanDesc || String(concept || ''),
        layout: 'premium_vertical_row',
        referenceSummary: '',
        referenceCount: resolvedReferenceImages.length,
        referenceAnalysisStatus: hasVisualReferences ? (visualFallbackUsed ? 'text_fallback' : 'analyzed') : 'not_requested',
        ideaSeed
      });
    }

  } catch (error) {
    console.error('[writePrompt Fatal Error]:', error);
    return res.status(500).json({ message: 'Terjadi kesalahan sistem saat memproses AI.', error: error.message });
  }
}

// Core internal function to generate video prompts using vision model (can be called by controller endpoints or background task)
async function generateVideoPromptsInternal({ storyboardId, promptType, regenerate, enableVo, voMaxWords, voLanguage, voTone, videoDuration }) {
  const db = getDb();
  
  // Retrieve storyboard
  const storyboard = await db.get('SELECT * FROM storyboards WHERE id = ?', [storyboardId]);
  if (!storyboard) {
    throw new Error('Storyboard tidak ditemukan.');
  }

  // Parse existing prompts to preserve other fields
  let currentPrompts = { imageToVideoPrompt: null, textToVideoPrompt: null };
  if (storyboard.video_prompts) {
    try {
      const parsed = JSON.parse(storyboard.video_prompts);
      if (parsed && typeof parsed === 'object') {
        if ('imageToVideoPrompt' in parsed || 'textToVideoPrompt' in parsed) {
          currentPrompts = {
            imageToVideoPrompt: parsed.imageToVideoPrompt || null,
            textToVideoPrompt: parsed.textToVideoPrompt || null
          };
        } else if ('visualPrompt' in parsed) {
          currentPrompts = {
            imageToVideoPrompt: null,
            textToVideoPrompt: parsed.visualPrompt || null
          };
        }
      }
    } catch (e) {}
  }

  const targetType = promptType === 'text-to-video' ? 'text-to-video' : 'image-to-video';

  // If specific prompt already exists and not forcing regeneration, return it directly
  if (targetType === 'image-to-video' && currentPrompts.imageToVideoPrompt && !regenerate) {
    return JSON.stringify(currentPrompts);
  }
  if (targetType === 'text-to-video' && currentPrompts.textToVideoPrompt && !regenerate) {
    return JSON.stringify(currentPrompts);
  }

  const settings = await db.get('SELECT * FROM ai_settings LIMIT 1');
  
  let apiHost = AI_API_HOST;
  let apiToken = AI_API_TOKEN;

  if (settings) {
    apiHost = settings.endpoint;
    apiToken = settings.api_key;
  }

  // Convert all storyboard panels/images to Base64 to send to vision model
  let panelImages = [];
  try {
    if (storyboard.image_path && storyboard.image_path.startsWith('[')) {
      panelImages = JSON.parse(storyboard.image_path);
    } else {
      panelImages = storyboard.image_path ? [storyboard.image_path] : [];
    }
  } catch (e) {
    panelImages = storyboard.image_path ? [storyboard.image_path] : [];
  }

  const imageParts = [];
  for (let i = 0; i < panelImages.length; i++) {
    const imgPath = panelImages[i];
    
    // Check if it's a local upload (either relative /uploads/ or absolute URL containing /uploads/)
    if (imgPath.includes('/uploads/')) {
      const idx = imgPath.indexOf('/uploads/');
      const relativeFilename = imgPath.substring(idx + '/uploads/'.length);
      const fullPath = path.join(uploadsDir, relativeFilename);
      if (fs.existsSync(fullPath)) {
        const imgBuffer = fs.readFileSync(fullPath);
        const base64 = imgBuffer.toString('base64');
        imageParts.push({
          type: 'image_url',
          image_url: {
            url: `data:image/png;base64,${base64}`
          }
        });
        continue;
      }
    }

    // Otherwise, if it starts with http, download and convert to base64
    if (imgPath.startsWith('http')) {
      try {
        const res = await fetch(imgPath);
        if (res.ok) {
          const arrayBuffer = await res.arrayBuffer();
          const imgBuffer = Buffer.from(arrayBuffer);
          const base64 = imgBuffer.toString('base64');
          imageParts.push({
            type: 'image_url',
            image_url: {
              url: `data:image/png;base64,${base64}`
            }
          });
        } else {
          console.error(`Failed to fetch remote image from ${imgPath}, status: ${res.status}`);
        }
      } catch (err) {
        console.error(`Error downloading remote image ${imgPath}:`, err);
      }
    }
  }

  const totalScenes = panelImages.length;

  let gridCount = 6;
  if (storyboard.generation_params) {
    try {
      const params = JSON.parse(storyboard.generation_params);
      if (params.gridCount) {
        gridCount = Number(params.gridCount);
      }
    } catch (e) {}
  }

  let gridDescText = `exactly ${gridCount} panels`;
  if (storyboard.style === 'premium_vertical_row') {
    gridDescText = `exactly ${gridCount} widescreen panels arranged in a vertical stack (from top to bottom)`;
  } else {
    if (gridCount === 4) gridDescText = "exactly 4 panels arranged in a 2x2 grid (from top-left, top-right, bottom-left, to bottom-right)";
    else if (gridCount === 6) gridDescText = "exactly 6 panels arranged in a 3x2 grid (3 columns, 2 rows)";
    else if (gridCount === 8) gridDescText = "exactly 8 panels arranged in a 4x2 grid (4 columns, 2 rows)";
    else if (gridCount === 9) gridDescText = "exactly 9 panels arranged in a 3x3 grid (3 columns, 3 rows)";
    else if (gridCount === 12) gridDescText = "exactly 12 panels arranged in a 4x3 grid (4 columns, 3 rows)";
  }

  const maxWordsAllowed = voMaxWords ? Math.min(Math.max(Number(voMaxWords), 8), 15) : 10;

  let durationClause = '';
  const durVal = videoDuration || 'auto';
  const _durTxt = durVal === 'auto'
    ? (targetType === 'image-to-video' ? 'Kling/SeedDance: 15s, Omni: 10s, Gemini: 8s' : '15 seconds')
    : `${Number(durVal)} seconds`;
  durationClause = `Each individual scene/panel video has a target duration of: ${_durTxt}. If Voiceover (VO) is enabled, keep the narration SHORT — about 6 to ${maxWordsAllowed} words per scene, HARD MAX ${maxWordsAllowed} words — one punchy line at a natural pace, not rushed.`;

  let toneClause = '';
  if (enableVo && voTone) {
    const toneRules = {
      'casual': 'Gaya bahasa SANTAI, AKRAB, GAUL, menggunakan kata-kata sehari-hari seperti "kamu", "yuk", "nih", "lho", layaknya berbicara dengan teman akrab. Hindari kata-kata formal.',
      'comedy': 'Gaya bahasa LUCU, HUMORIS, PENUH CANDAAN, dan MENGHIBUR. Gunakan plesetan ringan atau ekspresi jenaka agar audiens tertawa.',
      'excited': 'Gaya bahasa SANGAT ANTUSIAS, BERSEMANGAT, PROMOSIONAL (SELLING), bernada tinggi, persuasif, menarik perhatian (clickbait-style), penuh energi untuk jualan/promo.',
      'formal': 'Gaya bahasa RESMI, SERIUS, EDUKATIF, profesional, menggunakan tata bahasa yang baik dan benar (EYD/PUEBI), informatif dan berwibawa.',
      'emotional': 'Gaya bahasa MENYENTUH HATI, EMOSIONAL, EMPATIS, HANGAT, puitis, dan penuh perasaan agar menyentuh sisi kemanusiaan atau perasaan terdalam audiens.',
      'storytelling': 'Gaya bahasa BERCERITA (Storytelling), naratif, mengalir seperti mendongeng, membuat penasaran dengan alur cerita yang memikat.',
      'dramatic': 'Gaya bahasa DRAMATIS, TEGANG, MISTERIUS, penuh penekanan (suspenseful), seolah ada rahasia besar atau sesuatu yang luar biasa akan terjadi.',
      'soft_spoken': 'Gaya bahasa LEMBUT, TENANG, BISIKAN ASMR, santai, menenangkan jiwa, ritme perlahan dan sangat rileks.',
      'luxury_premium': 'Gaya bahasa ELEGAN, MEWAH, EKSLUSIF, mahal, sinematik, menggunakan diksi kelas tinggi yang menggambarkan prestise dan kemewahan.',
      'poetic_aesthetic': 'Gaya bahasa PUITIS, ESTETIK, ARTISTIK, penuh estetika visual, kata-kata indah yang puitis dan memanjakan imajinasi.',
      'news_anchor': 'Gaya bahasa REPORTER BERITA, Breaking News, lugas, cepat, berdasarkan fakta menarik, berwibawa seperti pembawa acara berita internasional.',
      'motivator_inspirational': 'Gaya bahasa MOTIVASI, INSPIRATIF, MEMBAKAR SEMANGAT, membangkitkan percaya diri dan dorongan positif yang kuat.',
      'review_honest': 'Gaya bahasa REVIEWER JUJUR, objektif, tanpa basa-basi, langsung pada poin plus-minus produk, seperti ulasan influencer tepercaya.',
      'cinematic_trailer': 'Gaya bahasa MOVIE TRAILER HOLLYWOOD, epik, megah, bernada dalam dan berwibawa seperti narasi trailer film box-office.',
      'sarcastic_witty': 'Gaya bahasa WITTY & SINDRAN HALUS, cerdas, sinis relatable, sarkasme lucu yang menyindir masalah sehari-hari dengan jenaka.',
      'kids_playful': 'Gaya bahasa CERIA & DUNIA ANAK, gembira, energik, komunikatif, penuh kegembiraan dunia mainan dan petualangan seru.'
    };
    const toneDesc = toneRules[voTone] || voTone;
    toneClause = `Crucial: The tone and writing style of the voiceover script MUST strictly follow this style (in the narration language): "${toneDesc}". You must rewrite the narration using vocabulary, slang, emotional triggers, or structural patterns that perfectly match this style. For example, if it is casual or comedy, use slang and conversational Indonesian.`;
  }

  // Resolve legacy/aliased ids to the canonical style so old storyboards
  // (cube_morph_product, capsule_toss_transform) get the CURRENT rules.
  const resolvedStyle = resolveStyleId(storyboard.style);
  let capsuleStyleClause = '';
  if (resolvedStyle === 'cube_box_transform') {
    // Cube transformation reveal (photorealistic viral cube -> subject).
    capsuleStyleClause = `
CRITICAL CUBE TRANSFORMATION VIDEO RULES (photorealistic viral toy-cube reveal — NOT a glowing humanoid Transformer robot):
1. CAMERA: shoot from a FARTHER, WIDE distance on ONE stable, locked-off (or very slow) camera — do NOT cut, jump, snap or suddenly reposition the camera; keep the entire action comfortably inside the frame the whole time. Photorealistic and cinematic, shallow DOF, NOT a CGI cartoon.
2. OPENING — the ONLY moment a hand appears: a single human hand enters just to PRESS a button on top of the small premium mechanical cube (showing it is a transforming toy), then gently TOSSES / flips the cube (into the air or onto the surface). The hand then LEAVES the frame completely.
3. TRANSFORM (hands-free): after the toss, the cube automatically UNFOLDS — armored panels slide, hinge and telescope outward SMOOTHLY and satisfyingly, mechanically CONNECTED (no loose or detached parts) — and reshapes into the subject at its natural scale (the product itself, a scaled collectible, or a full-scale structure/scene). NO hands during this stage. NO exploding/flying/detached parts, NO energy beams, NO glow-energy magic; it does NOT become a humanoid robot/mecha/Transformer.
4. Keep the subject's EXACT identity, branding and colors. End on the finished photorealistic result in a calm, WIDE cinematic hero shot.
I2V FIELD NOTE: in the "imageToVideoPrompt" field, convey this ONLY as the stable WIDE camera + the action MOTION (a hand presses the button, tosses the cube, then it auto-unfolds hands-free) — do NOT re-describe or "build" the product in words; the full identity/build description belongs to the "textToVideoPrompt" field.`;
  }

  if (resolvedStyle === 'asmr_toy_transform') {
    // Static-camera ASMR toy transform on a tabletop.
    capsuleStyleClause = `
CRITICAL ASMR TOY TRANSFORM VIDEO RULES (LOCKED camera, tabletop, ASMR — no camera effects):
1. The CAMERA IS COMPLETELY LOCKED/STATIC on a tripod over a real worn white table, framed at a COMFORTABLE, slightly WIDE top-down distance with clear empty margin around the toy — wide enough that the FULLY-UNFOLDED finished die-cast toy stays entirely in frame and is NEVER cropped. ABSOLUTELY NO camera movement — no pan, tilt, zoom, orbit, dolly, push-in or shake (do NOT move to keep up with the toy; the starting framing must already fit the final result). ONLY the toy moves. Ignore any 'CAM:' tag that implies movement; keep the shot perfectly still.
2. A small armored cube rests statically on the table and SMOOTHLY, mechanically UNFOLDS by itself — panels slide, hinge and telescope out step by step — into a HIGH-END, PREMIUM, EXPENSIVE-LOOKING miniature die-cast collectible of the product on the SAME table (heavy metal die-cast feel, flawless factory paint, crisp realistic detailing, glossy premium finish — NOT a cheap hollow plastic toy). Photorealistic; mechanically connected; NO human hands visible in frame; NO flying/detaching parts; NO glow/energy; NOT a humanoid robot/mecha.
3. AUDIO = satisfying ASMR mechanical transformation sounds ONLY (soft clicks, servo whirs, panels locking into place). No music-over.
4. Keep the exact same worn white table and the product's exact identity throughout; end on the finished PREMIUM, expensive-looking die-cast collectible resting still on the table.
I2V FIELD NOTE: in the "imageToVideoPrompt" field, express this ONLY as the locked WIDE framing + the unfolding MOTION and sounds — do NOT re-describe or "build" the product there; the full identity/build description belongs to the "textToVideoPrompt" field.`;
  }

  if (resolvedStyle === 'shape_morph_transform') {
    const { getInitialContainerDescription } = require('../prompts/containerShapes');
    const containerObj = getInitialContainerDescription(storyboard.prompt || storyboard.title, 'auto');
    const shapeDesc = containerObj.shapeEn;

    // Adaptive Shape transformation reveal — STRICT SINGLE SHAPE.
    capsuleStyleClause = `
CRITICAL ADAPTIVE SHAPE TRANSFORMATION VIDEO RULES (photorealistic single container reveal — NOT a glowing humanoid Transformer robot):
1. PHOTOREALISTIC and cinematic. The scene MUST start from a SINGLE precision high-tech mechanical pod (${shapeDesc}) resting statically on a fitting surface. Smooth motion move as the container expands, shallow depth of field.
2. STRICT SINGLE SHAPE RULE: DO NOT change or cycle through other container shapes (NO spheres, NO cubes, NO cylinders if the container is a box). The SAME single ${shapeDesc} unfolds mechanically into the target subject.
3. STRICT CONSISTENT MECHANICAL LOOK: keep the SAME high-tech, precision-engineered METAL / mechanical material, finish and realism from the FIRST frame to the LAST. It must NEVER drift into a cartoon, plastic, glossy or childish kids-toy look partway through — start mechanical, STAY mechanical all the way to the finished subject.
4. The container's panels UNFOLD, slide and telescope outward SMOOTHLY and satisfyingly — mechanically CONNECTED, no loose or detached parts — and build/reshape into the target subject at its natural scale. NO hands visible in frame. NO exploding/flying/detached parts, NO energy beams, NO glow-energy magic.
5. Keep the subject's EXACT identity, branding and colors. NO human hands in frame (automatic mechanical unfolding). End on the finished photorealistic result in a cinematic hero shot.
I2V FIELD NOTE: in the "imageToVideoPrompt" field, convey all of this ONLY as camera + the unfolding MOTION (framed WIDE so the fully-formed subject is never cropped) — do NOT write "build/create the product" or re-describe the product there; the full build/identity description belongs to the "textToVideoPrompt" field.`;
  }

  if (resolvedStyle === 'bts_practical_fx') {
    // Behind-the-scenes practical miniature FX (documentary "making of").
    capsuleStyleClause = `
CRITICAL BEHIND-THE-SCENES PRACTICAL FX VIDEO RULES (real film soundstage "making of" — NOT a finished CGI shot):
1. Documentary behind-the-scenes look. Show the real stage: a large water tank / studio floor, a detailed MINIATURE scale-model of the location, a blue screen with tracking markers behind it, overhead lighting rigs & camera cranes, and effects crew (dark shirts) at the edges. Raw, true-to-life soundstage — NOT a glossy graded final film shot.
2. The spectacle is a PRACTICAL effect: real water/foam (hydraulic flood or wave), or blast/smoke/storm, physically surging across the MINIATURE set — in-camera, not clean CGI.
3. The hero subject/character/vehicle must match the reference EXACTLY (identity, costume, colours, logo), only rendered at the set's miniature scale.
4. FRAMING: wide establishing then controlled handheld push-ins; keep the WHOLE miniature set in frame during the effect so the action is never cropped.
I2V FIELD NOTE: in the "imageToVideoPrompt" field express this ONLY as camera + the practical-effect MOTION and crew activity — do NOT re-describe or "build" the subject in words; the full identity/scene description belongs to the "textToVideoPrompt" field.`;
  }

  if (resolvedStyle === 'mini_restoration_asmr') {
    // Satisfying miniature restoration / build (macro ASMR, human hands expected).
    capsuleStyleClause = `
CRITICAL MINIATURE RESTORATION / BUILD ASMR VIDEO RULES (macro, clean studio, satisfying):
1. Human HANDS with precision tools (tiny screwdriver, tweezers, brush) assemble / restore / detail a hyper-realistic MINIATURE of the subject on a clean bright studio surface, fingers in frame for scale. This is the ONE style where human hands ARE expected and encouraged.
2. Macro, oddly-satisfying ASMR pacing: reveal the internal frame, panels, wiring, interior and mechanisms step by step; slow, deliberate, tactile motion. Clean crisp light — NO cinematic haze or lens flare.
3. The miniature must match the reference subject EXACTLY (shape, colours, logo, proportions) — a faithful small-scale replica, never redesigned or life-size.
4. AUDIO = satisfying ASMR craft sounds (soft tool clicks, brushing, parts snapping into place). End on the finished, pristine, glossy miniature in a clean hero shot.
I2V FIELD NOTE: in the "imageToVideoPrompt" field express this ONLY as camera + the hands' assembly/restoration MOTION and macro focus — do NOT re-describe or "build" the product in words; the full identity description belongs to the "textToVideoPrompt" field.`;
  }

  if (resolvedStyle === 'jelly_character_asmr') {
    // Cute translucent jelly figurine, palm-held ASMR adventure.
    capsuleStyleClause = `
CRITICAL JELLY CHARACTER ASMR VIDEO RULES (cute translucent jelly figurine, palm-held, macro):
1. The subject is a cute, chubby, glossy TRANSLUCENT jelly/gummy figurine of the character, small enough to sit in an open human PALM. Soft natural daylight with wet specular highlights; blurred natural background; intimate macro with gentle handheld.
2. Satisfying ASMR "adventure": the jelly character playfully interacts with tiny translucent props (a mini drink/treat); as it "drinks/eats", its see-through body visibly FILLS with liquid and rising bubbles inside the translucent belly; soft jiggle/wobble, tiny droplets or foam.
3. Keep the reference character's identity & colours recognizable — just rendered as translucent jelly. Cute and toylike, NOT creepy or hyper-real. The whole figurine stays in frame (palm-held), never cropped.
I2V FIELD NOTE: in the "imageToVideoPrompt" field express this ONLY as camera + the jelly's soft MOTION, wobble, bubbles and light — do NOT re-describe or "build" the character in words; the full identity description belongs to the "textToVideoPrompt" field.`;
  }

  // Make the generated video FOLLOW the directions printed inside the storyboard
  // (applies to EVERY style — the storyboard is the director's sheet).
  const followBoardClause = `FOLLOW THE STORYBOARD'S OWN DIRECTIONS: every panel/card prints production tags — 'CAM:' (camera angle/movement), 'LIGHT:' (lighting) and 'AUDIO:' (music/SFX) — plus a scene title and a one-line action. READ those printed tags in EACH panel and make your "imageToVideoPrompt" (camera + motion + atmosphere) FOLLOW them precisely: e.g. a panel tagged 'CAM: low-angle tracking' -> a low-angle tracking move; 'CAM: static'/'locked' -> a locked tripod shot; 'CAM: push-in' -> a slow push-in; match the mood to the 'LIGHT:' tag and let the motion match the panel's written action. NEVER contradict a panel's printed camera/lighting/action — the storyboard directs the video.
SUBJECT CONSISTENCY (CRITICAL): every page/scene depicts the SAME product/subject/dish shown across the panels. Keep that exact subject identical in EVERY scene's prompt — never switch to a different product, dish, ingredient, or theme partway through (e.g. if early scenes cook noodles, later scenes are the SAME noodles, not vegetables). Only the stage/action/camera changes, not the subject.`;

  // Style-aware atmosphere: cinematic styles get haze + subtle lens flare + DOF;
  // clean styles stay crisp (DOF only, no haze/flare) so the product/scene is clear.
  const atmo = CINEMATIC_VIDEO_STYLES.has(resolvedStyle)
    ? 'cinematic haze, subtle anamorphic lens flare, moderate depth of field (keep the subject sharp — only mild background separation, avoid heavy bokeh), volumetric lighting, gentle motion blur'
    : 'clean, crisp, true-to-life lighting, sharp focus on the subject, mostly deep focus with only subtle background separation (NO heavy bokeh, NO cinematic haze, NO lens flare — keep the product/scene clear and honest)';

  // Idea 1: anchor the video to the CHOSEN layout style (ALL styles, not just transforms),
  // so the result doesn't drift away from the storyboard's look.
  const styleSpec = getStyleSpec(storyboard.style);
  const styleClause = `MATCH THE CHOSEN LAYOUT STYLE: "${styleSpec.name}"${styleSpec.desc ? ` — ${styleSpec.desc}` : ''}. Base camera grammar for this style: ${sanitizeCameraForVideo(styleSpec.camera)}. Base lighting: ${styleSpec.lighting}. Keep the video's camera language, motion, pacing and mood consistent with THIS style AND with each storyboard panel — never drift into a different look.`;

  // Idea 2: camera discipline — consistent framing, no erratic/extreme moves.
  const cameraDisciplineClause = `CAMERA DISCIPLINE: keep a sensible, CONSISTENT shot scale that matches each panel's framing; use gentle, controlled moves (slow push-in, pan, tilt or orbit). Do NOT cut to extreme close-ups, do NOT use big or abrupt zooms, and avoid disorienting or jittery motion — UNLESS a panel's printed 'CAM:' tag explicitly calls for it. Keep the main subject/product fully in frame with a little margin and clearly visible throughout — never let it touch or spill past the edges. If the subject changes size or moves, frame for its LARGEST state so it is never cropped.`;

  // Idea 3: anti-crop framing for styles where the subject expands / changes scale
  // on screen (cube/pod unfolds, parts converge, splash bursts). The camera being
  // too close is exactly why the transformation gets cut off by the frame edges.
  const isTransformFraming = TRANSFORM_FRAMING_STYLES.has(resolvedStyle);
  const framingClause = isTransformFraming
    ? `FRAMING — DO NOT CROP THE TRANSFORMATION (critical for this style): the subject changes scale on screen (a small object unfolds/expands into the full subject, parts converge, or a splash bursts). Frame for the LARGEST/FINAL state, NOT the small starting object: begin on a MEDIUM-WIDE to WIDE shot and keep the camera pulled back with clear empty margin/headroom on ALL sides, so the ENTIRE object and its complete expansion stay fully inside the frame at every moment and are NEVER cut off by the edges. Do NOT push in, zoom in, or sit tight during the change; if anything, ease slightly WIDER as it grows. Only move closer for the final hero beat once the subject is complete and fully visible.`
    : '';

  // Universal: the page image is a storyboard PLANNING sheet — never let the video
  // animate the sheet/grid itself (this is what turned the education/infographic
  // storyboard into a video of moving panels). Always render the real scene INSIDE the
  // panel as one full-frame continuous shot. ALSO: never let the vision model mention,
  // quote, or paraphrase any of the sheet's PRINTED TEXT (captions, VO cue notes,
  // CAM/LIGHT tag labels, badges, duration chips) inside the generated prompts — that
  // printed planning text is not part of the real scene and was the source of a
  // persistent text "leak" into otherwise purely-visual prompt fields.
  const noStoryboardChromeClause = `NEVER RENDER THE STORYBOARD SHEET ITSELF: each page image is a storyboard PLANNING layout — a printed poster with a grid of numbered panels, a header/title banner, badges and duration chips. Your prompts must describe ONLY the real scene happening INSIDE the relevant panel, rendered as ONE single, full-frame, continuous live shot. NEVER show, pan across, scroll or animate the sheet or its layout: no grid, no split panels/boxes/cards, no rows or columns, no panel numbers or 'Scene N' labels, no header/badge/duration chips, no on-screen captions or UI text, and NEVER write 'a 3x2 (or NxN) grid of panels', 'top-left to bottom-right' sweeps, or 'panels sliding into focus'. If a page shows several numbered panels/beats, render them as ONE continuous full-frame real-world shot that PROGRESSES through those beats in chronological order (a single flowing long-take / mini-montage of the actual scene, evenly across the clip) — NOT a single frozen moment, and NEVER the grid, split panels, or a sweep across the sheet.
NEVER QUOTE OR PARAPHRASE THE SHEET'S PRINTED TEXT (critical — this is the #1 source of leaks): the printed header/title text, on-screen caption text, 'VO:' voice-over cue notes, the 'CAM:'/'LIGHT:' tag labels themselves, panel/scene numbers, and duration/badge chip text are PLANNING ANNOTATIONS for the human crew — they are NOT part of the real-world scene and must NEVER appear, be mentioned, quoted, transcribed, translated, or paraphrased inside "imageToVideoPrompt" or "textToVideoPrompt". Do NOT write things like "the caption reads '...'", "a banner displaying '...'", "text on screen says '...'", "the VO note shows '...'", or repeat any of that printed wording (in any language) in quotation marks anywhere in your output. Describe only the real, physical visual scene and its motion — never the sheet's printed planning text.`;

  let systemInstruction = '';
  if (enableVo) {
    systemInstruction = `You are an expert AI Video Director and master video prompting engineer specializing in high-fidelity commercial video generation.
${durationClause}
${capsuleStyleClause}
${styleClause}
${cameraDisciplineClause}
${framingClause}
${noStoryboardChromeClause}
${followBoardClause}

You are provided with ${panelImages.length} page images of a storyboard. Each page image contains ${gridDescText}. This means there are exactly ${totalScenes} pages (scenes) in total.

Your task is to analyze all the pages sequentially and write a distinct visual prompt and voiceover script for EACH of the ${totalScenes} pages.

For each page (scene):
1. "imageToVideoPrompt": ONLY a camera-direction, lighting and motion prompt in English (80-150 words) for Image-to-Video models that ALREADY SEE this exact storyboard image. Treat it as notes to a camera operator + gaffer for a shot that ALREADY EXISTS — NOT a description of anything to create.
   - IT MUST CONTAIN ONLY: (a) camera work — shot scale/distance, angle & movement (e.g. "slow push-in", "cinematic pan down", "smooth orbit", "locked tripod"); (b) how the elements ALREADY in the image move (e.g. "panels slide and unfold smoothly", "liquid splashes upward"); (c) lighting behaviour/atmosphere ("${atmo}").
   - ABSOLUTELY FORBIDDEN: do NOT tell the model to create, build, generate, assemble, add, place or reveal any NEW object/product/scene, and do NOT (re)describe the subject's appearance, colours, materials, logo, packaging or setting — the image already contains ALL of that. No scene-building or product-description words; only direct the camera, the light, and the motion of what is already there.
   - FOLLOW THE STORYBOARD: derive the camera moves, framing and motion from the page's panels IN ORDER — their printed 'CAM:'/'LIGHT:' tags and drawn actions — never invent a different scene or drift from what the panels show.
   - COVER THE WHOLE PAGE AS ONE SHOT (progression): if this page has multiple numbered scenes/beats, direct ONE continuous take that moves through ALL of them in chronological order (beat 1 → beat 2 → … → final beat), spread roughly evenly across the clip's duration; chain the moves naturally (e.g. push-in on the first action, then tilt/glide to the next, and settle on the final hero beat). Do NOT linger on only one beat, and NEVER show the grid/panels.
   - FRAMING: choose a shot scale that keeps the whole subject AND its full motion/transformation inside the frame with margin — never frame so tight that the action gets cut off by the edges.
   - FOR TRANSFORMATIONS (Cube/ASMR/Shape): NO human hands, NO fingers, NO human interaction — the object unfolds automatically by itself on the surface.
   - Purely visual: DO NOT include any narration script or "narrator speaks:" tags inside this field.

2. "textToVideoPrompt": A full, self-contained Text-to-Video prompt in English (110-180 words). OPPOSITE of the I2V field: the model has NO image, so describe EVERYTHING in THIS storyboard panel from words alone — leave nothing out.
   - Describe EXACTLY what the panel shows: the main subject/product faithfully (type, shape, exact colors, materials, logo/branding & any visible text), the setting/background, props, composition & framing, the lighting/mood and ${atmo} — THEN the chronological action and camera movement across the panel's scenes. Be concrete and visual so the generated video matches the storyboard panel.
   - STRICT RULE FOR TRANSFORMATIONS (Cube/ASMR/Shape): ABSOLUTELY NO human hands, NO fingers, NO human interaction in the prompt. The object/cube unfolds completely automatically by itself on the surface!
   - STRICT RULE: DO NOT include any narration script text or "narrator speaks:" tags inside this visual prompt field. Keep it purely visual!

3. "narration": A voiceover narration script paragraph in the language: "${voLanguage || 'Bahasa Indonesia'}". ${toneClause} The narration must fit the page duration and align with the chronological visual action of that page.

CRITICAL SPEECH PACING, TEMPO & PRONUNCIATION RULES (Strictly prevents fast, rushed, garbled, or mispronounced voiceover):
- EJAAN NALAR & PHONETIC (HINDARI BELAPOTAN): Tulis narasi 100% dalam BAHASA PERCAKAPAN MANUSIA YANG ALAMI. DILARANG KERAS menggunakan singkatan, simbol, atau istilah teknis yang membuat TTS membaca belepotan:
  * Tulis kata secara UTUH (contoh: "kilogram" BUKAN "kg", "sentimeter" BUKAN "cm", "seratus persen" BUKAN "100%", "berat badan" BUKAN "BB", "Rupiah" BUKAN "Rp").
  * DILARANG memakai simbol atau karakter khusus seperti %, &, +, /, #, ( ), atau tanda minus (-).
  * Terjemahkan istilah asing ke kata bahasa Indonesia percakapan yang halus (contoh: "tahan air" BUKAN "waterproof", "tas ransel" BUKAN "backpack").
- TEMPO & PACING: Write narration to be spoken at a clear, relaxed, natural conversational pace (about 1.5 words per second) that FILLS most of the scene — continuous enough to avoid long silent gaps, but never rushed or crammed. Insert commas & periods between short phrases for natural breathing pauses.
- WORD COUNT PER SCENE — keep it SHORT: about 6 to 10 words TOTAL, HARD MAX 10 words. One punchy line, never more.
- Keep phrases short, rhythmic and well-spaced; finish about 1 second before the scene ends. Do NOT cram or rush.

CRITICAL NARRATION FLOW & STRUCTURE:
The voiceover narrations across all the ${totalScenes} pages must combine to form one single, continuously flowing script from the first page to the last. Do not treat each page as a standalone video!
- Page 1 (scene_idx = 0): Must start with the opening hook to grab attention. Strictly DO NOT include any conclusion, promo details, or Call to Action (CTA) phrases like "klik keranjang kuning" or "checkout sekarang" here.
- Middle Pages (scene_idx between 1 and ${totalScenes - 2}): Focus strictly on detailed features, demonstrations, or benefits. Ensure the sentences connect naturally from the previous page. DO NOT write any CTA or ending here.
- Final Page (scene_idx = ${totalScenes - 1}): This is the absolute ending of the video. Conclude the narrative smoothly:
  * For commercial/product ads: End with a strong, natural Call to Action (CTA) tailored to the product (e.g. "Dapatkan sekarang sebelum promo berakhir!", "Pesan milikmu hari ini!").
  * For Action, Cinematic, Drama, Storytelling, Animation, or Educational videos: End with a powerful cinematic climax, dramatic punchline, or satisfying story resolution (DO NOT include any sales pitch, shop link, or commercial CTA).
  Adapt the ending naturally to match the genre and tone of the user's prompt.
This prevents premature endings and duplicate CTAs in the middle of the storyboard flow.

You MUST return the output strictly in this JSON format (do not wrap in markdown \`\`\`json blocks):
{
  "scenes": [
    {
      "scene_idx": 0,
      "imageToVideoPrompt": "<English motion-only camera & motion prompt for Page 1 — purely visual, NO narration or timing text>",
      "textToVideoPrompt": "<English full descriptive text prompt for Page 1>",
      "narration": "<Voiceover script for Page 1>"
    },
    ...
  ]
}
Ensure there are exactly ${totalScenes} items in the "scenes" array corresponding to the pages in sequence.`;
  } else {
    systemInstruction = `You are an expert AI Video Director and master video prompting engineer specializing in high-fidelity commercial video generation.
${durationClause}
${capsuleStyleClause}
${styleClause}
${cameraDisciplineClause}
${framingClause}
${noStoryboardChromeClause}
${followBoardClause}

You are provided with ${panelImages.length} page images of a storyboard. Each page image contains ${gridDescText}. This means there are exactly ${totalScenes} pages (scenes) in total.

Your task is to analyze all the pages sequentially and write a distinct visual prompt for EACH of the ${totalScenes} pages.

For each page (scene):
1. "imageToVideoPrompt": ONLY a camera-direction, lighting and motion prompt in English (70-130 words) for Image-to-Video models that ALREADY SEE this exact storyboard image. Treat it as notes to a camera operator + gaffer for a shot that ALREADY EXISTS — NOT a description of anything to create.
   - IT MUST CONTAIN ONLY: (a) camera work — shot scale/distance, angle & movement (e.g. "slow tracking shot", "cinematic pan down", "locked tripod"); (b) how the elements ALREADY in the image move (e.g. "panels unfold smoothly", "fluid water splashes"); (c) lighting behaviour/atmosphere ("${atmo}").
   - ABSOLUTELY FORBIDDEN: do NOT tell the model to create, build, generate, assemble, add, place or reveal any NEW object/product/scene, and do NOT (re)describe the subject's appearance, colours, materials, logo, packaging or setting — the image already contains ALL of that. Only direct the camera, the light, and the motion of what is already there.
   - FOLLOW THE STORYBOARD: derive the camera moves, framing and motion from the page's panels IN ORDER — their printed 'CAM:'/'LIGHT:' tags and drawn actions — never invent a different scene or drift from what the panels show.
   - COVER THE WHOLE PAGE AS ONE SHOT (progression): if this page has multiple numbered scenes/beats, direct ONE continuous take that moves through ALL of them in chronological order (beat 1 → beat 2 → … → final beat), spread roughly evenly across the clip's duration; chain the moves naturally (e.g. push-in on the first action, then tilt/glide to the next, and settle on the final hero beat). Do NOT linger on only one beat, and NEVER show the grid/panels.
   - FRAMING: choose a shot scale that keeps the whole subject AND its full motion/transformation inside the frame with margin — never frame so tight that the action gets cut off by the edges.
   - Voiceover is DISABLED for this project. DO NOT include any voiceover timing or narration text in this prompt!

2. "textToVideoPrompt": A full, self-contained Text-to-Video prompt in English (110-180 words). OPPOSITE of the I2V field: the model has NO image, so describe EVERYTHING in THIS storyboard panel from words alone — leave nothing out.
   - Describe EXACTLY what the panel shows: the main subject/product faithfully (type, shape, exact colors, materials, logo/branding & any visible text), the setting/background, props, composition & framing, the lighting/mood and ${atmo} — THEN the chronological action and camera movement across the panel's scenes. Be concrete and visual so the generated video matches the storyboard panel.

You MUST return the output strictly in this JSON format (do not wrap in markdown \`\`\`json blocks):
{
  "scenes": [
    {
      "scene_idx": 0,
      "imageToVideoPrompt": "<English motion-only prompt for Page 1>",
      "textToVideoPrompt": "<English full descriptive text prompt for Page 1>",
      "narration": null
    },
    ...
  ]
}
Ensure there are exactly ${totalScenes} items in the "scenes" array corresponding to the pages in sequence.`;
  }

  const payload = {
    model: settings?.model || 'gemini-3-flash',
    messages: [
      {
        role: 'system',
        content: systemInstruction
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Project Title: ${storyboard.title}
Main Project Description: ${storyboard.prompt}

Please analyze the provided image sheet(s) carefully. Generate the requested JSON output containing scenes array.`
          },
          ...imageParts
        ]
      }
    ],
    temperature: 0.7
  };

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiToken}`
  };

  const response = await llmChatViaSettings(payload, { db });

  if (response.statusCode !== 200) {
    throw new Error(`Vision API Error (status ${response.statusCode}): ${response.body}`);
  }

  const { parseAiContent } = require('../prompts/aiClient');
  const content = parseAiContent(response.body);
  
  let cleanText = content.trim();
  if (cleanText.startsWith('```')) {
    cleanText = cleanText.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '');
  }
  cleanText = cleanText.trim();

  if (!cleanText) {
    console.error('[AI Video Prompts Debug] Empty response content. Raw body:', response.body);
    throw new Error('Respon dari AI kosong. Hal ini biasanya terjadi jika gambar referensi atau teks prompt terdeteksi sensitif/diblokir oleh filter keamanan (safety filter) AI model. Silakan coba ganti dengan gambar lain.');
  }

  // Validate and parse the structured output
  let finalJsonStr = '';
  try {
    const parsed = JSON.parse(cleanText);
    if (parsed && Array.isArray(parsed.scenes)) {
      // Hard cap: VO narration per scene must be SHORT (configurable max 8-15 words).

      const { stripSpeechLeak } = require('../prompts/sanitizeVideoPrompt');
      parsed.scenes = parsed.scenes.map(s => {
        let i2v = s.imageToVideoPrompt || '';
        let t2v = s.textToVideoPrompt || '';
        let narr = s.narration || '';

        if (['cube_box_transform', 'asmr_toy_transform', 'shape_morph_transform', 'cube_morph_product', 'capsule_toss_transform'].includes(resolvedStyle)) {
          i2v = i2v.replace(/(?:A|a)\s+hand\s+gently\s+interacts\s+with/gi, 'The object automatically unfolds on');
          i2v = i2v.replace(/(?:A|a)\s+hand\s+gently\s+opens/gi, 'The object automatically opens');
          i2v = i2v.replace(/(?:A|a)\s+hand\s+(?:gently\s+)?(?:touches|holds|presses|interacts\s+with|interacts)/gi, 'The mechanical mechanism');
          i2v = i2v.replace(/\b(?:hands?|fingers?|human\s+hands?)\b/gi, 'mechanical panels');

          t2v = t2v.replace(/(?:A|a)\s+hand\s+gently\s+interacts\s+with/gi, 'The object automatically unfolds on');
          t2v = t2v.replace(/(?:A|a)\s+hand\s+gently\s+opens/gi, 'The object automatically opens');
          t2v = t2v.replace(/(?:A|a)\s+hand\s+(?:gently\s+)?(?:touches|holds|presses|interacts\s+with|interacts)/gi, 'The mechanical mechanism');
          t2v = t2v.replace(/\b(?:hands?|fingers?|human\s+hands?)\b/gi, 'mechanical panels');
        }

        // Bug C: the image-to-video prompt must be PURELY visual — strip any leaked
        // narration / VO / timecode / printed-sheet-text text (keep camera + motion + atmosphere only).
        i2v = stripSpeechLeak(i2v);

        // Automatic Narration Truncation: ensure voiceover script never exceeds max words
        if (narr && typeof narr === 'string') {
          const words = narr.trim().split(/\s+/);
          if (words.length > maxWordsAllowed) {
            let truncated = words.slice(0, maxWordsAllowed).join(' ');
            // Ensure proper punctuation ending
            if (!/[.!?]$/.test(truncated)) {
              truncated += '.';
            }
            narr = truncated;
          }
        }

        return { ...s, imageToVideoPrompt: i2v, textToVideoPrompt: t2v, narration: narr };
      });
      finalJsonStr = JSON.stringify(parsed);
    } else {
      throw new Error("Invalid structure from AI");
    }
  } catch (err) {
    console.error("Failed to parse AI scenes JSON, constructing fallback:", err);
    const fallbackScenes = [];
    for (let idx = 0; idx < totalScenes; idx++) {
      fallbackScenes.push({
        scene_idx: idx,
        imageToVideoPrompt: `Camera motion for Scene ${idx + 1}: ${cleanText.substring(0, 200)}...`,
        textToVideoPrompt: `Visual prompt for Scene ${idx + 1}: ${cleanText.substring(0, 200)}...`,
        // Bug B: never fabricate a VO placeholder here — a literal string like
        // "Narasi voiceover untuk Scene 1" would be read aloud by the TTS. Leave empty.
        narration: null
      });
    }
    finalJsonStr = JSON.stringify({ scenes: fallbackScenes });
  }

  // Save to DB as JSON string
  await db.run('UPDATE storyboards SET video_prompts = ? WHERE id = ?', [finalJsonStr, storyboardId]);
  return finalJsonStr;
}

async function generateVideoPrompts(req, res) {
  const { storyboardId, promptType, regenerate, enableVo, voMaxWords, voLanguage, voTone, videoDuration } = req.body;
  if (!storyboardId) {
    console.error('[AI Video Prompts] Missing storyboardId in request');
    return res.status(400).json({ message: 'Storyboard ID harus diisi.' });
  }

  console.log(`[AI Video Prompts] Processing request for storyboard ID: ${storyboardId} (type: ${promptType}, regenerate: ${!!regenerate}, enableVo: ${!!enableVo}, voMaxWords: ${voMaxWords || 10}, voLanguage: ${voLanguage || 'N/A'}, voTone: ${voTone || 'N/A'}, videoDuration: ${videoDuration})`);

  try {
    const finalJsonStr = await generateVideoPromptsInternal({ storyboardId, promptType, regenerate, enableVo, voMaxWords, voLanguage, voTone, videoDuration });
    return res.json({ videoPrompts: finalJsonStr });
  } catch (error) {
    console.error('[AI Video Prompts Critical Error]:', error);
    return res.status(500).json({ message: 'Terjadi kesalahan sistem saat menulis prompt video.', error: error.message });
  }
}

module.exports = {
  writePrompt,
  generateRandomIdea,
  generateVideoPrompts,
  generateVideoPromptsInternal
};
