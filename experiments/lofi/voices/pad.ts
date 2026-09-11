/**
 * The pad: the body of the sound, and the only voice that is always doing something.
 *
 * Three oscillators per note rather than one. A single sawtooth at a fixed pitch is
 * static in a way that no amount of filtering hides; three of them a few cents apart
 * beat slowly against each other and the result drifts on its own. The detune spread is
 * the `warmth` parameter, and it is the difference between "synth pad" and "warm".
 */

import type { Chain } from '../fx'
import type { Shape } from '../drift'
import { midiToFreq, type NoteEvent } from '../harmony'
import type { MusicParams } from '../params'

const VOICES = 3
/** Ceiling on attack and release, so a short chord still gets a complete envelope. */
const MAX_ATTACK = 3
const MAX_RELEASE = 6

export function playPad(
  ctx: AudioContext,
  event: NoteEvent,
  chain: Chain,
  params: MusicParams,
  shape: Shape,
  startAt: number,
): void {
  const at = startAt + event.at
  const attack = Math.min(MAX_ATTACK, event.duration * 0.35)
  const release = Math.min(MAX_RELEASE, event.duration * 0.6)
  const end = at + event.duration
  const freq = midiToFreq(event.midi)

  const envelope = ctx.createGain()
  envelope.gain.setValueAtTime(0, at)
  envelope.gain.linearRampToValueAtTime(event.level * shape.pad, at + attack)
  envelope.gain.setValueAtTime(event.level * shape.pad, end)
  envelope.gain.linearRampToValueAtTime(0, end + release)

  const panner = ctx.createStereoPanner()
  panner.pan.value = event.pan

  envelope.connect(panner)
  panner.connect(chain.pad)

  const oscillators: OscillatorNode[] = []
  for (let i = 0; i < VOICES; i++) {
    const osc = ctx.createOscillator()
    osc.type = i === 0 ? 'triangle' : 'sawtooth'
    osc.frequency.value = freq
    // Spread symmetrically about the true pitch, so the chord does not drift sharp.
    osc.detune.value = ((i / (VOICES - 1)) * 2 - 1) * params.warmth
    chain.wow.connect(osc.detune)

    // The sawtooths sit under the triangle; three saws in unison is a buzz, not a pad.
    const level = ctx.createGain()
    level.gain.value = i === 0 ? 0.5 : 0.25
    osc.connect(level)
    level.connect(envelope)

    osc.start(at)
    osc.stop(end + release + 0.1)
    oscillators.push(osc)
  }

  // Every node downstream is torn down from the first oscillator's `ended`. Without
  // this a long session accumulates a filter and a panner per note for ever, and the
  // symptom is a gradual slowdown with nothing obvious to point at.
  oscillators[0].onended = () => {
    for (const osc of oscillators) {
      chain.wow.disconnect(osc.detune)
      osc.disconnect()
    }
    envelope.disconnect()
    panner.disconnect()
  }
}
