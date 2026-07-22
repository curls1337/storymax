// Fix A7: the reference-image instruction is a single global clause appended
// once at the end of the prompt, instead of being injected into every panel's
// scene description (which wasted characters and buried the instruction).

function referenceClause(style, hasRefImage) {
  if (!hasRefImage) return '';

  if (style === 'cube_morph_product') {
    return "REFERENCE IMAGE: The reference image shows the main subject/product. Across all panels, accurately maintain its visual appearance, details, branding, and color. The first image prompt must show the mechanical cube customized with the colors and metallic theme of this product; the final image prompt must show the actual product itself.";
  }

  return "REFERENCE IMAGE: The reference image shows the main subject/product. Across all panels, accurately maintain its visual appearance, details, branding, and color. If the product in the reference image is red, keep it red; do not recolor it. Use the color yellow ONLY for labels, numbers, borders, and UI text elements outside the panels.";
}

module.exports = { referenceClause };
