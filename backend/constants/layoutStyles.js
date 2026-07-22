// Canonical backend style list — derived from the Style Spec library so there is
// ONE source of truth. Shape { value, label, desc } kept for aiController.writePrompt.
const { listStyles } = require('../prompts/styleLibrary');

module.exports = listStyles().map((s) => ({ value: s.id, label: s.name, desc: s.desc }));
