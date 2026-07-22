// Prepares Capacitor asset SOURCES from the app logo (public/logo.png, 1024x1024),
// then you run `capacitor-assets generate` to produce all iOS & Android icon sizes.
//
// This copies the already-committed logo into the assets/ folder that
// @capacitor/assets expects, so no binary icon files need to live in git.
//
// Usage (from frontend/):  npm run assets
import { mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const logo = join(root, 'public', 'logo.png'); // 1024x1024 StoryMax app logo (committed)
const assetsDir = join(root, 'assets');

if (!existsSync(logo)) {
  console.error('[prepare-icons] Missing frontend/public/logo.png (need a 1024x1024 PNG).');
  process.exit(1);
}

mkdirSync(assetsDir, { recursive: true });

// @capacitor/assets source files (all derived from the same full-bleed logo):
//  - icon-only.png       -> iOS icon + Android legacy icon (full-bleed)
//  - icon-foreground.png -> Android adaptive icon foreground
//  - icon-background.png -> Android adaptive icon background
//  - logo.png            -> universal fallback / splash source
const targets = ['icon-only.png', 'icon-foreground.png', 'icon-background.png', 'logo.png'];
for (const name of targets) {
  copyFileSync(logo, join(assetsDir, name));
}

console.log('[prepare-icons] Wrote assets/ from public/logo.png:', targets.join(', '));
console.log('[prepare-icons] Next: npx capacitor-assets generate   (then rebuild in Xcode / Android Studio)');
