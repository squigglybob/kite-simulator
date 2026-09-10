import { RESURRECT64 } from './palette'

/**
 * Loading the generated beach art.
 *
 * The scene arrives as one wide painting: grassy dunes down each side, open sand
 * between them, then surf and sea along the top. Rather than use it whole — which would
 * fix the beach at one width and one zoom — it is cut into three pieces that can be
 * recomposed at any size: the left dune, the right dune, and a strip of the open sand
 * between them. The dunes then frame both edges of the screen and the sand stretches to
 * fill whatever is left, so the beach widens as the camera pulls back.
 *
 * Two other problems have to be solved. Everything above row 177 is the generator's own
 * sky and its attempt at a keyable background, both discarded — our sky is drawn in code
 * so it can parallax and follow the camera. And the art is drawn much larger than the
 * game runs, so pieces are box-filtered down and then snapped back onto the palette,
 * which restores hard pixel edges at the size actually being drawn.
 */

/** The band of the painting that is actually beach: surf line down to foreground sand. */
const SCENE = { y: 177, height: 217 }

/**
 * Horizontal cuts, measured from the painting rather than guessed. The left dune runs
 * to x=227 and the right one starts at x=872; each cut carries a little open sand past
 * the dune so the join is soft, and stops short of the image's dark border.
 */
const DUNE_LEFT = { x: 1, width: 234 }
const DUNE_RIGHT = { x: 866, width: 313 }
/**
 * The sand between the dunes comes from the separate full-width crop rather than a
 * slice of the wide painting. It is the whole beach across — pebbles, foam, the lot —
 * so the tile is 635 px of varied sand instead of a couple of hundred, and it reads as
 * a beach rather than a flat wash. Its own dark border is trimmed off the edges.
 */
const SAND_CROP = { x: 2, width: 635 }

export interface SceneryAssets {
  duneLeft: HTMLCanvasElement | null
  duneRight: HTMLCanvasElement | null
  sand: HTMLCanvasElement | null
  loaded: boolean
}

export const scenery: SceneryAssets = {
  duneLeft: null,
  duneRight: null,
  sand: null,
  loaded: false,
}

/** Native height of every scene piece, for fitting them to the band on screen. */
export const SCENE_HEIGHT = SCENE.height

// ---------------------------------------------------------------------------

function canvasOf(
  width: number,
  height: number,
): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('2D context unavailable while preparing scenery')
  return [canvas, ctx]
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`could not load ${url}`))
    image.src = url
  })
}

// --- Palette snapping -------------------------------------------------------

const paletteRgb = RESURRECT64.map((hex) => {
  const n = parseInt(hex.slice(1), 16)
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff }
})

/** Memoised, because a downsampled piece repeats the same handful of blends. */
const snapCache = new Map<number, number>()

function snapToPalette(r: number, g: number, b: number): number {
  const key = (r << 16) | (g << 8) | b
  const hit = snapCache.get(key)
  if (hit !== undefined) return hit

  let best = 0
  let bestDistance = Infinity
  for (let i = 0; i < paletteRgb.length; i++) {
    const p = paletteRgb[i]
    const dr = p.r - r
    const dg = p.g - g
    const db = p.b - b
    const distance = dr * dr + dg * dg + db * db
    if (distance < bestDistance) {
      bestDistance = distance
      best = i
    }
  }
  snapCache.set(key, best)
  return best
}

// --- Public -----------------------------------------------------------------

/**
 * Rendered pieces, keyed by source and target width. A procedural sprite is redrawn at
 * each zoom level; a bitmap cannot be, so it is re-derived from the original every time
 * rather than scaled from an already-scaled copy.
 */
const scaledCache = new Map<string, HTMLCanvasElement>()

export function scaled(
  key: string,
  source: HTMLCanvasElement,
  targetWidth: number,
): HTMLCanvasElement {
  const width = Math.max(1, Math.round(targetWidth))
  const height = Math.max(1, Math.round((source.height / source.width) * width))
  const cacheKey = `${key}:${width}`

  const hit = scaledCache.get(cacheKey)
  if (hit) return hit

  const [canvas, ctx] = canvasOf(width, height)
  // Smoothing on for the downsample itself — a box filter keeps the shape at ratios
  // where nearest-neighbour would drop whole features — then snapped back onto the
  // palette so the result is hard-edged pixel art again.
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, width, height)

  const data = ctx.getImageData(0, 0, width, height)
  const px = data.data
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 128) {
      px[i + 3] = 0
      continue
    }
    const p = paletteRgb[snapToPalette(px[i], px[i + 1], px[i + 2])]
    px[i] = p.r
    px[i + 1] = p.g
    px[i + 2] = p.b
    px[i + 3] = 255
  }
  ctx.putImageData(data, 0, 0)

  if (scaledCache.size > 200) scaledCache.clear()
  scaledCache.set(cacheKey, canvas)
  return canvas
}

/**
 * Kicks off loading. The game runs without any of this — the procedural coastline is
 * drawn until the bitmaps arrive, and stays if they never do.
 */
export async function loadScenery(): Promise<void> {
  const [wide, beach] = await Promise.all([
    loadImage('/assets/beach-dunes.png').catch(() => null),
    loadImage('/assets/beach-ground.png').catch(() => null),
  ])
  if (!wide || !beach) return

  // Both images share the same horizon, so one row range cuts them both.
  const cut = (
    image: HTMLImageElement,
    x: number,
    width: number,
  ): HTMLCanvasElement => {
    const [canvas, ctx] = canvasOf(width, SCENE.height)
    ctx.drawImage(image, x, SCENE.y, width, SCENE.height, 0, 0, width, SCENE.height)
    return canvas
  }

  scenery.duneLeft = cut(wide, DUNE_LEFT.x, DUNE_LEFT.width)
  scenery.duneRight = cut(wide, DUNE_RIGHT.x, DUNE_RIGHT.width)
  scenery.sand = cut(beach, SAND_CROP.x, SAND_CROP.width)
  scenery.loaded = true
}
