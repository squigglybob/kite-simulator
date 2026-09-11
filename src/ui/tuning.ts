import { config, type Config } from '../sim/config'
import { availableMusicSources } from './settings'

/**
 * Live tuning panel.
 *
 * This exists early rather than late on purpose. Kite physics cannot be judged by
 * reading code — it has to be flown — and without sliders every "it feels floaty"
 * becomes a round trip through a code change. Sliders write straight into the config
 * object and the next physics step picks them up.
 *
 * Values persist to localStorage so a tuning session survives a reload, and the copy
 * button dumps the whole config as JSON so good numbers can be handed back.
 */

const STORAGE_KEY = 'kite-flyer.config'

/**
 * The shipped values, captured before `loadSavedConfig` can merge anything over them.
 * A saved value that turns out to be unusable falls back to this rather than to
 * whichever option happens to be listed first.
 */
const DEFAULTS = structuredClone(config) as unknown as Nested

interface SliderSpec {
  path: string
  label: string
  min: number
  max: number
  step: number
}

interface ToggleSpec {
  path: string
  label: string
}

interface SelectSpec {
  path: string
  label: string
  options: { value: string; label: string }[]
}

/**
 * Discriminated by shape rather than a `kind` tag, so the sixty-odd existing slider
 * specs did not have to be touched to add two more row types.
 */
type Row = SliderSpec | ToggleSpec | SelectSpec

const isSelect = (row: Row): row is SelectSpec => 'options' in row
const isSlider = (row: Row): row is SliderSpec => 'min' in row

interface Section {
  title: string
  rows: Row[]
}

