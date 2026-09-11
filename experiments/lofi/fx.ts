/**
 * The shared signal chain. Built once, used by every voice.
 *
 *   pad  -> padBus  -\                        /-> padSend  -\
 *   bass -> bassBus --+-> dry -> tone -> ... <--- bassSend --+-> convolver -> tone
 *   bell -> bellBus -/                        \-> bellSend -/
 *
 *   dry + wet -> tone (lowpass) -> rumble (highpass) -> limiter -> master -> out
 *   hiss ------------------------------------------------------------------^
 *
 * One reverb, not three. Convolution is the most expensive thing in the module by a
 * wide margin and there is no musical reason for the pad, the bass and the bells to sit
 * in different rooms, so they share a send bus. The hiss joins after the tone shaping
 * rather than before, because rolling the top off the noise removes the only part of it
 * that does anything.
 *
 * The per-voice buses exist so a fader is instant. Multiplying a voice's level into each
 * note's envelope when the note is scheduled is a chord's worth of latency — eight to
 * fifteen seconds — before a slider does anything audible, which makes mixing by ear
 * impossible. A bus is one gain node and the change lands on the notes already ringing.
 */

import { mulberry32 } from '../../src/core/rng'
import type { MusicParams } from './params'

/** Nothing below this survives a laptop speaker; it only eats headroom. */
const RUMBLE_HZ = 40
/** The rolled-off top end. Fixed — the drifting filter is per-voice, on the pad. */
const TONE_HZ = 4200
/** Ratio between the two wobble oscillators. Deliberately not a round number. */
const FLUTTER_RATIO = 0.37
/** Level below which the soft clipper is exactly linear and does nothing at all. */
const SOFT_CLIP_KNEE = 0.8
/** A long tail on a low note is the fastest route to mud. */
const BASS_SEND_SHARE = 0.2
/** Sparse high notes are where a long tail earns its keep. */
const BELL_SEND_SHARE = 1.4

export interface Chain {
  /** Voices connect here. One bus each, so a level change is immediate. */
  readonly pad: GainNode
  readonly bass: GainNode
  readonly bell: GainNode
  /** Connect to an oscillator's `detune` to put it on tape. */
  readonly wow: GainNode
  setGain(value: number, when: number, timeConstant?: number): void
  /** Voice levels. Safe to call every chord and on every slider movement. */
  setVoiceGains(params: MusicParams): void
  /** Reverb send depth, as the drift currently wants it. */
  setReverb(amount: number): void
  /** The pad's lowpass corner. One filter on the bus, not one per note. */
  setPadCutoff(hz: number): void
  /** The drift's swell on the pad, 0 to 1, multiplied with the pad fader. */
  setPadSwell(level: number): void
  setHiss(level: number): void
  setWow(depth: number, rate: number): void
  /** Regenerates the impulse response. Cheap, but not free — debounce a slider. */
  setReverbTail(seconds: number): void
  dispose(): void
}

/**
 * A stereo noise burst that decays away, used as the reverb's impulse response.
 *
 * The one-pole filter coefficient falls as the tail proceeds, so the room gets darker
 * as it dies rather than hissing all the way out. That single detail is most of the
 * difference between this sounding like a room and sounding like a noise gate.
 */
function impulseResponse(ctx: BaseAudioContext, seconds: number, seed: number): AudioBuffer {
  const length = Math.max(1, Math.floor(Math.max(0.2, seconds) * ctx.sampleRate))
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate)
  const rng = mulberry32(seed)

  let peak = 1e-6
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel)
    let low = 0
    for (let i = 0; i < length; i++) {
      const t = i / length
      const coefficient = 0.12 + 0.35 * (1 - t)
      low += coefficient * (rng() * 2 - 1 - low)
      data[i] = low * Math.pow(1 - t, 2.5)
      const magnitude = Math.abs(data[i])
      if (magnitude > peak) peak = magnitude
    }
  }

  // Normalised, because the raw level depends on sample rate and tail length, and a
  // reverb whose loudness changes when you drag a slider is untunable.
  const scale = 0.5 / peak
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel)
    for (let i = 0; i < length; i++) data[i] *= scale
  }
  return buffer
}

/** A few seconds of noise, looped. Long enough that the loop is not a pitch. */
function noiseLoop(ctx: BaseAudioContext, seed: number): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * 3)
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  const rng = mulberry32(seed)
  for (let i = 0; i < length; i++) data[i] = rng() * 2 - 1
  return buffer
}

