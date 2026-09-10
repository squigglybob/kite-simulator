import { fbm1D, hash1 } from '../../core/rng'
import { SCENE_HEIGHT, scaled, scenery } from '../assets'
import { C } from '../palette'
import { getSprite } from '../spritecache'

/**
 * Procedural coastline: distant headlands, sea, surf line and beach.
 *
 * Generated rather than drawn from a bitmap because the camera zooms and pans, and
 * because a noise-driven horizon tiles infinitely and lands in exactly the palette
 * colours. Each layer takes its own parallax factor so they separate with distance.
 */

export interface GroundLayout {
  width: number
  height: number
  /** Screen row where sea meets sky. */
  horizonY: number
  /** Screen row where sea meets sand. */
  shoreY: number
}

interface HeadlandBand {
  seed: number
  color: string
  /** Peak height above the horizon, in pixels. */
  amplitude: number
  /** Horizontal noise frequency; lower is broader landforms. */
  frequency: number
  /** How far the band sits below the horizon, hiding its base. */
  sink: number
  parallax: number
}

const HEADLANDS: readonly HeadlandBand[] = [
  { seed: 101, color: C.headlandFar, amplitude: 13, frequency: 0.010, sink: 1, parallax: 0.12 },
  { seed: 977, color: C.headlandNear, amplitude: 8, frequency: 0.019, sink: 3, parallax: 0.26 },
]

function drawHeadlands(
  ctx: CanvasRenderingContext2D,
  layout: GroundLayout,
  scrollX: number,
): void {
  for (const band of HEADLANDS) {
    ctx.fillStyle = band.color
    const offset = scrollX * band.parallax
    for (let x = 0; x < layout.width; x++) {
      const n = fbm1D((x + offset) * band.frequency, 4, band.seed)
      // Bias downward so the profile reads as a few distinct peaks rather than
      // an even ridge running the full width.
      const peak = Math.round(Math.pow(n, 1.8) * band.amplitude)
      if (peak <= 0) continue
      const top = layout.horizonY + band.sink - peak
      ctx.fillRect(x, top, 1, peak)
    }
  }
}

function drawSea(ctx: CanvasRenderingContext2D, layout: GroundLayout): void {
  const { width, horizonY, shoreY } = layout
  const depth = shoreY - horizonY

  // Three bands, deepening toward the viewer.
  const bands: [string, number][] = [
    [C.sea2, 0.0],
    [C.sea1, 0.35],
    [C.sea0, 0.7],
  ]
  for (let i = 0; i < bands.length; i++) {
    const [color, start] = bands[i]
    const end = i + 1 < bands.length ? bands[i + 1][1] : 1
    ctx.fillStyle = color
    const y0 = horizonY + Math.round(start * depth)
    const y1 = horizonY + Math.round(end * depth)
    ctx.fillRect(0, y0, width, y1 - y0)
  }

  // Glints: sparse horizontal dashes, denser toward the horizon where the viewing
  // angle is shallow and the sea catches more light.
  ctx.fillStyle = C.seaGlint
  for (let y = horizonY + 1; y < shoreY - 1; y++) {
    const nearness = (y - horizonY) / Math.max(1, depth)
    const density = 0.05 * (1 - nearness) + 0.008
    for (let x = 0; x < width; x++) {
      if (hash1(x * 7919 + y * 104729, 55) < density) {
        ctx.fillRect(x, y, 1 + Math.floor(hash1(x + y * 31, 77) * 3), 1)
      }
    }
  }
}

function drawSurf(
  ctx: CanvasRenderingContext2D,
  layout: GroundLayout,
  scrollX: number,
): void {
  const offset = scrollX * 0.9
  for (let x = 0; x < layout.width; x++) {
    const wave = fbm1D((x + offset) * 0.05, 3, 421)
    const y = layout.shoreY + Math.round((wave - 0.5) * 3)

    ctx.fillStyle = C.cloud
    ctx.fillRect(x, y - 1, 1, 2)

    // Ragged foam scattered up the beach from the waterline.
    if (hash1(Math.round(x + offset) * 2654435761, 13) < 0.3) {
      ctx.fillRect(x, y + 1 + Math.floor(hash1(x, 91) * 2), 1, 1)
    }
  }
}