const SECTIONS: Section[] = [
  {
    title: 'Wind',
    rows: [
      { path: 'wind.base', label: 'base speed m/s', min: 0, max: 20, step: 0.1 },
      { path: 'wind.shear', label: 'shear exponent', min: 0, max: 0.5, step: 0.01 },
      { path: 'wind.gustAmp', label: 'gust amplitude', min: 0, max: 6, step: 0.1 },
      { path: 'wind.gustCellSize', label: 'gust cell size m', min: 3, max: 80, step: 1 },
      { path: 'wind.gustTimeScale', label: 'gust rate', min: 0, max: 2, step: 0.01 },
      { path: 'wind.turbHeight', label: 'turbulence height m', min: 0, max: 30, step: 0.5 },
      { path: 'wind.turbAmp', label: 'turbulence amp', min: 0, max: 5, step: 0.05 },
    ],
  },
  {
    title: 'Kite',
    rows: [
      { path: 'kite.mass', label: 'mass kg', min: 0.05, max: 2, step: 0.01 },
      { path: 'kite.area', label: 'area m2', min: 0.1, max: 3, step: 0.05 },
      { path: 'kite.bridleUpper', label: 'bridle upper leg', min: 0.36, max: 0.66, step: 0.002 },
      { path: 'kite.bridleLower', label: 'bridle lower leg', min: 0.33, max: 0.58, step: 0.002 },
      { path: 'kite.cpBase', label: 'pressure centre', min: -0.35, max: 0.15, step: 0.002 },
      { path: 'kite.cpSlope', label: 'pressure travel', min: -1, max: -0.02, step: 0.01 },
      { path: 'kite.tailDrag', label: 'tail drag m2', min: 0, max: 0.4, step: 0.002 },
      { path: 'kite.tailArm', label: 'tail arm x spine', min: 0.4, max: 4, step: 0.05 },
      { path: 'kite.tailMassPerMetre', label: 'tail kg per m', min: 0, max: 0.08, step: 0.001 },
      { path: 'kite.aeroDamping', label: 'plate damping', min: 0, max: 2, step: 0.01 },
      { path: 'kite.spinDamping', label: 'spin damping', min: 0, max: 0.5, step: 0.005 },
      { path: 'kite.sideslipLift', label: 'sideslip lift loss', min: 0, max: 1, step: 0.02 },
      { path: 'kite.sideslipDrag', label: 'sideslip drag', min: 0, max: 2.5, step: 0.05 },
      { path: 'kite.stallDeg', label: 'stall angle deg', min: 5, max: 40, step: 0.5 },
      { path: 'kite.stallBlendDeg', label: 'stall blend deg', min: 1, max: 25, step: 0.5 },
      { path: 'kite.clScale', label: 'lift scale', min: 0, max: 3, step: 0.05 },
      { path: 'kite.cdScale', label: 'drag scale', min: 0, max: 3, step: 0.05 },
      { path: 'kite.cd0', label: 'parasitic drag', min: 0, max: 1, step: 0.005 },
      { path: 'kite.rollGustGain', label: 'roll gust gain', min: 0, max: 0.2, step: 0.002 },
      { path: 'kite.visualScale', label: 'drawn size x', min: 1, max: 6, step: 0.1 },
      { path: 'kite.aspect', label: 'height / width', min: 0.8, max: 3, step: 0.05 },
      { path: 'kite.tailLength', label: 'tail length m', min: 0, max: 15, step: 0.25 },
    ],
  },
  {
    title: 'Line',
    rows: [
      { path: 'line.length', label: 'length m', min: 5, max: 80, step: 0.5 },
      { path: 'line.spring', label: 'spring N/m', min: 50, max: 4000, step: 10 },
      { path: 'line.damping', label: 'damping', min: 0, max: 60, step: 0.5 },
      { path: 'line.dragPerMetre', label: 'drag per metre', min: 0, max: 0.05, step: 0.0005 },
      { path: 'line.reelRate', label: 'reel rate m/s', min: 0.5, max: 20, step: 0.5 },
      { path: 'line.tautTension', label: 'taut tension N', min: 1, max: 100, step: 1 },
      { path: 'line.maxTension', label: 'max tension N', min: 100, max: 5000, step: 50 },
      { path: 'line.sagFactor', label: 'line sag x', min: 0, max: 2.5, step: 0.05 },
      { path: 'line.bridleSag', label: 'bridle sag', min: 0, max: 0.5, step: 0.005 },
    ],
  },
  {
    title: 'Hands',
    rows: [
      { path: 'hand.drawTime', label: 'draw time s', min: 0.05, max: 1.5, step: 0.01 },
      { path: 'hand.releaseTime', label: 'release time s', min: 0.05, max: 2, step: 0.01 },
      { path: 'hand.drawDepth', label: 'draw depth m', min: 0, max: 3, step: 0.05 },
      { path: 'hand.lateralOffset', label: 'lateral offset m', min: 0, max: 2, step: 0.05 },
    ],
  },
  {
    title: 'Scenery',
    rows: [
      { path: 'scenery.seaSparkle', label: 'sea sparkle', min: 0, max: 0.3, step: 0.002 },
      { path: 'scenery.seaSparkleRate', label: 'sparkle rate', min: 1, max: 30, step: 0.5 },
      { path: 'scenery.grassSway', label: 'grass sway px', min: 0, max: 30, step: 0.5 },
      { path: 'scenery.grassRate', label: 'grass flutter', min: 0.2, max: 8, step: 0.1 },
      { path: 'scenery.waveHeight', label: 'swell height px', min: 0, max: 8, step: 1 },
      { path: 'scenery.waveLength', label: 'swell length px', min: 16, max: 300, step: 2 },
      { path: 'scenery.waveSpeed', label: 'swell speed', min: 0, max: 6, step: 0.1 },
    ],
  },
  {
    title: 'Audio',
    rows: [
      { path: 'audio.masterVolume', label: 'master volume', min: 0, max: 1, step: 0.02 },
      { path: 'audio.masterMuted', label: 'mute all  (M)' },
      { path: 'audio.ambienceVolume', label: 'sea volume', min: 0, max: 1, step: 0.02 },
      { path: 'audio.ambienceMuted', label: 'mute sea' },
      {
        // Only the sources that actually work, so `validateSelects` treats a saved
        // value for one that does not yet exist as unusable and falls back.
        path: 'audio.musicSource',
        label: 'music',
        options: availableMusicSources().map((s) => ({ value: s.value, label: s.label })),
      },
      { path: 'audio.musicVolume', label: 'music volume', min: 0, max: 1, step: 0.02 },
      { path: 'audio.musicMuted', label: 'mute music' },
      { path: 'audio.crossfadeSeconds', label: 'sea loop crossfade s', min: 0.5, max: 15, step: 0.5 },
      { path: 'audio.trackCrossfadeSeconds', label: 'track crossfade s', min: 1, max: 20, step: 0.5 },
    ],
  },
  {
    title: 'Camera',
    rows: [
      { path: 'camera.dist', label: 'camera setback m', min: 3, max: 60, step: 0.5 },
      { path: 'camera.focal', label: 'focal length', min: 120, max: 900, step: 4 },
      { path: 'camera.eyeHeight', label: 'eye height m', min: 0.5, max: 4, step: 0.05 },
    ],
  },
]

type Nested = Record<string, unknown>
type Value = number | boolean | string

function readPath(root: Nested, path: string): unknown {
  const parts = path.split('.')
  let node: unknown = root
  for (const part of parts) node = (node as Nested)[part]
  return node
}

