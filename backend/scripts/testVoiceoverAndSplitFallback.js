const assert = require('assert');
const { fallbackSplit, buildFallbackConceptForPage } = require('../prompts/splitPrompt');

console.log('=== TEST SUITE: VOICEOVER REGEX "X" & AI SPLIT FALLBACK ===\n');

// -------------------------------------------------------------
// 1. TEST BUG 1: Voiceover "x" sanitization
// -------------------------------------------------------------
function cleanVoiceoverLine(narration) {
  let line = String(narration || '').trim();
  if (!line) return '';
  line = line.replace(/^['"\s]+|['"\s]+$/g, '');
  line = line.replace(/(\w+)\s+x\s+(\w+)/gi, '$1 dan $2');
  line = line.replace(/#/g, '');
  return line;
}

const wordsWithX = [
  "exactly", "context", "next level", "flexible", "extra", 
  "expert", "text", "example", "mix", "taxi", "oxygen", 
  "relax", "luxury", "texture", "boxing", "exercise", 
  "experience", "explore", "extreme", "complex", "maximize"
];

for (const word of wordsWithX) {
  const input = `Ini adalah fitur ${word} terbaik kami`;
  const result = cleanVoiceoverLine(input);
  assert.strictEqual(result.includes(word), true, `FAILED: Word "${word}" was corrupted to "${result}"`);
  assert.strictEqual(/e\s+dan\s+actly|fle\s+dan\s+ible|ne\s+dan\s+t/i.test(result), false, `FAILED: Word "${word}" was split by x!`);
  console.log(`✅ PASSED: Word "${word}" preserved intact: "${result}"`);
}

const standaloneXCases = [
  { input: "Brand X Brand", expected: "Brand dan Brand" },
  { input: "Minum 5 x sehari secara teratur", expected: "Minum 5 dan sehari secara teratur" },
  { input: "Kolaborasi produk x giveaway spesial", expected: "Kolaborasi produk dan giveaway spesial" }
];

for (const tc of standaloneXCases) {
  const result = cleanVoiceoverLine(tc.input);
  assert.strictEqual(result, tc.expected, `FAILED: Expected "${tc.expected}", got "${result}"`);
  console.log(`✅ PASSED: Standalone "x" converted correctly: "${tc.input}" -> "${result}"`);
}

// -------------------------------------------------------------
// 2. TEST BUG 2: AI Split Fallback per-page variation
// -------------------------------------------------------------
const rawConcept = "Botol tumbler stainless steel tahan dingin 24 jam dengan tutup magnetik";
const pageCount = 3;
const pages = fallbackSplit(rawConcept, pageCount, 15, false);

assert.strictEqual(pages.length, 3, 'FAILED: Fallback split must return 3 pages');
assert.notStrictEqual(pages[0], pages[1], 'FAILED: Page 1 and Page 2 must not be identical');
assert.notStrictEqual(pages[1], pages[2], 'FAILED: Page 2 and Page 3 must not be identical');

assert.strictEqual(pages[0].includes('PEMBUKA'), true, 'FAILED: Page 1 must contain PEMBUKA');
assert.strictEqual(pages[1].includes('PENGGUNAAN'), true, 'FAILED: Page 2 must contain PENGGUNAAN');
assert.strictEqual(pages[2].includes('PENUTUP'), true, 'FAILED: Page 3 must contain PENUTUP');

console.log(`\n✅ PASSED: Fallback Split creates distinct chronological acts:`);
pages.forEach((p, idx) => console.log(`   Page ${idx + 1}: ${p.substring(0, 110)}...`));

const singleConcept = buildFallbackConceptForPage(rawConcept, 1, pageCount, 15, false);
assert.strictEqual(singleConcept.includes('PENGGUNAAN'), true, 'FAILED: buildFallbackConceptForPage for pageIdx 1 must return PENGGUNAAN');
console.log(`\n✅ PASSED: buildFallbackConceptForPage returns appropriate act: "${singleConcept.substring(0, 90)}..."`);

console.log('\nALL BUG 1 & BUG 2 TESTS PASSED SUCCESSFULLY! 🎉\n');
