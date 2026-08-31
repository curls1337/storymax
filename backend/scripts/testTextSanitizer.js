const { sanitizeStoreNoise } = require('../utils/textSanitizer');

const dirtyProductDesc = `
Jam Tangan Digital Pria Original 100% Stainless Steel Waterproof
- Desain modern dan higienis dengan peningkatan performa signifikan
- Layar digital LED dengan backlight terang
- Produk 100% original bergaransi pabrik

INFO TOKO & PENGIRIMAN:
Pengiriman dari Jakarta Barat. Buka toko Senin - Sabtu.
Resi otomatis update malam hari. Kurir instan / sameday ready.
Bisa COD / Bayar di tempat! Gratis ongkir se-Indonesia!
Packing aman free bubble wrap tebal + kardus!

SYARAT RETUR & GARANSI:
Garansi resmi 1 tahun. Wajib video unboxing tanpa jeda untuk klaim garansi.
Bintang 1-3 garansi hangus!
Hubungi CS kami WA: 0812-3456-7890 / +6281987654321 atau email support@tokoelektronik.com
Follow IG kami @tokoelektronik_official dan FB: @tokoelektronik_id serta TikTok: @tokoelektronik
Kunjungi https://tokopedia.link/jam-digital-original
Checkout sekarang sebelum kehabisan!
`;

console.log('=== BEFORE SANITIZATION ===');
console.log(dirtyProductDesc);

const cleaned = sanitizeStoreNoise(dirtyProductDesc);

console.log('=== AFTER SANITIZATION ===');
console.log(cleaned);

const tests = [
  // Preservation tests (False-Positive prevention)
  [cleaned.includes('Original') || cleaned.includes('original'), 'Word "original" is preserved and not truncated to "or"'],
  [cleaned.includes('Digital') || cleaned.includes('digital'), 'Word "digital" is preserved and not truncated to "d"'],
  [cleaned.includes('Desain') || cleaned.includes('desain'), 'Word "desain" is preserved'],
  [cleaned.includes('higienis'), 'Word "higienis" is preserved'],
  [cleaned.includes('signifikan'), 'Word "signifikan" is preserved'],
  [cleaned.includes('Waterproof'), 'Word "Waterproof" is preserved'],
  [cleaned.includes('Stainless Steel'), 'Word "Stainless Steel" is preserved'],

  // Store Noise & Contact stripping tests
  [!cleaned.includes('0812'), 'WA / Phone numbers stripped'],
  [!cleaned.includes('support@tokoelektronik.com'), 'Email stripped'],
  [!cleaned.includes('tokopedia.link'), 'URLs stripped'],
  [!cleaned.includes('@tokoelektronik_official'), 'IG handle @tokoelektronik_official stripped'],
  [!cleaned.includes('@tokoelektronik_id'), 'FB handle @tokoelektronik_id stripped'],
  [!cleaned.includes('@tokoelektronik'), 'TikTok handle stripped'],
  [!cleaned.includes('video unboxing'), 'Video unboxing noise stripped'],
  [!cleaned.includes('garansi resmi'), 'Garansi resmi noise stripped'],
  [!cleaned.includes('COD'), 'COD noise stripped'],
  [!cleaned.includes('bubble wrap'), 'Bubble wrap noise stripped'],
  [!cleaned.includes('Checkout sekarang'), 'Checkout CTA stripped'],
];

let allPassed = true;
for (const [passed, desc] of tests) {
  if (!passed) {
    console.error(`❌ FAILED: ${desc}`);
    allPassed = false;
  } else {
    console.log(`✅ PASSED: ${desc}`);
  }
}

if (!allPassed) {
  console.error('\nSOME TESTS FAILED!');
  process.exit(1);
} else {
  console.log('\nALL TESTS PASSED SUCCESSFULLY!');
}
