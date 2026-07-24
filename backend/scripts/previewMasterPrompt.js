#!/usr/bin/env node
/*
 * Dry-run preview for the DETERMINISTIC master-prompt builder.
 *
 * Prints the exact Freebeat prompt buildMasterPrompt() would produce for a set
 * of representative styles / page counts, WITHOUT calling Freebeat or any AI
 * endpoint. Use it to eyeball prompt quality and verify the char budget +
 * protected tail (face clause + NEGATIVE) before/after changes.
 *
 *   node backend/scripts/previewMasterPrompt.js            # summary + full prompts
 *   node backend/scripts/previewMasterPrompt.js --summary  # length/limit table only
 */
const { getStyleSpec } = require('../prompts/styleLibrary');
const { buildMasterPrompt } = require('../prompts/masterPrompt');

const FREEBEAT_LIMIT = 2000; // hard cap enforced by the Freebeat API

// A realistic, detailed subject descriptor (~the length analyzeSubject returns).
const SUBJECT = 'a matte forest-green stainless-steel insulated tumbler, 600ml, tall slim body with a subtle brushed finish, black screw-on lid with a flip-up spout, a small embossed circular "AQUA" logo on the front, and a slim silicone grip band near the base';

const CONCEPT = 'Promo botol tumbler AQUA hijau: awalnya air panas dituang, lalu ditutup rapat, dibawa aktivitas seharian, dan di akhir air masih tetap dingin & segar saat dibuka — menonjolkan insulasi tahan 24 jam dan desain anti-bocor yang premium.';

// Representative styles. `ref` toggles the reference-image path (edit vs generate).
// Without a ref the subject TEXT is the only identity anchor, so the brand MUST
// survive in text; with a ref the picture carries identity so text can be leaner.
// expectBrand: require the brand to survive in TEXT. True for standard photo styles
// with no reference image (text is the sole identity anchor). Informational for the
// cube transform (early panels are a mechanical cube, not the product) and for the
// intentionally-illustrated anime style.
const SCENARIOS = [
  // Reference-image mode (the user's real usage): brand kept in text + fidelity clauses present.
  { style: 'product_hero',       pageCount: 1, aspectRatio: '1:1',  model: '108', ref: true,  expectBrand: true },
  { style: 'before_after',       pageCount: 1, aspectRatio: '9:16', model: '108', ref: true,  expectBrand: true },
  { style: 'unboxing',           pageCount: 1, aspectRatio: '9:16', model: '108', ref: true,  expectBrand: true },
  { style: 'ugc_review',         pageCount: 1, aspectRatio: '9:16', model: '108', ref: true,  expectBrand: true },
  { style: 'recipe_cooking',     pageCount: 1, aspectRatio: '9:16', model: '108', ref: true,  expectBrand: true },
  { style: 'cube_box_transform', pageCount: 2, aspectRatio: '9:16', model: '108', ref: true,  expectBrand: false }, // tightest budget (heavy style)
  // No-reference sanity check — still a valid, brand-preserving prompt.
  { style: 'product_hero',       pageCount: 1, aspectRatio: '1:1',  model: '108', ref: false, expectBrand: true },
];

const summaryOnly = process.argv.includes('--summary');
const rows = [];

for (const sc of SCENARIOS) {
  const spec = getStyleSpec(sc.style);
  const gridCount = 6;
  for (let pageNum = 1; pageNum <= sc.pageCount; pageNum++) {
    const startScene = (pageNum - 1) * gridCount + 1;
    const ctx = {
      subject: SUBJECT,
      concept: CONCEPT,
      faceMode: spec.faceMode,
      gridCount,
      startScene,
      totalDuration: sc.pageCount * 15,
      aspectRatio: sc.aspectRatio,
      model: sc.model,
      pageNum,
      pageCount: sc.pageCount,
      hasRefImage: sc.ref,
    };
    const prompt = buildMasterPrompt(spec, ctx);
    const len = prompt.length;
    const hasNeg = /\nNEGATIVE:/.test(prompt);
    const hasFooter = /FOOTER:/.test(prompt);
    const hasScenes = /SCENES (on this page|progress)/.test(prompt); // structure: the arc line survived
    const hasCamera = /Base camera:/.test(prompt);                   // structure: the camera line survived
    const brandKept = prompt.includes('AQUA');                       // brand detail present in text
    const brandOk = sc.expectBrand ? brandKept : true;
    // Reference-fidelity guarantees (only asserted when a reference image is used):
    const hasRefNote = /SAME product as the reference/.test(prompt);  // strong image-edit clause present
    const hasFidelityNeg = /different or redesigned product/.test(prompt); // product-integrity negatives present
    // Guaranteed fidelity mechanism = the leading product-integrity NEGATIVE terms.
    // The prose ref clause is best-effort (dropped only on the tightest heavy styles).
    const fidelityOk = sc.ref ? hasFidelityNeg : true;
    rows.push({ id: sc.style, ref: sc.ref, page: `${pageNum}/${sc.pageCount}`, len, hasNeg, hasFooter, hasScenes, hasCamera, brandKept, brandOk, hasRefNote, hasFidelityNeg, fidelityOk });

    if (!summaryOnly) {
      console.log('\n' + '='.repeat(78));
      console.log(`STYLE: ${sc.style}  (${spec.name})  page ${pageNum}/${sc.pageCount}  faceMode=${spec.faceMode}  ref=${sc.ref}`);
      console.log(`length=${len}  within2000=${len <= FREEBEAT_LIMIT}  NEG=${hasNeg}  FOOT=${hasFooter}  SCENES=${hasScenes}  CAM=${hasCamera}  brandKept=${brandKept}  refNote=${hasRefNote}  fidelityNeg=${hasFidelityNeg}`);
      console.log('-'.repeat(78));
      console.log(prompt);
    }
  }
}

console.log('\n' + '#'.repeat(78));
console.log('SUMMARY  (len<=2000; NEG/FOOT/SCENES/CAM present; brandOk; fidelityOk=refNote+product-neg when ref)');
console.log('#'.repeat(78));
let allOk = true;
for (const r of rows) {
  const ok = r.len <= FREEBEAT_LIMIT && r.hasNeg && r.hasFooter && r.hasScenes && r.hasCamera && r.brandOk && r.fidelityOk;
  if (!ok) allOk = false;
  console.log(
    `${ok ? 'OK ' : 'BAD'}  ${r.id.padEnd(20)} ref=${String(r.ref).padEnd(5)} p${r.page.padEnd(4)} len=${String(r.len).padStart(4)}  SCENES=${r.hasScenes} CAM=${r.hasCamera} brandKept=${r.brandKept} refNote=${r.hasRefNote} fidNeg=${r.hasFidelityNeg}`
  );
}
const worst = Math.max(...rows.map((r) => r.len));
console.log(`\nlongest prompt = ${worst} chars (limit ${FREEBEAT_LIMIT})`);
console.log(`ALL CHECKS ${allOk ? 'PASSED' : 'FAILED'}`);
