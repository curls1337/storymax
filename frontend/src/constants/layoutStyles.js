// Canonical frontend storyboard styles. Selector shows icon + name + desc
// (no preview images). faceMode = default face handling per style.
export default [
  // Transformasi & Reveal
  { value: 'cube_box_transform', label: 'Cube Box Transformation', desc: 'Kubus detail di atas permukaan → otomatis morph & mekar jadi produk/model, sinematik fotorealistis.', category: 'Transformasi & Reveal', faceMode: 'faceless', icon: 'Box' },
  { value: 'shape_morph_transform', label: 'Transformasi Shape Adaptif (Auto)', desc: 'Bentuk awal otomatis menyesuaikan objek (kotak, bulat/bola, silinder, segitiga, dsb.) → mekar & morph otomatis di atas permukaan.', category: 'Transformasi & Reveal', faceMode: 'faceless', icon: 'Shapes' },
  { value: 'asmr_toy_transform', label: 'ASMR Toy Transform (Statis)', desc: 'Kubus diletakkan di meja lalu membuka sendiri jadi mainan die-cast — kamera DIAM, suara ASMR mekanis, smooth.', category: 'Transformasi & Reveal', faceMode: 'faceless', icon: 'AudioWaveform' },
  { value: 'unboxing', label: 'Unboxing', desc: 'Buka kemasan dramatis, reveal produk, close-up detail.', category: 'Transformasi & Reveal', faceMode: 'faceless', icon: 'PackageOpen' },
  { value: 'before_after', label: 'Before–After', desc: 'Perbandingan sebelum vs sesudah memakai produk.', category: 'Transformasi & Reveal', faceMode: 'chin_max', icon: 'GitCompareArrows' },
  { value: 'product_assembly', label: 'Product Assembly', desc: 'Bagian-bagian beterbangan menyatu jadi produk.', category: 'Transformasi & Reveal', faceMode: 'faceless', icon: 'Combine' },
  { value: 'liquid_splash', label: 'Liquid / Splash Reveal', desc: 'Produk muncul dari cipratan cairan / asap.', category: 'Transformasi & Reveal', faceMode: 'faceless', icon: 'Droplets' },
  // UGC & Social
  { value: 'ugc_review', label: 'UGC Review', desc: 'Influencer autentik: hook → demo → ajakan beli.', category: 'UGC & Social', faceMode: 'chin_max', icon: 'Megaphone' },
  { value: 'pov', label: 'POV', desc: 'Sudut pandang orang pertama memakai produk.', category: 'UGC & Social', faceMode: 'chin_max', icon: 'Eye' },
  { value: 'talking_head', label: 'Talking-Head', desc: 'Bicara ke kamera memperkenalkan produk.', category: 'UGC & Social', faceMode: 'chin_max', icon: 'Mic' },
  { value: 'grwm', label: 'GRWM (Get Ready With Me)', desc: 'Rutinitas persiapan sambil pakai produk.', category: 'UGC & Social', faceMode: 'chin_max', icon: 'Sparkles' },
  { value: 'skit_meme', label: 'Skit / Meme', desc: 'Komedi singkat relatable seputar produk.', category: 'UGC & Social', faceMode: 'chin_max', icon: 'Laugh' },
  { value: 'reaction', label: 'Reaction / Duet', desc: 'Reaksi terhadap produk atau hasil.', category: 'UGC & Social', faceMode: 'chin_max', icon: 'MessageCircle' },
  // Proses & Edukasi
  { value: 'timelapse_process', label: 'Timelapse Proses', desc: 'Proses dipercepat dari awal sampai hasil.', category: 'Proses & Edukasi', faceMode: 'faceless', icon: 'FastForward' },
  { value: 'tutorial_steps', label: 'Tutorial Langkah', desc: 'Panduan how-to langkah demi langkah bernomor.', category: 'Proses & Edukasi', faceMode: 'chin_max', icon: 'ListChecks' },
  { value: 'recipe_cooking', label: 'Resep & Masakan', desc: 'Langkah memasak + ASMR, cocok kuliner/F&B.', category: 'Proses & Edukasi', faceMode: 'faceless', icon: 'ChefHat' },
  { value: 'education_explainer', label: 'Edukasi Explainer', desc: 'Menjelaskan konsep/fitur dengan ikon & diagram.', category: 'Proses & Edukasi', faceMode: 'faceless', icon: 'GraduationCap' },
  { value: 'diy_build', label: 'DIY / Build', desc: 'Rakit atau kerajinan miniatur langkah demi langkah.', category: 'Proses & Edukasi', faceMode: 'faceless', icon: 'Hammer' },
  // Sinematik & Branding
  { value: 'short_story', label: 'Cerita Pendek Sinematik', desc: 'Iklan bernarasi dengan alur cerita sinematik.', category: 'Sinematik & Branding', faceMode: 'full', icon: 'Clapperboard' },
  { value: 'cinematic_broll', label: 'Cinematic B-Roll', desc: 'Potongan sinematik estetik untuk iklan/TVC.', category: 'Sinematik & Branding', faceMode: 'faceless', icon: 'Film' },
  { value: 'product_hero', label: 'Product Hero Showcase', desc: 'Hero shot produk premium yang bersih.', category: 'Sinematik & Branding', faceMode: 'faceless', icon: 'Star' },
  { value: 'luxury_mood', label: 'Luxury / Premium Mood', desc: 'Mewah, gelap, dramatis, eksklusif.', category: 'Sinematik & Branding', faceMode: 'faceless', icon: 'Gem' },
  { value: 'fashion_lookbook', label: 'Fashion Lookbook', desc: 'Busana / OOTD bergaya editorial.', category: 'Sinematik & Branding', faceMode: 'full', icon: 'Shirt' },
  // Artistik / Niche
  { value: 'asmr_satisfying', label: 'ASMR / Satisfying', desc: 'Fokus tekstur & suara, visual memuaskan.', category: 'Artistik / Niche', faceMode: 'faceless', icon: 'AudioWaveform' },
  { value: 'stop_motion', label: 'Stop-Motion', desc: 'Animasi frame-by-frame yang playful.', category: 'Artistik / Niche', faceMode: 'faceless', icon: 'Frame' },
  { value: 'tiny_world', label: 'Miniature / Tiny World', desc: 'Gaya Pixar 3D dengan objek mini.', category: 'Artistik / Niche', faceMode: 'faceless', icon: 'Blocks' },
  { value: 'anime_comic', label: 'Anime / Komik', desc: 'Gaya manga/komik bercerita (ilustrasi).', category: 'Artistik / Niche', faceMode: 'full', icon: 'BookOpen' },
];
