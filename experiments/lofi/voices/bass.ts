/**
 * The bass: one note, centred, felt more than heard.
 *
 * Two triangles an octave apart, not one. A single triangle at 73 Hz measures as the
 * loudest thing in the whole mix and is still nearly inaudible on a laptop, because
 * essentially all of its energy sits below 200 Hz where small speakers reproduce
 * nothing — so it eats the headroom the limiter then takes back off the pad and the
 * bells, which are the parts you can actually hear. The octave above carries the note
 * into a band that small speakers do reproduce, and `bassOctave` is the fader for
 * exactly that trade: none of it on a subwoofer, plenty of it on a laptop.
 *
 * Barely any reverb, handled by the bus. A long tail on a low note is the fastest way
 * to turn a mix to mud, and the bass is the one voice whose job is to be definite.
 */

import type { Chain } from '../fx'
import type { Shape } from '../drift'
import { midiToFreq, type NoteEvent } from '../harmony'
import type { MusicParams } from '../params'

/** High enough to pass the octave and its first harmonics; the point is audibility. */
const CUTOFF_HZ = 700
const ATTACK = 1.5
const RELEASE = 3
/** The bass wobbles less than everything else; on a sustained low note it is obvious. */
const WOW_SHARE = 0.4

export function playBass(
  ctx: AudioContext,
  event: NoteEvent,
  chain: Chain,
  params: MusicParams,
  shape: Shape,
  startAt: number,
): void {
  const at = startAt + event.at
  const attack = Math.min(ATTACK, event.duration * 0.3)
  const end = at + event.duration
  const level = event.level * shape.bass
  const freq = midiToFreq(event.midi)

  const envelope = ctx.createGain()
  envelope.gain.setValueAtTime(0, at)
  envelope.gain.linearRampToValueAtTime(level, at + attack)
  envelope.gain.setValueAtTime(level, end)
  envelope.gain.linearRampToValueAtTime(0, end + RELEASE)

  const filter = ctx.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = CUTOFF_HZ
  filter.Q.value = 0.5

  envelope.connect(filter)
  filter.connect(chain.bass)

  const wow = ctx.createGain()
  wow.gain.value = WOW_SHARE
  chain.wow.connect(wow)

  const oscillators: OscillatorNode[] = []
  for (const [multiple, share] of [[1, 1], [2, params.bassOctave]] as const) {
    if (share <= 0) continue
    const osc = ctx.createOscillator()
    osc.type = 'triangle'
    osc.frequency.value = freq * multiple
    wow.connect(osc.detune)

    const mix = ctx.createGain()
    mix.gain.value = share
    osc.connect(mix)
    mix.connect(envelope)

    osc.start(at)
    osc.stop(end + RELEASE + 0.1)
    oscillators.push(osc)
  }

  oscillators[0].onended = () => {
    chain.wow.disconnect(wow)
    for (const osc of oscillators) osc.disconnect()
    wow.disconnect()
    envelope.disconnect()
    filter.disconnect()
  }
}
