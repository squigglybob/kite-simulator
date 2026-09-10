import { config } from '../sim/config'
import { add, v3, type Vec3 } from '../core/vec3'
import { C } from '../render/palette'
import type { Camera } from '../render/camera'
import type { World } from '../sim/world'

/**
 * The wind window: the dome of air downwind of the flyer that a kite can actually fly
 * in, drawn as a wireframe at the current line length.
 *
 * This is the one thing a new flyer has to internalise. Straight downwind and low is
 * the power zone, where the kite meets the most wind and pulls hardest; out at the
 * edges — overhead, or square to either side — the kite runs out of airflow, the line
 * goes slack and it falls. Every stall and every dive in the game happens because of
 * where the kite sits on this dome, and until you can see the dome that looks arbitrary.
 *
 * Drawn dotted rather than as solid lines, so it reads as an overlay you can see the
 * sky through instead of a cage around the kite.
 */

const DEG = Math.PI / 180

/** Rings of constant height above the horizon. */
const ELEVATIONS = [15, 30, 45, 60, 75]
/** Ribs of constant bearing either side of straight downwind. */
const AZIMUTHS = [-75, -50, -25, 0, 25, 50, 75]
/** How far round the dome the rings run. */
const AZIMUTH_LIMIT = 85
/**
 * Only every other sample is painted, which is what makes it dotted. The count has to
 * be generous: at a long line the dome projects across most of the screen, and a
 * sparse sampling leaves dots so far apart they no longer read as a curve.
 */
const SAMPLES = 256

/** A point on the dome, at the current line length from the hand. */
function onDome(hand: Vec3, radius: number, azimuth: number, elevation: number): Vec3 {
  const horizontal = Math.cos(elevation) * radius
  return add(
    hand,
    v3(
      Math.sin(azimuth) * horizontal,
      Math.sin(elevation) * radius,
      Math.cos(azimuth) * horizontal,
    ),
  )
}

export function drawWindWindow(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  world: World,
): void {
  const hand = world.flyer.handPos
  const radius = config.line.length
  const height = ctx.canvas.height
  const width = ctx.canvas.width

  const dot = (point: Vec3, colour: string) => {
    const p = camera.project(point)
    const x = Math.round(p.x)
    const y = Math.round(p.y)
    // Nothing below the horizon: the dome does not go underground.
    if (x < 0 || y < 0 || x >= width || y >= height) return
    ctx.fillStyle = colour
    ctx.fillRect(x, y, 1, 1)
  }

  for (const degrees of ELEVATIONS) {
    const elevation = degrees * DEG
    // The zenith ring is the edge of the window, so it gets the warning colour.
    const colour = degrees >= 75 ? C.kiteTrim : C.sky2
    for (let i = 0; i <= SAMPLES; i += 2) {
      const azimuth = (-AZIMUTH_LIMIT + (2 * AZIMUTH_LIMIT * i) / SAMPLES) * DEG
      dot(onDome(hand, radius, azimuth, elevation), colour)
    }
  }

  for (const degrees of AZIMUTHS) {
    const azimuth = degrees * DEG
    const edge = Math.abs(degrees) >= 75
    const colour = edge ? C.kiteTrim : C.sky2
    for (let i = 0; i <= SAMPLES; i += 2) {
      const elevation = ((88 * i) / SAMPLES) * DEG
      dot(onDome(hand, radius, azimuth, elevation), colour)
    }
  }

  // The power zone: straight downwind and low, where the kite pulls hardest.
  for (let i = 0; i <= 20; i++) {
    const azimuth = (-18 + (36 * i) / 20) * DEG
    dot(onDome(hand, radius, azimuth, 25 * DEG), C.kite)
  }
}
