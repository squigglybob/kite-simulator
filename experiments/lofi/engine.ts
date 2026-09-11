/**
 * The scheduler, and the only class in the module.
 *
 * Two clocks, the same arrangement `src/audio/ambience.ts` already uses: a `setInterval`
 * that wakes up often and queues everything falling inside a lookahead window, and the
 * audio context's own clock that decides when those events actually sound. `setInterval`
 * is far too imprecise to start a note on, but it is perfectly good at deciding that a
 * note should be started four seconds from now. The pump interval stays well under the
 * lookahead so a throttled timer never leaves a gap.
 *
 * Note that the engine takes an `AudioContext` and a destination rather than making its
 * own. That is the single seam between this experiment and the game: the standalone
 * page supplies a context it created on a button press, and the game will supply one
 * from its mixer, and nothing else about the module has to change.
 */

import { mulberry32 } from '../../src/core/rng'
import { shapeAt, type Shape } from './drift'
import { createChain, type Chain } from './fx'
import { chordsOf, nextChord, voiceBass, voiceBells, voicePad, type Chord } from './harmony'
import type { MusicParams } from './params'
import { playBass } from './voices/bass'
import { playBell } from './voices/bell'
import { playPad } from './voices/pad'

/** How far ahead events are queued, and how often the queue is topped up. */
const LOOKAHEAD = 4
const PUMP_MS = 500
/** Seconds the piece takes to arrive, and to leave. Long enough to feel intentional. */
const OPENING_FADE = 4
const CLOSING_FADE = 2

export interface ChordReport {
  chord: string
  section: Shape['section']
  seconds: number
  notes: number
}

export class MusicEngine {
  private chain: Chain | null = null
  private pump = 0
  private rng: () => number
  /** Context time the piece's own timeline is measured from. */
  private origin = 0
  /** Seconds along that timeline where the next chord begins. */
  private cursor = 0
  private chordIndex = 0
  private running = false
  /**
   * The drift's most recent multiplier on `reverbMix`, kept so that moving the reverb
   * fader can be applied at once rather than waiting for the next chord.
   */
  private reverbDrift = 1
  private cutoffDrift = 1

  /** Called as each chord is queued. The harness prints it; the game ignores it. */
  onChord: ((report: ChordReport) => void) | null = null

  /** The chords currently in play. Never empty — an empty pool has nothing to voice. */
  private chords: Chord[]

  constructor(
    private readonly ctx: AudioContext,
    private readonly destination: AudioNode,
    private params: MusicParams,
    private readonly seed: number,
    chords: readonly Chord[] = chordsOf('aeolian'),
  ) {
    this.rng = mulberry32(seed)
    this.chords = [...chords]
  }

  /**
   * Swaps the pool mid-flight. The change lands on the next chord rather than the
   * current one, so the chord already sounding is allowed to finish — switching preset
   * halfway through a chord would cut it off, which sounds like a fault.
   */
  setChords(chords: readonly Chord[]): void {
    if (chords.length === 0) return
    this.chords = [...chords]
    if (this.chordIndex >= this.chords.length) this.chordIndex = 0
  }

  start(): void {
    if (this.running) return
    this.running = true

    this.chain = createChain(this.ctx, this.destination, this.params, this.seed)
    this.rng = mulberry32(this.seed)
    this.origin = this.ctx.currentTime + 0.1
    this.cursor = 0
    this.chordIndex = 0

    this.chain.setGain(this.params.gain, this.ctx.currentTime, OPENING_FADE / 3)
    this.schedule()
    this.pump = window.setInterval(() => this.schedule(), PUMP_MS)
  }

  stop(): void {
    if (!this.running) return
    this.running = false
    clearInterval(this.pump)

    const chain = this.chain
    this.chain = null
    if (!chain) return

    chain.setGain(0, this.ctx.currentTime, CLOSING_FADE / 3)
    // Torn down only after the fade has actually finished; disposing immediately cuts
    // the tail off mid-ring, which is worse than not fading at all.
    window.setTimeout(() => chain.dispose(), (CLOSING_FADE + 1) * 1000)
  }

