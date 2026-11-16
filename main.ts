// EMBERFALL v2 — entrypoint for the make.fun best-game-01 bounty (Node 22, stdlib only).
// Validates screenshots/ and game/ up front (FAIL FAST), then copies game/ and
// screenshots/ to the output directory and writes dossier.json with the vendored
// make.fun library. Run: `node main.ts` (or MAKEFUN_OUTPUT_DIR=out node main.ts).

import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const MAX_SCREENSHOT_BYTES = 262144;
const MIN_SCREENSHOTS = 3;
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg']);

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

// ---- FAIL FAST: validate everything BEFORE writing anything to the output dir ----
// v2 keeps the same gates as v1 (3+ screenshots, each <= 256 KiB, game/index.html
// present) so a broken hand-in fails here, never in the scorer.

const screenshotsDir = join(here, 'screenshots');
if (!existsSync(screenshotsDir) || !statSync(screenshotsDir).isDirectory()) {
  fail('screenshots/ is missing — add at least 3 screenshots (.png/.jpg/.jpeg, each <= 256 KiB).');
}
const images = readdirSync(screenshotsDir)
  .filter((name) => IMAGE_EXTENSIONS.has(name.slice(name.lastIndexOf('.')).toLowerCase()))
  .sort();
if (images.length < MIN_SCREENSHOTS) {
  fail(
    `screenshots/ holds ${images.length} image file(s); at least ${MIN_SCREENSHOTS} are required.`,
  );
}
for (const name of images) {
  const size = statSync(join(screenshotsDir, name)).size;
  if (size > MAX_SCREENSHOT_BYTES) {
    fail(`screenshots/${name} is ${size} bytes, over the 262144-byte limit.`);
  }
}

const indexHtml = join(here, 'game', 'index.html');
if (!existsSync(indexHtml)) {
  fail('game/index.html is missing — the game entrypoint is required.');
}

// ---- Copy game/ + screenshots/ and write the dossier ----

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
cpSync(screenshotsDir, join(out, 'screenshots'), { recursive: true });

// The scorer's own caps: only text_max_bytes shapes the bytes; the others refuse an
// entry the scorer would refuse (more than 4 screenshots or one over 256 KiB; more
// than 993 files in game/ or 48 MiB of game files, or a path under game/ over 1000
// bytes).
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  }),
);

console.log(`EMBERFALL v2 handed in: ${images.length} screenshot(s), dossier written to ${join(out, 'dossier.json')}`);
