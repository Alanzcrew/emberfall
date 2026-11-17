// Emberfall v3 entrypoint (Node 22, standard library only).
// The game lives in this directory's game/ folder: plain static files a desktop
// browser loads offline (game/index.html and its ES modules, no library, no
// network request). This program hands it in: it copies game/ and screenshots/
// from beside this file to /output and writes /output/dossier.json, the summary
// the judge reads, with the vendored make.fun library.
//
// Before anything is written, the hand-in is checked against the kit's own
// gate (competition.yaml): screenshots/ must hold 3 to 4 PNG or JPEG shots,
// each no bigger than 256 KiB, and game/index.html must be a regular file no
// bigger than 1 MiB. A hand-in that falls short stops here with a plain error
// naming what is wrong, instead of shipping a broken entry.
//
// Serve it locally with `node serve.ts`, then open http://localhost:8080.
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Gate limits, taken from the kit's own requirements (competition.yaml).
const SHOT_MIN = 3;
const SHOT_MAX = 4;
const SHOT_MAX_BYTES = 262144; // 256 KiB
const INDEX_MAX_BYTES = 1048576; // 1 MiB
const SHOT_EXTS = new Set(['.png', '.jpg', '.jpeg']);

function fail(message: string): never {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

// Check the hand-in before any output is written. Returns the screenshot
// names, sorted, so the success line at the end can count them.
function checkHandIn(): string[] {
  const shotsDir = join(here, 'screenshots');
  if (!existsSync(shotsDir)) fail('screenshots/ is missing beside main.ts');

  const shots = readdirSync(shotsDir)
    .filter((name) => !name.startsWith('.'))
    .filter((name) => SHOT_EXTS.has(name.slice(name.lastIndexOf('.')).toLowerCase()))
    .sort();
  if (shots.length < SHOT_MIN) {
    fail(`screenshots/ holds ${shots.length} image(s), need at least ${SHOT_MIN}`);
  }
  if (shots.length > SHOT_MAX) {
    fail(`screenshots/ holds ${shots.length} image(s), at most ${SHOT_MAX} allowed`);
  }
  for (const name of shots) {
    const path = join(shotsDir, name);
    const info = statSync(path);
    if (!info.isFile()) fail(`screenshots/${name} is not a regular file`);
    if (info.size > SHOT_MAX_BYTES) {
      fail(`screenshots/${name} is ${info.size} bytes, over the ${SHOT_MAX_BYTES}-byte (256 KiB) limit`);
    }
  }

  const indexPath = join(here, 'game', 'index.html');
  if (!existsSync(indexPath)) fail('game/index.html is missing');
  const indexInfo = statSync(indexPath);
  if (!indexInfo.isFile()) fail('game/index.html is not a regular file');
  if (indexInfo.size > INDEX_MAX_BYTES) {
    fail(`game/index.html is ${indexInfo.size} bytes, over the ${INDEX_MAX_BYTES}-byte (1 MiB) limit`);
  }

  return shots;
}

const shots = checkHandIn();

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });

// The scorer's own caps (reference/gate.json): only text_max_bytes shapes the bytes; the others refuse an entry the
// scorer would refuse (more than 4 screenshots or one over 256 KiB; more than 993 files in game/ or 48 MiB of game
// files, in all, or a path under game/ over 1000 bytes: game/ counts beside /output's own 1000-entry cap, its
// screenshots/ and dossier.json).
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

console.log(`Handed in ${shots.length} screenshots to ${out}.`);
