// EMBERFALL v3 — every tuning number and colour in one place.
//
// v3 vs v2: 10 enemy types (+ stalker, mender, charger; elites), a second
// boss (Gloom Matriarch, every 15th wave), shrines, relics, weapon
// evolutions, an Ember Storm frenzy event, 2 dash charges, destructible
// arena pillars that reshuffle every wave, and a 16-upgrade pool.
// The playfield is a fixed 1280x720 logical area; the renderer scales it
// to the window, so no rule below depends on the screen size.
// Pure data only: no DOM access, safe to import from Node.

export const FIELD = { width: 1280, height: 720 };

/** The simulation's fixed step, in seconds: 60 updates a second. */
export const STEP = 1 / 60;

export const PLAYER = {
  radius: 16,
  speed: 300, // px per second
  hp: 100,
  maxHp: 100,
  fireRate: 4.5, // shots per second
  bulletSpeed: 680,
  bulletDamage: 1,
  projectiles: 1,
  pierce: 0,
  magnet: 110, // pickup attraction radius, px
  bulletRange: 540, // px a bolt travels before fizzling
  invulnerable: 0.8, // seconds of mercy after taking a hit
  // v3 dash: two charges, each recharging on its own timer.
  dashCharges: 2,
  dashSpeed: 950,
  dashTime: 0.16,
  dashInvuln: 0.28,
  dashRecharge: 2.5, // seconds to refill one charge
};

/** Where the best score is kept between visits (this browser only). */
export const BEST_KEY = 'emberfall.best';
/** Run profile: runs played, total kills, best wave (this browser only). */
export const PROFILE_KEY = 'emberfall.profile';

/** UI font stack, shared by the renderer and any DOM chrome. */
export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

// ---------------------------------------------------------------------------
// Enemies ("glooms"). radius/hp/speed/dmg/xp/score are wave-1 base values;
// world.js scales hp and speed per wave. `cost` is the wave-budget price.
// `fromWave` is the first wave the type can appear in.
// ---------------------------------------------------------------------------
export const ENEMY = {
  wisp: {
    radius: 12, hp: 1, speed: 98, dmg: 8, xp: 1, score: 10, cost: 1, fromWave: 1,
  },
  crawler: {
    radius: 18, hp: 4, speed: 56, dmg: 14, xp: 2, score: 20, cost: 2, fromWave: 1,
  },
  spitter: {
    radius: 14, hp: 3, speed: 72, dmg: 10, xp: 3, score: 30, cost: 3, fromWave: 2,
    orbSpeed: 175, orbDamage: 10, orbInterval: 2.2,
    keepMin: 240, keepMax: 300, // preferred distance band to the player
  },
  // v3: fades out of sight, then decloaks with a lunge when close.
  stalker: {
    radius: 13, hp: 3, speed: 88, dmg: 16, xp: 4, score: 45, cost: 3, fromWave: 3,
    visibleTime: 1.4, hiddenTime: 1.7, hiddenSpeedMult: 1.45,
    hiddenDamageMult: 0.75, lungeRange: 75, lungeSpeed: 430, lungeTime: 0.3,
  },
  dasher: {
    radius: 13, hp: 3, speed: 82, dmg: 12, xp: 3, score: 40, cost: 3, fromWave: 4,
    windup: 0.55, lungeSpeed: 520, lungeTime: 0.35, lungeCooldown: 1.6,
  },
  // v3: hangs back and mends the most-hurt ally nearby. Kill it first.
  // Its mend breaks for a second whenever it takes damage, so focus fire
  // shuts it down; at most two share a wave.
  mender: {
    radius: 15, hp: 3, speed: 66, dmg: 8, xp: 4, score: 50, cost: 4, fromWave: 5,
    healRange: 280, healPerSecond: 3, keepMin: 200, keepMax: 260,
  },
  splitter: {
    radius: 20, hp: 7, speed: 50, dmg: 12, xp: 4, score: 35, cost: 4, fromWave: 6,
    children: 2,
  },
  // v3: locks a lane, telegraphs it, then charges through. Hits a wall or a
  // pillar and it staggers, taking double damage while stunned.
  charger: {
    radius: 17, hp: 6, speed: 74, dmg: 18, xp: 5, score: 55, cost: 4, fromWave: 7,
    aimTime: 0.7, chargeSpeed: 620, chargeTime: 0.45, recoverTime: 0.6,
    stunTime: 1.2, stunDamageMult: 2,
  },
  brute: {
    radius: 34, hp: 40, speed: 44, dmg: 22, xp: 20, score: 150, cost: 0, fromWave: 5,
  },
  // Boss 1: every 10th wave. Radial orb bursts + summons wisps.
  gloomlord: {
    radius: 52, hp: 320, speed: 35, dmg: 26, xp: 60, score: 600, cost: 0, fromWave: 10,
    orbSpeed: 150, orbDamage: 12,
    burstInterval: 3.0, burstCount: 10,
    summonInterval: 6.5, summonCount: 3,
  },
  // Boss 2: every 15th wave. Spiral orb sweeps + spawns splitters; enrages
  // under 30% HP (faster bursts, faster feet).
  matriarch: {
    radius: 46, hp: 420, speed: 40, dmg: 24, xp: 80, score: 900, cost: 0, fromWave: 15,
    orbSpeed: 165, orbDamage: 12,
    burstInterval: 2.6, burstCount: 3, // spiral: 3 orbs per tick, rotating
    summonInterval: 8.0, summonCount: 2,
    enrageHpFrac: 0.3, enrageBurstMult: 0.62, enrageSpeedMult: 1.4,
  },
};

