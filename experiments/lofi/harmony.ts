/**
 * What notes to play. No Web Audio in this file, by rule.
 *
 * The harmony is hand-authored and the performance is generated. Picking chords at
 * random from a scale produces something that is technically in key and audibly
 * aimless; picking from six chords that were chosen because they sound good together
 * produces something that sounds deliberate even when the order is not. Everything that
 * varies — which notes of the chord sound, in what register, spread how wide, entering
 * when — is generated on top of that fixed base.
 *
 * The pool is D aeolian throughout. No leading tone and no dominant seventh anywhere,
 * which is what keeps it from ever sounding like it wants to resolve: a progression
 * that implies an ending is the wrong shape for music meant to run for an hour.
 */

import type { MusicParams } from './params'
import type { Shape } from './drift'

export interface Chord {
  name: string
  /** Semitones above the tonic. */
  root: number
  /** Semitones above the chord root. Values past 12 are extensions, kept up there. */
  intervals: number[]
}

/** Ordered by root so that adjacent indices are adjacent scale degrees. */
export const POOL: Chord[] = [
  { name: 'i m9', root: 0, intervals: [0, 3, 7, 10, 14] },
  { name: 'III maj7', root: 3, intervals: [0, 4, 7, 11, 14] },
  { name: 'iv m11', root: 5, intervals: [0, 3, 7, 10, 17] },
  { name: 'v m7', root: 7, intervals: [0, 3, 7, 10, 14] },
  { name: 'VI maj7', root: 8, intervals: [0, 4, 7, 11, 14] },
  { name: 'VII sus2', root: 10, intervals: [0, 2, 7, 11] },
]

/**
 * Weight for a move of n scale steps, where the pool wraps so the largest possible
 * distance is three. Zero for a repeat — holding the same chord twice reads as the
 * generator having stalled, not as a musical choice — and falling off with distance, so
 * it wanders by step and leaps only occasionally.
 */
const STEP_WEIGHT = [0, 4, 3, 2]
/** Added to the tonic's weight so the progression keeps drifting back to home. */
const TONIC_PULL = 1.5

/** Below this the pad turns to mud; only the bass is allowed under it. D3, about 147 Hz. */
const PAD_LOW = 50
const PAD_HIGH = 81
/** A1 to A2. Low enough to feel, high enough to survive a laptop speaker. */
const BASS_LOW = 33
const BASS_HIGH = 45
const BELL_LOW = 72
const BELL_HIGH = 93

export type VoiceName = 'pad' | 'bass' | 'bell'

export interface NoteEvent {
  voice: VoiceName
  midi: number
  /** Seconds after the chord begins. */
  at: number
  /** Seconds the note is held. Each voice adds its own release tail past this. */
  duration: number
  /** 0 to 1, before the voice's own gain is applied. */
  level: number
  /** -1 hard left to 1 hard right. */
  pan: number
}

export const midiToFreq = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12)

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

/** Octave-shifts a pitch until it lands inside the range, whichever side it started. */
function fold(midi: number, low: number, high: number): number {
  let n = midi
  while (n > high) n -= 12
  while (n < low) n += 12
  return n
}

/** Circular distance between two pool indices. */
const stepsBetween = (a: number, b: number): number => {
  const raw = Math.abs(a - b) % POOL.length
  return Math.min(raw, POOL.length - raw)
}

export function nextChord(current: number, rng: () => number): number {
  const weights = POOL.map((_, i) => {
    const step = STEP_WEIGHT[stepsBetween(current, i)] ?? 0
    // A zero is never rescued by the tonic pull. Without this guard, sitting on the
    // tonic gives it a weight of TONIC_PULL against its own zero and the progression
    // repeats a chord roughly once every seventy.
    if (step === 0) return 0
    return i === 0 ? step + TONIC_PULL : step
  })

  let roll = rng() * weights.reduce((sum, w) => sum + w, 0)
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i]
    if (roll <= 0) return i
  }
  return 0
}

