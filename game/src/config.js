// EMBERFALL — every tuning number and colour in one place.
// The playfield is a fixed 1280x720 logical area; the renderer scales it to
// the window, so no rule below depends on the screen size. Pure data only:
// this module has no DOM access and is safe to import from Node.

// Logical playfield size (canvas backing resolution).
export const FIELD = { width: 1280, height: 720 };

/** The simulation's fixed step, in seconds: 60 updates a second. */
export const STEP = 1 / 60;

// The lantern-keeper. All numbers here are the defaults a fresh run starts
// with; upgrades.js baseStats() copies them into the player's live stats.
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
  brute: {
    radius: 34, hp: 40, speed: 42, dmg: 22, xp: 20, score: 150, cost: 0,
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
};

// XP curve: xpNext(level) = round(base + (level-1)*perLevel + (level-1)^2*quad).
export const XP = { base: 6, perLevel: 5, quad: 0.6 };

// Combo: each kill within the window raises the score multiplier by 1.
export const COMBO = { timer: 2.5, cap: 8 };

// Pickups.
export const GEM = { pickupRadius: 22 };
export const HEART = {
  heal: 20,
  dropChance: 0.05, // crawlers and spitters roll this on death
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
};
