/**
 * Every audible quantity in the module, in one place.
 *
 * Nothing in the voices or the effects chain carries a tuning literal of its own. That
 * is not tidiness for its own sake: phase 5 drops this straight into `config.audio` and
 * the game's tuning panel builds sliders from it, so anything hidden inside a voice is
 * a value that can never be tuned by ear. Numbers only, for the same reason — the
 * config merge in `src/ui/tuning.ts` only carries numbers and objects across.
 */
export interface MusicParams {
  /** Level of the whole module before it reaches its destination, 0 to 1. */
  gain: number

  /** Lowpass corner the pad sits behind, in Hz. The single biggest tone control. */
  brightness: number
  /** Detune spread across the pad's oscillator stack, in cents. */
  warmth: number
  /** How much of each chord sounds, 0 to 1. Low values leave gaps in the voicing. */
  density: number

  /** MIDI note of the tonic. 50 is D3. */
  root: number
  /** Seconds a chord is held. */
  chordSeconds: number
  /** Random variation either side of `chordSeconds`, in seconds. */
  chordJitter: number

  /** Pitch wobble depth in cents, and its rate in Hz. The tape character lives here. */
  wowDepth: number
  wowRate: number

  /** Reverb tail length in seconds, and how much of each voice is sent to it. */
  reverbSeconds: number
  reverbMix: number

  /** Broadband noise bed level, 0 to 1. Deliberately small. */
  hiss: number

  /** Voice levels, 0 to 1. */
  padGain: number
  bassGain: number
  bellGain: number
  /**
   * Level of an oscillator an octave above the bass note, 0 to 1. The bass fundamental
   * sits under 200 Hz where laptop speakers reproduce nothing, so this is what decides
   * whether the bass is audible at all on the speakers most people actually have.
   */
  bassOctave: number
  /**
   * How far the chords swell and fade, 0 to 0.9. At zero the pad holds one level; at
   * 0.5 it breathes between half volume and full. The chords never drop out whatever
   * this is set to — they are the one voice always present.
   */
  swellDepth: number

  /** Roughly how many bell notes sound per minute, before drift and dropouts. */
  bellRate: number

  /** Chance a given section drops one or more voices, 0 to 1. */
  dropoutChance: number
  /** Seconds a section lasts before the dropout dice are rolled again. */
  sectionSeconds: number
}

/**
 * The beach preset: warm, slow, dark, and light on the top end so it leaves room for
 * the surf it will eventually sit beside.
 */
export const BEACH: MusicParams = {
  gain: 0.55,

  brightness: 1200,
  warmth: 7,
  density: 0.6,

  root: 50,
  chordSeconds: 11,
  chordJitter: 3,

  wowDepth: 6,
  wowRate: 0.24,

  reverbSeconds: 4.5,
  reverbMix: 0.5,

  hiss: 0.02,

  padGain: 0.5,
  bassGain: 0.38,
  bellGain: 0.3,
  bassOctave: 0.5,
  swellDepth: 0.45,

  bellRate: 4,

  dropoutChance: 0.45,
  sectionSeconds: 75,
}

export const defaultParams = (): MusicParams => ({ ...BEACH })
