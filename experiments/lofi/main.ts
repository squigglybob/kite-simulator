/**
 * The experiment harness: transport, readout, presets, chord picker and a fader per
 * parameter.
 *
 * The faders were not in the original plan — a play button was, on the grounds that the
 * harness should stay minimal. That was wrong and audibly so: generative drone reveals
 * itself over minutes, so judging a mix by editing a constant and reloading costs a
 * three-minute wait per guess. The distinction the panel draws between faders that land
 * immediately and faders that wait for the next chord matters more than it looks, since
 * a fader that appears to do nothing for ten seconds is worse than no fader at all.
 *
 * The seed lives in the URL so any run is bookmarkable, the working state persists, and
 * a setting worth keeping can be saved as a preset — which is the only way a good mix
 * found by ear survives the next experiment.
 */

import { MusicEngine } from './engine'
import { CHORD_SETS, CHORD_SET_NAMES, chordsOf, type Chord, type ChordSetName } from './harmony'
import { defaultParams, type MusicParams } from './params'
import { BUILT_IN, isBuiltIn, loadSaved, remove, save, type Preset } from './presets'

const STATE_KEY = 'lofi.state'

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
    title: 'Pad LFOs',
    faders: [
      { key: 'padLfoDepth', label: 'volume depth', min: 0, max: 0.9, step: 0.02 },
      { key: 'padLfoSeconds', label: 'volume period s', min: 2, max: 120, step: 1 },
      { key: 'padFilterLfoDepth', label: 'filter depth', min: 0, max: 1, step: 0.02 },
      { key: 'padFilterLfoSeconds', label: 'filter period s', min: 2, max: 120, step: 1 },
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

/** Working state: what the panel currently shows, whether or not it matches a preset. */
interface State {
  preset: string
  chordSet: ChordSetName
  /** Indices of the enabled chords. Empty means the whole set. */
  enabled: number[]
  params: MusicParams
}

function initialState(): State {
  const base: State = {
    preset: BUILT_IN[0].name,
    chordSet: BUILT_IN[0].chordSet,
    enabled: [],
    params: defaultParams(),
  }
  try {
    const raw = localStorage.getItem(STATE_KEY)
    if (!raw) return base
    const saved = JSON.parse(raw) as Partial<State>
    if (saved.chordSet && saved.chordSet in CHORD_SETS) base.chordSet = saved.chordSet
    if (Array.isArray(saved.enabled)) base.enabled = saved.enabled.filter((n) => typeof n === 'number')
    if (typeof saved.preset === 'string') base.preset = saved.preset
    // Field by field, so a state saved before a parameter existed still loads with that
    // parameter at its default rather than undefined.
    const params = saved.params as Record<string, unknown> | undefined
    if (params) {
      for (const key of Object.keys(base.params) as (keyof MusicParams)[]) {
        const value = params[key]
        if (typeof value === 'number' && Number.isFinite(value)) base.params[key] = value
      }
    }
  } catch {
    localStorage.removeItem(STATE_KEY)
  }
  return base
}

const state = initialState()

function persist(): void {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state))
  } catch {
    // A full or blocked localStorage is no reason to stop the music.
  }
}

/** The chords actually in play: the set, narrowed to the ticked ones. */
function activeChords(): Chord[] {
  const all = chordsOf(state.chordSet)
  if (state.enabled.length === 0) return [...all]
  const picked = state.enabled.filter((i) => i >= 0 && i < all.length).map((i) => all[i])
  // Unticking everything would leave nothing to voice, so it means the whole set.
  return picked.length > 0 ? picked : [...all]
}

// Created on the button press, not before: no browser will start an audio context
// without a gesture, and one created early just sits suspended.
let ctx: AudioContext | null = null
let engine: MusicEngine | null = null
let startedAt = 0

const controls = new Map<keyof MusicParams, { input: HTMLInputElement; readout: HTMLElement }>()

