// Ready-made preset choices for the "Tambah Karakter Manual" / "Edit Character"
// form. Each preset is a complete value that can be dropped straight into the
// paired text field, so users who feel unsure filling these fields manually
// can just pick something close and tweak it afterwards. Picking a preset
// does not lock the field — the text/textarea below stays fully editable.
export default {
  visualTone: [
    { value: 'Tarantino Cinematic, 90s Retro, Gritty Urban Realism', label: 'Tarantino Cinematic / 90s Retro' },
    { value: 'Wes Anderson Symmetrical, Pastel Dreamy, Whimsical', label: 'Wes Anderson / Pastel Dreamy' },
    { value: 'Modern Minimalist, Clean Studio, High Fashion Editorial', label: 'Modern Minimalist / High Fashion' },
    { value: 'Cyberpunk Neon, Futuristic, Blade Runner Mood', label: 'Cyberpunk Neon / Futuristic' },
    { value: 'Warm Golden Hour, Nostalgic Film Grain, Coming-of-Age', label: 'Warm Golden Hour / Nostalgic' },
    { value: 'Dark Noir, High Contrast Black & White, Moody Shadows', label: 'Dark Noir / Black & White' },
    { value: 'Bright Vibrant Pop, Saturated Colors, Playful Commercial', label: 'Vibrant Pop / Playful Commercial' },
    { value: 'Natural Documentary, Candid Realism, Handheld Look', label: 'Natural Documentary / Candid' },
  ],
  colorPalette: [
    { value: '#B22222, #FFC300, #F5F5F5, #8B4513, #28282B', label: 'Retro Warm (Merah Bata, Kuning, Coklat)' },
    { value: '#E6D45A, #C4A85A, #F5F5F5, #8B5E34, #1E1E1E', label: 'Earthy Gold (Emas Tanah)' },
    { value: '#0F172A, #1E293B, #38BDF8, #F8FAFC, #94A3B8', label: 'Cool Cyberpunk Blue' },
    { value: '#FF6B6B, #FFD93D, #6BCB77, #4D96FF, #FFFFFF', label: 'Vibrant Pop (Ceria & Warna-warni)' },
    { value: '#2C2C2C, #D4AF37, #FFFFFF, #800020, #C0C0C0', label: 'Luxury Black & Gold' },
    { value: '#F7CAC9, #92A8D1, #F3E5AB, #D5A6BD, #FFFFFF', label: 'Pastel Dreamy' },
    { value: '#1A1A1A, #FFFFFF, #808080, #C41E3A, #E5E5E5', label: 'Monochrome Noir' },
  ],
  profileNotes: [
    { value: 'Rambut keriting, ekspresi percaya diri, plester jari, jam tangan sebagai aksesoris khas', label: 'Rambut keriting, percaya diri, plester jari' },
    { value: 'Rambut lurus rapi, tatapan tenang, kacamata sebagai ciri khas', label: 'Rambut rapi, tenang, berkacamata' },
    { value: 'Rambut pendek gaya militer, postur tegap, bekas luka kecil di alis', label: 'Rambut pendek militer, postur tegap' },
    { value: 'Rambut panjang bergelombang, senyum ramah, anting-anting mencolok', label: 'Rambut panjang bergelombang, ramah' },
    { value: 'Botak/gundul, tatapan tajam, tato di leher/lengan', label: 'Botak, tatapan tajam, bertato' },
    { value: 'Rambut ikal, kumis/janggut tipis, topi sebagai ciri khas', label: 'Rambut ikal, kumis tipis, bertopi' },
  ],
  turnaroundNotes: [
    { value: 'Depan: tampak penuh kostum utama. Kiri: detail aksesoris sisi kiri. Belakang: detail punggung/tas. Kanan: detail aksesoris sisi kanan.', label: 'Kostum utama, detail 4 sisi' },
    { value: 'Pakaian kasual sehari-hari terlihat konsisten dari segala sudut, sepatu dan aksesoris tetap sama persis.', label: 'Kasual sehari-hari, konsisten' },
    { value: 'Seragam kerja/formal rapi dari depan, samping, dan belakang, dengan logo/lencana yang konsisten.', label: 'Seragam kerja / formal' },
    { value: 'Kostum tradisional lengkap terlihat detail motif kain dari semua sisi pandang.', label: 'Kostum tradisional lengkap' },
  ],
  expressions: [
    { value: '01. Weary, 02. Ironic Smile, 03. Wide Laugh, 04. Suspicious, 05. Sad Clown', label: 'Weary, Ironic Smile, Wide Laugh, Suspicious, Sad Clown' },
    { value: '01. Happy, 02. Joyful, 03. Serious, 04. Surprised, 05. Playful', label: 'Happy, Joyful, Serious, Surprised, Playful' },
    { value: '01. Confident, 02. Calm, 03. Angry, 04. Curious, 05. Thoughtful', label: 'Confident, Calm, Angry, Curious, Thoughtful' },
    { value: '01. Excited, 02. Nervous, 03. Determined, 04. Shy, 05. Proud', label: 'Excited, Nervous, Determined, Shy, Proud' },
    { value: '01. Neutral, 02. Smiling, 03. Frowning, 04. Winking, 05. Shocked', label: 'Neutral, Smiling, Frowning, Winking, Shocked' },
  ],
  wardrobe: [
    { value: 'Kaos kumal, celana kargo, sepatu kets lusuh, aksesoris statement (stiker/pin)', label: 'Kaos kumal & celana kargo (kasual nyentrik)' },
    { value: 'Kemeja formal rapi, celana bahan, sepatu pantofel, jam tangan elegan', label: 'Kemeja formal & pantofel' },
    { value: 'Hoodie oversized, celana jogger, sneakers, topi/beanie', label: 'Hoodie oversized & sneakers' },
    { value: 'Dress kasual, sandal/flat shoes, tas selempang kecil', label: 'Dress kasual & flat shoes' },
    { value: 'Seragam kerja lengkap dengan name tag dan sepatu safety', label: 'Seragam kerja lengkap' },
    { value: 'Pakaian olahraga (jersey/legging), sepatu lari, botol minum sebagai properti', label: 'Pakaian olahraga' },
  ],
  triggerPrompt: [
    { value: 'consistent face, same facial features, exact same outfit across all scenes, no variation in appearance', label: 'Konsisten wajah & outfit (umum)' },
    { value: 'maintain identical hairstyle, clothing, and accessories in every shot, photorealistic consistency', label: 'Konsisten rambut, baju, aksesoris' },
    { value: 'lock character identity: same face structure, skin tone, and wardrobe details in all generated images', label: 'Kunci identitas wajah & warna kulit' },
  ],
  voiceTone: [
    { value: 'Hangat dan percaya diri', label: 'Hangat dan percaya diri' },
    { value: 'Serak dan lelah', label: 'Serak dan lelah' },
    { value: 'Ceria dan energik', label: 'Ceria dan energik' },
    { value: 'Tenang dan berwibawa', label: 'Tenang dan berwibawa' },
    { value: 'Lembut dan ramah', label: 'Lembut dan ramah' },
    { value: 'Tegas dan berkharisma', label: 'Tegas dan berkharisma' },
    { value: 'Misterius dan dalam', label: 'Misterius dan dalam' },
  ],
  voiceLanguage: [
    { value: 'Bahasa Indonesia', label: 'Bahasa Indonesia' },
    { value: 'English (US)', label: 'English (US)' },
    { value: 'English (UK)', label: 'English (UK)' },
    { value: 'Bahasa Jawa', label: 'Bahasa Jawa' },
    { value: 'Bahasa Sunda', label: 'Bahasa Sunda' },
    { value: 'Mandarin', label: 'Mandarin' },
    { value: 'Spanish', label: 'Spanish' },
  ],
};