/**
 * The chord itself.
 *
 * Notes are taken by walking up from a random point in the interval list and lifting an
 * octave on each wrap, which spreads the voicing across two octaves rather than stacking
 * it into a block. The two details that matter most: the entries are staggered over the
 * first second or so, so the chord blooms instead of landing as a slab, and the upper
 * notes are quieter, because an even pad with four notes above the stave is shrill no
 * matter how dark the filter is.
 */
export function voicePad(
  chord: Chord,
  params: MusicParams,
  shape: Shape,
  duration: number,
  rng: () => number,
): NoteEvent[] {
  const base = params.root + chord.root + 12 + Math.round(shape.register) * 12
  const pool = chord.intervals
  const count = 3 + Math.round(clamp01(params.density * shape.density) * 2)
  const start = Math.floor(rng() * pool.length)

  const pitches: number[] = []
  for (let i = 0; i < count; i++) {
    const raw = start + i
    const midi = base + pool[raw % pool.length] + 12 * Math.floor(raw / pool.length)
    const folded = fold(midi, PAD_LOW, PAD_HIGH)
    if (!pitches.includes(folded)) pitches.push(folded)
  }
  pitches.sort((a, b) => a - b)

  // A random rotation of the stereo spread, so successive chords do not all put their
  // lowest note in the same ear.
  const rotate = rng()

  // Taper the top of the voicing: an even pad with four notes above the stave is
  // shrill however dark the filter is.
  const taper = pitches.map((_, i) =>
    1 - (pitches.length > 1 ? i / (pitches.length - 1) : 0) * 0.45)

  // Then normalise the chord to constant total power, so three notes and five notes are
  // equally loud. Without this the density walk in `drift.ts` is audible as the music
  // getting louder and quieter rather than thicker and thinner — and a dense chord on
  // top of the bass was enough to clip the output outright.
  const power = Math.sqrt(taper.reduce((sum, level) => sum + level * level, 0))

  return pitches.map((midi, i) => {
    const up = pitches.length > 1 ? i / (pitches.length - 1) : 0
    return {
      voice: 'pad' as const,
      midi,
      at: rng() * 1.2,
      duration,
      level: taper[i] / power,
      pan: Math.sin((rotate + up) * Math.PI * 2) * 0.55,
    }
  })
}

export function voiceBass(
  chord: Chord,
  params: MusicParams,
  duration: number,
): NoteEvent {
  return {
    voice: 'bass',
    midi: fold(params.root + chord.root, BASS_LOW, BASS_HIGH),
    at: 0,
    duration,
    level: 1,
    pan: 0,
  }
}

/**
 * The sparkle. Sparse, high, and drawn from the chord so it never disagrees with the
 * pad underneath it. The count is rolled rather than spaced evenly — evenly spaced
 * bells start sounding like a metronome within a minute, which is the one thing a
 * piece with no tempo must not do.
 */
export function voiceBells(
  chord: Chord,
  params: MusicParams,
  shape: Shape,
  duration: number,
  rng: () => number,
): NoteEvent[] {
  const expected = (params.bellRate / 60) * duration * shape.bells
  const events: NoteEvent[] = []

  // Fractional expectations become a chance of one more, so a rate below one per chord
  // still sounds occasionally instead of never.
  let remaining = expected
  while (remaining > 0 && events.length < 6) {
    if (remaining < 1 && rng() > remaining) break
    remaining -= 1

    const interval = chord.intervals[Math.floor(rng() * chord.intervals.length)]
    // `fold` always lands in the bottom octave of the range, so without the lift every
    // bell in the piece sits inside the same twelve semitones and they start to sound
    // like one instrument playing one figure.
    const folded = fold(params.root + chord.root + interval, BELL_LOW, BELL_HIGH)
    const lift = rng() < 0.35 && folded + 12 <= BELL_HIGH ? 12 : 0
    events.push({
      voice: 'bell',
      midi: folded + lift,
      // Never in the first second: the chord needs a moment to establish first.
      at: 1 + rng() * Math.max(0.1, duration - 2),
      duration: 0.05,
      level: 0.55 + rng() * 0.45,
      pan: (rng() * 2 - 1) * 0.7,
    })
  }

  return events.sort((a, b) => a.at - b.at)
}
