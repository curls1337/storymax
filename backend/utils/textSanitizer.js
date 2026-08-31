// textSanitizer.js
// Utility to clean e-commerce store noise (WhatsApp numbers, emails, store policies,
// unboxing video requirements, warranty claims, COD/free-shipping claims, social URLs, etc.)
// from user drafts, scraped Tokopedia text, and AI responses.

const PHONE_REGEX = /(?:(?:wa|whatsapp|hubungi|call|telp|telepon|hp|chat\s+admin|contact|cs|hotline)\s*[:\-]?\s*)?(?:\+?62|08|02\d)[\s\-.]*(?:\d[\s\-.]*){7,13}\d/gi;
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const URL_REGEX = /https?:\/\/[^\s)]+/gi;
const SOCIAL_HANDLE_REGEX = /(?:ig|instagram|tiktok|facebook|fb|tokopedia|shopee|lazada|blibli)\s*[:\-]?\s*@?[a-zA-Z0-9_.-]+/gi;

// Section header lines that indicate purely store/transactional sections
const STORE_HEADER_LINE_REGEX = /^(?:info\s*toko|syarat\s*(?:retur|garansi|komplain)|ketentuan\s*(?:toko|garansi|retur)|kebijakan\s*(?:toko|pengembalian)|catatan\s*toko|jadwal\s*operasional|kontak\s*kami|layanan\s*pelanggan|follow\s*kami|media\s*sosial|pengiriman\s*&\s*ongkir|perhatian|note|pemberitahuan)\b[^\n]*:?$/im;

