import { config } from '../sim/config'

/**
 * The recorded music: a shuffled playlist of lofi tracks, crossfaded into each other.
 *
 * Streamed through `<audio>` elements rather than decoded like the surf bed. A decoded
 * two-minute stereo track is roughly 46 MB of float32 and there are seven of them;
 * streaming costs almost nothing resident and starts playing far sooner. The bed pays
 * for decoding because it needs sample-accurate overlapping passes to hide the loop
 * seam in one short clip. A playlist has no seam to hide — each track simply fades into
 * a different one — so two decks and a gain each is the whole mechanism.
 *
 * Levels here are purely the crossfade. Volume and mute belong to the mixer channel
 * this feeds, which is also why the elements' own `volume` is never touched: routing an
 * element into the audio graph bypasses it.
 */

const TRACKS = [
  '/assets/music/alex-morgan-lofi-chill-vlog-beats-573883.mp3',
  '/assets/music/alex-morgan-lofi-cocktail-bar-568153.mp3',
  '/assets/music/alex-morgan-lofi-coffee-shop-568150.mp3',
  '/assets/music/alex-morgan-lofi-midnight-club-568164.mp3',
  '/assets/music/alex-morgan-lofi-restaurant-568157.mp3',
  '/assets/music/alex-morgan-lofi-study-rainy-night-568166.mp3',
  '/assets/music/alex-morgan-lofi-sunny-cafe-568156.mp3',
]

/** How often the active deck's remaining time is checked. */
const PUMP_INTERVAL = 250
/** Seconds before the crossfade that the next deck starts buffering. */
const PRELOAD_LEAD = 4
const MIN_FADE = 1
const MAX_FADE = 20
/** How quickly the player leaves when switched off or muted at the source. */
const STOP_FADE = 1.2

interface Deck {
  el: HTMLAudioElement
  source: MediaElementAudioSourceNode
  gain: GainNode
  /** Set the moment a deck starts its exit ramp, so it is never advanced twice. */
  leaving: boolean
  /** Context time its ramp reaches zero and it can be torn down. */
  silentAt: number
}

export class TrackPlayer {
  private order: number[] = []
  private cursor = 0
  private decks: Deck[] = []
  /** Built and buffering a few seconds early so the crossfade does not start on silence. */
  private pending: Deck | null = null
  private pump = 0
  private playing = false
  /** A whole playlist's worth of failures in a row means something is properly wrong. */
  private failures = 0

  constructor(
    private readonly ctx: AudioContext,
    private readonly destination: AudioNode,
  ) {
    this.reshuffle()
  }

  get isPlaying(): boolean {
    return this.playing
  }

  start(): void {
    if (this.playing || TRACKS.length === 0) return
    this.playing = true
    this.failures = 0
    this.begin(this.fadeSeconds())
    this.pump = window.setInterval(() => this.tick(), PUMP_INTERVAL)
  }

  stop(): void {
    if (!this.playing) return
    this.playing = false
    clearInterval(this.pump)
    this.pump = 0

    for (const deck of this.decks) this.retire(deck, STOP_FADE)
    if (this.pending) {
      this.dispose(this.pending)
      this.pending = null
    }
    // The decks are still ramping down, so they are reaped on a timer rather than now.
    const leaving = this.decks
    this.decks = []
    window.setTimeout(() => {
      for (const deck of leaving) this.dispose(deck)
    }, (STOP_FADE + 0.2) * 1000)
  }

  /** Whichever of start or stop the config now calls for. */
  setPlaying(on: boolean): void {
    if (on) this.start()
    else this.stop()
  }

  private tick(): void {
    if (!this.playing) return
    this.reap()

    const active = this.decks.find((d) => !d.leaving)
    if (!active) {
      // Everything fell over. Try the next track, but do not spin the whole playlist.
      if (this.failures < TRACKS.length) this.begin(this.fadeSeconds())
      else this.giveUp()
      return
    }

    const fade = this.fadeSeconds()
    const remaining = this.remaining(active)
    if (remaining === null) return

    if (remaining <= fade + PRELOAD_LEAD) this.preload()
    if (remaining <= fade) this.advance(fade)
  }

