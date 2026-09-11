/**
 * The experiment harness: transport, readout, and a fader per parameter.
 *
 * The faders were not in the original plan — a play button was, on the grounds that the
 * harness should stay minimal. That was wrong, and audibly so: generative drone reveals
 * itself over minutes, so judging a mix by editing a constant and reloading costs a
 * three-minute wait per guess. The distinction the panel draws between faders that land
 * immediately and faders that wait for the next chord matters more than it looks, since
 * a fader that appears to do nothing for ten seconds is worse than no fader at all.
 *
 * The seed lives in the URL so any run is bookmarkable, and the settings persist, so a
 * good mix survives the reload that finding the next one requires.
 */

import { MusicEngine } from './engine'
import { defaultParams, type MusicParams } from './params'

const STORAGE_KEY = 'lofi.params'

interface Fader {
  key: keyof MusicParams
  label: string
  min: number
  max: number
  step: number
  /** True when the value is read as a note is built, so it cannot affect one already ringing. */
  later?: true
}

const GROUPS: { title: string; faders: Fader[] }[] = [
  {
    title: 'Mix',
    faders: [
      { key: 'gain', label: 'master', min: 0, max: 1, step: 0.01 },
      { key: 'padGain', label: 'pad', min: 0, max: 1, step: 0.01 },
      { key: 'bassGain', label: 'bass', min: 0, max: 1, step: 0.01 },
      { key: 'bassOctave', label: 'bass octave', min: 0, max: 1, step: 0.01, later: true },
      { key: 'bellGain', label: 'bells', min: 0, max: 1, step: 0.01 },
      { key: 'hiss', label: 'hiss', min: 0, max: 0.2, step: 0.005 },
    ],
  },
  {
    title: 'Tone',
    faders: [
      { key: 'brightness', label: 'pad cutoff Hz', min: 150, max: 4000, step: 25 },
      { key: 'warmth', label: 'detune cents', min: 0, max: 30, step: 0.5, later: true },
    ],
  },
  {
    title: 'Space',
    faders: [
      { key: 'reverbMix', label: 'reverb send', min: 0, max: 1, step: 0.02 },
      { key: 'reverbSeconds', label: 'reverb tail s', min: 0.5, max: 10, step: 0.1 },
    ],
  },
  {
    title: 'Tape',
    faders: [
      { key: 'wowDepth', label: 'wow cents', min: 0, max: 40, step: 0.5 },
      { key: 'wowRate', label: 'wow rate Hz', min: 0.02, max: 2, step: 0.01 },
    ],
  },
  {
    title: 'Motion',
    faders: [
      { key: 'chordSeconds', label: 'chord length s', min: 3, max: 40, step: 0.5, later: true },
      { key: 'chordJitter', label: 'length jitter s', min: 0, max: 10, step: 0.5, later: true },
      { key: 'density', label: 'chord density', min: 0, max: 1, step: 0.02, later: true },
      { key: 'bellRate', label: 'bells per min', min: 0, max: 20, step: 0.5, later: true },
    ],
  },
  {
    title: 'Form',
    faders: [
      { key: 'dropoutChance', label: 'dropout chance', min: 0, max: 1, step: 0.05, later: true },
      { key: 'sectionSeconds', label: 'section s', min: 20, max: 240, step: 5, later: true },
      { key: 'root', label: 'tonic midi', min: 36, max: 62, step: 1, later: true },
    ],
  },
]

function required<T extends Element>(selector: string): T {
  const found = document.querySelector<T>(selector)
  if (!found) throw new Error(`harness markup is missing ${selector}`)
  return found
}

const toggle = required<HTMLButtonElement>('#toggle')
const panel = required<HTMLElement>('#panel')
const seedOut = required<HTMLElement>('#seed')
const chordOut = required<HTMLElement>('#chord')
const sectionOut = required<HTMLElement>('#section')
const elapsedOut = required<HTMLElement>('#elapsed')

const fromUrl = Number(new URLSearchParams(location.search).get('seed'))
const seed = Number.isFinite(fromUrl) && fromUrl > 0
  ? Math.floor(fromUrl)
  : Math.floor(Math.random() * 0xffffffff)

