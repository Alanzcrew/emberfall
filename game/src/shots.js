// EMBERFALL screenshot scenes — autopilot staging for ?shot= start/play/levelup/end.
// No DOM: stageShot drives the pure world with scripted input and returns the
// screen the renderer should paint plus the best score to display.
import { SCREEN_TITLE, SCREEN_PLAY, SCREEN_LEVELUP, SCREEN_OVER } from './render.js';
import { STEP } from './config.js';

const NEUTRAL_INPUT = { mx: 0, my: 0, ax: 1, ay: 0, firing: false };

function nearest(list, x, y) {
  let best = null;
  let bestD = Infinity;
  for (const item of list || []) {
    if (item == null || item.x == null) continue;
    const dx = item.x - x;
    const dy = item.y - y;
    const d = Math.hypot(dx, dy);
    if (d < bestD) {
      bestD = d;
      best = item;
    }
  }
  return best == null ? null : { item: best, dist: bestD };
}

function norm(x, y) {
  const len = Math.hypot(x, y);
  if (len < 0.0001) return { x: 0, y: 0 };
  return { x: x / len, y: y / len };
}

// The SPEC autopilot. Normal mode: flee the nearest enemy inside 140px, else
// chase the nearest gem inside 260px, else drift to the centre; aim at the
// nearest enemy and fire while any enemy is inside 560px. Weak mode (end
// scene): no fleeing, always chase gems, fire only inside 200px.
function autopilotInput(state, weak) {
  const p = state.player || {};
  const px = p.x == null ? 640 : p.x;
  const py = p.y == null ? 360 : p.y;

  const foe = nearest(state.enemies, px, py);
  const gem = nearest(state.gems, px, py);

  let mx = 0;
  let my = 0;
  if (!weak && foe && foe.dist < 140) {
    // Run directly away from the threat.
    const away = norm(px - foe.item.x, py - foe.item.y);
    mx = away.x;
    my = away.y;
  } else if (gem && (weak || gem.dist < 260)) {
    const to = norm(gem.item.x - px, gem.item.y - py);
    mx = to.x;
    my = to.y;
  } else {
    // Drift back to the middle of the arena.
    const to = norm(640 - px, 360 - py);
    mx = to.x;
    my = to.y;
  }

  let ax = 1;
  let ay = 0;
  if (foe) {
    const aim = norm(foe.item.x - px, foe.item.y - py);
    ax = aim.x;
    ay = aim.y;
  } else if (mx !== 0 || my !== 0) {
    ax = mx;
    ay = my;
  }

  const fireRange = weak ? 200 : 560;
  const firing = !!(foe && foe.dist < fireRange);
  return { mx, my, ax, ay, firing };
}

function stepN(world, n, inputFn, attract) {
  for (let i = 0; i < n; i += 1) {
    const input = inputFn ? inputFn(world.state) : NEUTRAL_INPUT;
    world.step(STEP, input, !!attract);
  }
}

export function stageShot(name, world) {
  if (name === 'start') {
    world.reset();
    stepN(world, Math.round(5 / STEP), null, true);
    return { screen: SCREEN_TITLE, best: 0 };
  }

  if (name === 'play') {
    // ~30s of real play. If the autopilot dies early (unlucky surround),
    // reset and try again so the staged scene is a live fight, not a corpse.
    const total = Math.round(30 / STEP);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      world.reset();
      let survived = true;
      for (let i = 0; i < total; i += 1) {
        world.step(STEP, autopilotInput(world.state, false), false);
        if (world.state.over) {
          survived = false;
          break;
        }
        // Keep the fight running through level-ups: a world that pauses
        // stepping while a choice is pending would otherwise freeze here.
        if (world.state.levelUpPending && typeof world.chooseUpgrade === 'function') {
          world.chooseUpgrade(0);
        }
      }
      if (survived) break;
    }
    return { screen: SCREEN_PLAY, best: world.state.score || 0 };
  }

  if (name === 'levelup') {
    // Autopilot until the first level-up. Retry from a fresh reset if the
    // keeper dies before earning enough XP (keeps the staged scene valid).
    const cap = Math.round(300 / STEP);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      world.reset();
      for (let i = 0; i < cap; i += 1) {
        world.step(STEP, autopilotInput(world.state, false), false);
        if (world.state.levelUpPending || world.state.over) break;
      }
      if (world.state.levelUpPending) break;
    }
    return { screen: SCREEN_LEVELUP, best: world.state.score || 0 };
  }

  if (name === 'end') {
    world.reset();
    const cap = Math.round(600 / STEP);
    for (let i = 0; i < cap; i += 1) {
      world.step(STEP, autopilotInput(world.state, true), false);
      if (world.state.over) break;
      // Auto-pick the first ember so a level-up never stalls the death run.
      if (world.state.levelUpPending && typeof world.chooseUpgrade === 'function') {
        world.chooseUpgrade(0);
      }
    }
    return { screen: SCREEN_OVER, best: world.state.score || 0 };
  }

  // Unknown shot name: fall back to the title scene.
  world.reset();
  stepN(world, Math.round(5 / STEP), null, true);
  return { screen: SCREEN_TITLE, best: 0 };
}
