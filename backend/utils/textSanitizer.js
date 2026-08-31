// textSanitizer.js
// Utility to clean e-commerce store noise (WhatsApp numbers, emails, store policies,
// unboxing video requirements, warranty claims, COD/free-shipping claims, social URLs, etc.)
// from user drafts, scraped Tokopedia text, and AI responses without destroying valid product specs.

const PHONE_REGEX = /(?:(?:wa|whatsapp|hubungi|call|telp|telepon|hp|chat[ \t]+admin|contact|cs|hotline)[ \t]*[:\-]?\s*)?(?:\+?62|08|02\d)[\s\-.]*(?:\d[\s\-.]*){7,13}\d/gi;
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const URL_REGEX = /https?:\/\/[^\s)]+/gi;

// Safe Social Handle Regex: Requires word-boundary \b and explicit separators/at-signs for short handles (ig/fb)
// to prevent false positives on valid words like "original", "digital", "design", "higienis", "signifikan", etc.
const SOCIAL_HANDLE_REGEX = /\b(?:instagram|tiktok|facebook|tokopedia|shopee|lazada|blibli)\b[ \t]*[:\-]?\s*@?[a-zA-Z0-9_.-]+|\b(?:ig|fb)\b[ \t]*[:\-]?\s*@[a-zA-Z0-9_.-]+|\b(?:ig|fb)\b[ \t]*[:\-]\s*@?[a-zA-Z0-9_.-]+/gi;

// Section header lines that indicate purely store/transactional sections
const STORE_HEADER_LINE_REGEX = /^(?:info[ \t]*toko|syarat[ \t]*(?:retur|garansi|komplain)|ketentuan[ \t]*(?:toko|garansi|retur)|kebijakan[ \t]*(?:toko|pengembalian)|catatan[ \t]*toko|jadwal[ \t]*operasional|kontak[ \t]*kami|layanan[ \t]*pelanggan|follow[ \t]*kami|media[ \t]*sosial|pengiriman[ \t]*&[ \t]*ongkir|perhatian|note|pemberitahuan)\b.*$/i;

