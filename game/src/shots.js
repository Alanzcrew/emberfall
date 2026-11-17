// EMBERFALL v3 — screenshot staging + the headless autopilot.
//
// stageShot(name, world) drives the world into a scene and returns the
// screen that scene belongs to, so the sim and the screenshot harness share
// one definition of "the play scene".
//
// autopilot(state) is the SAME core policy v2 was measured with — flee the
// nearest foe inside 140px, chase gems inside 420px, drift to the centre
// otherwise, fire at anything inside 560px, dash out of a dasher windup or
// a close brute/boss — extended only where v3 adds a threat or a tool the
// policy must understand (chargers, stalkers, menders, shrines, hearts).
// The race script runs this one function against both worlds, so a v3 win
// is a win of the game, not of the driver.

import { STEP } from './config.js';
import { SCREEN_TITLE, SCREEN_PLAY, SCREEN_LEVELUP, SCREEN_OVER } from './render.js';

function nearest(list, x, y) {
  let best = null; let bestD = Infinity;
  for (const it of list || []) {
    const d = Math.hypot(it.x - x, it.y - y);
    if (d < bestD) { bestD = d; best = it; }
  }
  return best ? { item: best, dist: bestD } : null;
}

function norm(x, y) {
  const l = Math.hypot(x, y) || 1;
  return { x: x / l, y: y / l };
}

export function autopilot(state) {
  const p = state.player;
  const foe = nearest(state.enemies, p.x, p.y);
  const gem = nearest(state.gems, p.x, p.y);
  const heart = nearest(state.hearts, p.x, p.y);
  const shrine = state.shrine && !state.shrine.claimed ? state.shrine : null;
  let mx = 0; let my = 0;

  // Threats first: anything winding up a big hit gets fled, not fought.
  const threat = foe && (
    (foe.item.type === 'charger' && foe.item.mode === 'aim' && foe.dist < 340)
    || (foe.item.type === 'stalker' && !foe.item.visible && foe.dist < 150)
    || (foe.item.type === 'dasher' && foe.item.mode === 'windup' && foe.dist < 220)
  );
  if (foe && foe.dist < 140 && !threat) {
    const a = norm(p.x - foe.item.x, p.y - foe.item.y);
    mx = a.x; my = a.y;
  } else if (threat) {
    // Sidestep: run perpendicular to the incoming lane/lunge.
    const f = foe.item;
    const along = f.type === 'charger'
      ? norm(f.lockX - f.x, f.lockY - f.y)
      : norm(f.x - p.x, f.y - p.y);
    const side = Math.abs(along.x) > Math.abs(along.y)
      ? { x: 0, y: along.x > 0 ? 1 : -1 }
      : { x: along.y > 0 ? 1 : -1, y: 0 };
    mx = side.x; my = side.y;
  } else if (heart && p.hp < p.maxHp * 0.6 && heart.dist < 320) {
    const a = norm(heart.item.x - p.x, heart.item.y - p.y);
    mx = a.x; my = a.y;
  } else if (shrine && foe && foe.dist > 260 && p.hp < p.maxHp * 0.85) {
    const a = norm(shrine.x - p.x, shrine.y - p.y);
    mx = a.x; my = a.y;
  } else if (shrine && !foe && p.hp < p.maxHp * 0.85) {
    const a = norm(shrine.x - p.x, shrine.y - p.y);
    mx = a.x; my = a.y;
  } else if (gem && gem.dist < 420) {
    const a = norm(gem.item.x - p.x, gem.item.y - p.y);
    mx = a.x; my = a.y;
  } else {
    const a = norm(640 - p.x, 360 - p.y);
    mx = a.x; my = a.y;
  }

  // Aim: menders first (they undo your work), then the boss, then nearest.
  let ax = 1; let ay = 0;
  const mender = (state.enemies || []).find((e) => e.type === 'mender' && e.hp > 0);
  const boss = state.boss;
  const target = (mender && dist0(mender, p) < 560 ? mender : null)
    || (boss && boss.hp > 0 ? boss : null)
    || (foe ? foe.item : null);
  if (target) {
    const a = norm(target.x - p.x, target.y - p.y);
    ax = a.x; ay = a.y;
  }

  let dash = false;
  // v3 tracks dash charges; v2 tracks a cooldown — the policy reads
  // whichever the world provides, so one driver races both games.
  const dashReady = p.dashCharges !== undefined
    ? p.dashCharges > 0
    : p.dashCooldown <= 0;
  if (foe && dashReady) {
    const f = foe.item;
    if (f.type === 'dasher' && f.mode === 'windup' && foe.dist < 220) dash = true;
    if ((f.type === 'brute' || f.type === 'gloomlord' || f.type === 'matriarch')
      && foe.dist < 70 + (f.radius || 0)) dash = true;
    if (f.type === 'charger' && f.mode === 'aim' && foe.dist < 170) dash = true;
    if (f.type === 'stalker' && f.mode === 'lunge' && foe.dist < 130) dash = true;
  }
  return {
    mx, my, ax, ay,
    firing: !!(foe && foe.dist < 560),
    dash,
  };
}

