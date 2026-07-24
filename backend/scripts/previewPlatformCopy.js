#!/usr/bin/env node
/*
 * Offline verification for per-platform marketing copy (point 5). No AI call.
 * Checks the system prompt injects the style tone + each platform's rules + JSON
 * shape, and that normalizePlatformCopy always yields all 4 platforms with caps.
 *   node backend/scripts/previewPlatformCopy.js
 */
const { getStyleSpec } = require('../prompts/styleLibrary');
const {
  buildPlatformCopySystemPrompt, normalizePlatformCopy, marketingToneFor,
  PLATFORMS, PRIMARY_PLATFORM,
} = require('../prompts/marketingTone');

let allOk = true;

// 1) System prompt construction across a few styles.
for (const id of ['asmr_satisfying', 'product_hero', 'recipe_cooking']) {
  const spec = getStyleSpec(id);
  const sys = buildPlatformCopySystemPrompt(spec);
  const checks = {
    tone: sys.includes(marketingToneFor(spec)),
    tiktok: /tiktok/i.test(sys) && /#fyp/i.test(sys),
    instagram: /instagram/i.test(sys),
    youtube: /youtube/i.test(sys) && /#Shorts/i.test(sys),
    facebook: /facebook/i.test(sys),
    styleName: sys.includes(spec.name),
    jsonShape: /"tiktok":\{"title"/.test(sys) && /"facebook":\{"title"/.test(sys),
  };
  const ok = Object.values(checks).every(Boolean);
  if (!ok) allOk = false;
  console.log(`${ok ? 'OK ' : 'BAD'}  systemPrompt[${id}]  ${JSON.stringify(checks)}`);
}

// 2) normalizePlatformCopy — full input.
const full = normalizePlatformCopy({
  tiktok: { title: 'Segar 24 jam', caption: 'Dingin seharian! #fyp #tumbler #aqua' },
  instagram: { title: 'Tetap dingin', caption: 'Bawa ke mana aja ✨ save dulu ya. #ootd #hydration #aqua #reels #fyp' },
  youtube: { title: 'Tumbler AQUA: Air Tetap Dingin 24 Jam?', caption: 'Uji ketahanan dingin tumbler AQUA. #Shorts #review' },
  facebook: { title: 'Anti tumpah', caption: 'Kalian tim air dingin atau hangat? Cerita dong. #aqua #tumbler' },
});
const fullOk = PLATFORMS.every((p) => full[p] && full[p].title && full[p].caption) && !!full[PRIMARY_PLATFORM];
console.log(`${fullOk ? 'OK ' : 'BAD'}  normalize(full) -> all 4 platforms populated; primary=${PRIMARY_PLATFORM}`);
if (!fullOk) allOk = false;

// 3) normalizePlatformCopy — partial/garbage input still yields all 4 keys.
const partial = normalizePlatformCopy({ tiktok: { caption: 'hook' }, youtube: {} });
const partialOk = PLATFORMS.every((p) => partial[p] && typeof partial[p].title === 'string' && typeof partial[p].caption === 'string');
console.log(`${partialOk ? 'OK ' : 'BAD'}  normalize(partial) -> all 4 keys present (missing filled empty)`);
if (!partialOk) allOk = false;

// 4) cap enforcement (long caption trimmed).
const long = normalizePlatformCopy({ tiktok: { title: 'x', caption: 'kata '.repeat(200) } });
const capOk = long.tiktok.caption.length <= 220;
console.log(`${capOk ? 'OK ' : 'BAD'}  normalize caps TikTok caption (${long.tiktok.caption.length} <= 220)`);
if (!capOk) allOk = false;

console.log(`\n${'#'.repeat(60)}\nALL CHECKS ${allOk ? 'PASSED' : 'FAILED'}`);