const format = (fader: Fader, value: number): string =>
  fader.step >= 1 ? String(Math.round(value)) : value.toFixed(fader.step < 0.01 ? 3 : 2)

// ---------------------------------------------------------------- preset and chords

const presetSelect = document.createElement('select')
const chordSetSelect = document.createElement('select')
const chordList = document.createElement('div')
chordList.className = 'chords'
const deleteButton = document.createElement('button')
deleteButton.type = 'button'
deleteButton.textContent = 'Delete'

function allPresets(): Preset[] {
  return [...BUILT_IN, ...loadSaved()]
}

function refreshPresetList(): void {
  const saved = loadSaved()
  presetSelect.innerHTML = ''
  for (const group of [
    { label: 'Built in', items: BUILT_IN },
    { label: 'Saved', items: saved },
  ]) {
    if (group.items.length === 0) continue
    const optgroup = document.createElement('optgroup')
    optgroup.label = group.label
    for (const preset of group.items) {
      const option = document.createElement('option')
      option.value = preset.name
      option.textContent = preset.name
      optgroup.append(option)
    }
    presetSelect.append(optgroup)
  }
  const custom = document.createElement('option')
  custom.value = ''
  custom.textContent = '(edited)'
  presetSelect.append(custom)
  presetSelect.value = allPresets().some((p) => p.name === state.preset) ? state.preset : ''
  deleteButton.disabled = state.preset === '' || isBuiltIn(state.preset)
}

function refreshChordList(): void {
  chordList.innerHTML = ''
  const chords = chordsOf(state.chordSet)
  chords.forEach((chord, index) => {
    const row = document.createElement('label')
    row.className = 'chord'
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.checked = state.enabled.length === 0 || state.enabled.includes(index)
    box.addEventListener('change', () => {
      const ticked = state.enabled.length === 0
        ? chords.map((_, i) => i)
        : [...state.enabled]
      const at = ticked.indexOf(index)
      if (box.checked && at === -1) ticked.push(index)
      if (!box.checked && at !== -1) ticked.splice(at, 1)
      ticked.sort((a, b) => a - b)
      state.enabled = ticked.length === chords.length ? [] : ticked
      markEdited()
      engine?.setChords(activeChords())
      persist()
    })
    const text = document.createElement('span')
    text.textContent = chord.name
    row.append(box, text)
    chordList.append(row)
  })
}

/** Any hand change means the panel no longer matches the preset it was loaded from. */
function markEdited(): void {
  if (state.preset === '') return
  state.preset = ''
  presetSelect.value = ''
  deleteButton.disabled = true
}

function applyPreset(preset: Preset): void {
  state.preset = preset.name
  state.chordSet = preset.chordSet
  state.enabled = [...preset.chords]
  state.params = { ...preset.params }
  chordSetSelect.value = state.chordSet
  refreshChordList()
  refreshFaders()
  refreshPresetList()
  engine?.setParams(state.params)
  engine?.setChords(activeChords())
  persist()
}

function refreshFaders(): void {
  for (const group of GROUPS) {
    for (const fader of group.faders) {
      const control = controls.get(fader.key)
      if (!control) continue
      control.input.value = String(state.params[fader.key])
      control.readout.textContent = format(fader, state.params[fader.key])
    }
  }
}

// ------------------------------------------------------------------------ the panel

function heading(text: string): void {
  const h = document.createElement('h2')
  h.textContent = text
  panel.append(h)
}

heading('Preset')
presetSelect.addEventListener('change', () => {
  const chosen = allPresets().find((p) => p.name === presetSelect.value)
  if (chosen) applyPreset(chosen)
})
panel.append(presetSelect)

