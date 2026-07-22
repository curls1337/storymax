// Background handling + layout-stability clause for the sheet.
// Fix A2: the opening preamble is defined in ONE place. Templates no longer
//         repeat a near-identical "A professional ... sheet ..." sentence, so
//         buildEnhancedPrompt does not prepend a second one.
// Fix A4: styles that intentionally use a textured background (e.g. comic
//         grunge, hand-drawn concept sheets) are NOT forced to a "100% solid
//         flat" background, which previously contradicted their own art style.

const DARK_STYLES = [
  'cube_morph_product',
  'premium_vertical_row',
  'unboxing_cinematic_grid',
  'ugc_overlay_dark_table',
];

const TEXTURED_STYLES = [
  'comic_grunge_storyboard',
  'character_design_turnaround',
];

function backgroundFor(style) {
  if (TEXTURED_STYLES.includes(style)) return 'textured';
  return DARK_STYLES.includes(style) ? 'dark' : 'light';
}

function stabilityClause(style) {
  const bg = backgroundFor(style);
  if (bg === 'dark') {
    return "\nCRITICAL LAYOUT STABILITY REQUIREMENT: The background of the entire poster sheet MUST be a 100% solid flat dark-charcoal color. The action, visual elements, steam, glow, or colors described inside the widescreen panels MUST remain strictly contained within their respective panel borders and MUST NOT bleed, leak, or affect the surrounding dark-charcoal background, header, or text layout. The layout structure, dark borders, and header design MUST remain completely identical to the previous pages.";
  }
  if (bg === 'textured') {
    return "\nCRITICAL LAYOUT STABILITY REQUIREMENT: Keep the intended textured/hand-drawn art style consistent across the whole sheet, but the panel grid, borders, scene-number badges, and header layout MUST stay clean, aligned, and identical across pages. The action inside each panel MUST remain within its panel borders and MUST NOT cover the scene numbers or text.";
  }
  return "\nCRITICAL LAYOUT STABILITY REQUIREMENT: The background of the entire poster sheet MUST be a 100% solid flat clean white color. The action, visual elements, steam, glow, or colors described inside the widescreen panels MUST remain strictly contained within their respective panel borders and MUST NOT bleed, leak, or affect the surrounding white background, header, or text layout. The layout structure, clean borders, and header design MUST remain completely identical to the previous pages.";
}

module.exports = { DARK_STYLES, TEXTURED_STYLES, backgroundFor, stabilityClause };