export function createChain(
  ctx: AudioContext,
  destination: AudioNode,
  params: MusicParams,
  seed: number,
): Chain {
  // A safety net, not a sound, and therefore the very last thing in the chain. Placed
  // before the master fader it sees the full pre-fader signal and gain-reduces
  // continuously, which lets the bass — nearly all of it below 200 Hz and inaudible on
  // a laptop — duck the pad and the bells every time it sounds. After the fader, at a
  // threshold just under full scale, it only ever catches a genuine over.
  const limiter = ctx.createDynamicsCompressor()
  limiter.threshold.value = -1
  limiter.knee.value = 0
  limiter.ratio.value = 20
  limiter.attack.value = 0.003
  limiter.release.value = 0.25
  // The compressor reduces a sustained over but does not guarantee a ceiling — with a
  // 3 ms attack and no lookahead it lets peaks through, and pushing the master fader to
  // the top clipped outright. This does guarantee it: linear below the knee, then a
  // tanh curve that cannot reach 1 however hard it is driven. Gentle saturation is also
  // the right sound to fail into for this genre, which a hard clip is not.
  const softClip = ctx.createWaveShaper()
  const curve = new Float32Array(2048)
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1
    const magnitude = Math.abs(x)
    const shaped = magnitude <= SOFT_CLIP_KNEE
      ? magnitude
      : SOFT_CLIP_KNEE + (1 - SOFT_CLIP_KNEE) * Math.tanh((magnitude - SOFT_CLIP_KNEE) / (1 - SOFT_CLIP_KNEE))
    curve[i] = Math.sign(x) * shaped
  }
  softClip.curve = curve
  softClip.oversample = '4x'
  softClip.connect(destination)

  limiter.connect(softClip)

  const master = ctx.createGain()
  master.gain.value = 0
  master.connect(limiter)

  const rumble = ctx.createBiquadFilter()
  rumble.type = 'highpass'
  rumble.frequency.value = RUMBLE_HZ
  rumble.connect(master)

  const tone = ctx.createBiquadFilter()
  tone.type = 'lowpass'
  tone.frequency.value = TONE_HZ
  tone.Q.value = 0.7
  tone.connect(rumble)

  const dry = ctx.createGain()
  dry.connect(tone)

  const convolver = ctx.createConvolver()
  convolver.buffer = impulseResponse(ctx, params.reverbSeconds, seed + 1)
  convolver.connect(tone)

  const voice = (): { bus: GainNode; send: GainNode } => {
    const bus = ctx.createGain()
    const send = ctx.createGain()
    send.gain.value = 0
    bus.connect(dry)
    bus.connect(send)
    send.connect(convolver)
    return { bus, send }
  }
  const bass = voice()
  const bell = voice()

  // The pad's filter sits on its bus rather than on each note. Every note of a chord
  // was being given the same corner anyway, so this is fewer nodes for the same sound —
  // and it makes the fader live, including over the tails of notes already ringing.
  const pad = voice()
  const padFilter = ctx.createBiquadFilter()
  padFilter.type = 'lowpass'
  padFilter.frequency.value = params.brightness
  padFilter.Q.value = 0.6

  // The swell is a separate node from the bus so that the fader and the drift do not
  // fight over one gain. It also wants a far slower glide: the fader should feel
  // immediate, whereas the swell is meant to be something you never catch happening.
  const padSwell = ctx.createGain()
  padSwell.gain.value = 1

  pad.bus.disconnect()
  pad.bus.connect(padSwell)
  padSwell.connect(padFilter)
  padFilter.connect(dry)
  padFilter.connect(pad.send)

  // Two wobble oscillators rather than one. A single LFO on pitch is a vibrato and
  // sounds like an effect; two at an awkward ratio never quite repeat and sound like a
  // mechanism that is slightly worn, which is the whole idea.
  const wow = ctx.createGain()
  wow.gain.value = 1
  const lfos: OscillatorNode[] = []
  const depths: GainNode[] = []
  const SHARES = [0.65, 0.35]
  for (let i = 0; i < SHARES.length; i++) {
    const lfo = ctx.createOscillator()
    lfo.type = 'sine'
    lfo.frequency.value = Math.max(0.01, params.wowRate * (i === 0 ? 1 : FLUTTER_RATIO))
    const depth = ctx.createGain()
    depth.gain.value = params.wowDepth * SHARES[i]
    lfo.connect(depth)
    depth.connect(wow)
    lfo.start()
    lfos.push(lfo)
    depths.push(depth)
  }

  const hissSource = ctx.createBufferSource()
  hissSource.buffer = noiseLoop(ctx, seed + 2)
  hissSource.loop = true
  const hissBand = ctx.createBiquadFilter()
  hissBand.type = 'highpass'
  hissBand.frequency.value = 1800
  const hissGain = ctx.createGain()
  hissGain.gain.value = params.hiss * 0.12
  hissSource.connect(hissBand)
  hissBand.connect(hissGain)
  hissGain.connect(master)
  hissSource.start()

  const glide = (param: AudioParam, value: number): void => {
    param.setTargetAtTime(value, ctx.currentTime, 0.03)
  }

  const chain: Chain = {
    pad: pad.bus,
    bass: bass.bus,
    bell: bell.bus,
    wow,
    setGain(value, when, timeConstant = 0.4) {
      master.gain.cancelScheduledValues(when)
      master.gain.setTargetAtTime(value, when, timeConstant)
    },
    setVoiceGains(next) {
      glide(pad.bus.gain, next.padGain)
      glide(bass.bus.gain, next.bassGain)
      glide(bell.bus.gain, next.bellGain)
    },
    setReverb(amount) {
      glide(pad.send.gain, amount)
      glide(bass.send.gain, amount * BASS_SEND_SHARE)
      glide(bell.send.gain, Math.min(1, amount * BELL_SEND_SHARE))
    },
    setPadCutoff(hz) {
      padFilter.frequency.setTargetAtTime(Math.max(60, hz), ctx.currentTime, 1.5)
    },
    setPadSwell(level) {
      padSwell.gain.setTargetAtTime(Math.max(0, level), ctx.currentTime, 2.5)
    },
    setHiss(level) {
      glide(hissGain.gain, level * 0.12)
    },
    setWow(depth, rate) {
      for (let i = 0; i < depths.length; i++) {
        glide(depths[i].gain, depth * SHARES[i])
        glide(lfos[i].frequency, Math.max(0.01, rate * (i === 0 ? 1 : FLUTTER_RATIO)))
      }
    },
    setReverbTail(seconds) {
      convolver.buffer = impulseResponse(ctx, seconds, seed + 1)
    },
    dispose() {
      for (const lfo of lfos) lfo.stop()
      hissSource.stop()
      master.disconnect()
    },
  }

  chain.setVoiceGains(params)
  return chain
}