function writePath(root: Nested, path: string, value: Value): void {
  const parts = path.split('.')
  let node = root
  for (let i = 0; i < parts.length - 1; i++) node = node[parts[i]] as Nested
  node[parts[parts.length - 1]] = value
}

/**
 * Merge saved values in field by field, so a config gaining new fields still loads —
 * and one that has dropped or renamed a field silently ignores the stale saved copy.
 */
function mergeInto(target: Nested, source: Nested): void {
  for (const [key, value] of Object.entries(source)) {
    const existing = target[key]
    if (
      (typeof existing === 'number' && typeof value === 'number') ||
      (typeof existing === 'boolean' && typeof value === 'boolean') ||
      (typeof existing === 'string' && typeof value === 'string')
    ) {
      target[key] = value
    } else if (
      existing && typeof existing === 'object' &&
      value && typeof value === 'object'
    ) {
      mergeInto(existing as Nested, value as Nested)
    }
  }
}

/**
 * Strings are the one merged kind that can arrive plausible but wrong — an option
 * removed since the value was saved, or a hand-edited localStorage entry. A select
 * whose value is no longer offered falls back to the first option rather than putting
 * the config into a state no row can display.
 */
function validateSelects(): void {
  const root = config as unknown as Nested
  for (const section of SECTIONS) {
    for (const row of section.rows) {
      if (!isSelect(row)) continue
      const current = readPath(root, row.path)
      if (!row.options.some((option) => option.value === current)) {
        const fallback = readPath(DEFAULTS, row.path)
        writePath(
          root,
          row.path,
          typeof fallback === 'string' ? fallback : row.options[0].value,
        )
      }
    }
  }
}

export function loadSavedConfig(): void {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return
  try {
    mergeInto(config as unknown as Nested, JSON.parse(raw) as Nested)
    validateSelects()
  } catch {
    localStorage.removeItem(STORAGE_KEY)
  }
}

let saveTimer = 0

/** Debounced, because a slider drag would otherwise write on every pixel of travel. */
export function saveConfig(): void {
  clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config satisfies Config))
  }, 250)
}

export interface TuningPanel {
  toggle(): void
  /** Greys the launch button out while the kite is flying. */
  setLaunchEnabled(enabled: boolean): void
  /** Push config values back into the sliders after a programmatic change. */
  refresh(): void
}

export interface TuningHooks {
  /** Start over: kite in the air, clock and score cleared. */
  onRelaunch: () => void
  /** Walk the kite out and set it down ready to fly, keeping the score. */
  onSetUpForLaunch: () => void
  onChange?: (path: string) => void
}

