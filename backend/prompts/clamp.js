// Clamp a prompt to a max length while preserving trailing CLI-style params
// (e.g. "--ar 3:4"). Fix A9: cut at the nearest sentence/word boundary instead
// of slicing mid-word.

function safeClampPrompt(promptStr, limit = 2000) {
  const trimmed = (promptStr || '').trim();
  if (trimmed.length <= limit) return trimmed;

  // Detect trailing parameter block so we never truncate it away.
  const paramRegex = /\s*(--ar\s+\d+:\d+|\s+--\S+(\s+\S+)?)*$/i;
  const match = trimmed.match(paramRegex);

  let suffix = '';
  let mainBody = trimmed;
  if (match && match[0].trim()) {
    suffix = ' ' + match[0].trim();
    mainBody = trimmed.substring(0, trimmed.length - match[0].length);
  }

  const allowedLength = Math.max(0, limit - suffix.length);
  let truncatedBody = mainBody.substring(0, allowedLength);

  // A9: prefer cutting at a sentence end, then a comma, then a space,
  // as long as we don't lose too much of the allowed budget.
  const boundary = Math.max(
    truncatedBody.lastIndexOf('. '),
    truncatedBody.lastIndexOf(', '),
    truncatedBody.lastIndexOf(' ')
  );
  if (boundary > allowedLength * 0.6) {
    truncatedBody = truncatedBody.substring(0, boundary);
  }

  return truncatedBody.trim() + suffix;
}

module.exports = { safeClampPrompt };
