import { startLoop } from './core/loop'
import { add, scale, sub, v3, type Vec3 } from './core/vec3'
import { createInput } from './input/keys'
import { Camera, FEET_Y } from './render/camera'
import { C } from './render/palette'
import { pixelPath, type Point } from './render/raster'
import { BASE_H, BASE_W, Screen } from './render/screen'
import { CloudField } from './render/sprites/cloud'
import { drawFlyer } from './render/sprites/flyer'
import { drawGround, type GroundLayout } from './render/sprites/ground'
import { KiteRenderer } from './render/sprites/kite'
import { drawSky } from './render/sprites/sky'
import { config } from './sim/config'
import { sagDepth } from './sim/line'
import { World } from './sim/world'
import { drawHud } from './ui/hud'
import { createTuningPanel, loadSavedConfig } from './ui/tuning'
import { drawForceVectors } from './ui/vectors'

const canvas = document.querySelector<HTMLCanvasElement>('#screen')
if (!canvas) throw new Error('#screen canvas is missing from the document')

loadSavedConfig()

const screen = new Screen(canvas)
const ctx = screen.ctx
const camera = new Camera()
const world = new World()
const input = createInput()
const clouds = new CloudField()
const kiteRenderer = new KiteRenderer()

const panel = createTuningPanel(() => {
  world.reset()
  kiteRenderer.reset()
})
let showVectors = false

input.onPress('KeyR', () => {
  world.reset()
  kiteRenderer.reset()
})
input.onPress('KeyV', () => (showVectors = !showVectors))
input.onPress('KeyT', () => panel.toggle())

/** World-space distance to the waterline. Fixes where sea meets sand on screen. */
const SHORE_DISTANCE = 45
const FLYER_HEIGHT_M = 1.75
/** Tension at which the flyer is bracing as hard as they will. */
const BRACE_TENSION = 60
const STRING_SEGMENTS = 14

function step(dt: number): void {
  world.step(dt, input.state)
  clouds.update(dt)
  kiteRenderer.update(world.kite, world.time)
}

function groundLayout(): GroundLayout {
  const horizonY = clamp(Math.round(camera.horizonY), 8, BASE_H - 4)
  const shoreY = Math.round(camera.project(v3(0, 0, SHORE_DISTANCE)).y)
  return {
    width: BASE_W,
    height: BASE_H,
    horizonY,
    // Always leave the sea a visible band, however far out the camera pulls.
    shoreY: clamp(shoreY, horizonY + 3, BASE_H - 2),
  }
}

/**
 * The line, sampled as a curve in world space and then projected, so perspective
 * applies along its length rather than to a flat approximation of it.
 */
function drawString(handScreen: Point, kiteWorld: Vec3): void {
  const handWorld = world.flyer.handPos
  const sag = sagDepth(world.kite.diag.line)

  const midpoint = scale(add(handWorld, kiteWorld), 0.5)
  const sagged = sub(midpoint, v3(0, sag, 0))
  // Control point that puts the curve's midpoint exactly at the sagged position.
  const control = sub(scale(sagged, 2), midpoint)

  const points: Point[] = []
  for (let i = 0; i <= STRING_SEGMENTS; i++) {
    const t = i / STRING_SEGMENTS
    const u = 1 - t
    const world3 = add(
      add(scale(handWorld, u * u), scale(control, 2 * u * t)),
      scale(kiteWorld, t * t),
    )
    points.push(camera.project(world3))
  }
  // Start from where the hands were actually drawn, not where the physics anchor is.
  points[0] = handScreen

  pixelPath(ctx, points, C.ink)
}

let smoothedFrameTime = 1 / 60

function render(alpha: number, frameTime: number): void {
  if (frameTime > 0) smoothedFrameTime += (frameTime - smoothedFrameTime) * 0.1

  const kite = world.kite
  const kiteWorld = add(kite.prevPos, scale(sub(kite.pos, kite.prevPos), alpha))
  camera.update(kiteWorld)

  const layout = groundLayout()
  drawSky(ctx, BASE_W, layout.horizonY)
  clouds.draw(ctx, camera, layout.horizonY)
  drawGround(ctx, layout, 0)

  // The flyer stands at the world origin, so their depth is the camera setback.
  const pixelsPerMetre = (config.camera.focal / config.camera.dist) * camera.zoom
  const tensionFraction = Math.min(kite.diag.line.tension / BRACE_TENSION, 1)
  // Leaning back against the pull foreshortens the figure slightly.
  const heightPx = Math.max(6, FLYER_HEIGHT_M * pixelsPerMetre * (1 - 0.08 * tensionFraction))

  const kiteScreen = camera.project(kiteWorld)
  const shoulderY = FEET_Y - heightPx * 0.8
  const stringAngle = Math.atan2(kiteScreen.y - shoulderY, kiteScreen.x - BASE_W / 2)

  const handScreen = drawFlyer(ctx, {
    feetX: BASE_W / 2,
    feetY: FEET_Y,
    heightPx,
    stringAngle,
    pull: world.flyer.pull,
    // Tilt away from any sideways pull; a centred kite pulls straight back instead.
    lean: -Math.cos(stringAngle) * tensionFraction * 0.3,
  })

  drawString(handScreen, kiteWorld)
  kiteRenderer.draw(ctx, camera, kite, kiteWorld)

  if (showVectors) drawForceVectors(ctx, kite, camera)
  drawHud(ctx, world, Math.round(1 / smoothedFrameTime), camera.zoom)

  screen.present()
}

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n
}

startLoop({ step, render })

// A hot reload re-runs this module in place, which would leave the previous game loop
// running alongside the new one and step the simulation twice per frame. Reload fully.
if (import.meta.hot) {
  import.meta.hot.accept(() => location.reload())
}
