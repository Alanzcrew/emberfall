// EMBERFALL v3 — the upgrade pool: 16 stackable upgrades, each up to 3
// stacks. At 3 stacks, four of them EVOLVE into a stronger form (nova,
// orbital, multishot, chain) with a banner, a fanfare and a free burst.
//
// Pure data + pure apply functions: no DOM, safe to import from Node.

import {
  PLAYER, NOVA, ORBITAL, CRIT, REGEN, CHAIN, THORNS, LIFESTEAL,
} from './config.js';

export const MAX_STACKS = 3;

/** Fresh base stats for a new run. Everything an upgrade touches lives here. */
export function baseStats() {
  return {
    speed: PLAYER.speed,
    maxHp: PLAYER.maxHp,
    fireRate: PLAYER.fireRate,
    bulletSpeed: PLAYER.bulletSpeed,
    bulletDamage: PLAYER.bulletDamage,
    projectiles: PLAYER.projectiles,
    pierce: PLAYER.pierce,
    magnet: PLAYER.magnet,
    bulletRange: PLAYER.bulletRange,
    dashCharges: PLAYER.dashCharges,
    dashRecharge: PLAYER.dashRecharge,
    // Stackable systems (0 = unowned).
    nova: 0,
    orbital: 0,
    critChance: 0,
    regen: 0,
    chain: 0,
    thorns: 0,
    lifesteal: 0,
    // Evolutions (false until the 3rd stack lands).
    novaEvolved: false,
    orbitalEvolved: false,
    multishotEvolved: false,
    chainEvolved: false,
  };
}

/**
 * One upgrade definition.
 *  id: stable key. name/desc: card text. max: stacks. apply: mutates stats.
 *  evolve: id of the evolution granted at max stacks, or null.
 */
export const UPGRADE_DEFS = [
  {
    id: 'damage', name: 'Kindled Shot', max: MAX_STACKS,
    desc: '+1 bolt damage.',
    apply: (s) => { s.bulletDamage += 1; },
  },
  {
    id: 'firerate', name: 'Rapid Ember', max: MAX_STACKS,
    desc: '+18% fire rate.',
    apply: (s) => { s.fireRate *= 1.18; },
  },
  {
    id: 'multishot', name: 'Split Ember', max: MAX_STACKS,
    desc: '+1 bolt per shot.',
    apply: (s) => { s.projectiles += 1; },
    evolve: 'fan',
  },
  {
    id: 'pierce', name: 'Piercing Ember', max: MAX_STACKS,
    desc: 'Bolts pierce +1 enemy.',
    apply: (s) => { s.pierce += 1; },
  },
  {
    id: 'chain', name: 'Storm Chain', max: MAX_STACKS,
    desc: 'Bolts arc to +1 nearby enemy.',
    apply: (s) => { s.chain += 1; },
    evolve: 'stormcall',
  },
  {
    id: 'nova', name: 'Ember Nova', max: MAX_STACKS,
    desc: 'A radial burst of fire every few seconds.',
    apply: (s) => { s.nova += 1; },
    evolve: 'supernova',
  },
  {
    id: 'orbital', name: 'Orbiting Ember', max: MAX_STACKS,
    desc: '+1 ember orbiting you, burning on contact.',
    apply: (s) => { s.orbital += 1; },
    evolve: 'twin-orbit',
  },
  {
    id: 'crit', name: 'Kindled Edge', max: MAX_STACKS,
    desc: '+12% crit chance (crits deal double).',
    apply: (s) => { s.critChance += CRIT.chancePerStack; },
  },
  {
    id: 'lifesteal', name: 'Siphon Ember', max: MAX_STACKS,
    desc: 'Each kill restores +1 HP.',
    apply: (s) => { s.lifesteal += 1; },
  },
  {
    id: 'thorns', name: 'Briar Lantern', max: MAX_STACKS,
    desc: 'Attackers take +3 damage when they touch you.',
    apply: (s) => { s.thorns += THORNS.reflectPerStack; },
  },
  {
    id: 'speed', name: 'Ember Boots', max: MAX_STACKS,
    desc: '+10% move speed.',
    apply: (s) => { s.speed *= 1.10; },
  },
  {
    id: 'dash', name: 'Twin Step', max: MAX_STACKS,
    desc: '+1 dash charge, dashes recharge 15% faster.',
    apply: (s) => { s.dashCharges += 1; s.dashRecharge *= 0.85; },
  },
  {
    id: 'maxhp', name: 'Ember Heart', max: MAX_STACKS,
    desc: '+25 max HP and heal 25.',
    apply: (s) => { s.maxHp += 25; },
  },
  {
    id: 'regen', name: 'Kindled Blood', max: MAX_STACKS,
    desc: 'Regenerate +0.8 HP per second.',
    apply: (s) => { s.regen += REGEN.perSecondPerStack; },
  },
  {
    id: 'magnet', name: 'Lodestone', max: MAX_STACKS,
    desc: '+45 pickup attraction radius.',
    apply: (s) => { s.magnet += 45; },
  },
  {
    id: 'range', name: 'Long Fuse', max: MAX_STACKS,
    desc: '+20% bolt speed, +80 bolt range.',
    apply: (s) => { s.bulletSpeed *= 1.2; s.bulletRange += 80; },
  },
];

/** Evolution flavour text, shown on the evolve banner. */
export const EVOLUTIONS = {
  supernova: { name: 'SUPERNOVA', desc: 'Nova bursts scorch the ground where they land.' },
  'twin-orbit': { name: 'TWIN ORBIT', desc: 'Your orbiters double — and spin 40% faster.' },
  fan: { name: 'FAN OF EMBERS', desc: 'Two more bolts fan out with every shot.' },
  stormcall: { name: 'STORMCALL', desc: 'Chains strike twice and reach two foes further.' },
};

/** Look a def up by id. */
export function defById(id) {
  return UPGRADE_DEFS.find((d) => d.id === id) || null;
}

/**
 * Apply one stack of `id` to `stats`. Returns true when applied, false when
 * the id is unknown or already maxed. The caller owns stack counting.
 */
export function applyUpgrade(stats, id) {
  const def = defById(id);
  if (!def) return false;
  def.apply(stats);
  return true;
}

/** Nova numbers for a given stack count (evolved or not). */
export function novaStats(stacks, evolved) {
  return {
    interval: Math.max(
      NOVA.minInterval,
      NOVA.interval - NOVA.intervalPerStack * (stacks - 1),
    ),
    damage: NOVA.damage + NOVA.damagePerStack * (stacks - 1)
      + (evolved ? NOVA.evolveDamageBonus : 0),
    radius: NOVA.radius + NOVA.radiusPerStack * (stacks - 1)
      + (evolved ? NOVA.evolveRadiusBonus : 0),
    burn: evolved,
  };
}

/** Orbital numbers for a given stack count (evolved or not). */
export function orbitalStats(stacks, evolved) {
  return {
    count: ORBITAL.countPerStack * stacks * (evolved ? 2 : 1),
    damage: ORBITAL.damage + ORBITAL.damagePerStack * (stacks - 1),
    speed: ORBITAL.speed * (evolved ? ORBITAL.evolveSpeedMult : 1),
    radius: ORBITAL.radius,
  };
}

/** Chain jumps for a given stack count (evolved or not). */
export function chainJumps(stacks, evolved) {
  let jumps = stacks;
  if (evolved) jumps += CHAIN.evolveJumpsBonus;
  return jumps;
}

/** Lifesteal heal per kill for a given stack count. */
export function lifestealPerKill(stacks) {
  return LIFESTEAL.healPerKillPerStack * stacks;
}
