// EMBERFALL v3 — seeded RNG. A tiny SplitMix64 ported to BigInt so one seed
// reproduces one run on every engine and every Node version. The world and
// the wave generator each get a child stream derived from the run seed, so
// adding a roll in one system never reshuffles the other.
//
// First outputs are pinned by the sim (seed 0 -> see simulate.mjs).

const MASK = (1n << 64n) - 1n;

export class SplitMix64 {
  constructor(seed) {
    this.state = BigInt(seed >>> 0) & MASK;
  }

  nextU64() {
    this.state = (this.state + 0x9e3779b97f4a7c15n) & MASK;
    let z = this.state;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK;
    return z ^ (z >> 31n);
  }

  /** Uniform double in [0, 1). */
  next() {
    // Top 53 bits -> double, the standard float conversion.
    return Number(this.nextU64() >> 11n) / 2 ** 53;
  }

  /** Integer in [0, n) without modulo bias. */
  below(n) {
    if (n <= 1) return 0;
    const limit = MASK - ((MASK + 1n) % BigInt(n));
    let x;
    do { x = this.nextU64(); } while (x > limit);
    return Number(x % BigInt(n));
  }

  /** Integer in [min, max] inclusive. */
  int(min, max) {
    return min + this.below(max - min + 1);
  }

  /** Uniform double in [min, max). */
  range(min, max) {
    return min + this.next() * (max - min);
  }

  /** True with probability p (0..1). */
  chance(p) {
    return this.next() < p;
  }

  /** Pick one element of a non-empty array. */
  pick(arr) {
    return arr[this.below(arr.length)];
  }

  /** Fisher-Yates shuffle, in place, driven by this stream. */
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.below(i + 1);
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  /** Derive an independent child stream (layout, loot, decoration ...). */
  child(salt) {
    return new SplitMix64(Number((this.nextU64() ^ BigInt(salt >>> 0)) & 0xffffffffn));
  }
}

/** Convenience factory used by the world and the shot stager. */
export function createRandom(seed) {
  return new SplitMix64(seed >>> 0);
}