  /** Seconds of audio left on a deck, or null while its duration is still unknown. */
  private remaining(deck: Deck): number | null {
    const { duration, currentTime, playbackRate } = deck.el
    if (!Number.isFinite(duration) || duration <= 0) return null
    return (duration - currentTime) / (playbackRate || 1)
  }

  private advance(fade: number): void {
    for (const deck of this.decks) {
      if (!deck.leaving) this.retire(deck, fade)
    }
    this.begin(fade)
  }

  /** Builds the next deck early so it has buffered by the time it is faded up. */
  private preload(): void {
    if (this.pending) return
    this.pending = this.makeDeck(this.takeNextUrl())
  }

  private begin(fade: number): void {
    const deck = this.pending ?? this.makeDeck(this.takeNextUrl())
    this.pending = null
    this.decks.push(deck)

    const now = this.ctx.currentTime
    deck.gain.gain.cancelScheduledValues(now)
    deck.gain.gain.setValueAtTime(0, now)
    deck.gain.gain.linearRampToValueAtTime(1, now + fade)

    void deck.el.play().catch(() => this.fail(deck))
  }

  private retire(deck: Deck, fade: number): void {
    deck.leaving = true
    const now = this.ctx.currentTime
    const held = deck.gain.gain.value
    deck.gain.gain.cancelScheduledValues(now)
    deck.gain.gain.setValueAtTime(held, now)
    deck.gain.gain.linearRampToValueAtTime(0, now + fade)
    deck.silentAt = now + fade
  }

  private reap(): void {
    const now = this.ctx.currentTime
    const done = this.decks.filter((d) => d.leaving && now > d.silentAt + 0.1)
    if (done.length === 0) return
    this.decks = this.decks.filter((d) => !done.includes(d))
    for (const deck of done) this.dispose(deck)
  }

  private makeDeck(url: string): Deck {
    const el = new Audio()
    // Same-origin out of public/, so crossOrigin stays unset: setting it would force a
    // CORS preflight, and a cross-origin element feeds silence into the graph anyway.
    el.preload = 'auto'
    el.src = url
    el.load()

    const source = this.ctx.createMediaElementSource(el)
    const gain = this.ctx.createGain()
    gain.gain.value = 0
    source.connect(gain)
    gain.connect(this.destination)

    const deck: Deck = { el, source, gain, leaving: false, silentAt: 0 }

    // Backstops. A deck whose clock stops advancing would otherwise never reach the
    // remaining-time test in the pump, and the music would simply end.
    el.addEventListener('ended', () => {
      if (deck.leaving || !this.playing) return
      this.advance(this.fadeSeconds())
    })
    el.addEventListener('error', () => this.fail(deck))
    el.addEventListener('playing', () => (this.failures = 0), { once: true })

    return deck
  }

  private fail(deck: Deck): void {
    this.failures++
    if (!deck.leaving) {
      deck.leaving = true
      deck.silentAt = this.ctx.currentTime
    }
  }

  private giveUp(): void {
    console.warn('[music] every track failed to play; stopping')
    this.stop()
  }

  private dispose(deck: Deck): void {
    deck.el.pause()
    deck.gain.disconnect()
    deck.source.disconnect()
    // Dropping the source and reloading is what actually stops the download; pausing
    // alone leaves the browser buffering the rest of a track nobody will hear.
    deck.el.removeAttribute('src')
    deck.el.load()
  }

  private takeNextUrl(): string {
    if (this.cursor >= this.order.length) this.reshuffle()
    const index = this.order[this.cursor++]
    return TRACKS[index]
  }

  /** A fresh order each pass, never repeating the track that just played. */
  private reshuffle(): void {
    const last = this.order.length > 0 ? this.order[this.order.length - 1] : -1
    const next = TRACKS.map((_, i) => i)
    for (let i = next.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[next[i], next[j]] = [next[j], next[i]]
    }
    if (next.length > 1 && next[0] === last) [next[0], next[1]] = [next[1], next[0]]
    this.order = next
    this.cursor = 0
  }

  private fadeSeconds(): number {
    const wanted = config.audio.trackCrossfadeSeconds
    return Math.max(MIN_FADE, Math.min(wanted, MAX_FADE))
  }
}