function dist0(e, p) {
  return Math.hypot(e.x - p.x, e.y - p.y);
}

function runSteps(world, seconds, picker) {
  const n = Math.round(seconds / STEP);
  for (let i = 0; i < n; i++) {
    world.step(STEP, autopilot(world.state), false);
    if (world.state.levelUpPending && picker) world.chooseUpgrade(picker(world.state));
    if (world.state.relicPending && picker) world.chooseRelic(picker(world.state));
    if (world.state.over) break;
  }
  return world.state;
}

/**
 * Drive `world` into a named scene. Returns the screen constant the
 * renderer should draw. The world is reset first, so staging is repeatable.
 */
export function stageShot(name, world) {
  world.reset();
  const s = world.state;
  if (name === 'start') {
    return SCREEN_TITLE;
  }
  if (name === 'play') {
    // Mid-fight, wave 3+, with a busy frame: at least 6 foes live.
    let guard = 0;
    while (guard++ < 7200) {
      world.step(STEP, autopilot(s), false);
      if (s.levelUpPending) world.chooseUpgrade(0);
      if (s.relicPending) world.chooseRelic(0);
      if (s.over) break;
      if (s.wave >= 3 && s.waveState === 'active' && s.enemies.length >= 6) break;
    }
    return SCREEN_PLAY;
  }
  if (name === 'levelup') {
    let guard = 0;
    while (!s.levelUpPending && !s.over && guard++ < 3600) {
      world.step(STEP, autopilot(s), false);
    }
    return SCREEN_LEVELUP;
  }
  if (name === 'end') {
    runSteps(world, 420, () => 0);
    if (!s.over) {
      // The keeper survived the whole staging window: end the run the
      // honest way — wounded, shieldless, Second Wind spent, with the
      // next wave's crawlers already on top of them. The next step's
      // normal contact damage finishes the run, so the run-stats screen
      // shows a real time survived.
      for (let attempt = 0; attempt < 3 && !s.over; attempt++) {
        const p = s.player;
        p.hp = 1;
        p.invuln = 0;
        p.shield = 0;
        p.dashT = 0;
        p.relics.secondwindUsed = true;
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2;
          s.enemies.push({
            type: 'crawler',
            x: Math.min(Math.max(p.x + Math.cos(a) * 20, 20), 1260),
            y: Math.min(Math.max(p.y + Math.sin(a) * 20, 20), 700),
            vx: 0, vy: 0, radius: 18, hp: 4, maxHp: 4, speed: 55,
            dmg: 14, xp: 2, score: 20, elite: false, mode: 'chase',
            modeT: 0, t: 0, flash: 0, stunT: 0, orbHitT: 0, orbT: 0,
            burstT: 0, summonT: 0, spiralA: 0, fadeT: 0, visible: true,
            lockX: 0, lockY: 0, healTarget: null,
          });
        }
        runSteps(world, 10, () => 0);
      }
    }
    return SCREEN_OVER;
  }
  return SCREEN_TITLE;
}
