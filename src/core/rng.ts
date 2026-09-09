/**
 * Seeded randomness and value noise. Used for scenery that must look organic but
 * regenerate identically every run — horizon profiles, cloud and prop placement.
 */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Deterministic hash of one integer to [0, 1). */
export function hash1(n: number, seed = 0): number {
  let h = Math.imul(n ^ seed, 0x27d4eb2d)
  h ^= h >>> 15
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  return (h >>> 0) / 4294967296
}

const smoothstep = (t: number): number => t * t * (3 - 2 * t)

/** 1D value noise with smooth interpolation. Period is 1 unit of `x`. */
export function valueNoise1D(x: number, seed = 0): number {
  const i = Math.floor(x)
  const f = smoothstep(x - i)
  return hash1(i, seed) * (1 - f) + hash1(i + 1, seed) * f
}

/** Fractal sum of value noise. Returns roughly [0, 1). */
export function fbm1D(x: number, octaves = 4, seed = 0): number {
  let sum = 0
  let amp = 0.5
  let freq = 1
  let norm = 0
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise1D(x * freq, seed + o * 1013) * amp
    norm += amp
    amp *= 0.5
    freq *= 2
  }
  return sum / norm
}