const presetButtons = document.createElement('div')
presetButtons.className = 'row'
const saveButton = document.createElement('button')
saveButton.type = 'button'
saveButton.textContent = 'Save as…'
saveButton.addEventListener('click', () => {
  const suggested = state.preset || 'My preset'
  const name = window.prompt('Save these settings as', suggested)?.trim()
  if (!name) return
  if (isBuiltIn(name)) {
    window.alert(`"${name}" is a built-in preset. Pick another name.`)
    return
  }
  save({ name, chordSet: state.chordSet, chords: [...state.enabled], params: { ...state.params } })
  state.preset = name
  refreshPresetList()
  persist()
})
deleteButton.addEventListener('click', () => {
  if (!state.preset || isBuiltIn(state.preset)) return
  if (!window.confirm(`Delete preset "${state.preset}"?`)) return
  remove(state.preset)
  state.preset = ''
  refreshPresetList()
  persist()
})
presetButtons.append(saveButton, deleteButton)
panel.append(presetButtons)

heading('Chords')
for (const name of CHORD_SET_NAMES) {
  const option = document.createElement('option')
  option.value = name
  option.textContent = CHORD_SETS[name].label
  chordSetSelect.append(option)
}
chordSetSelect.value = state.chordSet
const feel = document.createElement('p')
feel.className = 'feel'
const showFeel = (): void => { feel.textContent = CHORD_SETS[state.chordSet].feel }
chordSetSelect.addEventListener('change', () => {
  state.chordSet = chordSetSelect.value as ChordSetName
  // A selection of indices means nothing once the set has changed underneath it.
  state.enabled = []
  showFeel()
  refreshChordList()
  markEdited()
  engine?.setChords(activeChords())
  persist()
})
showFeel()
panel.append(chordSetSelect, feel, chordList)

for (const group of GROUPS) {
  heading(group.title)
  for (const fader of group.faders) {
    const label = document.createElement('label')
    if (fader.later) label.className = 'later'

    const caption = document.createElement('span')
    const name = document.createElement('i')
    name.style.fontStyle = 'normal'
    name.textContent = fader.label
    const value = document.createElement('b')
    value.textContent = format(fader, state.params[fader.key])
    caption.append(name, value)

    const input = document.createElement('input')
    input.type = 'range'
    input.min = String(fader.min)
    input.max = String(fader.max)
    input.step = String(fader.step)
    input.value = String(state.params[fader.key])
    input.addEventListener('input', () => {
      const next = Number(input.value)
      state.params[fader.key] = next
      value.textContent = format(fader, next)
      engine?.setParams({ [fader.key]: next })
      markEdited()
      persist()
    })

    controls.set(fader.key, { input, readout: value })
    label.append(caption, input)
    panel.append(label)
  }
}

refreshPresetList()
refreshChordList()

// ------------------------------------------------------------------------ transport

const clock = (seconds: number): string => {
  const whole = Math.max(0, Math.floor(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

toggle.addEventListener('click', () => {
  if (!ctx) {
    ctx = new AudioContext()
    engine = new MusicEngine(ctx, ctx.destination, state.params, seed, activeChords())
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
    engine.setChords(activeChords())
    engine.setParams(state.params)
    engine.start()
    toggle.textContent = 'Stop'
  }
})

required<HTMLButtonElement>('#reseed').addEventListener('click', () => {
  location.search = `?seed=${Math.floor(Math.random() * 0xffffffff)}`
})

required<HTMLButtonElement>('#copy').addEventListener('click', async (event) => {
  const button = event.currentTarget as HTMLButtonElement
  // The whole preset, not just the numbers: chords and settings together are what a
  // feel actually is, and this is what gets pasted into presets.ts.
  const preset: Preset = {
    name: state.preset || 'Untitled',
    chordSet: state.chordSet,
    chords: [...state.enabled],
    params: { ...state.params },
  }
  await navigator.clipboard.writeText(JSON.stringify(preset, null, 2))
  button.textContent = 'Copied'
  window.setTimeout(() => { button.textContent = 'Copy preset' }, 1200)
})

required<HTMLButtonElement>('#reset').addEventListener('click', () => {
  applyPreset(BUILT_IN[0])
})

window.setInterval(() => {
  if (!ctx || !engine?.isRunning) return
  elapsedOut.textContent = clock(ctx.currentTime - startedAt)
}, 500)
