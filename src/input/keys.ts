/**
 * Keyboard input.
 *
 * A and L are the two hands, deliberately far apart so they feel like separate hands
 * rather than one control. Q and E reel the line, which is a single shared quantity
 * and so gets a single pair of keys.
 */

export interface InputState {
  left: boolean
  right: boolean
  reelIn: boolean
  reelOut: boolean
}

const BINDINGS: Record<string, keyof InputState> = {
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyL: 'right',
  ArrowRight: 'right',
  KeyQ: 'reelIn',
  ArrowUp: 'reelIn',
  KeyE: 'reelOut',
  ArrowDown: 'reelOut',
}

export interface Input {
  readonly state: InputState
  /** Fires once per press, for toggles and one-shot actions. */
  onPress(code: string, handler: () => void): void
}

export function createInput(target: EventTarget = window): Input {
  const state: InputState = {
    left: false,
    right: false,
    reelIn: false,
    reelOut: false,
  }
  const pressHandlers = new Map<string, (() => void)[]>()

  target.addEventListener('keydown', (event) => {
    const e = event as KeyboardEvent
    if (e.repeat) return

    const bound = BINDINGS[e.code]
    if (bound) {
      state[bound] = true
      e.preventDefault()
    }
    for (const handler of pressHandlers.get(e.code) ?? []) handler()
  })

  target.addEventListener('keyup', (event) => {
    const e = event as KeyboardEvent
    const bound = BINDINGS[e.code]
    if (bound) {
      state[bound] = false
      e.preventDefault()
    }
  })

  // A held key with the window unfocused would otherwise stick on forever.
  window.addEventListener('blur', () => {
    state.left = false
    state.right = false
    state.reelIn = false
    state.reelOut = false
  })

  return {
    state,
    onPress(code, handler) {
      const list = pressHandlers.get(code) ?? []
      list.push(handler)
      pressHandlers.set(code, list)
    },
  }
}