// Elites: from wave 8, a slice of spawns come back Ember-touched — bigger,
// tougher, worth far more, and they drop a heart half the time.
export const ELITE = {
  fromWave: 8, chance: 0.08, hpMult: 3, radiusMult: 1.5, speedMult: 0.9,
  scoreMult: 3, xpMult: 2, gemDrops: 3, heartChance: 0.5,
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
  matriarchEvery: 15, // a Gloom Matriarch spawns at the start of every Nth wave
  swarmEvery: 4, // every Nth wave is a swarm: fast wisps + dashers only
  swarmBudgetMult: 1.4,
};

// Arena pillars: reshuffled every wave from the wave seed. They block
// bodies, never bolts (embers fly over the low stone) and never the boss,
// and never spawn near the centre.
export const PILLARS = {
  countMin: 3, countMax: 5, radiusMin: 22, radiusMax: 30,
  minCenterDistance: 190, minGap: 130,
};

// Shrines: one per wave from wave 2. Channel inside the ring to claim a boon.
export const SHRINE = {
  fromWave: 2, radius: 70, channelTime: 2.5,
  minCenterDistance: 210, heal: 40, furyDamageMult: 1.5, furyTime: 15, shield: 30,
};

// Ember Storm: a periodic frenzy — double XP, faster spawns, ember rain.
export const STORM = {
  firstAt: 45, every: 45, duration: 12, xpMult: 2, spawnIntervalMult: 0.75,
};

// XP curve: xpNext(level) = round(base + (level-1)*perLevel + (level-1)^2*quad).
export const XP = { base: 5, perLevel: 4.5, quad: 0.5 };

// Combo: each kill within the window raises the chain by 1 (starting at 1,
// capped at 15). The chain IS the score multiplier — a kill at x12 pays
// twelve times its base score — and it also lifts XP gain. At 10 the chain
// detonates a free Emberfall nova. The chain only falls when its timer
// expires, never when the keeper is hurt.
export const COMBO = { timer: 2.5, cap: 15, xpPerStep: 0.02, novaAt: 10 };

// Pickups.
export const GEM = { pickupRadius: 22 };
export const HEART = {
  heal: 20,
  dropChance: 0.05, // crawlers, spitters and menders roll this on death
};

// Nova / orbital / crit / regen (stackable systems).
export const NOVA = {
  interval: 5.5, intervalPerStack: 0.8, minInterval: 2.5,
  damage: 3, damagePerStack: 1, radius: 200, radiusPerStack: 14,
  evolveRadiusBonus: 60, evolveDamageBonus: 2, burnDps: 10, burnTime: 3,
};
export const ORBITAL = {
  radius: 74, speed: 3.4, damage: 2, damagePerStack: 1,
  countPerStack: 1, hitCooldown: 0.45,
  evolveSpeedMult: 1.4, // twin orbit: double orbiters, faster spin
};
export const CRIT = { chancePerStack: 0.12, multiplier: 2 };
export const REGEN = { perSecondPerStack: 0.8 };
export const CHAIN = {
  jumpRange: 200, damageFalloff: 0.7, // each jump deals 70% of the last
  evolveJumpsBonus: 2, evolveSecondStrike: true,
};
export const THORNS = { reflectPerStack: 3 };
export const LIFESTEAL = { healPerKillPerStack: 1 };
export const MULTISHOT = { evolveProjectilesBonus: 1 };

// ---------------------------------------------------------------------------
// Palette. Warm ember light against a cold dark field; v3 adds gold for
// elites, violet for the Matriarch, and teal for shrine light.
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
  matriarch: '#c44dff',
  dash: '#7de3ff',
  crit: '#ffe066',
  elite: '#ffd166',
  shrine: '#5df2c8',
  storm: '#ff7a3c',
  pillar: '#2a2350',
};
