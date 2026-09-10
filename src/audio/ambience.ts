import { config } from '../sim/config'

/**
 * The beach bed: lapping water and distant gulls, running under everything.
 *
 * Not `<audio loop>`. A hard loop point on a recording of waves clicks audibly, because
 * the waveform almost never happens to be at the same place after 75 seconds. Instead
 * the clip is scheduled repeatedly with each pass overlapping the last: every playback
 * fades up over a few seconds, runs, and fades back down, with the next one starting
 * mid-fade. The join lands in the middle of a crossfade where there is nothing to hear.
 *
 * Browsers will not start audio before the page has been interacted with, so the whole
 * thing waits for the first key or click and then fades up from silence.
 */

const TRACK =
  '/assets/sounds/jonathanslattermusic-sea-gently-lapping-waves-far-away-seagulls-486892.mp3'

/** How far ahead the next pass is queued. Comfortably longer than the pump interval. */
const LOOKAHEAD = 6
const PUMP_INTERVAL = 2000
/** Seconds the bed takes to arrive when the game starts, and to leave when muted. */
const OPENING_FADE = 2.5
const MUTE_FADE = 0.5

export class Ambience {
  private context: AudioContext | null = null
  private master: GainNode | null = null
  private buffer: AudioBuffer | null = null
  private nextStart = 0
  private pump = 0
  private muted = false
  private started = false

  /**
   * Begins loading immediately but does not make a sound until `unlockOn` fires. The
   * download and decode are the slow part, so getting them underway early means the bed
   * is ready the moment the player touches a key.
   */
  async load(): Promise<void> {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return

    this.context = new Ctor()
    this.master = this.context.createGain()
    this.master.gain.value = 0
    this.master.connect(this.context.destination)

    try {
      const response = await fetch(TRACK)
      if (!response.ok) throw new Error(`${response.status}`)
      this.buffer = await this.context.decodeAudioData(await response.arrayBuffer())
    } catch {
      // No ambience is a perfectly playable game; never let it take the page down.
      this.buffer = null
    }
  }

  /** Starts the bed on the first real interaction, which is when browsers allow it. */
  unlockOn(target: EventTarget = window): void {
    const begin = () => {
      target.removeEventListener('keydown', begin)
      target.removeEventListener('pointerdown', begin)
      void this.start()
    }
    target.addEventListener('keydown', begin)
    target.addEventListener('pointerdown', begin)
  }

  private async start(): Promise<void> {
    if (this.started || !this.context || !this.master || !this.buffer) return
    this.started = true

    if (this.context.state === 'suspended') await this.context.resume()

    const now = this.context.currentTime
    this.master.gain.cancelScheduledValues(now)
    this.master.gain.setValueAtTime(0, now)
    this.master.gain.linearRampToValueAtTime(this.target(), now + OPENING_FADE)

    this.nextStart = now + 0.05
    this.schedule()
    this.pump = window.setInterval(() => this.schedule(), PUMP_INTERVAL)
  }

  /** Queues whatever passes fall inside the lookahead window. */
  private schedule(): void {
    const ctx = this.context
    const buffer = this.buffer
    if (!ctx || !buffer || !this.master) return

    const fade = Math.max(0.05, Math.min(config.audio.crossfadeSeconds, buffer.duration / 3))

    while (this.nextStart < ctx.currentTime + LOOKAHEAD) {
      const at = Math.max(this.nextStart, ctx.currentTime + 0.02)

      const source = ctx.createBufferSource()
      source.buffer = buffer

      const gain = ctx.createGain()
      source.connect(gain)
      gain.connect(this.master)

      gain.gain.setValueAtTime(0, at)
      gain.gain.linearRampToValueAtTime(1, at + fade)
      gain.gain.setValueAtTime(1, at + buffer.duration - fade)
      gain.gain.linearRampToValueAtTime(0, at + buffer.duration)

      source.start(at)
      source.stop(at + buffer.duration + 0.05)

      // The next pass begins while this one is still fading out, so the two overlap
      // exactly across the crossfade.
      this.nextStart = at + buffer.duration - fade
    }
  }

  private target(): number {
    return this.muted ? 0 : Math.max(0, Math.min(config.audio.volume, 1))
  }

  /** Applies a volume change from the tuning panel without a click. */
  refreshVolume(): void {
    if (!this.context || !this.master || !this.started) return
    const now = this.context.currentTime
    this.master.gain.cancelScheduledValues(now)
    this.master.gain.setTargetAtTime(this.target(), now, 0.08)
  }

  toggleMute(): boolean {
    this.muted = !this.muted
    if (this.context && this.master && this.started) {
      const now = this.context.currentTime
      this.master.gain.cancelScheduledValues(now)
      this.master.gain.setValueAtTime(this.master.gain.value, now)
      this.master.gain.linearRampToValueAtTime(this.target(), now + MUTE_FADE)
    }
    return this.muted
  }

  get isMuted(): boolean {
    return this.muted
  }

  stop(): void {
    clearInterval(this.pump)
    void this.context?.close()
    this.context = null
    this.master = null
    this.started = false
  }
}
