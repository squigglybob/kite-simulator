import { Ambience } from './audio/ambience'
import { startLoop } from './core/loop'
import { add, scale, sub, v3, type Vec3 } from './core/vec3'
import { createInput } from './input/keys'
import { Camera, FEET_Y } from './render/camera'
import { C } from './render/palette'
import { pixelPath, type Point } from './render/raster'
import { BASE_H, BASE_W, Screen } from './render/screen'
import { loadScenery } from './render/assets'
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

// The game runs immediately on the procedural coastline; the generated beach swaps in
// whenever it finishes loading.
void loadScenery()

// Downloaded and decoded straight away, but silent until the first key or click — no
// browser will start audio before the page has been interacted with.
const ambience = new Ambience()
void ambience.load()
ambience.unlockOn()
const kiteRenderer = new KiteRenderer()

const panel = createTuningPanel(
  () => {
    world.reset()
    kiteRenderer.reset()
  },
  (path) => {
    if (path.startsWith('audio.')) ambience.refreshVolume()
  },
)
let showVectors = false

input.onPress('KeyR', () => {
  world.reset()
  kiteRenderer.reset()
})
input.onPress('KeyV', () => (showVectors = !showVectors))
input.onPress('KeyT', () => panel.toggle())
input.onPress('KeyM', () => ambience.toggleMute())

/** World-space distance to the waterline. Fixes where sea meets sand on screen. */
const SHORE_DISTANCE = 45
const FLYER_HEIGHT_M = 1.75
/** Tension at which the flyer is bracing as hard as they will. */
const BRACE_TENSION = 35
/**
 * The line is sampled by projected length, not by a fixed count. At a fixed count each
 * chord covers `lineLength / count` metres, so on an 80 m line the segment leaving the
 * hands spanned nearly six metres and drew as a visibly rigid stick — and grew longer
 * the more line you let out.
 */
const STRING_PIXELS_PER_SEGMENT = 4
const STRING_MIN_SEGMENTS = 10
const STRING_MAX_SEGMENTS = 72

function step(dt: number): void {
  world.step(dt, input.state)
  clouds.update(dt)
  kiteRenderer.update(world.kite, dt)
  // Reeling moves config.line.length directly, so the panel needs telling.
  if (input.state.reelIn || input.state.reelOut) panel.refresh()
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
/** `tow` is the bridle's tow point, not the kite's centre — that is where a line ends. */
function drawString(handScreen: Point, tow: Vec3): void {
  const handWorld = world.flyer.handPos
  const sag = sagDepth(world.kite.diag.line)

  const midpoint = scale(add(handWorld, tow), 0.5)
  const sagged = sub(midpoint, v3(0, sag, 0))
  // Control point that puts the curve's midpoint exactly at the sagged position.
  const control = sub(scale(sagged, 2), midpoint)

  const towScreen = camera.project(tow)
  const screenLength = Math.hypot(
    towScreen.x - handScreen.x,
    towScreen.y - handScreen.y,
  )
  const segments = clamp(
    Math.round(screenLength / STRING_PIXELS_PER_SEGMENT),
    STRING_MIN_SEGMENTS,
    STRING_MAX_SEGMENTS,
  )

  const points: Point[] = []
  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    const u = 1 - t
    const world3 = add(
      add(scale(handWorld, u * u), scale(control, 2 * u * t)),
      scale(tow, t * t),
    )
    points.push(camera.project(world3))
  }

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

  // The line ends at the bridle's tow point, which stands off the front of the kite.
  const towWorld = kiteRenderer.bridlePoint(kite, kiteWorld)
  const towScreen = camera.project(towWorld)
  // One grip, shared by the rig and the string: the projected simulated hand position.
  // Drawing them from separate points left a kink at the hands.
  const handScreen = camera.project(world.flyer.handPos)
  const stringAngle = Math.atan2(towScreen.y - handScreen.y, towScreen.x - handScreen.x)

  drawFlyer(ctx, {
    feetX: BASE_W / 2,
    feetY: FEET_Y,
    heightPx,
    hand: handScreen,
    stringAngle,
    tension: tensionFraction,
    // Tilt away from any sideways pull; a centred kite pulls straight back instead.
    lean: -Math.cos(stringAngle) * tensionFraction * 0.3,
  })

  // Body first, then the line over it, then the bridle over both. The tow point is
  // nearer the camera than the kite is, so a line drawn underneath the body looked as
  // though it passed behind the kite.
  kiteRenderer.draw(ctx, camera, kite, kiteWorld)
  drawString(handScreen, towWorld)
  kiteRenderer.drawBridle(ctx, camera, kite, kiteWorld)

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
