// Shared Freebeat CLI helpers — removes the duplicated spawn-arg construction
// that previously lived in 3-4 places (B3).
const fs = require('fs');
const path = require('path');

// node_modules lives at backend/node_modules; this file is backend/services/freebeat/.
const localCliPath = path.join(__dirname, '..', '..', 'node_modules', 'freebeat-cli', 'dist', 'index.js');

function hasLocalCli() {
  return fs.existsSync(localCliPath);
}

// Base command + auth args for a freebeat invocation (local install or npx).
function resolveFreebeatBase(apiKey) {
  if (hasLocalCli()) {
    return { cmd: 'node', args: [localCliPath, '--api-key', apiKey] };
  }
  const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  return { cmd, args: ['-p', 'freebeat-cli', 'freebeat', '--api-key', apiKey] };
}

// Size/resolution args. For model 108 the real output size is set by
// --resolution; other models use --size <ratio>.
function freebeatSizeArgs(model, aspectRatio) {
  const ar = aspectRatio ? String(aspectRatio) : '1:1';
  if (String(model) === '108') {
    if (ar === '16:9') return ['--resolution', '1920x1088'];
    if (ar === '9:16') return ['--resolution', '1024x1536'];
    return ['--resolution', '1024x1024'];
  }
  return ['--size', ar];
}

module.exports = { localCliPath, hasLocalCli, resolveFreebeatBase, freebeatSizeArgs };
