/**
 * Percussion, with no grid behind it.
 *
 * Three timbres, all built from the same noise buffer the chain already holds for the
 * hiss, read from a random offset so no two hits are the same sample of noise. What
 * separates them is entirely the filter and the envelope:
 *
 *   tap     a narrow resonant band plus a tuned sine, struck and gone — a woodblock or
 *           a rim, and the only one that carries a pitch, taken from the chord so it
 *           belongs to the music rather than sitting on top of it
 *   shaker  a wide band up high with a very fast decay, which is all a shaker is
 *   swell   the same band opened out, with a slow attack and a long fall — a brush
 *           swirl, closer to weather than to a hit
 *
 * There is no kick and no snare here on purpose. A synthesised snare lands somewhere
 * near a 1980s drum machine, which is the one sound this genre is defined by avoiding,
 * and a kick without a pulse to sit on is just a thud.
 */

import type { Chain } from '../fx'
import type { PercEvent } from '../harmony'

/** Short, so a hit is an event rather than a wash. */
const TAP_DECAY = 0.16
const SHAKER_DECAY = 0.07
const SWELL_ATTACK = 0.7
const SWELL_DECAY = 1.6
/** Resonance of the tap's band. High enough to ring, low enough not to whistle. */
const TAP_Q = 9
const SHAKER_Q = 1.2
const SWELL_Q = 0.9

/**
 * Makeup for what the bandpass throws away.
 *
 * A bandpass passes roughly its bandwidth — the centre frequency divided by Q — out of
 * the whole spectrum of the noise going in, so a narrow band is also a very quiet one.
 * At the tap's Q of 9 that is a slice about fifty hertz wide taken out of twenty
 * thousand, which cost some twenty-five decibels and left the percussion inaudible
 * under the pad. These put it back, and are per timbre because each one filters
 * differently.
 */
const MAKEUP: Record<string, number> = { tap: 9, shaker: 3.2, swell: 3.2 }
/** The tap's tuned body, which bypasses the filter and so needs no makeup. */
const TAP_BODY = 0.6

export function playPerc(
  ctx: AudioContext,
  event: PercEvent,
  chain: Chain,
  startAt: number,
): void {
  const at = startAt + event.at
  const swell = event.timbre === 'swell'
  const attack = swell ? SWELL_ATTACK : 0.002
  const decay = swell ? SWELL_DECAY : event.timbre === 'tap' ? TAP_DECAY : SHAKER_DECAY
  const end = at + attack + decay

  const envelope = ctx.createGain()
  envelope.gain.setValueAtTime(0, at)
  envelope.gain.linearRampToValueAtTime(event.level, at + attack)
  // Exponential, because a linear fall on a struck sound reads as a fade rather than a
  // decay. It cannot reach zero, so it lands just under audibility and stops.
  envelope.gain.exponentialRampToValueAtTime(Math.max(1e-4, event.level * 1e-3), end)

  const band = ctx.createBiquadFilter()
  band.type = 'bandpass'
  band.frequency.value = event.freq
  band.Q.value = event.timbre === 'tap' ? TAP_Q : swell ? SWELL_Q : SHAKER_Q

  const panner = ctx.createStereoPanner()
  panner.pan.value = event.pan

  const makeup = ctx.createGain()
  makeup.gain.value = MAKEUP[event.timbre] ?? 1
  band.connect(makeup)
  makeup.connect(envelope)
  envelope.connect(panner)
  panner.connect(chain.perc)

  const noise = ctx.createBufferSource()
  noise.buffer = chain.noise
  // A random offset into the shared buffer, so repeated hits are not the same noise
  // twice — which is audible as a pitch even though noise has none.
  const offset = Math.random() * Math.max(0.01, chain.noise.duration - 2)
  noise.connect(band)
  noise.start(at, offset)
  noise.stop(end + 0.05)

  // The tap gets a sine at the same frequency for body. Filtered noise alone reads as a
  // click; the tone is what makes it a struck object.
  let body: OscillatorNode | null = null
  if (event.timbre === 'tap') {
    body = ctx.createOscillator()
    body.type = 'sine'
    body.frequency.value = event.freq
    const level = ctx.createGain()
    level.gain.value = TAP_BODY
    body.connect(level)
    level.connect(envelope)
    body.start(at)
    body.stop(end + 0.05)
  }

  noise.onended = () => {
    noise.disconnect()
    body?.disconnect()
    band.disconnect()
    makeup.disconnect()
    envelope.disconnect()
    panner.disconnect()
  }
}
