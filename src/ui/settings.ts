import { config, type MusicSource } from '../sim/config'
import { C } from '../render/palette'

/**
 * The pause menu: the settings a *player* changes, as opposed to the tuning panel,
 * which is a workbench for the person building the kite.
 *
 * That split is the reason this is a separate file rather than another section bolted
 * onto `tuning.ts`. The tuning panel exposes sixty sliders, opens over the top of a
 * flight without stopping it, and is meant to be read by someone who knows what a
 * pressure centre is. This stops the game, shows five controls, and names them in
 * words. They write to the same config object, so neither owns the state.
 *
 * Built in HTML rather than drawn on the canvas. The game is pixel art and a canvas
 * menu would match it better, but it would also mean hand-rolling hit testing, focus,
 * keyboard navigation and text input against a scaled framebuffer. The palette keeps
 * it in keeping; every colour here comes from `C` for that reason.
 */

/**
 * Where music can come from. `available` is the single switch that decides whether a
 * source is offered: the generative engine is still an experiment, so it appears in
 * the menu as visibly on its way rather than as an option that silently does nothing.
 * Flipping one flag is the whole of wiring it up.
 */
export interface MusicSourceOption {
  value: MusicSource
  label: string
  note?: string
  available: boolean
}

export const MUSIC_SOURCES: readonly MusicSourceOption[] = [
  { value: 'off', label: 'Off', available: true },
  { value: 'tracks', label: 'Lofi tracks', available: true },
  { value: 'generated', label: 'Generative', note: 'soon', available: false },
]

export const availableMusicSources = (): MusicSourceOption[] =>
  MUSIC_SOURCES.filter((s) => s.available)

export interface SettingsMenu {
  toggle(): void
  close(): void
  readonly isOpen: boolean
  /** Pull values back out of the config after something else changed them. */
  refresh(): void
}

export interface SettingsHooks {
  /** Push the audio config into the mixer. */
  onAudioChange: () => void
  /** Stop and start the simulation. */
  onPauseChange: (paused: boolean) => void
  /** Persist, debounced. */
  onSave: () => void
}

const css = `
  .settings-open {
    position: absolute; right: 10px; bottom: 10px; z-index: 5;
    width: 34px; height: 34px; padding: 0;
    display: grid; place-items: center; gap: 3px;
    cursor: pointer; border: 1px solid ${C.ink}; border-radius: 4px;
    background: ${C.sand0}; color: ${C.ink};
    font: 13px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
    box-shadow: 0 1px 0 ${C.ink};
  }
  /* An explicit display beats the hidden attribute's UA rule, so hiding the button
     while the menu is open has to be spelled out. */
  .settings-open[hidden] { display: none !important; }
  .settings-open:hover { background: ${C.sand1}; }
  .settings-open:focus-visible { outline: 2px solid ${C.kiteTrim}; outline-offset: 2px; }
  .settings-open .bars { display: flex; gap: 3px; }
  .settings-open .bars i { width: 4px; height: 13px; background: ${C.ink}; display: block; }

  .settings {
    position: absolute; inset: 0; z-index: 10;
    display: grid; place-items: center;
    background: color-mix(in srgb, ${C.ink} 72%, transparent);
    font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .settings[hidden] { display: none !important; }

  .settings .panel {
    width: min(340px, calc(100% - 32px));
    max-height: calc(100% - 32px); overflow-y: auto;
    padding: 16px 18px 18px; box-sizing: border-box;
    background: ${C.sand0}; color: ${C.ink};
    border: 1px solid ${C.ink}; border-radius: 6px;
    box-shadow: 0 3px 0 ${C.ink};
  }
  .settings h2 {
    margin: 0 0 14px; font-size: 15px; letter-spacing: 0.1em;
    text-transform: uppercase; display: flex; align-items: center; gap: 8px;
  }
  .settings h2 .spacer { flex: 1; }

  .settings button {
    font: inherit; cursor: pointer; color: ${C.ink};
    background: ${C.sand1}; border: 1px solid ${C.ink}; border-radius: 4px;
    padding: 8px 12px;
  }
  .settings button:hover:not(:disabled) { background: ${C.sand2}; }
  .settings button:focus-visible { outline: 2px solid ${C.kiteTrim}; outline-offset: 2px; }
  .settings .menu { display: flex; flex-direction: column; gap: 8px; }
  .settings .menu button { text-align: left; }
  .settings .icon {
    padding: 4px 9px; line-height: 1.2; background: transparent; border-color: transparent;
  }
  .settings .icon:hover { background: ${C.sand1}; border-color: ${C.ink}; }

  .settings .row { margin-bottom: 13px; }
  .settings .row > .label {
    display: flex; justify-content: space-between; gap: 10px; margin-bottom: 3px;
  }
  .settings .row .value { color: ${C.sandShadow}; }
  .settings input[type=range] {
    width: 100%; margin: 0; accent-color: ${C.kite}; display: block;
  }
  .settings .check { display: flex; align-items: center; gap: 8px; cursor: pointer; }
  .settings input[type=checkbox] { accent-color: ${C.kite}; margin: 0; width: 15px; height: 15px; }
  .settings select {
    width: 100%; font: inherit; padding: 6px 7px; color: ${C.ink};
    background: ${C.sand1}; border: 1px solid ${C.ink}; border-radius: 4px;
  }
  .settings fieldset {
    border: 1px solid ${C.sandShadow}; border-radius: 5px;
    margin: 0 0 14px; padding: 11px 12px 3px;
  }
  .settings legend {
    padding: 0 5px; text-transform: uppercase; letter-spacing: 0.08em; font-size: 11px;
    color: ${C.sandShadow};
  }
  .settings .hint { margin: 4px 0 0; color: ${C.sandShadow}; font-size: 11px; }
`

