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
 * Each set is one mode, written out as diatonic sevenths so that any order of any
 * subset of it stays coherent. What separates them is not difficulty but colour: the
 * major fourth that makes dorian hopeful, the flat second that makes phrygian dark, the
 * sharp fourth that makes lydian float. None of them contains a leading tone resolving
 * to a dominant seventh, which is what keeps every set from sounding like it wants to
 * end — a progression that implies an ending is the wrong shape for music meant to run
 * for an hour.
 *
 * Every set is written relative to the tonic, so the `root` parameter transposes all of
 * them and the sets differ only in flavour.
 */

import type { MusicParams } from './params'
import type { Shape } from './drift'

export interface Chord {
  name: string
  /** Semitones above the tonic. */
  root: number
  /** Which degree of the scale it is built on, 0 to 6. Root motion is judged by this. */
  degree: number
  /** Semitones above the chord root. Values past 12 are extensions, kept up there. */
  intervals: number[]
}

export interface ChordSet {
  /** Shown in the picker. */
  label: string
  /** What it feels like, so the choice can be made without playing all of them. */
  feel: string
  /** The seven degrees of the mode, as semitones above the tonic. */
  scale: number[]
  /** Which degrees carry a chord, as indices into `scale`, in ascending order. */
  degrees: number[]
  /** Scale steps between stacked notes. 2 stacks thirds, 3 stacks fourths. */
  stack: number
}

/**
 * Chords are built from the scale, never written out by hand.
 *
 * Hand-written interval lists are how three of these sets ended up containing notes
 * outside their own mode — an aeolian set with both a flat and a natural sixth in it,
 * so that two of its chords clashed by a semitone with the other four. Stacking degrees
 * of a declared scale makes that impossible: the quality of each chord falls out of
 * where it sits in the mode, which is what diatonic harmony is.
 */
export const CHORD_SETS: Record<string, ChordSet> = {
  aeolian: {
    label: 'Aeolian',
    feel: 'warm, wistful, settled — the original beach set',
    scale: [0, 2, 3, 5, 7, 8, 10],
    degrees: [0, 2, 3, 4, 5, 6],
    stack: 2,
  },
  dorian: {
    label: 'Dorian',
    feel: 'wistful but hopeful — the major sixth is what lifts it',
    scale: [0, 2, 3, 5, 7, 9, 10],
    degrees: [0, 1, 2, 3, 4, 6],
    stack: 2,
  },
  lydian: {
    label: 'Lydian',
    feel: 'bright, floating, unresolved — the sharp fourth never lands',
    scale: [0, 2, 4, 6, 7, 9, 11],
    degrees: [0, 1, 2, 4, 5, 6],
    stack: 2,
  },
  phrygian: {
    label: 'Phrygian',
    feel: 'dark and still — the flat second gives it the shadow',
    scale: [0, 1, 3, 5, 7, 8, 10],
    degrees: [0, 1, 2, 3, 5, 6],
    stack: 2,
  },
  mixolydian: {
    label: 'Mixolydian',
    feel: 'open and easy — major, but the flat seventh never pulls home',
    scale: [0, 2, 4, 5, 7, 9, 10],
    degrees: [0, 1, 3, 4, 5, 6],
    stack: 2,
  },
  quartal: {
    label: 'Quartal',
    feel: 'open and placeless — fourths imply no key, so it never resolves',
    scale: [0, 2, 3, 5, 7, 9, 10],
    degrees: [0, 1, 2, 3, 4, 5],
    stack: 3,
  },
}

export type ChordSetName = string

export const CHORD_SET_NAMES = Object.keys(CHORD_SETS)

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII']

/** The nth note above a degree, staying inside the scale and rising by octaves. */
function stackNote(scale: number[], degree: number, step: number): number {
  const index = degree + step
  return scale[((index % 7) + 7) % 7] + 12 * Math.floor(index / 7)
}

/**
 * A name that says what the chord actually is, derived rather than typed, so it cannot
 * drift out of step with the notes the way a hand-written label can.
 */
function nameOf(degree: number, intervals: number[], stack: number): string {
  if (stack !== 2) return `${ROMAN[degree]} sus`
  const third = intervals[1]
  const fifth = intervals[2]
  const seventh = intervals[3]
  const ninth = intervals[4]

  const minor = third === 3
  const numeral = minor ? ROMAN[degree].toLowerCase() : ROMAN[degree]
  if (fifth === 6) return `${numeral} m7b5`

  const quality = seventh === 11 ? 'maj7' : minor ? 'm7' : '7'
  if (ninth === 14) return `${numeral} ${seventh === 11 ? 'maj9' : minor ? 'm9' : '9'}`
  return `${numeral} ${quality}`
}

function build(set: ChordSet): Chord[] {
  return set.degrees.map((degree) => {
    const root = set.scale[degree]
    const intervals = [0, 1, 2, 3].map((k) => stackNote(set.scale, degree, k * set.stack) - root)

    // The ninth is added only where it is a major ninth. A minor ninth against the root
    // is the harshest interval in the set and it appears on exactly the degrees where
    // the scale has a semitone two steps up, so it has to be tested for rather than
    // assumed. Fourth-stacked chords get no extension at all; they are already wide.
    if (set.stack === 2) {
      const ninth = stackNote(set.scale, degree, 4 * set.stack) - root
      if (ninth === 14) intervals.push(ninth)
    }

    return { name: nameOf(degree, intervals, set.stack), root, degree, intervals }
  })
}

