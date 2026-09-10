import { config } from '../sim/config'
import { C } from '../render/palette'
import { fillPolygon, pixelLine, type Point } from '../render/raster'
import type { World } from '../sim/world'

/**
 * The instrument panel.
 *
 * Split in two. The player's readout — height, line out, how hard it is pulling, how
 * long it has been up — is always on and sits in the corners where it stays out of the
 * sky. The engineering readout underneath it, angles and airspeed and frame rate, is
 * for tuning and toggles off with H.
 *
 * Everything is drawn with a one-pixel ink shadow. The HUD has to stay legible over
 * both a bright sky and pale sand, and an outline is cheaper and more in keeping than
 * a translucent panel behind it.
 */

const DEG = 180 / Math.PI
/** Line load that fills the tension bar. Beyond this the kite is really pulling. */
const TENSION_FULL = 120

/**
 * Text with a one-pixel offset behind it. The shadow colour is a parameter because the
 * top of the screen is mid-blue sky and the bottom is pale sand: pale text with a dark
 * shadow disappears against the sand, and dark text with a pale shadow disappears
 * against the sky. Each label picks whichever way round suits what it sits over.
 */
function shadowed(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string = C.hudText,
  shadow: string = C.ink,
): void {
  ctx.fillStyle = shadow
  ctx.fillText(text, x + 1, y + 1)
  ctx.fillStyle = color
  ctx.fillText(text, x, y)
}

function clock(seconds: number): string {
  const whole = Math.floor(seconds)
  const minutes = Math.floor(whole / 60)
  return `${minutes}:${String(whole % 60).padStart(2, '0')}`
}

export interface HudState {
  fps: number
  zoom: number
  /** Best height across the whole session, not just this flight. */
  best: number
  showDebug: boolean
}

export function drawHud(
  ctx: CanvasRenderingContext2D,
  world: World,
  state: HudState,
): void {
  const { kite, flyer, stats } = world
  const d = kite.diag
  const width = ctx.canvas.width
  const height = ctx.canvas.height

  ctx.font = '8px monospace'
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'

  // --- What the player needs ------------------------------------------------
  shadowed(ctx, `ALT  ${kite.pos.y.toFixed(0)}m`, 4, 4)
  shadowed(ctx, `LINE ${config.line.length.toFixed(0)}m`, 4, 13)

  ctx.textAlign = 'right'
  shadowed(ctx, `BEST  ${state.best.toFixed(0)}m`, width - 4, 4)
  shadowed(ctx, `ALOFT ${clock(stats.timeAloft)}`, width - 4, 13)
  shadowed(
    ctx,
    `DOWN  ${stats.crashes}`,
    width - 4,
    22,
    stats.crashes > 0 ? C.kiteTrim : C.hudText,
  )
  ctx.textAlign = 'left'

  // --- Engineering readout ----------------------------------------------------
  if (state.showDebug) {
    const lines = [
      `elev  ${(d.elevation * DEG).toFixed(0)}`,
      `azim  ${(d.azimuth * DEG).toFixed(0)}`,
      `aoa   ${(d.alpha * DEG).toFixed(1)}${d.stalled ? ' STALL' : ''}`,
      `air   ${d.airspeed.toFixed(1)}`,
      `roll  ${(d.roll * DEG).toFixed(0)}`,
      `${state.fps}fps x${state.zoom}`,
    ]
    lines.forEach((line, i) => shadowed(ctx, line, 4, 30 + i * 9, C.sky2))
  }

  drawWindsock(ctx, world, 18, height - 46)
  drawTension(ctx, d.line.tension, width / 2, height - 26)
  drawHands(ctx, flyer.leftDraw, flyer.rightDraw, width / 2, height - 12)
}

/**
 * A windsock on the beach, reading the live field rather than the base setting — so it
 * lifts and drops with the gusts the kite is actually flying through.
 */
function drawWindsock(
  ctx: CanvasRenderingContext2D,
  world: World,
  x: number,
  y: number,
): void {
  const speed = world.windAtGround
  const poleTop = y
  const poleBottom = y + 18

  pixelLine(ctx, x, poleTop, x, poleBottom, C.ink, 1)

  // Hangs limp in still air, stands straight out in a blow.
  const lift = Math.min(speed / 11, 1)
  const flutter = Math.sin(world.time * 5) * 0.06 * lift
  const angle = (1 - lift) * 1.15 + flutter
  const reach = 15
  const dirX = Math.cos(angle) * reach
  const dirY = Math.sin(angle) * reach
  const mouth = 5

  const tip: Point = { x: x + dirX, y: poleTop + dirY }
  const upper: Point = { x: x + 1, y: poleTop - mouth / 2 }
  const lower: Point = { x: x + 1, y: poleTop + mouth / 2 }
  const midUpper: Point = { x: (upper.x + tip.x) / 2, y: (upper.y + tip.y) / 2 - 1 }
  const midLower: Point = { x: (lower.x + tip.x) / 2, y: (lower.y + tip.y) / 2 + 1 }

  // Outlined, because it hangs over the dune grass and a flat shape would be lost
  // against it.
  fillPolygon(
    ctx,
    [
      { x: upper.x - 1, y: upper.y - 1 },
      { x: midUpper.x, y: midUpper.y - 1 },
      { x: tip.x + 1, y: tip.y },
      { x: midLower.x, y: midLower.y + 1 },
      { x: lower.x - 1, y: lower.y + 1 },
    ],
    C.ink,
  )
  fillPolygon(ctx, [upper, midUpper, tip, midLower, lower], C.kiteTrim)
  fillPolygon(ctx, [midUpper, tip, midLower], C.kite)

  ctx.font = '8px monospace'
  ctx.textAlign = 'left'
  // Over sand, so this one is dark text on a pale shadow rather than the other way.
  shadowed(ctx, `${speed.toFixed(1)} m/s`, x + 4, poleBottom + 1, C.ink, C.sand0)
}

/** How hard the line is pulling, and a warning colour as it really loads up. */
function drawTension(
  ctx: CanvasRenderingContext2D,
  tension: number,
  centre: number,
  y: number,
): void {
  const width = 80
  const height = 4
  const x = Math.round(centre - width / 2)
  const filled = Math.round(width * Math.min(tension / TENSION_FULL, 1))

  // An outline, not a filled slab. Backing the whole gauge in ink made an unloaded
  // line read as a solid black bar across the beach.
  ctx.fillStyle = C.ink
  ctx.fillRect(x - 1, y - 1, width + 2, 1)
  ctx.fillRect(x - 1, y + height, width + 2, 1)
  ctx.fillRect(x - 1, y, 1, height)
  ctx.fillRect(x + width, y, 1, height)

  const load = tension / TENSION_FULL
  const colour = load > 0.8 ? C.kite : load > 0.5 ? C.kiteTrim : C.sky2
  ctx.fillStyle = colour
  ctx.fillRect(x, y, filled, height)
}

/** Two bars showing each hand's draw, so the spring-loaded keys are legible. */
function drawHands(
  ctx: CanvasRenderingContext2D,
  leftDraw: number,
  rightDraw: number,
  centre: number,
  y: number,
): void {
  const width = 40
  const height = 4

  const bar = (x: number, value: number) => {
    ctx.fillStyle = C.ink
    ctx.fillRect(x, y, width, height)
    ctx.fillStyle = C.kiteTrim
    ctx.fillRect(x, y, Math.round(width * value), height)
  }

  bar(centre - width - 6, leftDraw)
  bar(centre + 6, rightDraw)
}
