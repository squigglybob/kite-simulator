/**
 * Presets: a chord set and a full set of parameters under one name.
 *
 * A "feel" is not just a filter setting and not just a mode — it is both, and changing
 * one without the other mostly does not work. Lydian played dark and slow loses the
 * lift that makes it lydian; phrygian played bright and busy loses the shadow. So a
 * preset carries the chords and the numbers together, and switching preset switches
 * both.
 *
 * The built-in ones live in code so they survive a cleared browser. Anything saved from
 * the panel goes to localStorage, and the two are listed together with saved ones
 * marked, since in use the distinction rarely matters.
 */

import { CHORD_SETS, type ChordSetName } from './harmony'
import { BASE, type MusicParams } from './params'

export interface Preset {
  name: string
  chordSet: ChordSetName
  /**
   * Indices into the chord set that are allowed. An empty array means all of them —
   * which is also what a set loaded from an older save with no selection will do.
   */
  chords: number[]
  params: MusicParams
}

const withBase = (patch: Partial<MusicParams>): MusicParams => ({ ...BASE, ...patch })

export const BUILT_IN: Preset[] = [
  {
    name: 'Beach',
    chordSet: 'aeolian',
    chords: [],
    params: withBase({}),
  },
  {
    name: 'Dawn',
    chordSet: 'lydian',
    chords: [],
    // Brighter, higher, and busier with bells: the lift only reads if the top end is
    // actually there to hear.
    params: withBase({
      brightness: 2100,
      root: 52,
      chordSeconds: 9,
      bellRate: 7,
      bellGain: 0.36,
      reverbSeconds: 3.8,
      hiss: 0.015,
      padFilterLfoDepth: 0.4,
      padFilterLfoSeconds: 29,
    }),
  },
  {
    name: 'Dusk',
    chordSet: 'dorian',
    chords: [],
    params: withBase({
      brightness: 1400,
      chordSeconds: 12,
      bellRate: 4,
      reverbSeconds: 5,
      reverbMix: 0.55,
    }),
  },
  {
    name: 'Night',
    chordSet: 'phrygian',
    chords: [],
    // Slow, dark and sparse. The bass carries more of it because there is less above.
    params: withBase({
      brightness: 700,
      root: 46,
      chordSeconds: 18,
      chordJitter: 5,
      bellRate: 1.5,
      bellGain: 0.22,
      bassGain: 0.44,
      reverbSeconds: 7,
      reverbMix: 0.62,
      padLfoDepth: 0.45,
      padLfoSeconds: 38,
    }),
  },
  {
    name: 'Drift',
    chordSet: 'quartal',
    chords: [],
    // Almost no movement at all: very long chords, a long tail, and bells rare enough
    // to be an event rather than a texture.
    params: withBase({
      brightness: 1000,
      chordSeconds: 28,
      chordJitter: 8,
      density: 0.45,
      bellRate: 1,
      reverbSeconds: 8,
      reverbMix: 0.7,
      padLfoDepth: 0.5,
      padLfoSeconds: 54,
      padFilterLfoSeconds: 61,
      dropoutChance: 0.3,
      sectionSeconds: 110,
    }),
  },
]

const STORAGE_KEY = 'lofi.presets'

/** Saved presets are validated on the way in; a corrupt entry is dropped, not thrown. */
export function loadSaved(): Preset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isPreset).map((preset) => ({
      ...preset,
      // Merged over BASE so a preset saved before a parameter existed still loads, with
      // the new parameter at its default rather than undefined.
      params: { ...BASE, ...preset.params },
    }))
  } catch {
    return []
  }
}

function isPreset(value: unknown): value is Preset {
  if (!value || typeof value !== 'object') return false
  const p = value as Partial<Preset>
  return (
    typeof p.name === 'string' &&
    typeof p.chordSet === 'string' &&
    p.chordSet in CHORD_SETS &&
    Array.isArray(p.chords) &&
    !!p.params &&
    typeof p.params === 'object'
  )
}

function write(presets: Preset[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets))
  } catch {
    // A full or blocked localStorage is no reason to stop the music.
  }
}

/** Saving under an existing name replaces it, which is what overwriting a slot means. */
export function save(preset: Preset): Preset[] {
  const saved = loadSaved().filter((p) => p.name !== preset.name)
  saved.push(preset)
  saved.sort((a, b) => a.name.localeCompare(b.name))
  write(saved)
  return saved
}

export function remove(name: string): Preset[] {
  const saved = loadSaved().filter((p) => p.name !== name)
  write(saved)
  return saved
}

export const isBuiltIn = (name: string): boolean => BUILT_IN.some((p) => p.name === name)
