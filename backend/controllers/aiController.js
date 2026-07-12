const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { getDb } = require('../db');

const LAYOUT_STYLES = [
  { value: 'cooking_grid', label: 'Cinematic Dark Storyboard Grid (Dark/Premium)' },
  { value: 'video_table', label: 'Clean Product Video Presentation Sheet (Cream/Editorial)' },
  { value: 'product_identity', label: 'Luxury Product Specs Infographic (Minimalist/Clean)' },
  { value: 'ugc_guide', label: 'Social UGC Action Storyboard (Vlog/Vibrant)' },
  { value: 'yellow_badge_storyboard', label: 'Yellow Badge Commercial Storyboard (Clean Yellow - School Bag)' },
  { value: 'female_editorial_table', label: 'Burgundy Editorial Script Table (Elegant Burgundy - Woman Shirt)' },
  { value: 'creative_diy_kids', label: 'Creative Kids Playful Storyboard (Playful/Colorful - Art Paint)' },
  { value: 'blue_pastel_asmr', label: 'Blue Pastel UGC ASMR Review (Aesthetic Blue - Aimilo)' },
  { value: 'minimalist_unboxing_grid', label: 'Minimalist Unboxing Rounded Grid (Clean Minimalist - Blender)' },
  { value: 'cinematic_overlay', label: 'Full Bleed Cinematic Storyboard (Cinematic Overlay - RC Train)' },
  { value: 'baking_timeline', label: 'Classic Cooking/Baking Timeline (Cream Timeline - Bread Homemade)' },
  { value: 'frame_strip', label: '3-Column Multi-Angle Progression Strip (Strip Grid - Tamagoyaki)' },
  { value: 'pencil_sketch', label: 'Vintage Crew Charcoal Pencil Sketch (Black and White Charcoal Sketch - Horror House)' },
  { value: 'animation_bible', label: '3D Animation Bible & Pitch Sheet (Pixar Blue - The Last Shot)' },
  { value: 'lego_diy', label: 'DIY Lego/Brick Assembly Storyboard (Lego Builder - RM Padang)' },
  { value: 'mecha_review', label: 'Tech Mecha Action Figure Review Columns (Tech Blue - Gundam ASMR)' },
  { value: 'anime_lego_storyboard', label: '2D Anime Lego Assembly Storyboard (Anime/Makoto Shinkai - Lego Beat)' },
  { value: 'toy_commercial', label: 'Toy Commercial Storyboard with Text Overlays (Blue Toy Car - Die-Cast)' },
  { value: 'cartoon_script_grid', label: 'Cute Cartoon Storyboard with Script Table (Cute 3D Cartoon - Housewife)' }
];

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
      timeout: 15000 // 15 seconds timeout
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

async function writePrompt(req, res) {
  const { concept } = req.body;
  if (!concept) {
    return res.status(400).json({ message: 'Ide kasar (concept) harus diisi.' });
  }

  try {
    const db = getDb();
    const settings = await db.get('SELECT * FROM ai_settings LIMIT 1');
    
    // Default fallbacks if settings table is empty
    let apiHost = 'http://localhost:8045/v1';
    let apiToken = 'ag_api_55bd6bfe5c3b771a';

    if (settings) {
      apiHost = settings.endpoint;
      apiToken = settings.api_key;
    }

    const layoutListText = LAYOUT_STYLES.map(s => `- "${s.value}": ${s.label}`).join('\n');

    const payload = {
      model: settings?.model || 'gemini-3-flash',
      messages: [
        {
          role: 'system',
          content: `Anda adalah seorang sutradara video iklan komersial profesional dan desainer storyboard.
Tugas Anda adalah menerima ide kasar dari pengguna, lalu menghasilkan:
1. Sebuah Judul Proyek yang elegan, padat, dan premium (maksimal 5 kata).
2. Sebuah Deskripsi Storyboard rinci yang siap digunakan sebagai prompt AI (berisi detail visual, gaya sinematik, sudut kamera, warna, dan pencahayaan).
3. Memilih satu Gaya Layout Storyboard yang paling cocok untuk ide/konsep tersebut dari daftar gaya berikut:
${layoutListText}

Anda harus mengembalikan respon hanya dalam format JSON mentah dengan key 'title', 'description', dan 'layout' (diisi dengan value/kode dari layout yang Anda pilih). Jangan bungkus dalam markdown (jangan pakai \`\`\`json). Contoh output:
{
  "title": "Judul Elegan",
  "description": "Deskripsi visual rinci...",
  "layout": "baking_timeline"
}`
        },
        {
          role: 'user',
          content: `Ide Kasar: ${concept}`
        }
      ],
      temperature: 0.7
    };

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiToken}`
    };

    const response = await httpRequest(`${apiHost}/chat/completions`, headers, payload);

    if (response.statusCode !== 200) {
      return res.status(500).json({ message: 'Gagal menghubungi server AI.', error: response.body });
    }

    const resJson = JSON.parse(response.body);
    const content = resJson.choices?.[0]?.message?.content || '';
    
    // Parse response content robustly
    let cleanText = content.trim();
    if (cleanText.startsWith('```')) {
      cleanText = cleanText.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '');
    }

    try {
      const parsed = JSON.parse(cleanText.trim());
      // Ensure selected layout is valid, fallback to 'cooking_grid'
      const selectedLayout = LAYOUT_STYLES.some(s => s.value === parsed.layout) ? parsed.layout : 'cooking_grid';
      return res.json({
        title: parsed.title || 'Untitled AI Project',
        description: parsed.description || concept,
        layout: selectedLayout
      });
    } catch (parseErr) {
      return res.json({
        title: concept.substring(0, 20) + '...',
        description: cleanText,
        layout: 'cooking_grid'
      });
    }

  } catch (error) {
    return res.status(500).json({ message: 'Terjadi kesalahan sistem saat memproses AI.', error: error.message });
  }
}