const NOISE_PATTERNS = [
  // Video unboxing & complaint policies
  /(?:wajib|mohon|harus|tolong)?[ \t]*(?:membuat|ada|sertakan|lampirkan)?[ \t]*video[ \t]*unboxing[^\n.]*/gi,
  /(?:tidak[ \t]*(?:menerima|bisa)[ \t]*)?komplain[ \t]*(?:tanpa|wajib)[ \t]*video[^\n.]*/gi,
  /\bbintang[ \t]*[1-5][^\n.]*(?:garansi|hangus|blokir|auto[ \t]*block|komplain|ulasan|bintang)?[^\n.]*/gi,
  /\bsyarat[ \t]*(?:dan[ \t]*ketentuan[ \t]*)?(?:retur|klaim|garansi)[^\n.]*/gi,
  /\bkebijakan[ \t]*(?:retur|pengembalian|toko)[^\n.]*/gi,
  /\bongkir[ \t]*retur[ \t]*ditanggung[^\n.]*/gi,
  /\bretur[ \t]*barang[ \t]*(?:maksimal|syarat)[^\n.]*/gi,

  // Store warranties & claims
  /\b(?:ber)?garansi[ \t]*(?:resmi|toko|distributor|pabrik)?[ \t]*\d*[ \t]*(?:tahun|bulan|hari|bln|thn)?(?:[ \t]*klaim[^\n.]*)?/gi,
  /\bklaim[ \t]*garansi[ \t]*(?:mudah|resmi|langsung)[^\n.]*/gi,

  // Shipping & store operations
  /\b(?:pengiriman|kirim|dikirim)[ \t]*dari[ \t]*[a-zA-Z0-9 \t,.-]+(?=\n|$|\.)/gi,
  /\bjadwal[ \t]*pengiriman[^\n.]*/gi,
  /\bjam[ \t]*operasional(?:[ \t]*toko)?[^\n.]*/gi,
  /\bbuka[ \t]*toko[ \t]*senin[^\n.]*/gi,
  /\bsenin[ \t]*-[ \t]*(?:sabtu|minggu)[^\n.]*/gi,
  /\bkurir[ \t]*(?:toko|instan|sameday|cargo|anteraja|sicepat|jne|j&t)[^\n.]*/gi,
  /\bresi[ \t]*(?:otomatis|update[ \t]*malam)[^\n.]*/gi,
  /\bpickup[ \t]*(?:jam|pukul)?[ \t]*\d+[^\n.]*/gi,
  /\bready[ \t]*stock[ \t]*siap[ \t]*kirim[^\n.]*/gi,
  /\bstok[ \t]*ready[ \t]*silakan[ \t]*order[^\n.]*/gi,

  // Free shipping & COD
  /\b(?:gratis|free)[ \t]*ongkir(?:[ \t]*(?:ekstra|se-indonesia|seluruh[ \t]*indonesia|x-tra))?[^\n.]*/gi,
  /\b(?:bisa|melayani|support|fitur)?[ \t]*cod(?:[ \t]*(?:\/|atau)?[ \t]*bayar[ \t]*di[ \t]*tempat)?[^\n.]*/gi,
  /\bbayar[ \t]*di[ \t]*tempat[ \t]*(?:\(cod\))?[^\n.]*/gi,

  // Packaging info
  /\b(?:packing|paket)[ \t]*(?:aman|rapi|standar|ekstra|bubble[ \t]*wrap)[^\n.]*/gi,
  /\bfree[ \t]*(?:bubble[ \t]*wrap|kardus|dus|box[ \t]*tambahan)[^\n.]*/gi,
  /\b(?:sudah|free)?[ \t]*termasuk[ \t]*bubble[ \t]*wrap[^\n.]*/gi,
  /\btambahan[ \t]*bubble[ \t]*wrap[^\n.]*/gi,
  /\bbuble[ \t]*wrap[ \t]*tebal[^\n.]*/gi,

  // Marketplace CTAs & reseller notes
  /\bcheckout[ \t]*(?:sekarang|hari[ \t]*ini|yuk|juga)[^\n.]*/gi,
  /\bklik[ \t]*(?:keranjang[ \t]*kuning|beli[ \t]*sekarang|checkout|tombol[ \t]*beli)[^\n.]*/gi,
  /\bmasukkan[ \t]*keranjang[ \t]*belanja[^\n.]*/gi,
  /\bvoucher[ \t]*diskon[^\n.]*/gi,
  /\bcashback[ \t]*(?:ekstra|100%|jumbo|terbesar)[^\n.]*/gi,
  /\bflash[ \t]*sale[ \t]*(?:terbatas|hari[ \t]*ini)?[^\n.]*/gi,
  /\bdiskon[ \t]*kilat[^\n.]*/gi,
  /\bpromo[ \t]*(?:terbatas|gajian|spesial|spesial[ \t]*toko)[^\n.]*/gi,
  /\bdilarang[ \t]*(?:copas|curi|copy|mengambil)[ \t]*(?:deskripsi|gambar|foto)[^\n.]*/gi,
  /\breseller[ \t]*(?:welcome|dan[ \t]*dropshipper)[^\n.]*/gi,
  /\bdropship[ \t]*(?:aman|welcome)[^\n.]*/gi,
  /\b(?:alamat[ \t]*toko|lokasi[ \t]*toko|store[ \t]*offline|toko[ \t]*fisik)[ \t]*[:\-]?[ \t]*[^\n]+/gi,

  // Residual contact / CTA leads
  /\b(?:hubungi[ \t]*cs(?:[ \t]*kami)?|chat[ \t]*admin|follow[ \t]*(?:ig|instagram|kami)?|kunjungi[ \t]*(?:toko|link)?|silakan[ \t]*order)\b[^\n.]*/gi,
];

function sanitizeStoreNoise(text) {
  if (!text || typeof text !== 'string') return '';

  let cleaned = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

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
