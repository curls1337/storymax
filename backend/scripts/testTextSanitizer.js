const { sanitizeStoreNoise } = require('../utils/textSanitizer');

const dirty = `
Sonifer 5-in-1 Hand Blender Stainless Steel 600W
- Motor tembaga murni bertenaga 600 Watt
- Dilengkapi 2 mode kecepatan turbo
- Wadah chopper 500ml dan gelas ukur 600ml
- Pisau stainless steel 304 tahan karat

INFO TOKO & PENGIRIMAN:
Pengiriman dari Jakarta Barat. Buka toko Senin - Sabtu.
Resi otomatis update malam hari. Kurir instan / sameday ready.
Bisa COD / Bayar di tempat! Gratis ongkir se-Indonesia!
Packing aman free bubble wrap tebal + kardus!

SYARAT RETUR & GARANSI:
Garansi resmi 1 tahun. Wajib video unboxing tanpa jeda untuk klaim garansi.
Bintang 1-3 garansi hangus!
Hubungi CS kami WA: 0812-3456-7890 / +6281987654321 atau email support@tokoelektronik.com
Follow IG kami @tokoelektronik_official dan kunjungi https://tokopedia.link/sonifer-blender
Checkout sekarang sebelum kehabisan!
`;

console.log('=== BEFORE ===');
console.log(dirty);
console.log('=== AFTER ===');
const cleaned = sanitizeStoreNoise(dirty);
console.log(cleaned);

// Assertions
const tests = [
  [!cleaned.includes('0812'), 'No WA number'],
  [!cleaned.includes('support@tokoelektronik.com'), 'No Email'],
  [!cleaned.includes('tokopedia.link'), 'No URL'],
  [!cleaned.includes('video unboxing'), 'No unboxing noise'],
  [!cleaned.includes('garansi resmi'), 'No warranty noise'],
  [!cleaned.includes('COD'), 'No COD noise'],
  [!cleaned.includes('bubble wrap'), 'No bubble wrap noise'],
  [cleaned.includes('Sonifer 5-in-1 Hand Blender Stainless Steel 600W'), 'Product Title preserved'],
  [cleaned.includes('600 Watt'), '600 Watt preserved'],
  [cleaned.includes('500ml'), '500ml preserved'],
  [cleaned.includes('Pisau stainless steel 304'), '304 stainless preserved'],
];

let allPassed = true;
for (const [passed, desc] of tests) {
  if (!passed) {
    console.error(`FAILED: ${desc}`);
    allPassed = false;
  } else {
    console.log(`PASSED: ${desc}`);
  }
}

if (!allPassed) process.exit(1);
console.log('ALL SANITIZER ASSERTIONS PASSED!');
