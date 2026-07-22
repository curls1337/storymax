// Registry of all storyboard style templates, keyed by style value.
// Fix A8: the default is an explicit alias to `premium_vertical_row` instead of
// a byte-for-byte duplicated branch.

const product = require('./product');
const creative = require('./creative');
const tutorial = require('./tutorial');
const ugc = require('./ugc');

const templates = {
  ...product,
  ...creative,
  ...tutorial,
  ...ugc,
};

// Explicit fallback for unknown / dead styles.
templates._default = product.premium_vertical_row;

module.exports = templates;
