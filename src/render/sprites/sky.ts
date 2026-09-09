import { SKY_RAMP } from '../palette'

/**
 * Dithered sky gradient.
 *
 * A smooth gradient is wrong for pixel art — it produces hundreds of colours and
 * visible banding. Instead the sky steps through a small fixed ramp and the
 * boundaries between steps are ordered-dithered with a 4x4 Bayer matrix, which is
 * how 16-bit hardware faked gradients and what makes this read as pixel art.
 *
 * The result is cached: the sky only changes when the horizon moves.
 */

const BAYER_4X4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
]

interface Rgb {
  r: number
  g: number
  b: number
}

function parseHex(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16)
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff }
}

const RAMP_RGB = SKY_RAMP.map(parseHex)

let cache: HTMLCanvasElement | null = null
let cacheKey = ''

function renderGradient(width: number, horizonY: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = horizonY
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D context unavailable for the sky cache')

  const image = ctx.createImageData(width, horizonY)
  const data = image.data
  const lastStop = RAMP_RGB.length - 1

  for (let y = 0; y < horizonY; y++) {
    // Bias the ramp toward the horizon so the pale haze occupies less vertical space
    // than the deep zenith blue, which is how a real sky is distributed.
    const t = Math.pow(y / Math.max(1, horizonY - 1), 1.6)
    const f = t * lastStop
    const lower = Math.min(Math.floor(f), lastStop)
    const upper = Math.min(lower + 1, lastStop)
    const frac = f - lower
    const bayerRow = BAYER_4X4[y & 3]

    for (let x = 0; x < width; x++) {
      const threshold = (bayerRow[x & 3] + 0.5) / 16
      const c = frac > threshold ? RAMP_RGB[upper] : RAMP_RGB[lower]
      const i = (y * width + x) * 4
      data[i] = c.r
      data[i + 1] = c.g
      data[i + 2] = c.b
      data[i + 3] = 255
    }
  }

  ctx.putImageData(image, 0, 0)
  return canvas
}

export function drawSky(
  ctx: CanvasRenderingContext2D,
  width: number,
  horizonY: number,
): void {
  const key = `${width}:${horizonY}`
  if (key !== cacheKey || !cache) {
    cache = renderGradient(width, horizonY)
    cacheKey = key
  }
  ctx.drawImage(cache, 0, 0)
}
