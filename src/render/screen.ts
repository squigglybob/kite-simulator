/**
 * The pixel buffer and its presentation.
 *
 * Everything draws into a small offscreen canvas at BASE_W x BASE_H. That buffer is
 * then blitted to the visible canvas at an *integer* scale with smoothing off, which
 * is what makes the pixels crisp squares rather than resampled mush. Non-integer
 * scaling is never permitted here; the window is letterboxed instead.
 */

export const BASE_W = 480
export const BASE_H = 270

export class Screen {
  readonly buffer: HTMLCanvasElement
  readonly ctx: CanvasRenderingContext2D
  private readonly display: HTMLCanvasElement
  private readonly displayCtx: CanvasRenderingContext2D
  private readonly stage: HTMLElement
  private scale = 1

  /**
   * `container` is the element whose free space decides the scale. It must be an
   * ancestor that is sized *independently of the canvas* — the stage, not a wrapper
   * that shrink-wraps the picture. Measuring a shrink-wrapping parent means measuring
   * the canvas to size the canvas, and the scale collapses to 1 and stays there.
   */
  constructor(display: HTMLCanvasElement, container?: HTMLElement) {
    this.display = display
    // Measured against the containing element, not the window, so the canvas
    // shrinks to fit beside the tuning panel instead of hiding behind it.
    this.stage = container ?? display.parentElement ?? document.body

    const displayCtx = display.getContext('2d', { alpha: false })
    if (!displayCtx) throw new Error('2D context unavailable on the display canvas')
    this.displayCtx = displayCtx

    this.buffer = document.createElement('canvas')
    this.buffer.width = BASE_W
    this.buffer.height = BASE_H

    const ctx = this.buffer.getContext('2d', { alpha: false })
    if (!ctx) throw new Error('2D context unavailable on the pixel buffer')
    this.ctx = ctx
    this.ctx.imageSmoothingEnabled = false

    this.resize()
    new ResizeObserver(() => this.resize()).observe(this.stage)
  }

  /** Current integer upscale factor. Sprite code needs this to pick a zoom level. */
  get upscale(): number {
    return this.scale
  }

  private resize(): void {
    // The canvas is inside the stage, so measure the stage with the canvas
    // discounted; otherwise each resize would feed back into the next.
    const available = this.stage.getBoundingClientRect()
    this.scale = Math.max(
      1,
      Math.floor(Math.min(available.width / BASE_W, available.height / BASE_H)),
    )
    this.display.width = BASE_W * this.scale
    this.display.height = BASE_H * this.scale
    // Canvas resets its context state on resize, so smoothing must be set again.
    this.displayCtx.imageSmoothingEnabled = false
  }

  present(): void {
    this.displayCtx.drawImage(
      this.buffer,
      0,
      0,
      BASE_W * this.scale,
      BASE_H * this.scale,
    )
  }
}
