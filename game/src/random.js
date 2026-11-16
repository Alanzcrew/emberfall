// Seeded RNG for Emberfall v2: mulberry32. Unchanged from v1 — the same
// seed must always produce the same sequence, which is what makes ?seed
// replays stable across versions.
/**
 * Create a deterministic mulberry32 PRNG from a 32-bit seed.
 * Returns a function next() -> float in [0, 1). The same seed always
 * produces the same sequence, which is what makes ?seed replays stable.
 *
 * @param {number} seed any integer; coerced to an unsigned 32-bit value.
 * @returns {() => number}
 */
export function createRandom(seed) {
  let a = (seed >>> 0) || 0;

  function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // Convenience helpers on the generator itself; world/shots may use them,
  // but the plain next() call is the only contract. v2 keeps this module
  // byte-identical in behaviour to v1 so old seeds replay the same way.
  next.int = (n) => Math.floor(next() * n);
  next.range = (min, max) => min + next() * (max - min);
  next.pick = (arr) => arr[Math.floor(next() * arr.length)];
  next.chance = (p) => next() < p;

  return next;
}