export function createSettingsMenu(hooks: SettingsHooks): SettingsMenu {
  // A hot reload re-runs this module without unloading the page, which would otherwise
  // leave the previous menu behind and stack a second one over it.
  document.querySelectorAll('.settings, .settings-open, #settings-css').forEach((s) => s.remove())

  // The button belongs to the picture, so it hangs off the frame that shrink-wraps the
  // canvas. The overlay belongs to the stage, which is roomier than the canvas and can
  // hold the panel at a readable size however small the game is being drawn.
  const stage = document.querySelector<HTMLElement>('#stage') ?? document.body
  const frame = document.querySelector<HTMLElement>('#frame') ?? stage

  const style = document.createElement('style')
  style.id = 'settings-css'
  style.textContent = css
  document.head.append(style)

  // --- the always-visible pause button ---------------------------------------
  // Bottom right because the HUD already owns both top corners and the bottom centre.
  const openButton = document.createElement('button')
  openButton.className = 'settings-open'
  openButton.title = 'Pause and open settings  (Esc)'
  openButton.setAttribute('aria-label', 'Pause and open settings')
  openButton.innerHTML = '<span class="bars"><i></i><i></i></span>'

  // --- the overlay -----------------------------------------------------------
  const root = document.createElement('div')
  root.className = 'settings'
  root.hidden = true
  root.setAttribute('role', 'dialog')
  root.setAttribute('aria-modal', 'true')

  const panel = document.createElement('div')
  panel.className = 'panel'
  root.append(panel)

  const heading = document.createElement('h2')
  const backButton = document.createElement('button')
  backButton.className = 'icon'
  backButton.textContent = '‹'
  backButton.title = 'Back'
  const title = document.createElement('span')
  const spacer = document.createElement('span')
  spacer.className = 'spacer'
  const closeButton = document.createElement('button')
  closeButton.className = 'icon'
  closeButton.textContent = '×'
  closeButton.title = 'Resume  (Esc)'
  heading.append(backButton, title, spacer, closeButton)
  panel.append(heading)

  const body = document.createElement('div')
  panel.append(body)

  const refreshers: (() => void)[] = []
  let view: 'root' | 'audio' = 'root'

  const commit = (): void => {
    hooks.onAudioChange()
    hooks.onSave()
  }

  /** Label, live readout and a slider, bound to one numeric field of the config. */
  function slider(
    label: string,
    read: () => number,
    write: (v: number) => void,
  ): HTMLElement {
    const row = document.createElement('div')
    row.className = 'row'
    const head = document.createElement('div')
    head.className = 'label'
    const name = document.createElement('span')
    name.textContent = label
    const value = document.createElement('span')
    value.className = 'value'
    head.append(name, value)

    const input = document.createElement('input')
    input.type = 'range'
    input.min = '0'
    input.max = '1'
    input.step = '0.02'

    const sync = () => {
      const v = read()
      input.value = String(v)
      value.textContent = `${Math.round(v * 100)}%`
    }
    sync()
    refreshers.push(sync)

    input.addEventListener('input', () => {
      const v = Number(input.value)
      write(v)
      value.textContent = `${Math.round(v * 100)}%`
      commit()
    })
    row.append(head, input)
    return row
  }

  function toggle(
    label: string,
    read: () => boolean,
    write: (v: boolean) => void,
  ): HTMLElement {
    const row = document.createElement('div')
    row.className = 'row'
    const wrap = document.createElement('label')
    wrap.className = 'check'
    const box = document.createElement('input')
    box.type = 'checkbox'
    const text = document.createElement('span')
    text.textContent = label

    const sync = () => (box.checked = read())
    sync()
    refreshers.push(sync)

    box.addEventListener('change', () => {
      write(box.checked)
      commit()
    })
    wrap.append(box, text)
    row.append(wrap)
    return row
  }

  function group(legendText: string, ...children: HTMLElement[]): HTMLElement {
    const set = document.createElement('fieldset')
    const legend = document.createElement('legend')
    legend.textContent = legendText
    set.append(legend, ...children)
    return set
  }

  function musicSourceRow(): HTMLElement {
    const row = document.createElement('div')
    row.className = 'row'
    const head = document.createElement('div')
    head.className = 'label'
    const name = document.createElement('span')
    name.textContent = 'Source'
    head.append(name)

    const select = document.createElement('select')
    for (const source of MUSIC_SOURCES) {
      const option = document.createElement('option')
      option.value = source.value
      option.textContent = source.note ? `${source.label}  (${source.note})` : source.label
      // Listed but not selectable until the engine lands, so the menu tells the truth
      // about what is coming without offering a choice that would do nothing.
      option.disabled = !source.available
      select.append(option)
    }

    const sync = () => (select.value = config.audio.musicSource)
    sync()
    refreshers.push(sync)

    select.addEventListener('change', () => {
      config.audio.musicSource = select.value as MusicSource
      commit()
    })
    row.append(head, select)
    return row
  }

  function render(): void {
    refreshers.length = 0
    body.replaceChildren()
    backButton.hidden = view === 'root'

    if (view === 'root') {
      title.textContent = 'Paused'
      const menu = document.createElement('div')
      menu.className = 'menu'

      const audioButton = document.createElement('button')
      audioButton.textContent = 'Audio'
      audioButton.addEventListener('click', () => {
        view = 'audio'
        render()
      })

      const resumeButton = document.createElement('button')
      resumeButton.textContent = 'Resume'
      resumeButton.addEventListener('click', () => close())

      menu.append(audioButton, resumeButton)
      body.append(menu)
      resumeButton.focus()
      return
    }

    title.textContent = 'Audio'
    body.append(
      slider('Master volume', () => config.audio.masterVolume, (v) => (config.audio.masterVolume = v)),
      toggle('Mute everything  (M)', () => config.audio.masterMuted, (v) => (config.audio.masterMuted = v)),
      group(
        'Ambient',
        slider('Sea and gulls', () => config.audio.ambienceVolume, (v) => (config.audio.ambienceVolume = v)),
        toggle('Mute ambient', () => config.audio.ambienceMuted, (v) => (config.audio.ambienceMuted = v)),
      ),
      group(
        'Music',
        musicSourceRow(),
        slider('Music volume', () => config.audio.musicVolume, (v) => (config.audio.musicVolume = v)),
        toggle('Mute music', () => config.audio.musicMuted, (v) => (config.audio.musicMuted = v)),
      ),
    )
    backButton.focus()
  }

  function open(): void {
    if (!root.hidden) return
    view = 'root'
    render()
    root.hidden = false
    openButton.hidden = true
    hooks.onPauseChange(true)
  }

  function close(): void {
    if (root.hidden) return
    root.hidden = true
    openButton.hidden = false
    hooks.onPauseChange(false)
    openButton.focus()
  }

  backButton.addEventListener('click', () => {
    view = 'root'
    render()
  })
  closeButton.addEventListener('click', () => close())
  openButton.addEventListener('click', () => open())
  // Clicking the darkened beach outside the panel resumes, as a dialog should.
  root.addEventListener('pointerdown', (e) => {
    if (e.target === root) close()
  })

  frame.append(openButton)
  stage.append(root)

  return {
    toggle() {
      if (root.hidden) open()
      else close()
    },
    close,
    get isOpen() {
      return !root.hidden
    },
    refresh() {
      for (const sync of refreshers) sync()
    },
  }
}
