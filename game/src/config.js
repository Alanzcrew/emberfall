// EMBERFALL v2 — every tuning number and colour in one place.
// v2 adds: dasher + splitter enemies, the Gloomlord boss (every 10th wave),
// a dash move with i-frames, and four new upgrades (nova, orbital, crit,
// regen). The playfield is a fixed 1280x720 logical area; the renderer
// scales it to the window, so no rule below depends on the screen size.
// Pure data only: no DOM access, safe to import from Node.

export const FIELD = { width: 1280, height: 720 };

/** The simulation's fixed step, in seconds: 60 updates a second. */
export const STEP = 1 / 60;

export const PLAYER = {
  radius: 16,
  speed: 300, // px per second
  hp: 100,
  maxHp: 100,
  fireRate: 4, // shots per second
  bulletSpeed: 640,
  bulletDamage: 1,
  projectiles: 1,
  pierce: 0,
  magnet: 90, // pickup attraction radius, px
  bulletRange: 520, // px a bolt travels before fizzling
  invulnerable: 0.8, // seconds of mercy after taking a hit
  // v2 dash: burst speed, i-frame time, cooldown.
  dashSpeed: 950,
  dashTime: 0.16,
  dashInvuln: 0.28,
  dashCooldown: 2.2,
};

/** Where the best score is kept between visits (this browser only). */
export const BEST_KEY = 'emberfall.best';

/** UI font stack, shared by the renderer and any DOM chrome. */
export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

// ---------------------------------------------------------------------------
// Enemies ("glooms"). radius/hp/speed/dmg/xp/score are the wave-1 base values;
// world.js scales hp and speed per wave. `cost` is the wave-budget price.
// ---------------------------------------------------------------------------
export const ENEMY = {
  wisp: {
    radius: 12, hp: 1, speed: 95, dmg: 8, xp: 1, score: 10, cost: 1,
  },
  crawler: {
    radius: 18, hp: 4, speed: 55, dmg: 14, xp: 2, score: 20, cost: 2,
  },
  spitter: {
    radius: 14, hp: 3, speed: 70, dmg: 10, xp: 3, score: 30, cost: 3,
    orbSpeed: 170, // px/s of the shadow orb it spits
    orbDamage: 10,
    orbInterval: 2.2, // seconds between orbs
    keepMin: 240, // preferred distance band to the player
    keepMax: 300,
  },
  // v2: winds up, then lunges fast at the keeper. Appears from wave 4.
  dasher: {
    radius: 13, hp: 3, speed: 80, dmg: 12, xp: 3, score: 40, cost: 3,
    windup: 0.55, // seconds of telegraphed crouch before the lunge
    lungeSpeed: 520,
    lungeTime: 0.35,
    lungeCooldown: 1.6,
  },
  // v2: pops into two wisps when killed. Appears from wave 6.
  splitter: {
    radius: 20, hp: 7, speed: 48, dmg: 12, xp: 4, score: 35, cost: 4,
    children: 2,
  },
  brute: {
    radius: 34, hp: 40, speed: 42, dmg: 22, xp: 20, score: 150, cost: 0,
  },
  // v2 boss: one per 10th wave. Radial orb bursts + summons wisps.
  gloomlord: {
    radius: 52, hp: 320, speed: 34, dmg: 26, xp: 60, score: 600, cost: 0,
    orbSpeed: 150,
    orbDamage: 12,
    burstInterval: 3.0, // seconds between radial bursts
    burstCount: 10, // orbs per burst
    summonInterval: 6.5, // seconds between wisp summons
    summonCount: 3,
  },
};

// Wave flow + spawning.
export const WAVE = {
  budgetBase: 6, // wave budget = budgetBase + wave * budgetPerWave
  budgetPerWave: 4,
  spawnIntervalStart: 0.9, // seconds between spawns on wave 1
  spawnIntervalMin: 0.35, // fastest interval, reached on later waves
  spawnIntervalStep: 0.05, // seconds shaved off per wave
  breather: 2.5, // seconds of "WAVE N" banner before spawning starts
  cleared: 2.0, // seconds the wave-clear bonus shows before the next wave
  telegraph: 0.5, // seconds a spawn ring warns before the enemy activates
  minSpawnDistance: 420, // spawns must be at least this far from the player
  hpScale: 0.12, // enemy hp *= (1 + hpScale * (wave - 1))
  speedScale: 0.03, // enemy speed *= min(1 + speedScale * (wave - 1), speedScaleCap)
  speedScaleCap: 1.5,
  clearBonus: 50, // wave-clear bonus = clearBonus * wave
  bruteEvery: 5, // a brute spawns at the start of every Nth wave
  bossEvery: 10, // a Gloomlord spawns at the start of every Nth wave
  swarmEvery: 4, // every Nth wave is a swarm: fast wisps + dashers only
  swarmBudgetMult: 1.4,
};

// XP curve: xpNext(level) = round(base + (level-1)*perLevel + (level-1)^2*quad).
export const XP = { base: 6, perLevel: 5, quad: 0.6 };

// Combo: each kill within the window raises the score multiplier by 1.
// v2 raises the cap to 12 so long kill chains pay off more.
export const COMBO = { timer: 2.5, cap: 12 };

// Pickups.
export const GEM = { pickupRadius: 22 };
export const HEART = {
  heal: 20,
  dropChance: 0.05, // crawlers and spitters roll this on death
};

// v2 systems.
export const NOVA = {
  interval: 5.5, // seconds between ember novas (per stack the interval shrinks)
  intervalPerStack: 0.8,
  minInterval: 2.5,
  damage: 3, // +1 per stack
  radius: 200, // +14 per stack
};
export const ORBITAL = {
  radius: 74, // orbit radius around the keeper
  speed: 3.4, // radians per second
  damage: 2, // +1 per stack
  countPerStack: 1, // one orbiting ember per stack
  hitCooldown: 0.45, // seconds before the same enemy can be hit again
};
export const CRIT = {
  chancePerStack: 0.12,
  multiplier: 2,
};
export const REGEN = {
  perSecondPerStack: 0.8,
};

// ---------------------------------------------------------------------------
// Palette. Warm ember light against a cold dark field.
// ---------------------------------------------------------------------------
export const PALETTE = {
  backdrop: '#0d0b1e',
  arena: '#141130',
  ember: '#ff9a3c',
  gold: '#ffd166',
  lantern: '#ffb347',
  shadow: '#7b5cff',
  wisp: '#b8a9ff',
  text: '#f2ead8',
  muted: '#8b86a3',
  hp: '#ff5d5d',
  xp: '#ffd166',
  panel: 'rgba(16,12,36,0.82)',
  boss: '#ff3d6e',
  dash: '#7de3ff',
  crit: '#ffe066',
};
