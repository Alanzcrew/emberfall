// EMBERFALL v3 — relics: one permanent run modifier, offered as a choice
// of 3 when the keeper reaches level 5, 10, 15 and 20. A relic is a build
// decision, not a stat bump: each one changes how a run is played.
//
// Pure data + pure apply functions: no DOM, safe to import from Node.

export const RELIC_LEVELS = [5, 10, 15, 20];

/**
 * One relic definition.
 *  id: stable key. name/desc: card text. apply: mutates the run's relic
 *  state (player.relics + stats where relevant).
 */
export const RELIC_DEFS = [
  {
    id: 'secondwind', name: 'Second Wind', desc: 'Once per run, death instead restores you to half health in a burst of flame.',
    apply: (p) => { p.relics.secondwind = true; p.relics.secondwindUsed = false; },
  },
  {
    id: 'thorns-aura', name: 'Lantern of Thorns', desc: 'Enemies that touch you take 5 damage, even without Briar Lantern.',
    apply: (p) => { p.relics.thornsAura = true; },
  },
  {
    id: 'magnet-core', name: 'Ember Magnet', desc: 'Pickup radius more than doubles — shards fly to you.',
    apply: (p) => { p.stats.magnet *= 2.2; p.relics.magnetCore = true; },
  },
  {
    id: 'greed-sigil', name: 'Greed Sigil', desc: '+25% score from every kill and wave bonus.',
    apply: (p) => { p.relics.greed = true; },
  },
  {
    id: 'swift-boots', name: 'Swift Boots', desc: '+15% move speed and dashes recharge 25% faster.',
    apply: (p) => { p.stats.speed *= 1.15; p.stats.dashRecharge *= 0.75; p.relics.swift = true; },
  },
  {
    id: 'heavy-bolts', name: 'Heavy Bolts', desc: '+1 bolt damage, −10% fire rate. Slow, but every hit lands like a hammer.',
    apply: (p) => { p.stats.bulletDamage += 1; p.stats.fireRate *= 0.9; p.relics.heavy = true; },
  },
];

/** Fresh relic state for a new run. */
export function baseRelics() {
  return {
    secondwind: false, secondwindUsed: false,
    thornsAura: false, magnetCore: false, greed: false,
    swift: false, heavy: false,
  };
}

/** Look a def up by id. */
export function relicById(id) {
  return RELIC_DEFS.find((d) => d.id === id) || null;
}

/** Apply a relic to the player object. Returns false on an unknown id. */
export function applyRelic(player, id) {
  const def = relicById(id);
  if (!def) return false;
  def.apply(player);
  return true;
}

/** Score multiplier from the Greed Sigil (1 when not owned). */
export function scoreMult(player) {
  return player.relics.greed ? 1.25 : 1;
}

/** Flat contact damage from relic thorns (0 when not owned). */
export function relicThorns(player) {
  return player.relics.thornsAura ? 5 : 0;
}