function drawBeach(
  ctx: CanvasRenderingContext2D,
  layout: GroundLayout,
  scrollX: number,
): void {
  const { width, height, shoreY } = layout

  // Wet sand darkens the strip just above the dry beach.
  const bands: [string, number][] = [
    [C.sand2, 0],
    [C.sand1, 0.18],
    [C.sand0, 0.45],
  ]
  const depth = height - shoreY
  for (let i = 0; i < bands.length; i++) {
    const [color, start] = bands[i]
    const end = i + 1 < bands.length ? bands[i + 1][1] : 1
    ctx.fillStyle = color
    const y0 = shoreY + Math.round(start * depth)
    const y1 = shoreY + Math.round(end * depth)
    ctx.fillRect(0, y0, width, y1 - y0)
  }

  // Wind-ripple speckle. Offset by scroll so the texture travels with the ground.
  const offset = Math.round(scrollX)
  for (let y = shoreY + 2; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const h = hash1((x + offset) * 374761393 + y * 668265263, 7)
      if (h < 0.03) {
        ctx.fillStyle = C.sandShadow
        ctx.fillRect(x, y, 1, 1)
      } else if (h > 0.985) {
        ctx.fillStyle = C.sand0
        ctx.fillRect(x, y, 2, 1)
      }
    }
  }
}

/**
 * The generated beach: dunes framing both edges, open sand stretched between them.
 *
 * The painting carries its own perspective, drawn for one viewpoint, so it cannot be
 * projected as a real ground plane — it is fitted to the band below the horizon
 * instead. Composing it from three pieces rather than using it whole is what lets the
 * beach widen as the camera pulls back: the dunes stay pinned to the screen edges at a
 * constant size, and only the sand between them grows.
 */
function drawBeachBitmap(ctx: CanvasRenderingContext2D, layout: GroundLayout): void {
  const { duneLeft, duneRight, sand } = scenery
  if (!duneLeft || !duneRight || !sand) return

  const band = layout.height - layout.horizonY
  if (band <= 0) return

  const scale = band / SCENE_HEIGHT
  const widthOf = (piece: HTMLCanvasElement) =>
    Math.max(4, Math.round(piece.width * scale))

  // Fill first: rounding can leave a piece a pixel short of an edge.
  ctx.fillStyle = C.sand0
  ctx.fillRect(0, layout.horizonY, layout.width, band)

  // Open sand across the whole width, mirror-tiled so the repeat seam is symmetric
  // rather than a hard edge. The dunes then cover both ends of it.
  const sandTile = scaled('sand', sand, widthOf(sand))
  for (let x = 0, i = 0; x < layout.width; x += sandTile.width, i++) {
    if (i % 2 === 0) {
      ctx.drawImage(sandTile, x, layout.horizonY)
    } else {
      ctx.save()
      ctx.translate(x + sandTile.width, layout.horizonY)
      ctx.scale(-1, 1)
      ctx.drawImage(sandTile, 0, 0)
      ctx.restore()
    }
  }

  const left = scaled('duneLeft', duneLeft, widthOf(duneLeft))
  const right = scaled('duneRight', duneRight, widthOf(duneRight))
  ctx.drawImage(left, 0, layout.horizonY)
  ctx.drawImage(right, layout.width - right.width, layout.horizonY)
}

/**
 * The coastline is expensive to draw — the sand speckle and sea glints touch every
 * pixel below the horizon and hash each one — but it only changes when the camera zoom
 * moves the horizon, so it is rasterised once per layout and blitted thereafter.
 * Redrawing it per frame cost roughly two thirds of the frame budget.
 */
export function drawGround(
  ctx: CanvasRenderingContext2D,
  layout: GroundLayout,
  scrollX: number,
): void {
  const hasArt = scenery.loaded
  const source = hasArt ? 'beach' : 'drawn'
  const key = `ground:${source}:${layout.width}:${layout.height}:${layout.horizonY}:${layout.shoreY}:${Math.round(scrollX)}`

  const sprite = getSprite(key, layout.width, layout.height, (target) => {
    drawHeadlands(target, layout, scrollX)
    if (hasArt) {
      drawBeachBitmap(target, layout)
    } else {
      // Still drawn in code until the art loads, and if it never does.
      drawSea(target, layout)
      drawSurf(target, layout, scrollX)
      drawBeach(target, layout, scrollX)
    }
  })
  ctx.drawImage(sprite, 0, 0)
}
