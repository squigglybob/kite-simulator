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
 * Level, mute and the gesture that starts the audio all belong to the mixer channel
 * this feeds; what is left here is the scheduling that makes the loop inaudible.
 */

const TRACK =
  '/assets/sounds/jonathanslattermusic-sea-gently-lapping-waves-far-away-seagulls-486892.mp3'

/** How far ahead the next pass is queued. Comfortably longer than the pump interval. */
const LOOKAHEAD = 6
const PUMP_INTERVAL = 2000

export class Ambience {
  private buffer: AudioBuffer | null = null
  private nextStart = 0
  private pump = 0
  /**
   * Download and unlock race each other, and either order is normal: a player who
   * clicks immediately beats the 2 MB clip, one who reads the page first does not.
   * Both are recorded and whichever lands second starts the bed.
   */
  private wanted = false
  private running = false

  constructor(
    private readonly ctx: AudioContext,
    private readonly destination: AudioNode,
  ) {}

  /** Begins downloading straight away; makes no sound until `start` is also called. */
  async load(): Promise<void> {
    try {
      const response = await fetch(TRACK)
      if (!response.ok) throw new Error(`${response.status}`)
      this.buffer = await this.ctx.decodeAudioData(await response.arrayBuffer())
    } catch {
      // No ambience is a perfectly playable game; never let it take the page down.
      this.buffer = null
      return
    }
    if (this.wanted) this.begin()
  }

  /** Called once the context is unlocked. Safe before the clip has arrived. */
  start(): void {
    this.wanted = true
    if (this.buffer) this.begin()
  }

  private begin(): void {
    if (this.running) return
    this.running = true
    this.nextStart = this.ctx.currentTime + 0.05
    this.schedule()
    this.pump = window.setInterval(() => this.schedule(), PUMP_INTERVAL)
  }

  /** Queues whatever passes fall inside the lookahead window. */
  private schedule(): void {
    const buffer = this.buffer
    if (!buffer) return

    const fade = Math.max(0.05, Math.min(config.audio.crossfadeSeconds, buffer.duration / 3))

    while (this.nextStart < this.ctx.currentTime + LOOKAHEAD) {
      const at = Math.max(this.nextStart, this.ctx.currentTime + 0.02)

      const source = this.ctx.createBufferSource()
      source.buffer = buffer

      const gain = this.ctx.createGain()
      source.connect(gain)
      gain.connect(this.destination)

      gain.gain.setValueAtTime(0, at)
      gain.gain.linearRampToValueAtTime(1, at + fade)
      gain.gain.setValueAtTime(1, at + buffer.duration - fade)
      gain.gain.linearRampToValueAtTime(0, at + buffer.duration)

      source.start(at)
      source.stop(at + buffer.duration + 0.05)
      source.addEventListener('ended', () => {
        source.disconnect()
        gain.disconnect()
      })

      // The next pass begins while this one is still fading out, so the two overlap
      // exactly across the crossfade.
      this.nextStart = at + buffer.duration - fade
    }
  }

  stop(): void {
    clearInterval(this.pump)
    this.pump = 0
    this.running = false
    this.wanted = false
  }
}
