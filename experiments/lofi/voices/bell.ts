/**
 * The bells: two sine oscillators, one modulating the other's frequency.
 *
 * This is the voice that makes a listener register the piece as music rather than as a
 * hum, and it is the cheapest of the three. The modulator sits at an inharmonic ratio
 * to the carrier, which is what produces a struck, metallic timbre instead of a
 * brighter sine; the modulation depth then decays much faster than the note does, so
 * each bell has a bright attack that mellows to a pure tone as it rings out.
 *
 * Sent hard to the reverb. Sparse high notes are where a long tail earns its keep.
 */

import type { Chain } from '../fx'
import type { Shape } from '../drift'
import { midiToFreq, type NoteEvent } from '../harmony'

/** Not a whole number, or the result is a harmonic and sounds like an organ. */
const RATIO = 3.47
/** Modulation depth as a multiple of the carrier frequency, at the moment of attack. */
const INDEX = 2.6
/** Seconds the modulation takes to fall away, leaving the bare sine behind. */
const TIMBRE_DECAY = 0.35
/** Ring time at the bottom of the bell range, halving every two octaves above it. */
const DECAY_AT_LOW = 2.6
const DECAY_REFERENCE_MIDI = 72

export function playBell(
  ctx: AudioContext,
  event: NoteEvent,
  chain: Chain,
  shape: Shape,
  startAt: number,
): void {
  const at = startAt + event.at
  const freq = midiToFreq(event.midi)
  // Small bells ring shorter than big ones, so the top of the range gets out of the way
  // faster than the bottom.
  const decay = DECAY_AT_LOW * Math.pow(2, -(event.midi - DECAY_REFERENCE_MIDI) / 24)
  const end = at + decay
  const level = event.level * shape.bells

  const envelope = ctx.createGain()
  envelope.gain.setValueAtTime(0, at)
  envelope.gain.linearRampToValueAtTime(level, at + 0.008)
  // Exponential, because a linear decay on a struck sound reads as a fade rather than
  // as a ring. It cannot reach zero, so it lands just under audibility and stops.
  envelope.gain.exponentialRampToValueAtTime(Math.max(1e-4, level * 1e-3), end)

  const panner = ctx.createStereoPanner()
  panner.pan.value = event.pan

  envelope.connect(panner)
  panner.connect(chain.bell)

  const carrier = ctx.createOscillator()
  carrier.type = 'sine'
  carrier.frequency.value = freq
  chain.wow.connect(carrier.detune)
  carrier.connect(envelope)

  const modulator = ctx.createOscillator()
  modulator.type = 'sine'
  modulator.frequency.value = freq * RATIO

  const depth = ctx.createGain()
  depth.gain.setValueAtTime(freq * INDEX, at)
  depth.gain.exponentialRampToValueAtTime(Math.max(1, freq * INDEX * 1e-3), at + TIMBRE_DECAY)
  modulator.connect(depth)
  depth.connect(carrier.frequency)

  carrier.start(at)
  modulator.start(at)
  carrier.stop(end + 0.05)
  modulator.stop(end + 0.05)

  carrier.onended = () => {
    chain.wow.disconnect(carrier.detune)
    carrier.disconnect()
    modulator.disconnect()
    depth.disconnect()
    envelope.disconnect()
    panner.disconnect()
  }

}
