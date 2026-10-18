export function randomInteger(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

/**
 * Small deterministic PRNG. All theme randomness is drawn from one of these seeded by
 * an assignment's `seed`, so a palette is reproducible from its seed alone — which is
 * what lets the harness assert rotation/stability properties and what will let a theme
 * be shared as a number.
 */
export function mulberry32(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = seed
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A fresh random seed for a new assignment. */
export function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff) >>> 0
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
