import { fbm1D, hash1 } from '../../core/rng'
import { config } from '../../sim/config'
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

/** How much of the band below the horizon is water rather than sand. */
const SEA_BAND_FRACTION = 0.13
/** Water plus surf — the whole strip the swell lifts, foam line included. */
const WAVE_BAND_FRACTION = 0.16

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

  // Only the still part goes into the cache; the grass is drawn back on per frame.
  const left = scaled('duneLeft', duneLeft.still, widthOf(duneLeft.still))
  const right = scaled('duneRight', duneRight.still, widthOf(duneRight.still))
  ctx.drawImage(left, 0, layout.horizonY)
  ctx.drawImage(right, layout.width - right.width, layout.horizonY)
}

/**
 * The coastline is expensive to draw — the sand speckle and sea glints touch every
 * pixel below the horizon and hash each one — but it only changes when the camera zoom
 * moves the horizon, so it is rasterised once per layout and blitted thereafter.
 * Redrawing it per frame cost roughly two thirds of the frame budget.
 */
/**
 * Sunlight glittering off the water.
 *
 * Drawn per frame rather than baked into the cached coastline, because it is the one
 * part that has to move. It stays cheap by only touching the water band — about a
 * dozen rows — and by deciding each pixel from a hash rather than tracking any state.
 *
 * Two details make it read as water rather than as noise. Each pixel advances through
 * its own time steps from its own phase offset, so the field shimmers instead of
 * strobing in unison. And density falls off toward the viewer: the sea near the horizon
 * is seen at a glancing angle and catches far more light than the water at your feet.
 *
 * `windSpeed` is sampled from the live wind field, so the sea genuinely picks up when
 * it starts blowing.
 */
export function drawSeaSparkle(
  ctx: CanvasRenderingContext2D,
  layout: GroundLayout,
  time: number,
  windSpeed: number,
): void {
  const band = layout.height - layout.horizonY
  const rows = Math.round(band * SEA_BAND_FRACTION)
  if (rows < 2) return

  const s = config.scenery
  const chop = Math.min(windSpeed / 10, 1.6)
  const density = s.seaSparkle * (0.35 + chop)
  if (density <= 0) return

  const top = layout.horizonY + 1
  const bottom = Math.min(top + rows, layout.height)

  for (let y = top; y < bottom; y++) {
    // Glancing light near the horizon, much less of it close in.
    const nearness = (y - top) / Math.max(1, rows - 1)
    const rowDensity = density * (1 - nearness * 0.75)

    for (let x = 0; x < layout.width; x++) {
      const phase = hash1(x + y * 7919, 311)
      const step = Math.floor(time * s.seaSparkleRate + phase * 5)
      if (hash1(x + y * 7919 + step * 104729, 17) >= rowDensity) continue

      const bright = hash1(x + y * 31 + step, 53)
      ctx.fillStyle = bright > 0.55 ? C.cloud : C.seaGlint
      ctx.fillRect(x, y, bright > 0.9 ? 2 : 1, 1)
    }
  }
}

/**
 * Marram grass bending in the wind.
 *
 * Each clump is bent about *its own* roots. The dune has grass at the waterline and
 * grass in the foreground, and bending the lot about the bottom of the image made the
 * upper clumps slide across the sand rather than bend, because their roots were being
 * treated as though they sat far below where they actually grow.
 *
 * Within a clump the bend is a gradient up its height — nothing at the base, most at
 * the tips — drawn as a few horizontal bands, so the whole beach costs a bit over a
 * hundred blits a frame and the coastline underneath stays cached.
 *
 * The bend is a steady lean plus a two-frequency flutter so it does not tick like a
 * metronome, and it scales with the live wind. It never reverses: grass downwind of a
 * steady breeze leans one way and trembles, it does not wave side to side.
 *
 * One honest liberty: the wind blows away from the camera, so grass leaning downwind
 * would foreshorten to almost nothing. It leans sideways instead, which is the pixel
 * art convention and the only version that reads at this size.
 */
export function drawSwayingGrass(
  ctx: CanvasRenderingContext2D,
  layout: GroundLayout,
  time: number,
  windSpeed: number,
): void {
  const { duneLeft, duneRight } = scenery
  if (!duneLeft || !duneRight) return

  const band = layout.height - layout.horizonY
  if (band <= 0) return

  const s = config.scenery
  const scale = band / SCENE_HEIGHT
  const chop = Math.min(windSpeed / 10, 1.6)
  const flutter =
    Math.sin(time * s.grassRate) * 0.7 + Math.sin(time * s.grassRate * 1.73 + 1.1) * 0.3
  // Always positive, so the lean only ever varies in strength. An earlier version let
  // this reach zero and skipped drawing entirely, which made the grass blink out of
  // existence every time the flutter crossed over.
  const bend = s.grassSway * scale * chop * (0.55 + 0.45 * flutter)

  const draw = (dune: typeof duneLeft, key: string, alignRight: boolean) => {
    const width = Math.max(4, Math.round(dune.grass.width * scale))
    const sprite = scaled(key, dune.grass, width)
    const originX = alignRight ? layout.width - sprite.width : 0
    // Taken from the sprite itself rather than recomputed, so rounding in the
    // downsample cannot drift the tuft boxes off the grass they describe.
    const sx = sprite.width / dune.grass.width
    const sy = sprite.height / dune.grass.height

    for (const tuft of dune.tufts) {
      const left = Math.floor(tuft.x * sx)
      const tuftWidth = Math.max(1, Math.ceil(tuft.width * sx))
      const top = Math.floor(tuft.y * sy)
      const tuftHeight = Math.max(1, Math.ceil(tuft.height * sy))
      const roots = top + tuftHeight
      const step = tuftHeight <= 8 ? 2 : 3

      for (let y = top; y < roots; y += step) {
        const rows = Math.min(step, roots - y)
        const up = (roots - y) / tuftHeight
        const dx = Math.round(bend * Math.pow(up, 1.6))
        ctx.drawImage(
          sprite,
          left,
          y,
          tuftWidth,
          rows,
          originX + left + dx,
          layout.horizonY + y,
          tuftWidth,
          rows,
        )
      }
    }
  }

  draw(duneLeft, 'grassLeft', false)
  draw(duneRight, 'grassRight', true)
}

