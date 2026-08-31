#!/usr/bin/env node
/*
 * Dry-run preview for the DETERMINISTIC master-prompt builder.
 *
 * Prints the exact prompt buildMasterPrompt() produces for a set
 * of representative styles / page counts, WITHOUT calling Freebeat or any AI
 * endpoint. Verifies char budget, positive rendering constraints, and continuity.
 *
 *   node backend/scripts/previewMasterPrompt.js            # summary + full prompts
 *   node backend/scripts/previewMasterPrompt.js --summary  # length/limit table only
 */
const { getStyleSpec } = require('../prompts/styleLibrary');
const { buildMasterPrompt } = require('../prompts/masterPrompt');

const FREEBEAT_LIMIT = 2000; // hard cap enforced by Freebeat / GPT Image APIs

const SUBJECT = 'an "AQUA" matte forest-green stainless-steel insulated tumbler, 600ml, with a subtle brushed finish, black screw-on lid with a flip-up spout, an embossed circular "AQUA" logo on the front, and a slim silicone grip band near the base';

const CONCEPT = 'Promo botol tumbler AQUA hijau: awalnya air panas dituang, lalu ditutup rapat, dibawa aktivitas seharian, dan di akhir air masih tetap dingin & segar saat dibuka — menonjolkan insulasi tahan 24 jam dan desain anti-bocor yang premium.';

const SCENARIOS = [
  { style: 'product_hero',          pageCount: 1, aspectRatio: '1:1',  model: '108', ref: true,  expectBrand: true },  // 15s, 1 page
  { style: 'before_after',          pageCount: 2, aspectRatio: '9:16', model: '108', ref: true,  expectBrand: true },  // 30s, 2 pages (continuous)
  { style: 'ugc_review',            pageCount: 3, aspectRatio: '9:16', model: '108', ref: true,  expectBrand: true },  // 45s, 3 pages (continuous)
  { style: 'unboxing',              pageCount: 4, aspectRatio: '9:16', model: '108', ref: true,  expectBrand: true },  // 60s, 4 pages (continuous)
  { style: 'recipe_cooking',        pageCount: 1, aspectRatio: '9:16', model: '108', ref: true,  expectBrand: true },
  { style: 'cube_box_transform',    pageCount: 4, aspectRatio: '9:16', model: '108', ref: true,  expectBrand: false }, // heaviest style, 60s
  { style: 'product_hero',          pageCount: 1, aspectRatio: '1:1',  model: '108', ref: false, expectBrand: true },  // no-ref sanity
  { style: 'premium_vertical_row',  pageCount: 2, aspectRatio: '9:16', model: '108', ref: true,  expectBrand: true },
  { style: 'social_lifestyle',      pageCount: 2, aspectRatio: '9:16', model: '108', ref: false, expectBrand: false }, // independentScenes = true
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
      secondsPerPage: 15,
    };
    const prompt = buildMasterPrompt(spec, ctx);
    const len = prompt.length;
    const hasConstraints = /\nRENDERING QUALITY & CONSTRAINTS:/.test(prompt);
    const noLiteralNegative = !/\nNEGATIVE:/.test(prompt);
    const hasFooter = /FOOTER:/.test(prompt);
    const hasScenes = /SCENES on this page|SCENES progress/.test(prompt);
    const hasCamera = /Base camera:/.test(prompt);
    const brandKept = prompt.includes('AQUA');
    const brandOk = sc.expectBrand ? brandKept : true;
    const hasFidelityConstraint = /100% exact product fidelity|Maintain 100% physical fidelity|recognizable|identical product features/i.test(prompt);
    const fidelityOk = sc.ref ? hasFidelityConstraint : true;
    const expWindow = `'TIME ${(pageNum - 1) * 15}-${pageNum * 15}s'`;
    const hasWindow = prompt.includes(expWindow);
    
    // Check correct continuity mode based on spec.independentScenes
    const isIndependent = !!spec.independentScenes;
    const hasCorrectScope = sc.pageCount > 1
      ? (isIndependent
          ? prompt.includes('Standalone moment for SAME character') && prompt.includes('Keep SAME character identity 100% consistent')
          : (pageNum === 1
              ? prompt.includes('START of sequence') && prompt.includes('Keep SAME setting, lighting, wardrobe & palette')
              : prompt.includes(`DIRECT CONTINUATION from Page ${pageNum - 1}`) && prompt.includes('Keep SAME setting, lighting, wardrobe & palette')))
      : true;

    const seqOk = sc.pageCount > 1 ? (hasWindow && hasCorrectScope) : !prompt.includes("'TIME ");

    rows.push({
      id: sc.style,
      ref: sc.ref,
      page: `${pageNum}/${sc.pageCount}`,
      independent: isIndependent,
      len,
      hasConstraints,
      noLiteralNegative,
      hasFooter,
      hasScenes,
      hasCamera,
      brandKept,
      brandOk,
      hasFidelityConstraint,
      fidelityOk,
      hasWindow,
      hasCorrectScope,
      seqOk,
    });

    if (!summaryOnly) {
      console.log('\n' + '='.repeat(78));
      console.log(`STYLE: ${sc.style}  (${spec.name})  page ${pageNum}/${sc.pageCount}  faceMode=${spec.faceMode}  ref=${sc.ref}  independent=${isIndependent}`);
      console.log(`length=${len}  within2000=${len <= FREEBEAT_LIMIT}  CONSTRAINTS=${hasConstraints}  NO_LITERAL_NEG=${noLiteralNegative}  FOOT=${hasFooter}  SCENES=${hasScenes}  CAM=${hasCamera}  brandKept=${brandKept}`);
      console.log('-'.repeat(78));
      console.log(prompt);
    }
  }
}

console.log('\n' + '#'.repeat(78));
console.log('SUMMARY  (len<=2000; CONSTRAINTS/NO_NEG/FOOT/SCENES/CAM; brandOk; fidelityOk; seqOk (continuous vs independent))');
console.log('#'.repeat(78));
let allOk = true;
for (const r of rows) {
  const ok = r.len <= FREEBEAT_LIMIT && r.hasConstraints && r.noLiteralNegative && r.hasFooter && r.hasScenes && r.hasCamera && r.brandOk && r.fidelityOk && r.seqOk;
  if (!ok) allOk = false;
  console.log(
    `${ok ? 'OK ' : 'BAD'}  ${r.id.padEnd(22)} ref=${String(r.ref).padEnd(5)} p${r.page.padEnd(4)} len=${String(r.len).padStart(4)} indep=${String(r.independent).padEnd(5)} SCENES=${r.hasScenes} scopeOk=${r.hasCorrectScope} constr=${r.hasConstraints} noNeg=${r.noLiteralNegative}`
  );
}
const worst = Math.max(...rows.map((r) => r.len));
console.log(`\nlongest prompt = ${worst} chars (limit ${FREEBEAT_LIMIT})`);
console.log(`ALL CHECKS ${allOk ? 'PASSED' : 'FAILED'}`);
