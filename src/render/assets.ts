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

/**
 * Marram grass, in the six greens the painting actually uses. Matched exactly rather
 * than by a "looks green" test, because the sea's teal and the surf's pale foam both
 * pass that and would end up swaying along with the grass.
 */
const GRASS_COLOURS = new Set([
  0x165a4c, 0x229062, 0x547e64, 0x92a884, 0x90db68, 0xb2ba90,
  // The two darkest greens are the shaded bases of the tufts. Left behind they read
  // as black stubble once the rest of the blade has moved off them.
  0x364e4a, 0x303638,
])
/** No grass grows in the water, so nothing above the sand line is considered. */
const GRASS_FIRST_ROW = 34

/**
 * One clump of grass, found as a connected island in the mask.
 *
 * Each tuft is bent about *its own* base. Treating the whole dune as one mass and
 * bending it about the bottom of the image made the clumps growing part-way up the
 * dune slide bodily sideways, because their roots were being treated as though they
 * were metres below where they actually are.
 */
export interface Tuft {
  x: number
  y: number
  width: number
  height: number
}

export interface Dune {
  /** Everything that is not grass, with the grass painted out behind it. */
  still: HTMLCanvasElement
  /** Only the grass, on transparency, to be drawn back on top with a bend in it. */
  grass: HTMLCanvasElement
  /** Individual clumps, each with the row its own roots sit on. */
  tufts: Tuft[]
}

export interface SceneryAssets {
  duneLeft: Dune | null
  duneRight: Dune | null
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
 * Splits a dune into the part that stays put and the grass that moves.
 *
 * The grass cannot simply be drawn on top of the untouched dune — shifting it sideways
 * would leave the original showing through as a ghost. So it is painted out of the
 * still layer first, each grass pixel taking the colour of whatever is below it in its
 * column. Grass grows out of sand, so what is below it is nearly always the sand it
 * grows from, and the repair is invisible.
 */
function splitDune(source: HTMLCanvasElement): Dune {
  const { width, height } = source
  const from = source.getContext('2d', { willReadFrequently: true })
  if (!from) throw new Error('2D context unavailable while splitting a dune')
  const data = from.getImageData(0, 0, width, height)
  const px = data.data

  const [grassCanvas, grassCtx] = canvasOf(width, height)
  const grassData = grassCtx.createImageData(width, height)
  const gp = grassData.data

  let grassTop = height
  let grassBottom = -1

  for (let x = 0; x < width; x++) {
    // Bottom upward, carrying the last non-grass colour so grass is filled with the
    // sand beneath it rather than with whatever happens to be above.
    let fillR = 0xfd
    let fillG = 0xcb
    let fillB = 0xb0
    for (let y = height - 1; y >= 0; y--) {
      const i = (y * width + x) * 4
      const rgb = (px[i] << 16) | (px[i + 1] << 8) | px[i + 2]
      const isGrass = y >= GRASS_FIRST_ROW && GRASS_COLOURS.has(rgb)

      if (!isGrass) {
        fillR = px[i]
        fillG = px[i + 1]
        fillB = px[i + 2]
        continue
      }

      gp[i] = px[i]
      gp[i + 1] = px[i + 1]
      gp[i + 2] = px[i + 2]
      gp[i + 3] = 255

      px[i] = fillR
      px[i + 1] = fillG
      px[i + 2] = fillB

      if (y < grassTop) grassTop = y
      if (y > grassBottom) grassBottom = y
    }
  }

  const [stillCanvas, stillCtx] = canvasOf(width, height)
  stillCtx.putImageData(data, 0, 0)
  grassCtx.putImageData(grassData, 0, 0)

  return {
    still: stillCanvas,
    grass: grassCanvas,
    tufts: findTufts(grassData),
  }
}

/**
 * Finds each separate clump of grass, so every one can bend about its own roots.
 * Same flood fill as any connected-component pass, iterative because a recursive one
 * would overflow the stack on a full dune.
 */
function findTufts(mask: ImageData): Tuft[] {
  const { width, height } = mask
  const px = mask.data
  const seen = new Uint8Array(width * height)
  const stack: number[] = []
  const tufts: Tuft[] = []

  for (let start = 0; start < seen.length; start++) {
    if (seen[start] || px[start * 4 + 3] === 0) continue

    stack.length = 0
    stack.push(start)
    seen[start] = 1
    let minX = width
    let minY = height
    let maxX = -1
    let maxY = -1
    let area = 0

    while (stack.length) {
      const index = stack.pop() as number
      const x = index % width
      const y = (index - x) / width
      area++
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          const n = ny * width + nx
          if (seen[n] || px[n * 4 + 3] === 0) continue
          seen[n] = 1
          stack.push(n)
        }
      }
    }

    // Single stray pixels are mask noise, not blades.
    if (area >= 12) {
      tufts.push({ x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 })
    }
  }

  return tufts
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

  scenery.duneLeft = splitDune(cut(wide, DUNE_LEFT.x, DUNE_LEFT.width))
  scenery.duneRight = splitDune(cut(wide, DUNE_RIGHT.x, DUNE_RIGHT.width))
  scenery.sand = cut(beach, SAND_CROP.x, SAND_CROP.width)
  scenery.loaded = true
}