seedOut.textContent = String(seed)
console.log(`seed ${seed} — ?seed=${seed} to hear this again`)

/** Saved values are merged field by field, so adding a parameter never breaks a save. */
function load(): MusicParams {
  const params = defaultParams()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return params
    const saved = JSON.parse(raw) as Record<string, unknown>
    for (const key of Object.keys(params) as (keyof MusicParams)[]) {
      const value = saved[key]
      if (typeof value === 'number' && Number.isFinite(value)) params[key] = value
    }
  } catch {
    localStorage.removeItem(STORAGE_KEY)
  }
  return params
}

const params = load()

// Created on the button press, not before: no browser will start an audio context
// without a gesture, and one created early just sits suspended.
let ctx: AudioContext | null = null
let engine: MusicEngine | null = null
let startedAt = 0

const controls = new Map<keyof MusicParams, { input: HTMLInputElement; readout: HTMLElement }>()

function save(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(params))
  } catch {
    // A full or blocked localStorage is no reason to stop the music.
  }
}

const format = (fader: Fader, value: number): string =>
  fader.step >= 1 ? String(Math.round(value)) : value.toFixed(fader.step < 0.01 ? 3 : 2)

for (const group of GROUPS) {
  const heading = document.createElement('h2')
  heading.textContent = group.title
  panel.append(heading)

  for (const fader of group.faders) {
    const label = document.createElement('label')
    if (fader.later) label.className = 'later'

    const caption = document.createElement('span')
    const name = document.createElement('i')
    name.style.fontStyle = 'normal'
    name.textContent = fader.label
    const value = document.createElement('b')
    value.textContent = format(fader, params[fader.key])
    caption.append(name, value)

    const input = document.createElement('input')
    input.type = 'range'
    input.min = String(fader.min)
    input.max = String(fader.max)
    input.step = String(fader.step)
    input.value = String(params[fader.key])
    input.addEventListener('input', () => {
      const next = Number(input.value)
      params[fader.key] = next
      value.textContent = format(fader, next)
      engine?.setParams({ [fader.key]: next })
      save()
    })

    controls.set(fader.key, { input, readout: value })
    label.append(caption, input)
    panel.append(label)
  }
}

/** Pushes the current values back into the faders after a programmatic change. */
function refresh(): void {
  for (const group of GROUPS) {
    for (const fader of group.faders) {
      const control = controls.get(fader.key)
      if (!control) continue
      control.input.value = String(params[fader.key])
      control.readout.textContent = format(fader, params[fader.key])
    }
  }
}

const clock = (seconds: number): string => {
  const whole = Math.max(0, Math.floor(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

toggle.addEventListener('click', () => {
  if (!ctx) {
    ctx = new AudioContext()
    engine = new MusicEngine(ctx, ctx.destination, params, seed)
    engine.onChord = (report) => {
      chordOut.textContent = `${report.chord}  ${report.seconds.toFixed(1)}s  ${report.notes} notes`
      sectionOut.textContent = report.section
    }
  }
  if (!engine) return

  if (engine.isRunning) {
    engine.stop()
    toggle.textContent = 'Play'
  } else {
    void ctx.resume()
    startedAt = ctx.currentTime
    engine.setParams(params)
    engine.start()
    toggle.textContent = 'Stop'
  }
})

required<HTMLButtonElement>('#reseed').addEventListener('click', () => {
  location.search = `?seed=${Math.floor(Math.random() * 0xffffffff)}`
})

required<HTMLButtonElement>('#copy').addEventListener('click', async (event) => {
  const button = event.currentTarget as HTMLButtonElement
  await navigator.clipboard.writeText(JSON.stringify(params, null, 2))
  button.textContent = 'Copied'
  window.setTimeout(() => { button.textContent = 'Copy params' }, 1200)
})

required<HTMLButtonElement>('#reset').addEventListener('click', () => {
  Object.assign(params, defaultParams())
  localStorage.removeItem(STORAGE_KEY)
  refresh()
  engine?.setParams(params)
})

window.setInterval(() => {
  if (!ctx || !engine?.isRunning) return
  elapsedOut.textContent = clock(ctx.currentTime - startedAt)
}, 500)