async function generateVideoPrompts(req, res) {
  const { storyboardId } = req.body;
  if (!storyboardId) {
    return res.status(400).json({ message: 'Storyboard ID harus disertakan.' });
  }

  try {
    const db = getDb();
    
    // Retrieve storyboard
    const storyboard = await db.get('SELECT * FROM storyboards WHERE id = ?', [storyboardId]);
    if (!storyboard) {
      return res.status(404).json({ message: 'Storyboard tidak ditemukan.' });
    }

    // If prompts already exist, return them directly
    if (storyboard.video_prompts) {
      try {
        const parsed = JSON.parse(storyboard.video_prompts);
        return res.json({ videoPrompts: parsed });
      } catch (err) {
        // Corrupted JSON, will regenerate
      }
    }

    const settings = await db.get('SELECT * FROM ai_settings LIMIT 1');
    
    let apiHost = 'http://localhost:8045/v1';
    let apiToken = 'ag_api_55bd6bfe5c3b771a';

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
      if (imgPath.startsWith('/uploads/')) {
        const fullPath = path.join(__dirname, '..', 'public', imgPath);
        if (fs.existsSync(fullPath)) {
          const imgBuffer = fs.readFileSync(fullPath);
          const base64 = imgBuffer.toString('base64');
          imageParts.push({
            type: 'image_url',
            image_url: {
              url: `data:image/png;base64,${base64}`
            }
          });
        }
      } else if (imgPath.startsWith('http')) {
        imageParts.push({
          type: 'image_url',
          image_url: {
            url: imgPath
          }
        });
      }
    }

    const payload = {
      model: settings?.model || 'gemini-3-flash',
      messages: [
        {
          role: 'system',
          content: `Anda adalah seorang direktur AI Video dan pakar perancangan prompt video komersial dengan kemampuan analisis gambar visual (Multimodal Vision).
Tugas Anda adalah menganalisis gambar-gambar adegan panel storyboard yang diberikan secara visual, lalu mencocokkannya dengan judul/deskripsi cerita untuk membuat prompt video yang sangat detail, dinamis, dan akurat untuk setiap adegan/panel.
Gunakan gambar visual panel tersebut secara langsung untuk mengenali objek, warna, komposisi adegan, dan aksi yang sedang terjadi.
Setiap adegan visual storyboard harus diubah menjadi prompt video mandiri dengan aturan berikut:
1. Bertipe Text-to-Video (tidak bergantung pada gambar referensi apa pun, melainkan mendeskripsikan adegan seutuhnya berdasarkan analisis visual yang Anda lakukan terhadap gambar panel tersebut).
2. Menyertakan detail visual yang kaya yang terlihat di gambar: objek utama, pergerakan kamera yang cocok (misal: smooth camera pan, slow zoom-in, cinematic tracking shot), pencahayaan (misal: volumetric studio light, high-end commercial soft shadows), dan kualitas visual (misal: photorealistic 8k, highly detailed).
3. Ditulis dalam Bahasa Inggris (English) agar kompatibel maksimal saat disalin ke generator video AI (seperti Kling, Luma, Runway, Sora, Pika).

Anda harus mengembalikan respon hanya dalam format JSON mentah berupa array objek, di mana setiap objek memiliki key 'scene' (nomor adegan) dan 'prompt' (teks prompt video lengkap). Jangan bungkus dalam markdown (jangan pakai \`\`\`json). Contoh output:
[
  {
    "scene": 1,
    "prompt": "Extreme close-up of a chef's hands pouring golden sauce onto a juicy cooked beef steak, steam rising, slow motion, volumetric studio lighting, photorealistic 8k, cinematic color grading"
  },
  {
    "scene": 2,
    "prompt": "Smooth panning shot of a sleek luxury cosmetics bottle reflecting light, clean soft shadows, studio background, 8k resolution"
  }
]`
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Judul Proyek: ${storyboard.title}
Deskripsi Utama Storyboard: ${storyboard.prompt}

Berikut adalah gambar-gambar panel storyboard berurutan dari Scene 1 s.d Scene ${panelImages.length}. Analisis setiap gambar dengan cermat untuk membuat prompt video yang akurat dan sesuai dengan visual gambarnya.`
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

    const response = await httpRequest(`${apiHost}/chat/completions`, headers, payload);

    if (response.statusCode !== 200) {
      console.error('[Vision API Error] Status:', response.statusCode, 'Body:', response.body);
      return res.status(500).json({ message: 'Gagal menghubungi server AI untuk menulis prompt video.', error: response.body });
    }

    const resJson = JSON.parse(response.body);
    const content = resJson.choices?.[0]?.message?.content || '';
    
    let cleanText = content.trim();
    if (cleanText.startsWith('```')) {
      cleanText = cleanText.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '');
    }

    try {
      const parsed = JSON.parse(cleanText.trim());
      if (Array.isArray(parsed)) {
        // Save to DB
        await db.run('UPDATE storyboards SET video_prompts = ? WHERE id = ?', [JSON.stringify(parsed), storyboardId]);
        return res.json({ videoPrompts: parsed });
      } else {
        throw new Error('Hasil AI bukan berupa array JSON.');
      }
    } catch (parseErr) {
      return res.status(500).json({ message: 'Gagal mengurai respon JSON dari AI.', rawResponse: cleanText });
    }

  } catch (error) {
    return res.status(500).json({ message: 'Terjadi kesalahan sistem saat menulis prompt video.', error: error.message });
  }
}

module.exports = {
  writePrompt,
  generateVideoPrompts
};