const built = new Map<string, Chord[]>()

export function chordsOf(name: ChordSetName): readonly Chord[] {
  const cached = built.get(name)
  if (cached) return cached
  const set = CHORD_SETS[name] ?? CHORD_SETS.aeolian
  const chords = build(set)
  built.set(name, chords)
  return chords
}

/**
 * How good each kind of root motion is, indexed by how many scale degrees the root
 * rises. This replaces weighting by position in the list, which knew nothing about
 * music: it rated a move by how far apart two chords sat in an array, and so rated
 * i to VII — a step down, the weakest move there is — as the single most likely
 * choice in the set.
 *
 * The ordering here is the common-practice one. Root rising a fourth is the strongest
 * progression in tonal music and covers v-i, ii-V and vi-ii. Falling a third is nearly
 * as good and keeps two notes in common. Rising a step has no common tones at all,
 * which reads as motion rather than drift. Falling a step is the retrogression every
 * textbook warns about, so it is possible but rare — VII still gets reached, by
 * arriving from somewhere else and resolving up into i.
 *
 * Every value is exposed in the panel, because "wonky" is a judgement of taste before
 * it is a rule, and these are only defaults.
 */
export const MOTION_LABELS = [
  'repeat',
  'step up',
  'third up',
  'fourth up',
  'fifth up',
  'third down',
  'step down',
]

export const DEFAULT_MOTION = [0, 3, 2, 5, 3, 4, 1]

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

/**
 * Percussion, which is not a note and so is not a NoteEvent.
 *
 * There is no grid and no tempo here: hits are scattered through the chord the same way
 * the bells are. That is the whole point of this stage — texture that makes the room
 * feel less static, without committing the piece to a pulse it was not built around.
 */
export type PercTimbre = 'shaker' | 'tap' | 'swell'

export interface PercEvent {
  timbre: PercTimbre
  /** Seconds after the chord begins. */
  at: number
  /** Resonant frequency for a tap, or filter centre for the noisy timbres. */
  freq: number
  level: number
  pan: number
}

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
/**
 * The next chord, chosen by how good the root motion is.
 *
 * With a pool narrowed to one or two chords every weight would be zero and the walk
 * would stall, so a single chord simply stays put and a pair alternates. If the motion
 * weights are all set to zero the same would happen, so that falls back to an even
 * choice among everything but the current chord — a panel setting should never be able
 * to make the music stop.
 */
export function nextChord(
  current: number,
  rng: () => number,
  chords: readonly Chord[],
  motion: readonly number[] = DEFAULT_MOTION,
): number {
  const size = chords.length
  if (size <= 1) return 0
  if (size === 2) return current === 0 ? 1 : 0

  const from = chords[current].degree
  const weights = chords.map((chord, i) => {
    if (i === current) return 0
    const rise = (((chord.degree - from) % 7) + 7) % 7
    const weight = motion[rise] ?? 0
    // A zero is never rescued by the tonic pull, or a motion the panel has ruled out
    // would come back through the side door.
    if (weight <= 0) return 0
    return chord.degree === 0 ? weight + TONIC_PULL : weight
  })

  const total = weights.reduce((sum, w) => sum + w, 0)
  if (total <= 0) {
    // Everything reachable has been ruled out; move somewhere rather than stall.
    const step = 1 + Math.floor(rng() * (size - 1))
    return (current + step) % size
  }

  let roll = rng() * total
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i]
    if (roll <= 0) return i
  }
  return current === 0 ? 1 : 0
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
/** A tap is tuned to the chord, so it reads as part of the music rather than over it. */
const TAP_LOW = 64
const TAP_HIGH = 83

export function voicePerc(
  chord: Chord,
  params: MusicParams,
  shape: Shape,
  duration: number,
  rng: () => number,
): PercEvent[] {
  const expected = (params.percRate / 60) * duration * shape.perc
  const events: PercEvent[] = []

  let remaining = expected
  while (remaining > 0 && events.length < 24) {
    if (remaining < 1 && rng() > remaining) break
    remaining -= 1

    const bright = clamp01(params.percTone)
    const swell = rng() < clamp01(params.percSwell)
    // Below the swell chance, `percTone` decides how often a hit is airy noise rather
    // than a tuned wooden knock — one dial from dry and woody to loose and brushy.
    const timbre: PercTimbre = swell ? 'swell' : rng() < bright ? 'shaker' : 'tap'

    let freq: number
    if (timbre === 'tap') {
      const interval = chord.intervals[Math.floor(rng() * chord.intervals.length)]
      freq = midiToFreq(fold(params.root + chord.root + interval, TAP_LOW, TAP_HIGH))
    } else if (timbre === 'shaker') {
      freq = 4000 + rng() * 5000
    } else {
      freq = 1800 + rng() * 3000
    }

    events.push({
      timbre,
      // Unlike the bells, a hit may land straight away: percussion is texture rather
      // than a comment on the chord, so it has nothing to wait for.
      at: rng() * duration,
      freq,
      // Swells are washes rather than accents, so they sit well back.
      level: (swell ? 0.3 : 0.55) + rng() * 0.45,
      pan: (rng() * 2 - 1) * 0.8,
    })
  }

  return events.sort((a, b) => a.at - b.at)
}

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
