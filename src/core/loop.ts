/**
 * Fixed-timestep game loop.
 *
 * Physics runs at a fixed rate regardless of display refresh, because the line
 * spring is stiff enough to blow up at variable or low step rates. Rendering runs
 * on rAF and receives an interpolation factor so motion stays smooth between steps.
 */

export interface LoopHandlers {
  step(dt: number): void
  render(alpha: number, frameTime: number): void
}

export interface Loop {
  stop(): void
}

/** Ceiling on catch-up work after a stall (tab backgrounded, breakpoint hit). */
const MAX_FRAME_SECONDS = 0.25

export function startLoop(handlers: LoopHandlers, hz = 240): Loop {
  const dt = 1 / hz
  let previous = performance.now()
  let accumulator = 0
  let raf = 0
  let running = true

  const frame = (now: number) => {
    if (!running) return
    raf = requestAnimationFrame(frame)

    const frameSeconds = Math.min((now - previous) / 1000, MAX_FRAME_SECONDS)
    previous = now
    accumulator += frameSeconds

    while (accumulator >= dt) {
      handlers.step(dt)
      accumulator -= dt
    }

    handlers.render(accumulator / dt, frameSeconds)
  }

  raf = requestAnimationFrame(frame)

  return {
    stop() {
      running = false
      cancelAnimationFrame(raf)
    },
  }
}
