// Canonical frontend storyboard styles. Selector shows icon + name + desc
// (no preview images). faceMode = default face handling per style.
export default [
  // ── A. Transformasi & Reveal (Premium) ──
  { value: 'mechanical_transform', label: 'Mechanical Transformation', desc: 'Wadah mekanis premium mekar & morph mulus jadi produk. Fokus pada presisi mekanik sinematik.', category: 'Transformasi & Reveal', faceMode: 'faceless', icon: 'Box' },
  { value: 'product_assembly', label: 'Product Assembly', desc: 'Bagian-bagian produk beterbangan menyatu secara presisi. Gaya futuristik & teknis.', category: 'Transformasi & Reveal', faceMode: 'faceless', icon: 'Combine' },
  { value: 'liquid_splash', label: 'Liquid / Splash Reveal', desc: 'Produk muncul dari cipratan cairan, asap, atau bubuk yang membeku. Artistik & segar.', category: 'Transformasi & Reveal', faceMode: 'faceless', icon: 'Droplets' },
  { value: 'unboxing', label: 'Cinematic Unboxing', desc: 'Pembukaan kemasan dramatis dengan fokus pada tekstur kotak dan reveal produk.', category: 'Transformasi & Reveal', faceMode: 'faceless', icon: 'PackageOpen' },
  { value: 'asmr_unboxing_premium', label: 'ASMR Unboxing Premium', desc: 'Unboxing kelas atas dengan sarung tangan hitam, fokus pada detail makro dan bunyi memuaskan.', category: 'Transformasi & Reveal', faceMode: 'faceless', icon: 'Hand' },
  { value: 'mechanic_transform_gauntlet', label: 'Mechanic Transformation (Gauntlet)', desc: 'Transformasi mekanis kompleks dari pod menjadi perangkat canggih. Fokus pada gir & plates.', category: 'Transformasi & Reveal', faceMode: 'faceless', icon: 'Cpu' },
  { value: 'before_after', label: 'Before–After', desc: 'Perbandingan visual langsung antara masalah (sebelum) dan solusi produk (sesudah).', category: 'Transformasi & Reveal', faceMode: 'chin_max', icon: 'GitCompareArrows' },

  // ── B. UGC & Social (Viral) ──
  { value: 'ugc_creator', label: 'UGC Creator Style', desc: 'Gaya influencer autentik berbicara ke kamera, demo produk, dan reaksi jujur. Relatable.', category: 'UGC & Social', faceMode: 'chin_max', icon: 'Megaphone' },
  { value: 'social_stylized_text', label: 'Social Media (Stylized Text)', desc: 'Fokus pada teks overlay besar, stiker, dan balon penjelasan fitur artistik di dalam gambar.', category: 'UGC & Social', faceMode: 'chin_max', icon: 'Type' },
  { value: 'social_lifestyle', label: 'Social Lifestyle (Independent)', desc: 'Satu karakter dalam berbagai aktivitas berbeda per halaman. Identitas konsisten, momen berbeda.', category: 'UGC & Social', faceMode: 'full', icon: 'Instagram' },
  { value: 'jelly_character_asmr', label: 'Jelly Character ASMR', desc: 'Figurin jeli transparan karakter yang digenggam; tubuh terisi gelembung. Memuaskan.', category: 'UGC & Social', faceMode: 'faceless', icon: 'Baby' },

  // ── C. Proses & Edukasi (Informatif) ──
  { value: 'timelapse_process', label: 'Timelapse Process', desc: 'Proses dipercepat dari awal sampai hasil akhir dengan sudut kamera tetap. Memuaskan.', category: 'Proses & Edukasi', faceMode: 'faceless', icon: 'FastForward' },
  { value: 'professional_tutorial', label: 'Professional Tutorial', desc: 'Panduan langkah demi langkah teknis dengan label nomor, durasi, dan fokus pada tangan.', category: 'Proses & Edukasi', faceMode: 'faceless', icon: 'ListChecks' },
  { value: 'recipe_asmr', label: 'Recipe & ASMR Cooking', desc: 'Langkah memasak dengan fokus pada tekstur makanan, uap, dan suara. Menggugah selera.', category: 'Proses & Edukasi', faceMode: 'faceless', icon: 'ChefHat' },
  { value: 'infographic_explainer', label: 'Infographic Explainer', desc: 'Menjelaskan konsep dengan ikon, diagram bersih, dan panah petunjuk.', category: 'Proses & Edukasi', faceMode: 'faceless', icon: 'GraduationCap' },

  // ── D. Cinematic & Art (High-End) ──
  { value: 'cinematic_ad', label: 'Cinematic TV Commercial', desc: 'Gaya iklan TV premium dengan layout katalog bersih dan fokus estetika produk kelas atas.', category: 'Cinematic & Art', faceMode: 'full', icon: 'Film' },
  { value: 'anime_manga', label: 'Anime / Manga Storyboard', desc: 'Gaya ilustrasi tangan dengan panel dinamis, action lines, dan ekspresi karakter kuat.', category: 'Cinematic & Art', faceMode: 'full', icon: 'BookOpen' },
  { value: 'kawaii_playful', label: 'Kawaii / Playful Layout', desc: 'Gaya lucu dengan elemen stiker, warna pastel ceria, ikon imut, dan balon teks.', category: 'Cinematic & Art', faceMode: 'full', icon: 'Sparkles' },
  { value: 'luxury_mood', label: 'Luxury / Premium Mood', desc: 'Eksklusif, gelap, dramatis. Fokus pada kemewahan material dan pencahayaan misterius.', category: 'Cinematic & Art', faceMode: 'faceless', icon: 'Gem' },
  { value: 'product_hero', label: 'Product Hero Showcase', desc: 'Hero shot produk premium yang bersih dan fokus pada sudut pandang terbaik produk.', category: 'Cinematic & Art', faceMode: 'faceless', icon: 'Star' },
  { value: 'cinematic_fpv_nature', label: 'Cinematic FPV Nature', desc: 'Gaya drone FPV kecepatan tinggi melewati pemandangan alam. Dinamis, luas, dan petualang.', category: 'Cinematic & Art', faceMode: 'faceless', icon: 'Wind' },
];