  /**
   * Live parameter changes. Levels, tone and reverb land on the notes already ringing,
   * because everything that is only a gain lives on a bus rather than in a note's
   * envelope. The rest — chord length, density, the dropout dice — can only apply to
   * chords not yet planned, and so take effect at the next chord change.
   */
  setParams(patch: Partial<MusicParams>): void {
    const previous = this.params
    this.params = { ...previous, ...patch }
    const chain = this.chain
    if (!chain) return

    chain.setGain(this.params.gain, this.ctx.currentTime)
    chain.setVoiceGains(this.params)
    chain.setHiss(this.params.hiss)
    chain.setWow(this.params.wowDepth, this.params.wowRate)
    chain.setReverb(Math.min(1, this.params.reverbMix * this.reverbDrift))
    chain.setPadCutoff(this.params.brightness * this.cutoffDrift)
    chain.setPadLfo(this.params.padLfoDepth, this.params.padLfoSeconds)
    chain.setPadFilterLfo(this.params.padFilterLfoDepth, this.params.padFilterLfoSeconds)
    // The only one that is not just a gain: the impulse response has to be regenerated,
    // so it is left until the value has actually changed.
    if (this.params.reverbSeconds !== previous.reverbSeconds) {
      chain.setReverbTail(this.params.reverbSeconds)
    }
  }

  get isRunning(): boolean {
    return this.running
  }

  private schedule(): void {
    const chain = this.chain
    if (!chain || !this.running) return

    const elapsed = Math.max(0, this.ctx.currentTime - this.origin)

    // The continuous half of the drift is applied every pump, not every chord. A swell
    // that only moved when the harmony did would not be a swell, it would be a series
    // of level changes you could count. The discontinuous half — which voices play at
    // all — stays chord-aligned, down in planChord, because a voice vanishing mid-chord
    // sounds like a fault rather than an arrangement.
    const now = shapeAt(elapsed, this.params, this.seed)
    this.reverbDrift = this.params.reverbMix > 0 ? now.reverb / this.params.reverbMix : 1
    this.cutoffDrift = this.params.brightness > 0 ? now.cutoff / this.params.brightness : 1
    chain.setVoiceGains(this.params)
    chain.setPadSection(now.pad)
    chain.setPadCutoff(now.cutoff)
    chain.setReverb(now.reverb)

    while (this.cursor < elapsed + LOOKAHEAD) this.planChord(chain, elapsed)
  }

  private planChord(chain: Chain, elapsed: number): void {
    const params = this.params
    const chord = this.chords[this.chordIndex]
    const shape = shapeAt(this.cursor, params, this.seed)
    const duration = Math.max(
      3,
      params.chordSeconds + (this.rng() * 2 - 1) * params.chordJitter,
    )
    const startAt = this.origin + this.cursor

    // Events are generated whether or not they will be played. A backgrounded tab
    // throttles the pump, and the catch-up would otherwise consume a different number of
    // random numbers and send the rest of the piece down a different path — which would
    // make the seed a lie the moment anyone switched tabs.
    const pad = voicePad(chord, params, shape, duration, this.rng)
    const bass = voiceBass(chord, params, duration)
    const bells = voiceBells(chord, params, shape, duration, this.rng)
    const audible = this.cursor + duration > elapsed

    if (audible) {
      // The pad is never gated. It swells and fades on its bus, but it is always there.
      for (const event of pad) playPad(this.ctx, event, chain, params, startAt)
      if (shape.bass > 0) playBass(this.ctx, bass, chain, params, shape, startAt)
      if (shape.bells > 0) for (const event of bells) playBell(this.ctx, event, chain, shape, startAt)

      this.onChord?.({
        chord: chord.name,
        section: shape.section,
        seconds: duration,
        notes: pad.length + (shape.bass > 0 ? 1 : 0) + (shape.bells > 0 ? bells.length : 0),
      })
    }

    this.cursor += duration
    this.chordIndex = nextChord(this.chordIndex, this.rng, this.chords.length)
  }
}
