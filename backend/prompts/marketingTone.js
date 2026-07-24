// Style-aware tone guidance for AI Marketing Copy (social captions for TikTok /
// Reels / Shorts / Facebook). Previously only the transformation styles got a rule
// and every other style fell back to a generic "high-converting viral ad" persona,
// which made ASMR / timelapse / tutorial / etc. captions sound salesy and off-vibe,
// and the description had no length cap. This module resolves a per-style tone and
// builds a system prompt that keeps captions authentic and concise.

// Coarse fallback per styleLibrary category.
const TONE_BY_CATEGORY = {
  'Transformasi & Reveal': 'Nada takjub & memuaskan pada momen reveal/transformasi — tonjolkan sensasi visual "oddly satisfying"-nya, BUKAN iklan jualan.',
  'UGC & Social': 'Nada autentik, personal, dan santai — seperti kreator asli yang berbagi (sudut orang pertama). Hindari bahasa korporat/iklan.',
  'Proses & Edukasi': 'Nada membantu & informatif — tonjolkan proses/langkah yang bikin penasaran atau tips yang layak disimpan. Ringan, jelas, tidak menjual.',
  'Sinematik & Branding': 'Nada sinematik, aspiratif, dan menggugah mood — kesan premium dan berkelas.',
  'Artistik / Niche': 'Nada artistik & estetik yang memikat — utamakan pengalaman sensorik/visual, bukan promosi.',
};

// Fine-grained per-style overrides where the category is too coarse.
const TONE_BY_STYLE = {
  asmr_satisfying: 'ASMR: nada tenang, lembut, sensorik; tekankan suara & tekstur yang memuaskan/menenangkan. Tanpa hype & tanpa seruan jualan.',
  asmr_toy_transform: 'ASMR transformasi: tenang & memuaskan; suara mekanis klik-klik yang satisfying, kamera diam. Minim hype.',
  timelapse_process: 'Timelapse: rasa penasaran melihat proses "dari nol jadi jadi"; cepat & memuaskan. Ajak menonton sampai akhir.',
  recipe_cooking: 'Kuliner: menggugah selera; cue rasa, aroma, dan tekstur yang bikin lapar. Cocok food content.',
  tutorial_steps: 'Tutorial: membantu & to-the-point; framing "cara/langkah", layak disimpan & dibagikan.',
  diy_build: 'DIY: membantu & seru; kepuasan merakit/membuat sendiri; layak disimpan.',
  education_explainer: 'Edukasi: jelas & mencerahkan; satu insight menarik; tidak menggurui, tidak menjual.',
  ugc_review: 'Review UGC: jujur & personal; kesan asli pemakai, relatable. Bukan iklan.',
  pov: 'POV: imersif orang-pertama; ajak penonton "ngerasain sendiri". Santai & relatable.',
  talking_head: 'Talking-head: ngobrol langsung ke penonton, hangat & meyakinkan tanpa terkesan iklan.',
  grwm: 'GRWM: santai & personal seperti rutinitas sehari-hari; relatable.',
  skit_meme: 'Skit/meme: lucu, relatable, punchy; nada komedi ringan.',
  product_hero: 'Product hero: premium & aspiratif; sorot keindahan produk secara elegan.',
  luxury_mood: 'Luxury: mewah, eksklusif, dramatis; sedikit kata, penuh gengsi.',
  fashion_lookbook: 'Fashion: gaya/OOTD editorial; percaya diri & estetik.',
  before_after: 'Before/After: tonjolkan hasil perubahan yang meyakinkan; relatable & jadi bukti nyata.',
  unboxing: 'Unboxing: excitement momen membuka & first impression; penasaran isi dan detailnya.',
  short_story: 'Cerita sinematik: emosional & naratif; buka dengan hook cerita, bukan iklan langsung.',
  cinematic_broll: 'B-roll sinematik: estetik & atmosferik; utamakan mood, bukan pitch jualan.',
  anime_comic: 'Komik/anime: energi karakter & cerita; playful atau dramatis sesuai panel.',
  stop_motion: 'Stop-motion: playful & handmade; pesona gerak frame-by-frame.',
  tiny_world: 'Miniatur/tiny world: menggemaskan & imajinatif; skala mini yang bikin gemas.',
};

const DEFAULT_TONE = 'Nada engaging namun AUTENTIK sesuai isi video; hindari klise iklan kecuali konsepnya memang promosi.';

function marketingToneFor(spec = {}) {
  return TONE_BY_STYLE[spec.id] || TONE_BY_CATEGORY[spec.category] || DEFAULT_TONE;
}

// Builds the system prompt for the marketing-copy LLM call. Pure & exported so it
// can be unit-previewed offline (no AI call).
function buildMarketingSystemPrompt(spec = {}, opts = {}) {
  const titleMax = opts.titleMax || 80;
  const descMax = opts.descMax || 450;
  const tone = marketingToneFor(spec);
  const name = spec.name || 'Standard';
  const desc = spec.desc ? ` — ${spec.desc}` : '';
  return `You are an authentic social-media copywriter for short-form video (TikTok, Instagram Reels/Feed, YouTube Shorts, Facebook). Write copy that MATCHES the video's real vibe — natural and scroll-stopping, NOT a hard-sell ad.

VIDEO STYLE: "${name}"${desc}
TONE (MUST follow): ${tone}

Return EXACTLY raw JSON with two keys:
1. "title": a short, catchy title that fits the TONE (MAX ${titleMax} characters, at most 1-2 emoji, no ALL-CAPS spam).
2. "description": a concise social caption (MAX ${descMax} characters TOTAL, hashtags included) — 1-3 short lines that match the TONE, then 5-8 relevant hashtags tied to the ACTUAL subject + style. Add at most ONE light call-to-engagement (a question/invite) and ONLY if it suits the style (e.g. skip it for calm ASMR). Keep it scannable: NO long paragraphs, NO generic ad clichés, NO invented product claims/prices.

The response language MUST match the storyboard/voiceover language (default: Indonesian). Sound like a real creator, not a brand press release.

Return ONLY raw JSON (no markdown fences). Shape (adapt tone/'#'-tags to THIS video):
{"title":"...","description":"...\\n\\n#tag1 #tag2 #tag3"}`;
}

// Belt-and-suspenders: keep the caption within a hard ceiling even if the model
// overshoots the target, trimming at a word boundary (never mid-word).
function capText(s, max) {
  if (!s || s.length <= max) return s;
  const cut = s.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return (sp > max - 140 ? cut.slice(0, sp) : cut).trim();
}

module.exports = { marketingToneFor, buildMarketingSystemPrompt, capText, TONE_BY_CATEGORY, TONE_BY_STYLE, DEFAULT_TONE };
