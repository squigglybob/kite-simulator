/**
 * How the piece changes over ten minutes. No Web Audio in this file either.
 *
 * Drone's failure mode is not sounding bad, it is sounding static — fine for ninety
 * seconds, wallpaper by minute five. Two mechanisms fight that.
 *
 * The first is continuous: filter corner, reverb depth, register and density each
 * follow their own very slow fractal noise walk, on deliberately unrelated periods so
 * they never line up into an audible cycle. Nothing here is fast enough to notice
 * happening; the point is that any two minutes are measurably different.
 *
 * The second is discontinuous, and does most of the work. Every section the dice decide
 * whether a voice drops out entirely, and silence turns out to be the most valuable
 * material available — it resets the ear, it costs nothing to generate, and in a beach
 * scene it lets the surf come forward on its own for a while.
 *
 * Every value is a pure function of elapsed time and the seed, with no accumulated
 * state, so the same seed gives the same hour every time.
 */

import { fbm1D, hash1 } from '../../src/core/rng'
import type { MusicParams } from './params'

export interface Shape {
  /** Pad filter corner in Hz, already drifted. */
  cutoff: number
  /**
   * Pad level from the section arrangement, 0 to 1, never zero. The swelling and fading
   * is an LFO in `fx.ts` and does not appear here — this is only how far a `hushed`
   * section pulls the chords back.
   */
  pad: number
  /** Reverb send, 0 to 1, already drifted. */
  reverb: number
  /** Octave offset for the pad. The voicing rounds it. */
  register: number
  /** Multiplier on the configured density. */
  density: number
  /** Voice multipliers. Zero means the voice has dropped out of this section. */
  bass: number
  bells: number
  perc: number
  /** What the section is doing, for the console readout. */
  section: string
}

/**
 * Periods in seconds for the four continuous walks. Chosen to be mutually awkward —
 * no two share a factor — so the combination does not repeat on any useful timescale.
 */
const CUTOFF_PERIOD = 97
const REVERB_PERIOD = 131
const REGISTER_PERIOD = 149
const DENSITY_PERIOD = 71

/** Separate seed offsets, or all four walks would be the same curve. */
const CUTOFF_SEED = 0
const REVERB_SEED = 2311
const REGISTER_SEED = 5417
const DENSITY_SEED = 7919
const SECTION_SEED = 104729
const VARIANT_SEED = 15485863

interface Variant {
  name: string
  pad: number
  bass: number
  bells: number
  perc: number
  weight: number
  /**
   * Seconds of the section this lasts before everything returns. Infinity means it
   * holds for the whole section.
   */
  holdFor: number
}

/**
 * No variant takes the pad below `hushed`, and none removes it. The chords carry the
 * identity of the piece: an arrangement that drops the bass or the bells still sounds
 * like the same music thinned out, whereas one that drops the chords sounds like a
 * different piece, or like a fault. `hushed` is what remains of the full rest — the pad
 * recedes far enough to let everything around it come forward, without going away.
 */
const VARIANTS: Variant[] = [
  { name: 'no bass', pad: 1, bass: 0, bells: 1, perc: 1, weight: 3, holdFor: Infinity },
  { name: 'no bells', pad: 1, bass: 1, bells: 0, perc: 1, weight: 3, holdFor: Infinity },
  { name: 'no perc', pad: 1, bass: 1, bells: 1, perc: 0, weight: 3, holdFor: Infinity },
  { name: 'pad alone', pad: 1, bass: 0, bells: 0, perc: 0, weight: 3, holdFor: Infinity },
  { name: 'pad and perc', pad: 1, bass: 0, bells: 0, perc: 1, weight: 2, holdFor: Infinity },
  { name: 'hushed', pad: 0.4, bass: 0.35, bells: 0, perc: 0, weight: 2, holdFor: 40 },
]

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

function pickVariant(roll: number): Variant {
  const total = VARIANTS.reduce((sum, v) => sum + v.weight, 0)
  let remaining = roll * total
  for (const variant of VARIANTS) {
    remaining -= variant.weight
    if (remaining <= 0) return variant
  }
  return VARIANTS[0]
}

/**
 * The state of the piece at `t` seconds since it started.
 *
 * Called once per chord rather than per frame, which means every change here lands on a
 * chord boundary. That is deliberate: a voice vanishing mid-chord sounds like a fault,
 * whereas the same voice failing to arrive with the next chord sounds like an
 * arrangement.
 */
export function shapeAt(t: number, params: MusicParams, seed: number): Shape {
  const cutoff = fbm1D(t / CUTOFF_PERIOD, 3, seed + CUTOFF_SEED)
  const reverb = fbm1D(t / REVERB_PERIOD, 3, seed + REVERB_SEED)
  const register = fbm1D(t / REGISTER_PERIOD, 2, seed + REGISTER_SEED)
  const density = fbm1D(t / DENSITY_PERIOD, 3, seed + DENSITY_SEED)

  const sectionSeconds = Math.max(10, params.sectionSeconds)
  const index = Math.floor(t / sectionSeconds)
  const intoSection = t - index * sectionSeconds

  let variant = VARIANTS[0]
  let name = 'full'
  // The opening section is always complete. A voice can only go missing once the
  // listener has heard it there to begin with; before that it is indistinguishable from
  // the generator being broken, and one seed in thirty opened on twenty-five seconds of
  // silence.
  if (index > 0 && hash1(index, seed + SECTION_SEED) < params.dropoutChance) {
    variant = pickVariant(hash1(index, seed + VARIANT_SEED))
    name = variant.name
  }

  const dropped = name !== 'full' && intoSection < variant.holdFor

  return {
    cutoff: params.brightness * lerp(0.55, 1.8, cutoff),
    reverb: Math.min(1, params.reverbMix * lerp(0.7, 1.35, reverb)),
    register: register * 2 - 1,
    density: lerp(0.6, 1.15, density),
    pad: dropped ? variant.pad : 1,
    bass: dropped ? variant.bass : 1,
    bells: dropped ? variant.bells : 1,
    perc: dropped ? variant.perc : 1,
    section: dropped ? name : 'full',
  }
}