const NOISE_PATTERNS = [
  // Video unboxing & complaint policies
  /(?:wajib|mohon|harus|tolong)?\s*(?:membuat|ada|sertakan|lampirkan)?\s*video\s*unboxing[^\n.]*/gi,
  /(?:tidak\s*(?:menerima|bisa)\s*)?komplain\s*(?:tanpa|wajib)\s*video[^\n.]*/gi,
  /bintang\s*[1-5][^\n.]*(?:garansi|hangus|blokir|auto\s*block|komplain|ulasan|bintang)?[^\n.]*/gi,
  /syarat\s*(?:dan\s*ketentuan\s*)?(?:retur|klaim|garansi)[^\n.]*/gi,
  /kebijakan\s*(?:retur|pengembalian|toko)[^\n.]*/gi,
  /ongkir\s*retur\s*ditanggung[^\n.]*/gi,
  /retur\s*barang\s*(?:maksimal|syarat)[^\n.]*/gi,

  // Store warranties & claims
  /garansi\s*(?:resmi|toko|distributor)?\s*\d*\s*(?:tahun|bulan|hari|bln|thn)?(?:\s*klaim[^\n.]*)?/gi,
  /klaim\s*garansi\s*(?:mudah|resmi|langsung)[^\n.]*/gi,

  // Shipping & store operations
  /(?:pengiriman|kirim|dikirim)\s*dari\s*[a-zA-Z0-9\s,.-]+(?=\n|$|\.)/gi,
  /jadwal\s*pengiriman[^\n.]*/gi,
  /jam\s*operasional(?:\s*toko)?[^\n.]*/gi,
  /buka\s*toko\s*senin[^\n.]*/gi,
  /senin\s*-\s*(?:sabtu|minggu)[^\n.]*/gi,
  /kurir\s*(?:toko|instan|sameday|cargo|anteraja|sicepat|jne|j&t)[^\n.]*/gi,
  /resi\s*(?:otomatis|update\s*malam)[^\n.]*/gi,
  /pickup\s*(?:jam|pukul)?\s*\d+[^\n.]*/gi,
  /ready\s*stock\s*siap\s*kirim[^\n.]*/gi,
  /stok\s*ready\s*silakan\s*order[^\n.]*/gi,

  // Free shipping & COD
  /(?:gratis|free)\s*ongkir(?:\s*(?:ekstra|se-indonesia|seluruh\s*indonesia|x-tra))?[^\n.]*/gi,
  /(?:bisa|melayani|support|fitur)?\s*cod(?:\s*(?:\/|atau)?\s*bayar\s*di\s*tempat)?[^\n.]*/gi,
  /bayar\s*di\s*tempat\s*(?:\(cod\))?[^\n.]*/gi,

  // Packaging info
  /(?:packing|paket)\s*(?:aman|rapi|standar|ekstra|bubble\s*wrap)[^\n.]*/gi,
  /free\s*(?:bubble\s*wrap|kardus|dus|box\s*tambahan)[^\n.]*/gi,
  /(?:sudah|free)?\s*termasuk\s*bubble\s*wrap[^\n.]*/gi,
  /tambahan\s*bubble\s*wrap[^\n.]*/gi,
  /buble\s*wrap\s*tebal[^\n.]*/gi,

  // Marketplace CTAs & reseller notes
  /checkout\s*(?:sekarang|hari\s*ini|yuk|juga)[^\n.]*/gi,
  /klik\s*(?:keranjang\s*kuning|beli\s*sekarang|checkout|tombol\s*beli)[^\n.]*/gi,
  /masukkan\s*keranjang\s*belanja[^\n.]*/gi,
  /voucher\s*diskon[^\n.]*/gi,
  /cashback\s*(?:ekstra|100%|jumbo|terbesar)[^\n.]*/gi,
  /flash\s*sale\s*(?:terbatas|hari\s*ini)?[^\n.]*/gi,
  /diskon\s*kilat[^\n.]*/gi,
  /promo\s*(?:terbatas|gajian|spesial|spesial\s*toko)[^\n.]*/gi,
  /dilarang\s*(?:copas|curi|copy|mengambil)\s*(?:deskripsi|gambar|foto)[^\n.]*/gi,
  /reseller\s*(?:welcome|dan\s*dropshipper)[^\n.]*/gi,
  /dropship\s*(?:aman|welcome)[^\n.]*/gi,
  /(?:alamat\s*toko|lokasi\s*toko|store\s*offline|toko\s*fisik)\s*[:\-]?\s*[^\n]+/gi,

  // Residual contact / CTA leads
  /(?:hubungi\s*cs(?:\s*kami)?|chat\s*admin|follow\s*(?:ig|instagram|kami)?|kunjungi\s*(?:toko|link)?|silakan\s*order)\b[^\n.]*/gi,
];

function sanitizeStoreNoise(text) {
  if (!text || typeof text !== 'string') return '';

  let cleaned = text;

  // 1. Remove URLs
  cleaned = cleaned.replace(URL_REGEX, '');

  // 2. Remove Emails
  cleaned = cleaned.replace(EMAIL_REGEX, '');

  // 3. Remove Phone numbers / WhatsApp
  cleaned = cleaned.replace(PHONE_REGEX, '');

  // 4. Remove Social handles
  cleaned = cleaned.replace(SOCIAL_HANDLE_REGEX, '');

  // 5. Apply noise line patterns
  for (const pattern of NOISE_PATTERNS) {
    cleaned = cleaned.replace(pattern, '');
  }

  // 6. Clean up line by line
  cleaned = cleaned
    .split('\n')
    .map(line => line.trim())
    .filter(line => {
      if (!line) return false;
      // Strip pure header or pure punctuation artifact lines
      if (STORE_HEADER_LINE_REGEX.test(line)) return false;
      if (/^[-*•#~=_:;,.|/\\()\s]+$/.test(line)) return false;
      // Strip lines that are just leftover fragments like "atau email" or "dan kunjungi"
      if (/^(?:dan|atau|serta|kunjungi|email|cs|wa|hubungi|follow)\s*[:;,.|/\-\s]*$/i.test(line)) return false;
      return true;
    })
    .join('\n');

  // 7. Collapse excessive consecutive newlines
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();

  return cleaned;
}

module.exports = {
  sanitizeStoreNoise,
};
