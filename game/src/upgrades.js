// EMBERFALL — level-up upgrades. Pure logic, no DOM: safe to import from
// Node. The player's live numbers live in a stats object shaped like the one
// baseStats() returns; applyUpgrade() mutates that object in place.

import { PLAYER } from './config.js';

/**
 * A fresh stats object with the run's default values (copied from config).
 * Shape: { fireRate, damage, projectiles, pierce, speed, magnet, maxHp,
 * bulletSpeed, bulletRange }.
 */
export function baseStats() {
  return {
    fireRate: PLAYER.fireRate,
    damage: PLAYER.bulletDamage,
    projectiles: PLAYER.projectiles,
    pierce: PLAYER.pierce,
    speed: PLAYER.speed,
    magnet: PLAYER.magnet,
    maxHp: PLAYER.maxHp,
    bulletSpeed: PLAYER.bulletSpeed,
    bulletRange: PLAYER.bulletRange,
  };
}

// Every upgrade the lantern-keeper can roll. `max` is the stack cap; each
// entry's `apply` is a small pure mutation of the stats object. The vitality
// heal (+25 HP on pick) is applied by world.js, which owns the live hp value.
export const UPGRADE_DEFS = [
  {
    id: 'rapid',
    name: 'Rapid Embers',
    desc: '+18% fire rate',
    max: 5,
    apply(stats) { stats.fireRate *= 1.18; },
  },
  {
    id: 'heavy',
    name: 'Heavy Embers',
    desc: '+1 ember damage',
    max: 5,
    apply(stats) { stats.damage += 1; },
  },
  {
    id: 'twin',
    name: 'Twin Shot',
    desc: '+1 projectile (spread)',
    max: 5,
    apply(stats) { stats.projectiles += 1; },
  },
  {
    id: 'pierce',
    name: 'Piercing Embers',
    desc: '+1 pierce — bolts pass through one more gloom',
    max: 5,
    apply(stats) { stats.pierce += 1; },
  },
];
UPGRADE_DEFS.push(
  {
    id: 'swift',
    name: 'Swift Boots',
    desc: '+10% move speed',
    max: 5,
    apply(stats) { stats.speed *= 1.1; },
  },
  {
    id: 'magnet',
    name: 'Ember Magnet',
    desc: '+45% pickup radius',
    max: 5,
    apply(stats) { stats.magnet *= 1.45; },
  },
  {
    id: 'vitality',
    name: 'Vitality',
    desc: '+25 max HP and heal 25',
    max: 5,
    apply(stats) { stats.maxHp += 25; },
  },
  {
    id: 'longfuse',
    name: 'Long Fuse',
    desc: '+15% bullet speed and +15% range',
    max: 5,
    apply(stats) { stats.bulletSpeed *= 1.15; stats.bulletRange *= 1.15; },
  },
);

/**
 * Roll 3 distinct upgrades the player can still take.
 * @param {function} random - seeded () => [0, 1) source.
 * @param {Object} owned - map of upgrade id -> stacks taken so far.
 * @returns {Array} up to 3 defs, each with owned[id] < def.max.
 */
export function rollUpgrades(random, owned) {
  const available = UPGRADE_DEFS.filter((def) => (owned[def.id] || 0) < def.max);
  // Fisher-Yates shuffle driven by the seeded random, so a given seed rolls
  // the same choices every time.
  for (let i = available.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const tmp = available[i];
    available[i] = available[j];
    available[j] = tmp;
  }
  return available.slice(0, 3);
}

/**
 * Apply one upgrade to a stats object, in place.
 * @param {Object} stats - the player's live stats (see baseStats()).
 * @param {string} id - upgrade id from UPGRADE_DEFS.
 * @returns {boolean} true when the id matched a known upgrade.
 */
export function applyUpgrade(stats, id) {
  const def = UPGRADE_DEFS.find((d) => d.id === id);
  if (!def) return false;
  def.apply(stats);
  return true;
}
