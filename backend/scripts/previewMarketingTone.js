#!/usr/bin/env node
/*
 * Offline preview/verification for AI Marketing Copy tone (no AI call).
 * Confirms every style resolves to an appropriate, NON-salesy tone, that the built
 * system prompt injects the style name + tone + length caps, and that the old
 * hard-sell persona / hype example is gone.
 *
 *   node backend/scripts/previewMarketingTone.js           # table + one full prompt
 *   node backend/scripts/previewMarketingTone.js --full     # print every full prompt
 */
const { getStyleSpec } = require('../prompts/styleLibrary');
const { marketingToneFor, buildMarketingSystemPrompt, capText, DEFAULT_TONE } = require('../prompts/marketingTone');

const STYLES = [
  'asmr_satisfying', 'timelapse_process', 'tutorial_steps', 'recipe_cooking',
  'ugc_review', 'product_hero', 'luxury_mood', 'fashion_lookbook',
  'education_explainer', 'cube_box_transform', 'cube_morph_product' /* alias */, 'anime_comic',
];

const HYPE = [/high-converting/i, /premium, modern, and engaging/i, /Whoosh/, /viral video content/i];
const full = process.argv.includes('--full');
const rows = [];

for (const id of STYLES) {
  const spec = getStyleSpec(id);
  const tone = marketingToneFor(spec);
  const sys = buildMarketingSystemPrompt(spec, { titleMax: 80, descMax: 450 });

  const toneInjected = sys.includes(tone);
  const nameInjected = sys.includes(spec.name);
  const capsPresent = /MAX 80 characters/.test(sys) && /MAX 450 characters/.test(sys);
  const authentic = /authentic social-media copywriter/i.test(sys);
  const noHype = !HYPE.some((re) => re.test(sys));
  // Known styles should get a SPECIFIC tone (not the generic default).
  const specificTone = id === '__none__' ? true : tone !== DEFAULT_TONE;

  const ok = toneInjected && nameInjected && capsPresent && authentic && noHype && specificTone;
  rows.push({ id, name: spec.name, ok, specificTone });

  console.log('\n' + '='.repeat(80));
  console.log(`${id}  ->  ${spec.name}  [${spec.category}]`);
  console.log(`TONE: ${tone}`);
  if (full) { console.log('-'.repeat(80)); console.log(sys); }
}

// capText safeguard sanity
const longCap = capText('kata '.repeat(300), 600);
const capOk = longCap.length <= 600 && !longCap.endsWith('kat');

console.log('\n' + '#'.repeat(80));
console.log('SUMMARY  (toneInjected + styleName + caps 80/450 + authentic persona + no hype + specific tone)');
console.log('#'.repeat(80));
let allOk = true;
for (const r of rows) {
  if (!r.ok) allOk = false;
  console.log(`${r.ok ? 'OK ' : 'BAD'}  ${r.id.padEnd(22)} specificTone=${r.specificTone}  (${r.name})`);
}
console.log(`\ncapText safeguard (<=600, word boundary): ${capOk ? 'OK' : 'BAD'}`);
console.log(`ALL CHECKS ${allOk && capOk ? 'PASSED' : 'FAILED'}`);
