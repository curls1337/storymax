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

module.exports = {
  writePrompt
};