function groundSprite(layout: GroundLayout, scrollX: number): HTMLCanvasElement {
  const hasArt = scenery.loaded
  const source = hasArt ? 'beach' : 'drawn'
  const key = `ground:${source}:${layout.width}:${layout.height}:${layout.horizonY}:${layout.shoreY}:${Math.round(scrollX)}`

  return getSprite(key, layout.width, layout.height, (target) => {
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
}

export function drawGround(
  ctx: CanvasRenderingContext2D,
  layout: GroundLayout,
  scrollX: number,
): void {
  ctx.drawImage(groundSprite(layout, scrollX), 0, 0)
}

/**
 * Swell rolling up the beach.
 *
 * The water is a painting, so there is nothing to simulate — instead the band of water
 * and surf is lifted and set down again by a pixel or two. The colour bands inside it
 * are flat, so what you see moving is the *boundaries* between them undulating, which
 * is what makes pixel-art water read as water.
 *
 * Two things this gets right that a naive version does not.
 *
 * The crests travel **shoreward**, not along the beach. The phase advances with depth
 * into the water rather than with distance along it, so a swell appears out by the
 * horizon and works its way down to the sand. Driving the phase from `x` instead — the
 * obvious thing to write — sends the whole sea sliding sideways past you, which is not
 * something water does.
 *
 * And it is the sum of two wave trains at incommensurate wavelengths and speeds, with
 * a slight slant across the shore so crests are not dead straight. A single sine is
 * perfectly periodic in both space and time and the eye picks it out immediately as a
 * moving graph rather than as sea.
 *
 * The displacement is only ever downward. Letting it go up would lift sea pixels over
 * the horizon into the sky; pushing down reads as surf running up the sand, and any
 * sliver uncovered at the top is the unshifted sea underneath, the same colour.
 */
export function drawWaves(
  ctx: CanvasRenderingContext2D,
  layout: GroundLayout,
  scrollX: number,
  time: number,
  windSpeed: number,
): void {
  const s = config.scenery
  const band = layout.height - layout.horizonY
  const rows = Math.round(band * WAVE_BAND_FRACTION)
  if (s.waveHeight < 1 || rows < 4) return

  const ground = groundSprite(layout, scrollX)
  const key = `seaband:${layout.width}:${layout.horizonY}:${rows}:${scenery.loaded ? 'art' : 'drawn'}`
  const water = getSprite(key, layout.width, rows, (target) => {
    target.drawImage(ground, 0, -layout.horizonY)
  })

  // Split into depth zones. The swell moves through these, from the horizon inward.
  const zones = Math.min(5, rows)
  const zoneRows = rows / zones
  const speed = s.waveSpeed * (0.4 + Math.min(windSpeed / 10, 1.4))
  // Shoreward wavelength, expressed as how much phase is crossed over the whole band.
  const perZone = (Math.PI * 2 * rows) / Math.max(8, s.waveLength) / zones
  const slantA = (Math.PI * 2) / Math.max(60, s.waveLength * 3.1)
  const slantB = (Math.PI * 2) / Math.max(60, s.waveLength * 1.7)
  const slice = 16

  for (let zone = 0; zone < zones; zone++) {
    const top = Math.floor(zone * zoneRows)
    const height = Math.max(1, Math.floor((zone + 1) * zoneRows) - top)
    const depth = zone * perZone

    for (let x = 0; x < layout.width; x += slice) {
      const width = Math.min(slice, layout.width - x)
      // Two trains, deliberately not harmonics of each other, each slanting slightly
      // differently across the shore.
      const a = Math.sin(depth - time * speed + x * slantA)
      const b = Math.sin(depth * 0.63 - time * speed * 1.47 + x * slantB + 2.2)
      const lift = (a * 0.62 + b * 0.38) * 0.5 + 0.5
      const dy = Math.round(lift * s.waveHeight)
      if (dy === 0) continue
      ctx.drawImage(
        water,
        x,
        top,
        width,
        height,
        x,
        layout.horizonY + top + dy,
        width,
        height,
      )
    }
  }
}

