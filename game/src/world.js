// EMBERFALL v2 — pure game logic. No window, document, or canvas anywhere
// in this file: it runs identically in the browser and in Node, and given the
// same seeded random it plays out deterministically.
//
// v2 adds: dasher + splitter enemies, the Gloomlord boss every 10th wave,
// swarm waves every 4th wave, a dash move with i-frames, nova / orbital /
// crit / regen upgrades, kill-streak announcements, and per-run stats.
//
// World interface:
//   createWorld(random) -> { state, reset(), step(dt, input, attract),
//                            chooseUpgrade(index) }
//   input = { mx, my, ax, ay, firing, dash } — move -1..1, aim dir
//           normalized, firing bool, dash bool (one-shot request).
//   step() returns an events bitmask.

import {
  FIELD, PLAYER, ENEMY, WAVE, XP, COMBO, GEM, HEART,
  NOVA, ORBITAL, CRIT,
} from './config.js';
import { rollUpgrades, applyUpgrade, baseStats } from './upgrades.js';

// Event bitmask returned by step(). main.js turns these into sounds.
export const EVENT_SHOOT = 1;
export const EVENT_HIT = 2;
export const EVENT_KILL = 4;
export const EVENT_PICKUP = 8;
export const EVENT_LEVELUP = 16;
export const EVENT_WAVE_CLEAR = 32;
export const EVENT_HURT = 64;
export const EVENT_OVER = 128;
export const EVENT_WAVE_START = 256;
export const EVENT_DASH = 512;
export const EVENT_NOVA = 1024;
export const EVENT_BOSS = 2048;
export const EVENT_STREAK = 4096;

// ---------------------------------------------------------------------------
// Small helpers (all pure, all driven by the seeded random where chance is
// involved, so replays stay deterministic).
// ---------------------------------------------------------------------------

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function dist(x1, y1, x2, y2) {
  return Math.hypot(x2 - x1, y2 - y1);
}

/** XP needed to go from `level` to `level + 1`. */
export function xpNextFor(level) {
  return Math.round(XP.base + (level - 1) * XP.perLevel + (level - 1) * (level - 1) * XP.quad);
}

/** Spawn interval for a wave: 0.9s on wave 1, shaved down to a 0.35s floor. */
function spawnIntervalFor(wave) {
  return Math.max(
    WAVE.spawnIntervalMin,
    WAVE.spawnIntervalStart - (wave - 1) * WAVE.spawnIntervalStep,
  );
}

