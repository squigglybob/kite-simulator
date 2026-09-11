/**
 * The audio bus: one context, one master gain, and a named channel per source.
 *
 * Sources do not own contexts. Two sources each building their own would mean two
 * unlock handlers, two clocks to schedule against, and nowhere coherent to put a master
 * mute — so the context, the gesture that unlocks it and the master level all live here,
 * and a source receives a context and a node to connect to.
 *
 * Every level change glides rather than jumps. A gain written directly is a step in the
 * waveform, which is a click, and a slider dragged across its range would be a burst of
 * them. Volume and mute are also kept as separate values, so unmuting returns to the
 * slider position instead of jumping to full.
 */

export type ChannelName = 'ambience' | 'music'

export interface Channel {
  /** Sources connect here. */
  readonly input: GainNode
  setVolume(v: number): void
  setMuted(m: boolean): void
  readonly muted: boolean
}

/** Seconds the whole mix takes to arrive on the first interaction. */
const OPENING_FADE = 2.5
/** Time constants: fast enough to feel immediate, slow enough to stay silent. */
const SLIDER_GLIDE = 0.05
const MUTE_GLIDE = 0.12

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n)

/**
 * Moves a param to a target without a click.
 *
 * The hold-then-target dance is not ceremony: `cancelScheduledValues` alone can snap a
 * param back to the value of its last `setValueAtTime` rather than leaving it where the
 * ramp had reached, so the current value is pinned down before anything else is asked.
 */
function glide(param: AudioParam, target: number, timeConstant: number, now: number): void {
  const held = param.value
  param.cancelScheduledValues(now)
  param.setValueAtTime(held, now)
  param.setTargetAtTime(target, now, timeConstant)
}

class BusChannel implements Channel {
  readonly input: GainNode
  private volume = 1
  private isMuted = false

  constructor(private readonly ctx: AudioContext, destination: AudioNode) {
    this.input = ctx.createGain()
    this.input.gain.value = 1
    this.input.connect(destination)
  }

  get muted(): boolean {
    return this.isMuted
  }

  setVolume(v: number): void {
    this.volume = clamp01(v)
    this.apply(SLIDER_GLIDE)
  }

  setMuted(m: boolean): void {
    if (m === this.isMuted) return
    this.isMuted = m
    this.apply(MUTE_GLIDE)
  }

  private apply(timeConstant: number): void {
    glide(this.input.gain, this.isMuted ? 0 : this.volume, timeConstant, this.ctx.currentTime)
  }
}

export class Mixer {
  readonly ctx: AudioContext
  private readonly master: GainNode
  private readonly channels = new Map<ChannelName, BusChannel>()
  private readonly waiting: (() => void)[] = []
  private masterVolume = 1
  private masterMuted = false
  private started = false

  constructor() {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) throw new Error('Web Audio is unavailable')

    // Constructing before a gesture is allowed — the context simply starts suspended —
    // and doing so early means sources can load and decode while the page is still
    // waiting to be touched.
    this.ctx = new Ctor()
    this.master = this.ctx.createGain()
    this.master.gain.value = 0
    this.master.connect(this.ctx.destination)
  }

  channel(name: ChannelName): Channel {
    const existing = this.channels.get(name)
    if (existing) return existing
    const made = new BusChannel(this.ctx, this.master)
    this.channels.set(name, made)
    return made
  }

  setMasterVolume(v: number): void {
    this.masterVolume = clamp01(v)
    if (this.started) this.applyMaster(SLIDER_GLIDE)
  }

  setMasterMuted(m: boolean): void {
    if (m === this.masterMuted) return
    this.masterMuted = m
    if (this.started) this.applyMaster(MUTE_GLIDE)
  }

  get isMasterMuted(): boolean {
    return this.masterMuted
  }

  /** False until the first gesture. Sources that cannot start before then ask this. */
  get isUnlocked(): boolean {
    return this.started
  }

  /** Runs once the context is live, immediately if it already is. */
  onUnlock(handler: () => void): void {
    if (this.started) handler()
    else this.waiting.push(handler)
  }

  /** Browsers will not start audio before the page has been interacted with. */
  unlockOn(target: EventTarget = window): void {
    const begin = (): void => {
      target.removeEventListener('keydown', begin)
      target.removeEventListener('pointerdown', begin)
      void this.start()
    }
    target.addEventListener('keydown', begin)
    target.addEventListener('pointerdown', begin)
  }

  private async start(): Promise<void> {
    if (this.started) return
    this.started = true

    if (this.ctx.state === 'suspended') await this.ctx.resume()

    // The mix fades up from silence rather than landing on the player at full level.
    const now = this.ctx.currentTime
    this.master.gain.cancelScheduledValues(now)
    this.master.gain.setValueAtTime(0, now)
    this.master.gain.linearRampToValueAtTime(this.masterTarget(), now + OPENING_FADE)

    for (const handler of this.waiting) handler()
    this.waiting.length = 0
  }

  private masterTarget(): number {
    return this.masterMuted ? 0 : this.masterVolume
  }

  private applyMaster(timeConstant: number): void {
    glide(this.master.gain, this.masterTarget(), timeConstant, this.ctx.currentTime)
  }
}