export function createTuningPanel(hooks: TuningHooks): TuningPanel {
  // A hot reload re-runs this module without unloading the page, which would otherwise
  // leave the previous panel behind and stack a second one beside it.
  document.querySelectorAll('.tuning').forEach((stale) => stale.remove())

  const root = document.createElement('div')
  root.className = 'tuning'
  root.innerHTML = `
    <style>
      .tuning {
        flex: 0 0 300px; height: 100vh;
        overflow-y: auto; padding: 10px 12px 40px;
        background: rgba(14, 17, 23, 0.94); color: #d7e3ec;
        font: 11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
        box-sizing: border-box; border-left: 1px solid #2b3440;
      }
      .tuning[hidden] { display: none !important; }
      .tuning h2 { font-size: 11px; margin: 14px 0 6px; color: #7fb2d9;
        text-transform: uppercase; letter-spacing: 0.08em; }
      .tuning h2:first-of-type { margin-top: 4px; }
      .tuning label { display: block; margin-bottom: 7px; }
      .tuning .row { display: flex; justify-content: space-between; gap: 8px; }
      .tuning .val { color: #f0c674; }
      .tuning input[type=range] { width: 100%; margin: 2px 0 0; accent-color: #7fb2d9; }
      .tuning input[type=checkbox] { margin: 0; accent-color: #7fb2d9; }
      .tuning select {
        width: 100%; margin: 2px 0 0; padding: 2px 3px;
        background: #1b222c; color: #f0c674;
        border: 1px solid #3a4757; border-radius: 3px; font: inherit;
      }
      .tuning .actions { display: flex; gap: 6px; margin: 14px 0 6px; }
      .tuning button {
        flex: 1; padding: 5px; cursor: pointer; border: 1px solid #3a4757;
        background: #1b222c; color: #d7e3ec;
        font: inherit; border-radius: 3px;
      }
      .tuning button:hover:not(:disabled) { background: #26303d; }
      .tuning button:disabled { opacity: 0.35; cursor: default; }
      .tuning .hint { color: #6b7a8a; margin-top: 10px; }
    </style>
  `

  const refreshers: (() => void)[] = []

  const values = config as unknown as Nested

  /** Writes through, tells the game, and persists. The one path every row takes. */
  const commit = (path: string, value: Value): void => {
    writePath(values, path, value)
    hooks.onChange?.(path)
    saveConfig()
  }

  for (const section of SECTIONS) {
    const heading = document.createElement('h2')
    heading.textContent = section.title
    root.append(heading)

    for (const spec of section.rows) {
      const label = document.createElement('label')
      const row = document.createElement('div')
      row.className = 'row'
      const name = document.createElement('span')
      name.textContent = spec.label
      row.append(name)

      if (isSlider(spec)) {
        const value = document.createElement('span')
        value.className = 'val'
        row.append(value)

        const slider = document.createElement('input')
        slider.type = 'range'
        slider.min = String(spec.min)
        slider.max = String(spec.max)
        slider.step = String(spec.step)

        const decimals = spec.step < 0.01 ? 4 : spec.step < 1 ? 2 : 0
        const show = (n: number) => {
          value.textContent = n.toFixed(decimals)
        }

        const sync = () => {
          const current = readPath(values, spec.path) as number
          slider.value = String(current)
          show(current)
        }
        sync()
        refreshers.push(sync)

        slider.addEventListener('input', () => {
          const n = Number(slider.value)
          show(n)
          commit(spec.path, n)
        })
        // Otherwise the focused slider swallows the arrow keys used to fly.
        slider.addEventListener('change', () => slider.blur())

        label.append(row, slider)
      } else if (isSelect(spec)) {
        const select = document.createElement('select')
        for (const option of spec.options) {
          const element = document.createElement('option')
          element.value = option.value
          element.textContent = option.label
          select.append(element)
        }

        const sync = () => {
          select.value = String(readPath(values, spec.path))
        }
        sync()
        refreshers.push(sync)

        select.addEventListener('change', () => {
          commit(spec.path, select.value)
          select.blur()
        })

        label.append(row, select)
      } else {
        // Mutes are real checkboxes rather than 0/1 sliders, because they are states
        // rather than quantities and read wrong as a slider stuck at one end.
        const box = document.createElement('input')
        box.type = 'checkbox'
        box.className = 'check'
        row.append(box)

        const sync = () => {
          box.checked = readPath(values, spec.path) === true
        }
        sync()
        refreshers.push(sync)

        box.addEventListener('change', () => {
          commit(spec.path, box.checked)
          box.blur()
        })

        label.append(row)
      }

      root.append(label)
    }
  }

  const actions = document.createElement('div')
  actions.className = 'actions'

  const copyButton = document.createElement('button')
  copyButton.textContent = 'Copy config'
  copyButton.addEventListener('click', () => {
    void navigator.clipboard.writeText(JSON.stringify(config, null, 2))
    copyButton.textContent = 'Copied'
    setTimeout(() => (copyButton.textContent = 'Copy config'), 1200)
    copyButton.blur()
  })

  const resetButton = document.createElement('button')
  resetButton.textContent = 'Defaults'
  resetButton.addEventListener('click', () => {
    localStorage.removeItem(STORAGE_KEY)
    location.reload()
  })

  const relaunchButton = document.createElement('button')
  relaunchButton.textContent = 'Relaunch'
  relaunchButton.addEventListener('click', () => {
    hooks.onRelaunch()
    relaunchButton.blur()
  })

  actions.append(copyButton, resetButton, relaunchButton)
  root.append(actions)

  // Its own row, because it is the one you reach for repeatedly while flying.
  const launchRow = document.createElement('div')
  launchRow.className = 'actions'
  const launchButton = document.createElement('button')
  launchButton.textContent = 'Set up for launch  (Space)'
  launchButton.addEventListener('click', () => {
    hooks.onSetUpForLaunch()
    launchButton.blur()
  })
  launchRow.append(launchButton)
  root.append(launchRow)

  const hint = document.createElement('p')
  hint.className = 'hint'
  hint.textContent =
    'A / L hands. Q / E line. Space set up launch. R relaunch. W window. H readout. V vectors. M mute all. T panel.'
  root.append(hint)

  document.body.append(root)

  let launchEnabled = true

  return {
    toggle() {
      root.hidden = !root.hidden
    },
    setLaunchEnabled(enabled) {
      if (enabled === launchEnabled) return
      launchEnabled = enabled
      launchButton.disabled = !enabled
    },
    refresh() {
      for (const sync of refreshers) sync()
    },
  }
}