/** Pick a point on the arena edge at least minSpawnDistance from the player. */
function pickSpawnPoint(random, px, py) {
  let best = null;
  let bestD = -1;
  for (let tries = 0; tries < 12; tries++) {
    const side = Math.floor(random() * 4);
    let x;
    let y;
    if (side === 0) { x = random() * FIELD.width; y = 24; }
    else if (side === 1) { x = random() * FIELD.width; y = FIELD.height - 24; }
    else if (side === 2) { x = 24; y = random() * FIELD.height; }
    else { x = FIELD.width - 24; y = random() * FIELD.height; }
    const d = dist(x, y, px, py);
    if (d >= WAVE.minSpawnDistance) return { x, y };
    if (d > bestD) { bestD = d; best = { x, y }; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// State factory. reset() rebuilds this shape in place so any reference a
// caller holds to world.state stays valid.
// ---------------------------------------------------------------------------

function makeEmberDots(random) {
  const dots = [];
  for (let i = 0; i < 80; i++) {
    dots.push({
      x: random() * FIELD.width,
      y: random() * FIELD.height,
      size: 0.8 + random() * 2.2,
      phase: random() * Math.PI * 2,
      speed: 0.4 + random() * 0.9,
    });
  }
  return dots;
}

function makeState(random) {
  return {
    time: 0,
    wave: 1,
    waveState: 'breather', // breather -> spawning -> fighting -> cleared -> next
    spawnQueue: [],
    spawnTimer: 0,
    breatherTimer: WAVE.breather,
    enemies: [],
    bullets: [],
    enemyBullets: [],
    gems: [],
    particles: [],
    texts: [],
    orbiters: [], // v2: orbiting ember positions, computed each step
    boss: null, // v2: live Gloomlord enemy, or null
    player: {
      x: FIELD.width / 2,
      y: FIELD.height / 2,
      vx: 0,
      vy: 0,
      hp: PLAYER.hp,
      maxHp: PLAYER.maxHp,
      level: 1,
      xp: 0,
      xpNext: xpNextFor(1),
      fireCooldown: 0,
      stats: baseStats(),
      invuln: 0,
      aimX: 1,
      aimY: 0,
      // v2 dash state.
      dashCooldown: 0,
      dashTime: 0,
      dashDirX: 1,
      dashDirY: 0,
      novaTimer: 0,
      orbitAngle: 0,
      regenAcc: 0,
    },
    owned: {},
    score: 0,
    kills: 0,
    combo: 1,
    comboTimer: 0,
    shake: 0,
    levelUpPending: false,
    choices: [],
    over: false,
    best: 0,
    // v2: per-run stats shown on the game-over screen.
    runStats: {
      shots: 0,
      hits: 0,
      dashes: 0,
      novaKills: 0,
      crits: 0,
      bestCombo: 1,
      bossKills: 0,
    },
    emberDots: makeEmberDots(random),
  };
}

export function createWorld(random) {
  const state = makeState(random);
  // Per-step event accumulator, shared by the helpers below.
  let pendingEvents = 0;
  // True until the first step of a wave has announced EVENT_WAVE_START.
  let waveStartPending = true;

  function reset() {
    const fresh = makeState(random);
    for (const key of Object.keys(fresh)) state[key] = fresh[key];
    pendingEvents = 0;
    waveStartPending = true;
  }

  // -------------------------------------------------------------------------
  // Particles + floating text.
  // -------------------------------------------------------------------------

  function addParticle(x, y, vx, vy, life, size, color, kind) {
    state.particles.push({ x, y, vx, vy, life, maxLife: life, size, color, kind });
  }

  function burst(x, y, color, n, speed, life, size) {
    for (let i = 0; i < n; i++) {
      const a = random() * Math.PI * 2;
      const s = speed * (0.4 + random() * 0.8);
      addParticle(x, y, Math.cos(a) * s, Math.sin(a) * s,
        life * (0.6 + random() * 0.7), size * (0.7 + random() * 0.6), color, 'spark');
    }
  }

  function ring(x, y, color, size) {
    addParticle(x, y, 0, 0, 0.45, size, color, 'ring');
  }

  function addText(x, y, text, color, size) {
    state.texts.push({ x, y, life: 0.9, text, color, size: size || 16 });
  }

  // -------------------------------------------------------------------------
  // Damage, death, XP.
  // -------------------------------------------------------------------------

  function hurtPlayer(dmg) {
    const p = state.player;
    if (p.invuln > 0 || state.over) return;
    p.hp -= dmg;
    p.invuln = PLAYER.invulnerable;
    state.shake = Math.max(state.shake, 9);
    pendingEvents |= EVENT_HURT;
    addText(p.x, p.y - 26, `-${dmg}`, '#ff5d5d', 18);
    burst(p.x, p.y, '#ff5d5d', 10, 220, 0.4, 3);
    if (p.hp <= 0) {
      p.hp = 0;
      state.over = true;
      state.shake = 16;
      pendingEvents |= EVENT_OVER;
      burst(p.x, p.y, '#ffb347', 36, 320, 0.9, 4);
      burst(p.x, p.y, '#ff9a3c', 24, 200, 1.1, 3);
      ring(p.x, p.y, '#ffd166', 90);
    }
  }

  function dropGem(x, y, value, kind) {
    const angle = random() * Math.PI * 2;
    state.gems.push({
      x, y,
      vx: Math.cos(angle) * 60, vy: Math.sin(angle) * 60,
      value, kind,
    });
  }

  function killEnemy(enemy, byNova) {
    // Score uses the current combo, then the combo climbs (cap 12 in v2).
    const gained = enemy.score * state.combo;
    state.score += gained;
    state.kills += 1;
    state.combo = Math.min(state.combo + 1, COMBO.cap);
    state.comboTimer = COMBO.timer;
    if (state.combo > state.runStats.bestCombo) state.runStats.bestCombo = state.combo;
    if (byNova) state.runStats.novaKills += 1;
    pendingEvents |= EVENT_KILL;
    addText(enemy.x, enemy.y - enemy.radius - 6, `+${gained}`, '#ffd166', 15);
    burst(enemy.x, enemy.y, '#b8a9ff', 12, 240, 0.5, 3);
    burst(enemy.x, enemy.y, '#ff9a3c', 6, 160, 0.6, 2.5);
    if (enemy.type === 'brute') {
      state.shake = Math.max(state.shake, 12);
      ring(enemy.x, enemy.y, '#ff9a3c', 120);
    }
    if (enemy.type === 'gloomlord') {
      // Boss down: big celebration, three hearts, and a score shower.
      state.shake = Math.max(state.shake, 18);
      ring(enemy.x, enemy.y, '#ff3d6e', 220);
      ring(enemy.x, enemy.y, '#ffd166', 160);
      burst(enemy.x, enemy.y, '#ff3d6e', 40, 340, 1.0, 4);
      burst(enemy.x, enemy.y, '#ffd166', 30, 260, 1.2, 3);
      addText(enemy.x, enemy.y - 70, 'GLOOMLORD SLAIN!', '#ffd166', 26);
      state.runStats.bossKills += 1;
      state.boss = null;
      for (let i = 0; i < 3; i++) dropGem(enemy.x, enemy.y, HEART.heal, 'heart');
    }
    if (enemy.type === 'splitter') {
      // Splits into two fresh wisps that pop in with a short telegraph.
      for (let i = 0; i < ENEMY.splitter.children; i++) {
        const a = random() * Math.PI * 2;
        const def = ENEMY.wisp;
        state.enemies.push({
          type: 'wisp',
          x: clamp(enemy.x + Math.cos(a) * 26, 12, FIELD.width - 12),
          y: clamp(enemy.y + Math.sin(a) * 26, 12, FIELD.height - 12),
          vx: 0, vy: 0,
          radius: def.radius, hp: def.hp, maxHp: def.hp,
          speed: def.speed, dmg: def.dmg, xp: def.xp, score: def.score,
          telegraph: 0.35, phase: random() * Math.PI * 2,
          orbTimer: 0, flash: 0, mode: 'chase', modeTimer: 0,
        });
      }
      burst(enemy.x, enemy.y, '#b8a9ff', 10, 200, 0.5, 3);
    }
    // Kill-streak announcements at combo milestones.
    if (state.combo === 5 || state.combo === 8 || state.combo === 12) {
      const label = state.combo === 12 ? 'UNSTOPPABLE!' : state.combo === 8 ? 'RAMPAGE!' : 'STREAK x5!';
      addText(state.player.x, state.player.y - 64, label, '#ffe066', 24);
      pendingEvents |= EVENT_STREAK;
    }
    // Drops: one ember shard worth the enemy's xp, plus a heart roll.
    dropGem(enemy.x, enemy.y, enemy.xp, 'gem');
    const heartChance = enemy.type === 'brute' || enemy.type === 'gloomlord'
      ? 1
      : (enemy.type === 'crawler' || enemy.type === 'spitter' || enemy.type === 'splitter'
        ? HEART.dropChance : 0);
    if (heartChance > 0 && random() < heartChance) {
      dropGem(enemy.x, enemy.y, HEART.heal, 'heart');
    }
  }

  function damageEnemy(enemy, dmg, byNova) {
    enemy.hp -= dmg;
    enemy.flash = 0.12;
    if (enemy.hp <= 0) killEnemy(enemy, byNova);
  }

  function levelUpOnce() {
    const p = state.player;
    p.xp -= p.xpNext;
    p.level += 1;
    p.xpNext = xpNextFor(p.level);
    state.levelUpPending = true;
    state.choices = rollUpgrades(random, state.owned);
    pendingEvents |= EVENT_LEVELUP;
    ring(p.x, p.y, '#ffd166', 80);
    burst(p.x, p.y, '#ffd166', 16, 200, 0.7, 3);
  }

  function addXp(value) {
    const p = state.player;
    p.xp += value;
    while (p.xp >= p.xpNext && !state.levelUpPending) levelUpOnce();
  }

  // -------------------------------------------------------------------------
  // Spawning + waves.
  // -------------------------------------------------------------------------

  function spawnEnemy(type, atX, atY) {
    const p = state.player;
    const def = ENEMY[type];
    const pos = (atX != null && atY != null)
      ? { x: atX, y: atY }
      : pickSpawnPoint(random, p.x, p.y);
    const hpScale = 1 + WAVE.hpScale * (state.wave - 1);
    const speedScale = Math.min(1 + WAVE.speedScale * (state.wave - 1), WAVE.speedScaleCap);
    const hp = Math.max(1, Math.round(def.hp * hpScale));
    const enemy = {
      type,
      x: pos.x, y: pos.y, vx: 0, vy: 0,
      radius: def.radius,
      hp, maxHp: hp,
      speed: def.speed * speedScale,
      dmg: def.dmg,
      xp: def.xp,
      score: def.score,
      telegraph: WAVE.telegraph,
      phase: random() * Math.PI * 2,
      orbTimer: 1 + random() * 1.2,
      flash: 0,
      // v2 AI state: dasher mode machine, boss timers, orbital hit guard.
      mode: 'chase',
      modeTimer: 0,
      lungeX: 0,
      lungeY: 0,
      burstTimer: ENEMY.gloomlord.burstInterval,
      summonTimer: ENEMY.gloomlord.summonInterval,
      orbCooldown: 0,
    };
    state.enemies.push(enemy);
    if (type === 'gloomlord') {
      state.boss = enemy;
      pendingEvents |= EVENT_BOSS;
      addText(FIELD.width / 2, 150, 'THE GLOOMLORD AWAKENS', '#ff3d6e', 30);
      state.shake = Math.max(state.shake, 10);
    }
    return enemy;
  }

  function isSwarmWave(wave) {
    return wave % WAVE.swarmEvery === 0 && wave % WAVE.bossEvery !== 0;
  }

  function setupWave() {
    // Spend the wave budget on a shuffled queue. Unlocks: crawlers wave 2,
    // spitters wave 3, dashers wave 4, splitters wave 6. A brute leads waves
    // 5, 10, 15, ... and a Gloomlord rules every 10th wave. Every 4th wave
    // is a fast wisp/dasher swarm with a fatter budget.
    let budget = WAVE.budgetBase + state.wave * WAVE.budgetPerWave;
    if (isSwarmWave(state.wave)) budget = Math.round(budget * WAVE.swarmBudgetMult);
    const queue = [];
    while (budget > 0) {
      const options = [{ type: 'wisp', cost: ENEMY.wisp.cost, weight: 5 }];
      if (state.wave >= 2 && !isSwarmWave(state.wave)) {
        options.push({ type: 'crawler', cost: ENEMY.crawler.cost, weight: 3 });
      }
      if (state.wave >= 3 && !isSwarmWave(state.wave)) {
        options.push({ type: 'spitter', cost: ENEMY.spitter.cost, weight: 2 });
      }
      if (state.wave >= 4) {
        options.push({ type: 'dasher', cost: ENEMY.dasher.cost, weight: isSwarmWave(state.wave) ? 3 : 2 });
      }
      if (state.wave >= 6 && !isSwarmWave(state.wave)) {
        options.push({ type: 'splitter', cost: ENEMY.splitter.cost, weight: 2 });
      }
      const affordable = options.filter((o) => o.cost <= budget);
      let total = 0;
      for (const o of affordable) total += o.weight;
      let roll = random() * total;
      let picked = affordable[0];
      for (const o of affordable) {
        roll -= o.weight;
        if (roll <= 0) { picked = o; break; }
      }
      queue.push(picked.type);
      budget -= picked.cost;
    }
    // Shuffle so the wave does not arrive in cost order.
    for (let i = queue.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      const tmp = queue[i];
      queue[i] = queue[j];
      queue[j] = tmp;
    }
    if (state.wave % WAVE.bruteEvery === 0) queue.unshift('brute');
    if (state.wave % WAVE.bossEvery === 0) queue.unshift('gloomlord');
    state.spawnQueue = queue;
  }

  // -------------------------------------------------------------------------
  // Per-frame updates.
  // -------------------------------------------------------------------------

  function updateParticles(dt) {
    for (let i = state.particles.length - 1; i >= 0; i--) {
      const pt = state.particles[i];
      pt.life -= dt;
      if (pt.life <= 0) { state.particles.splice(i, 1); continue; }
      if (pt.kind === 'ring') {
        pt.size += 260 * dt;
      } else {
        pt.x += pt.vx * dt;
        pt.y += pt.vy * dt;
        pt.vx *= 1 - 2.2 * dt;
        pt.vy *= 1 - 2.2 * dt;
        if (pt.kind === 'ember') pt.vy += 26 * dt;
      }
    }
    for (let i = state.texts.length - 1; i >= 0; i--) {
      const t = state.texts[i];
      t.life -= dt;
      t.y -= 34 * dt;
      if (t.life <= 0) state.texts.splice(i, 1);
    }
    if (state.shake > 0) state.shake = Math.max(0, state.shake - 26 * dt);
  }

  function updatePlayer(dt, input) {
    const p = state.player;
    if (p.invuln > 0) p.invuln -= dt;
    if (p.fireCooldown > 0) p.fireCooldown -= dt;
    if (p.dashCooldown > 0) p.dashCooldown -= dt;
    if (state.comboTimer > 0) {
      state.comboTimer -= dt;
      if (state.comboTimer <= 0) state.combo = 1;
    }
    // v2 regen: slow HP trickle while the run lasts.
    if (p.stats.regen > 0 && p.hp > 0 && p.hp < p.maxHp) {
      p.hp = Math.min(p.maxHp, p.hp + p.stats.regen * dt);
    }

    // Aim follows the input direction; a zero vector keeps the last aim.
    if (input.ax !== 0 || input.ay !== 0) {
      const len = Math.hypot(input.ax, input.ay) || 1;
      p.aimX = input.ax / len;
      p.aimY = input.ay / len;
    }

    // v2 dash: burst in the move direction (or aim if standing still),
    // with i-frames and an ember trail. One-shot: input.dash is consumed
    // here and the cooldown gates the next one.
    if (input.dash && p.dashCooldown <= 0 && p.dashTime <= 0) {
      let dx = input.mx || 0;
      let dy = input.my || 0;
      if (dx === 0 && dy === 0) { dx = p.aimX; dy = p.aimY; }
      const len = Math.hypot(dx, dy) || 1;
      p.dashDirX = dx / len;
      p.dashDirY = dy / len;
      p.dashTime = PLAYER.dashTime;
      p.dashCooldown = PLAYER.dashCooldown;
      p.invuln = Math.max(p.invuln, PLAYER.dashInvuln);
      state.runStats.dashes += 1;
      pendingEvents |= EVENT_DASH;
      burst(p.x, p.y, '#7de3ff', 8, 180, 0.35, 2.5);
    }

    if (p.dashTime > 0) {
      // Dashing: fixed burst velocity, trail embers behind.
      p.dashTime -= dt;
      p.vx = p.dashDirX * PLAYER.dashSpeed;
      p.vy = p.dashDirY * PLAYER.dashSpeed;
      addParticle(p.x, p.y, -p.dashDirX * 60, -p.dashDirY * 60,
        0.3, 4, '#ff9a3c', 'ember');
    } else {
      // Snappy accel/decel: velocity chases the target quickly, so movement
      // feels responsive without being instant.
      const ACCEL = 2600;
      const tx = (input.mx || 0) * p.stats.speed;
      const ty = (input.my || 0) * p.stats.speed;
      p.vx += clamp(tx - p.vx, -ACCEL * dt, ACCEL * dt);
      p.vy += clamp(ty - p.vy, -ACCEL * dt, ACCEL * dt);
    }
    p.x = clamp(p.x + p.vx * dt, PLAYER.radius, FIELD.width - PLAYER.radius);
    p.y = clamp(p.y + p.vy * dt, PLAYER.radius, FIELD.height - PLAYER.radius);

    // Firing: cooldown-gated, multi-projectile spread around the aim dir.
    if (input.firing && p.fireCooldown <= 0) {
      const n = p.stats.projectiles;
      const baseAngle = Math.atan2(p.aimY, p.aimX);
      const spreadStep = 0.13;
      for (let i = 0; i < n; i++) {
        const offset = (i - (n - 1) / 2) * spreadStep;
        const a = baseAngle + offset;
        state.bullets.push({
          x: p.x + p.aimX * (PLAYER.radius + 8),
          y: p.y + p.aimY * (PLAYER.radius + 8),
          vx: Math.cos(a) * p.stats.bulletSpeed,
          vy: Math.sin(a) * p.stats.bulletSpeed,
          damage: p.stats.damage,
          pierce: p.stats.pierce,
          range: p.stats.bulletRange,
          radius: 5,
          hitIds: new Set(),
        });
      }
      state.runStats.shots += n;
      p.fireCooldown = 1 / p.stats.fireRate;
      pendingEvents |= EVENT_SHOOT;
      burst(p.x + p.aimX * 22, p.y + p.aimY * 22, '#ff9a3c', 2, 90, 0.18, 2);
    }

    // v2 nova: periodic radial burst, stronger per stack.
    if (p.stats.nova > 0) {
      p.novaTimer -= dt;
      if (p.novaTimer <= 0) {
        const stacks = p.stats.nova;
        const radius = NOVA.radius + (stacks - 1) * 14;
        const dmg = NOVA.damage + (stacks - 1);
        p.novaTimer = Math.max(
          NOVA.minInterval,
          NOVA.interval - (stacks - 1) * NOVA.intervalPerStack,
        );
        pendingEvents |= EVENT_NOVA;
        ring(p.x, p.y, '#ff9a3c', radius);
        burst(p.x, p.y, '#ff9a3c', 18, 300, 0.5, 3);
        for (const e of state.enemies) {
          if (e.telegraph > 0 || e.hp <= 0) continue;
          if (dist(e.x, e.y, p.x, p.y) < radius + e.radius) {
            damageEnemy(e, dmg, true);
          }
        }
      }
    }

    // v2 orbital: embers circle the keeper and burn what they touch.
    if (p.stats.orbital > 0) {
      p.orbitAngle += ORBITAL.speed * dt;
      const n = p.stats.orbital * ORBITAL.countPerStack;
      const dmg = ORBITAL.damage + (p.stats.orbital - 1);
      state.orbiters = [];
      for (let i = 0; i < n; i++) {
        const a = p.orbitAngle + (i * Math.PI * 2) / n;
        const ox = p.x + Math.cos(a) * ORBITAL.radius;
        const oy = p.y + Math.sin(a) * ORBITAL.radius;
        state.orbiters.push({ x: ox, y: oy, angle: a });
        for (const e of state.enemies) {
          if (e.telegraph > 0 || e.hp <= 0 || e.orbCooldown > 0) continue;
          if (dist(ox, oy, e.x, e.y) < 12 + e.radius) {
            e.orbCooldown = ORBITAL.hitCooldown;
            damageEnemy(e, dmg, false);
            burst(ox, oy, '#ffb347', 4, 140, 0.3, 2.5);
          }
        }
      }
    } else {
      state.orbiters = [];
    }
  }

  function updateBullets(dt) {
    for (let i = state.bullets.length - 1; i >= 0; i--) {
      const b = state.bullets[i];
      const stepLen = Math.hypot(b.vx, b.vy) * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.range -= stepLen;
      let dead = b.range <= 0
        || b.x < -20 || b.x > FIELD.width + 20
        || b.y < -20 || b.y > FIELD.height + 20;
      if (!dead) {
        for (const e of state.enemies) {
          if (e.telegraph > 0 || e.hp <= 0 || b.hitIds.has(e)) continue;
          if (dist(b.x, b.y, e.x, e.y) < b.radius + e.radius) {
            // v2 crit: seeded roll, double damage, gold text.
            let dmg = b.damage;
            let crit = false;
            if (state.player.stats.critChance > 0
              && random() < state.player.stats.critChance) {
              dmg *= CRIT.multiplier;
              crit = true;
              state.runStats.crits += 1;
            }
            damageEnemy(e, dmg, false);
            state.runStats.hits += 1;
            b.hitIds.add(e);
            pendingEvents |= EVENT_HIT;
            if (crit) {
              addText(b.x, b.y - 10, `CRIT ${dmg}`, '#ffe066', 16);
              burst(b.x, b.y, '#ffe066', 5, 180, 0.3, 2.5);
            } else {
              burst(b.x, b.y, '#ffd166', 4, 160, 0.25, 2.5);
            }
            if (b.pierce > 0) {
              b.pierce -= 1;
            } else {
              dead = true;
              break;
            }
          }
        }
      }
      if (dead) state.bullets.splice(i, 1);
    }
    // Sweep enemies killed this step.
    for (let i = state.enemies.length - 1; i >= 0; i--) {
      if (state.enemies[i].hp <= 0) state.enemies.splice(i, 1);
    }
  }

  function updateEnemyBullets(dt) {
    const p = state.player;
    for (let i = state.enemyBullets.length - 1; i >= 0; i--) {
      const o = state.enemyBullets[i];
      o.x += o.vx * dt;
      o.y += o.vy * dt;
      o.life -= dt;
      let dead = o.life <= 0
        || o.x < -20 || o.x > FIELD.width + 20
        || o.y < -20 || o.y > FIELD.height + 20;
      if (!dead && p.invuln <= 0 && !state.over
        && dist(o.x, o.y, p.x, p.y) < o.radius + PLAYER.radius) {
        hurtPlayer(o.dmg);
        dead = true;
      }
      if (dead) state.enemyBullets.splice(i, 1);
    }
  }

  function updateEnemies(dt) {
    const p = state.player;
    for (const e of state.enemies) {
      if (e.telegraph > 0) { e.telegraph -= dt; continue; }
      if (e.flash > 0) e.flash -= dt;
      if (e.orbCooldown > 0) e.orbCooldown -= dt;
      const dx = p.x - e.x;
      const dy = p.y - e.y;
      const d = Math.hypot(dx, dy) || 1;
      const nx = dx / d;
      const ny = dy / d;
      let mvx = 0;
      let mvy = 0;
      if (e.type === 'wisp') {
        // Wobbles side to side while closing in.
        const wob = Math.sin(state.time * 3 + e.phase) * 0.7;
        const px = -ny * wob;
        const py = nx * wob;
        const len = Math.hypot(nx + px, ny + py) || 1;
        mvx = ((nx + px) / len) * e.speed;
        mvy = ((ny + py) / len) * e.speed;
      } else if (e.type === 'spitter') {
        const def = ENEMY.spitter;
        if (d > def.keepMax) { mvx = nx * e.speed; mvy = ny * e.speed; }
        else if (d < def.keepMin) { mvx = -nx * e.speed; mvy = -ny * e.speed; }
        else {
          // Hold the band and strafe slowly.
          const s = Math.sin(e.phase) >= 0 ? 1 : -1;
          mvx = -ny * 42 * s;
          mvy = nx * 42 * s;
        }
        e.orbTimer -= dt;
        if (e.orbTimer <= 0 && d < 560) {
          state.enemyBullets.push({
            x: e.x, y: e.y,
            vx: nx * def.orbSpeed, vy: ny * def.orbSpeed,
            radius: 6, dmg: def.orbDamage, life: 6,
          });
          e.orbTimer = def.orbInterval;
          burst(e.x, e.y, '#7b5cff', 4, 120, 0.3, 2.5);
        }
      } else if (e.type === 'dasher') {
        // v2: crouch (telegraphed), lunge, recover, repeat.
        const def = ENEMY.dasher;
        if (e.mode === 'chase') {
          mvx = nx * e.speed;
          mvy = ny * e.speed;
          e.modeTimer -= dt;
          if (d < 280 && e.modeTimer <= 0) {
            e.mode = 'windup';
            e.modeTimer = def.windup;
            e.lungeX = nx;
            e.lungeY = ny;
          }
        } else if (e.mode === 'windup') {
          // Crouch in place, visibly tensing (renderer draws it pulled in).
          mvx = 0;
          mvy = 0;
          e.modeTimer -= dt;
          if (e.modeTimer <= 0) {
            // Re-aim at the keeper's current position: the lunge tracks a
            // little, so standing still through the windup gets punished.
            e.lungeX = nx;
            e.lungeY = ny;
            e.mode = 'lunge';
            e.modeTimer = def.lungeTime;
          }
        } else if (e.mode === 'lunge') {
          mvx = e.lungeX * def.lungeSpeed;
          mvy = e.lungeY * def.lungeSpeed;
          e.modeTimer -= dt;
          if (e.modeTimer <= 0) {
            e.mode = 'recover';
            e.modeTimer = def.lungeCooldown;
          }
        } else {
          // recover: drift slowly, then chase again.
          mvx = nx * e.speed * 0.4;
          mvy = ny * e.speed * 0.4;
          e.modeTimer -= dt;
          if (e.modeTimer <= 0) e.mode = 'chase';
        }
      } else if (e.type === 'gloomlord') {
        // v2 boss: slow chase, radial orb bursts, wisp summons.
        mvx = nx * e.speed;
        mvy = ny * e.speed;
        const def = ENEMY.gloomlord;
        e.burstTimer -= dt;
        if (e.burstTimer <= 0) {
          e.burstTimer = def.burstInterval;
          for (let i = 0; i < def.burstCount; i++) {
            const a = (i / def.burstCount) * Math.PI * 2 + e.phase;
            state.enemyBullets.push({
              x: e.x, y: e.y,
              vx: Math.cos(a) * def.orbSpeed, vy: Math.sin(a) * def.orbSpeed,
              radius: 8, dmg: def.orbDamage, life: 8,
            });
          }
          ring(e.x, e.y, '#ff3d6e', 90);
          state.shake = Math.max(state.shake, 5);
        }
        e.summonTimer -= dt;
        if (e.summonTimer <= 0) {
          e.summonTimer = def.summonInterval;
          for (let i = 0; i < def.summonCount; i++) {
            const a = random() * Math.PI * 2;
            spawnEnemy('wisp',
              clamp(e.x + Math.cos(a) * 90, 12, FIELD.width - 12),
              clamp(e.y + Math.sin(a) * 90, 12, FIELD.height - 12));
          }
          burst(e.x, e.y, '#7b5cff', 12, 200, 0.5, 3);
        }
      } else {
        // Crawler, splitter and brute: steady chase.
        mvx = nx * e.speed;
        mvy = ny * e.speed;
      }
      e.vx = mvx;
      e.vy = mvy;
      e.x = clamp(e.x + e.vx * dt, e.radius, FIELD.width - e.radius);
      e.y = clamp(e.y + e.vy * dt, e.radius, FIELD.height - e.radius);
    }

    // Light separation so glooms do not stack into one blob.
    const list = state.enemies;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a.telegraph > 0) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (b.telegraph > 0) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        const min = a.radius + b.radius;
        if (d > 0 && d < min) {
          const push = (min - d) / 2;
          const ux = dx / d;
          const uy = dy / d;
          a.x = clamp(a.x - ux * push, a.radius, FIELD.width - a.radius);
          a.y = clamp(a.y - uy * push, a.radius, FIELD.height - a.radius);
          b.x = clamp(b.x + ux * push, b.radius, FIELD.width - b.radius);
          b.y = clamp(b.y + uy * push, b.radius, FIELD.height - b.radius);
        }
      }
    }

    // Contact damage respects the player's invulnerability window.
    if (!state.over && p.invuln <= 0) {
      for (const e of state.enemies) {
        if (e.telegraph > 0 || e.hp <= 0) continue;
        if (dist(e.x, e.y, p.x, p.y) < e.radius + PLAYER.radius) {
          hurtPlayer(e.dmg);
          break;
        }
      }
    }
  }

  function updateGems(dt) {
    const p = state.player;
    for (let i = state.gems.length - 1; i >= 0; i--) {
      const g = state.gems[i];
      const d = dist(g.x, g.y, p.x, p.y);
      if (d < p.stats.magnet) {
        // Magnet pull, accelerating toward the player.
        const nx = (p.x - g.x) / (d || 1);
        const ny = (p.y - g.y) / (d || 1);
        g.vx += nx * 1400 * dt;
        g.vy += ny * 1400 * dt;
        const sp = Math.hypot(g.vx, g.vy);
        if (sp > 520) { g.vx = (g.vx / sp) * 520; g.vy = (g.vy / sp) * 520; }
      } else {
        g.vx *= 1 - 3 * dt;
        g.vy *= 1 - 3 * dt;
      }
      g.x += g.vx * dt;
      g.y += g.vy * dt;
      if (d < GEM.pickupRadius) {
        if (g.kind === 'heart') {
          p.hp = Math.min(p.maxHp, p.hp + g.value);
          addText(p.x, p.y - 26, `+${g.value}`, '#7dff8a', 16);
        } else {
          addXp(g.value);
          addText(g.x, g.y - 10, `+${g.value} xp`, '#ffd166', 13);
        }
        pendingEvents |= EVENT_PICKUP;
        burst(g.x, g.y, g.kind === 'heart' ? '#7dff8a' : '#ffd166', 5, 120, 0.3, 2.5);
        state.gems.splice(i, 1);
      }
    }
  }

  function updateWaves(dt) {
    if (state.waveState === 'breather') {
      state.breatherTimer -= dt;
      if (state.breatherTimer <= 0) {
        setupWave();
        state.waveState = 'spawning';
        state.spawnTimer = 0;
      }
    } else if (state.waveState === 'spawning') {
      state.spawnTimer -= dt;
      if (state.spawnTimer <= 0 && state.spawnQueue.length > 0) {
        spawnEnemy(state.spawnQueue.shift());
        state.spawnTimer = spawnIntervalFor(state.wave);
      }
      if (state.spawnQueue.length === 0) state.waveState = 'fighting';
    } else if (state.waveState === 'fighting') {
      if (state.enemies.length === 0) {
        const bonus = WAVE.clearBonus * state.wave;
        state.score += bonus;
        state.waveState = 'cleared';
        state.breatherTimer = WAVE.cleared;
        pendingEvents |= EVENT_WAVE_CLEAR;
        addText(state.player.x, state.player.y - 48,
          `WAVE ${state.wave} CLEAR  +${bonus}`, '#ffd166', 22);
        ring(state.player.x, state.player.y, '#ffd166', 110);
      }
    } else if (state.waveState === 'cleared') {
      state.breatherTimer -= dt;
      if (state.breatherTimer <= 0) {
        state.wave += 1;
        state.waveState = 'breather';
        state.breatherTimer = WAVE.breather;
        waveStartPending = true;
      }
    }
  }

  // Title-screen demo: a few wisps drift lazily across the field. No combat,
  // no player damage, no waves — just ambience behind the title.
  function attractStep(dt) {
    if (state.enemies.length < 6 && random() < dt * 0.6) {
      const def = ENEMY.wisp;
      state.enemies.push({
        type: 'wisp',
        x: random() * FIELD.width, y: random() * FIELD.height,
        vx: 0, vy: 0,
        radius: def.radius, hp: def.hp, maxHp: def.hp,
        speed: 40, dmg: 0, xp: def.xp, score: def.score,
        telegraph: 0, phase: random() * Math.PI * 2,
        orbTimer: 0, flash: 0, mode: 'chase', modeTimer: 0,
        burstTimer: 0, summonTimer: 0, orbCooldown: 0,
      });
    }
    for (const e of state.enemies) {
      const a = Math.sin(state.time * 0.35 + e.phase) * 1.4;
      e.vx = Math.cos(a) * 42;
      e.vy = Math.sin(a) * 42;
      e.x += e.vx * dt;
      e.y += e.vy * dt;
      if (e.x < e.radius) e.x = e.radius;
      if (e.x > FIELD.width - e.radius) e.x = FIELD.width - e.radius;
      if (e.y < e.radius) e.y = e.radius;
      if (e.y > FIELD.height - e.radius) e.y = FIELD.height - e.radius;
    }
    updateParticles(dt);
  }

  function step(dt, input, attract) {
    pendingEvents = 0;
    const safeDt = Math.min(Math.max(dt, 0), 0.1);
    state.time += safeDt;

    if (attract) {
      attractStep(safeDt);
      return pendingEvents;
    }
    if (state.over) {
      updateParticles(safeDt);
      return pendingEvents;
    }
    if (waveStartPending) {
      pendingEvents |= EVENT_WAVE_START;
      waveStartPending = false;
    }
    // While a level-up choice is waiting, the fight freezes but embers and
    // floating text keep drifting (main.js normally stops stepping here).
    if (state.levelUpPending) {
      updateParticles(safeDt);
      return pendingEvents;
    }

    updatePlayer(safeDt, input || { mx: 0, my: 0, ax: 1, ay: 0, firing: false, dash: false });
    updateBullets(safeDt);
    updateEnemyBullets(safeDt);
    updateEnemies(safeDt);
    updateWaves(safeDt);
    updateGems(safeDt);
    updateParticles(safeDt);
    return pendingEvents;
  }

  function chooseUpgrade(index) {
    if (!state.levelUpPending) return false;
    const choice = state.choices[index];
    if (!choice) return false;
    const p = state.player;
    applyUpgrade(p.stats, choice.id);
    state.owned[choice.id] = (state.owned[choice.id] || 0) + 1;
    if (choice.id === 'vitality') {
      // Vitality also heals: maxHp grew inside applyUpgrade, sync and heal.
      p.maxHp = p.stats.maxHp;
      p.hp = Math.min(p.maxHp, p.hp + 25);
    }
    if (choice.id === 'nova') {
      // First nova stack fires soon so the player sees it right away.
      p.novaTimer = Math.min(p.novaTimer, 1.2);
    }
    state.levelUpPending = false;
    state.choices = [];
    // Banked XP can earn another level immediately — roll fresh choices.
    if (p.xp >= p.xpNext) levelUpOnce();
    return true;
  }

  return { state, reset, step, chooseUpgrade };
}
