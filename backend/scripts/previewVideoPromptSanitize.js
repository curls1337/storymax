#!/usr/bin/env node
/*
 * Offline verification for stripSpeechLeak (bug C): the image-to-video prompt must
 * be purely visual. Confirms leaked narration / VO / timecue text is removed while
 * legitimate camera/motion/atmosphere wording is preserved. No AI call.
 *   node backend/scripts/previewVideoPromptSanitize.js
 */
const { stripSpeechLeak } = require('../prompts/sanitizeVideoPrompt');

const CASES = [
  {
    name: 'Narrator label + quote',
    in: 'Slow cinematic push-in on the product. Narrator: "Beli sekarang sebelum kehabisan!" Subtle lens flare.',
    mustGo: /narrator|beli sekarang/i,
    mustKeep: ['push-in on the product', 'lens flare'],
  },
  {
    name: 'VO label',
    in: 'VO: hemat sampai 24 jam. Smooth camera orbit as panels unfold.',
    mustGo: /\bVO\b|hemat sampai/i,
    mustKeep: ['camera orbit', 'panels unfold'],
  },
  {
    name: 'Timing cues (parenthetical + at)',
    in: '(0-3s) camera tilts down, then at 3-6s a slow tracking shot across the scene.',
    mustGo: /\(0-3s\)|at 3-6s/i,
    mustKeep: ['camera tilts down', 'tracking shot'],
  },
  {
    name: 'narrator says phrasing',
    in: 'The narrator says "Segar sepanjang hari" while the camera slowly pans right over the table.',
    mustGo: /narrator says|segar sepanjang hari/i,
    mustKeep: ['camera slowly pans right'],
  },
  {
    name: 'Voiceover timing block',
    in: 'Handheld dolly-in. Voiceover timing: 0:00-0:05 intro line. Warm volumetric light.',
    mustGo: /voiceover timing|0:00-0:05|intro line/i,
    mustKeep: ['Handheld dolly-in', 'volumetric light'],
  },
  {
    name: 'Clean prompt (must be untouched in substance)',
    in: 'Slow orbit around the subject, shallow depth of field, gentle motion blur, cinematic haze.',
    mustGo: /narrator|voiceover|\bVO\b|\d-\d\s*s/i,
    mustKeep: ['Slow orbit around the subject', 'cinematic haze'],
  },
];

let allOk = true;
for (const c of CASES) {
  const out = stripSpeechLeak(c.in);
  const goneOk = !c.mustGo.test(out);
  const keptOk = c.mustKeep.every((k) => out.includes(k));
  const ok = goneOk && keptOk;
  if (!ok) allOk = false;
  console.log(`\n${ok ? 'OK ' : 'BAD'}  ${c.name}`);
  console.log(`   in : ${c.in}`);
  console.log(`   out: ${out}`);
  if (!goneOk) console.log(`   !! leaked text still present (matched ${c.mustGo})`);
  if (!keptOk) console.log(`   !! lost expected visual text: ${c.mustKeep.filter((k) => !out.includes(k)).join(' | ')}`);
}
console.log(`\n${'#'.repeat(60)}`);
console.log(`ALL CHECKS ${allOk ? 'PASSED' : 'FAILED'}`);
