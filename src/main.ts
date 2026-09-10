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
import {
  drawGround,
  drawSeaSparkle,
  drawSwayingGrass,
  drawWaves,
  type GroundLayout,
} from './render/sprites/ground'
import { KiteRenderer } from './render/sprites/kite'
import { drawSky } from './render/sprites/sky'
import { config } from './sim/config'
import { windAt } from './sim/wind'
import { sagDepth } from './sim/line'
import { World } from './sim/world'
import { drawHud } from './ui/hud'
import { drawWindWindow } from './ui/windwindow'
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

/**
 * Only available with the kite down. Setting up mid-flight would snatch a good flight
 * away on a stray keypress, and there is no real-world action it corresponds to.
 */
function setUpForLaunch(): void {
  if (!world.isGrounded) return
  world.setUpForLaunch()
  kiteRenderer.reset()
}

const panel = createTuningPanel({
  onRelaunch: () => {
    world.reset()
    kiteRenderer.reset()
  },
  onSetUpForLaunch: setUpForLaunch,
  onChange: (path) => {
    if (path.startsWith('audio.')) ambience.refreshVolume()
  },
})
let showVectors = false
let showDebug = true
let showWindow = false

/** Best height survives a reload, so it is worth beating rather than just a counter. */
const BEST_KEY = 'kite-flyer.best'
let best = Number(localStorage.getItem(BEST_KEY) ?? 0) || 0

input.onPress('KeyR', () => {
  world.reset()
  kiteRenderer.reset()
})
input.onPress('KeyV', () => (showVectors = !showVectors))
input.onPress('KeyT', () => panel.toggle())
input.onPress('KeyM', () => ambience.toggleMute())
input.onPress('KeyH', () => (showDebug = !showDebug))
input.onPress('KeyW', () => (showWindow = !showWindow))
input.onPress('Space', setUpForLaunch)

/** World-space distance to the waterline. Fixes where sea meets sand on screen. */
const SHORE_DISTANCE = 45
const FLYER_HEIGHT_M = 1.75
/** The line lies on the sand rather than sinking through it. */
const GROUND_CLEARANCE = 0.1
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
 * applies along its length rather than to a flat approximation of it. `tow` is the
 * bridle's tow point, not the kite's centre — that is where a line ends.
 *
 * A cubic rather than a quadratic, and both control points hang the same distance
 * *below the chord* rather than at the same absolute height. That distinction is the
 * whole thing: pinning them to one height makes the droop negligible at the low end
 * and enormous at the high end, so a line at any angle between vertical and flat comes
 * out as an S. Measuring the droop from the chord keeps the bow symmetric, which is
 * what a hanging line does, while the extra control point still lets a really slack
 * line drop away from the hand, run along the beach and rise again at the far end —
 * something a quadratic, bowing toward a single point, cannot draw.
 *
 * Points are clamped to ground level as they are sampled, rather than the sag being
 * capped beforehand. Capping first meant a kite already lying on the sand had no room
 * left to droop into, so the line snapped straight exactly when it should have looked
 * its slackest.
 */
function drawString(handScreen: Point, tow: Vec3): void {
  const handWorld = world.flyer.handPos
  const sag = sagDepth(world.kite.diag.line)

  // Both controls hang this far under the chord. A cubic whose controls are dropped by
  // `d` sits 0.75 * d below the chord at its midpoint, so this lands the curve on
  // exactly the sag the line physics asked for.
  const droop = sag / 0.75
  const chordAt = (t: number): Vec3 =>
    v3(
      handWorld.x + (tow.x - handWorld.x) * t,
      handWorld.y + (tow.y - handWorld.y) * t - droop,
      handWorld.z + (tow.z - handWorld.z) * t,
    )
  const first = chordAt(0.25)
  const second = chordAt(0.75)

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
      add(scale(handWorld, u * u * u), scale(first, 3 * u * u * t)),
      add(scale(second, 3 * u * t * t), scale(tow, t * t * t)),
    )
    // The beach stops it, wherever along its length that happens.
    if (world3.y < GROUND_CLEARANCE) world3.y = GROUND_CLEARANCE
    points.push(camera.project(world3))
  }

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
  // Sampled just above the water so the glitter answers to the same field the kite
  // is flying in, gusts and all.
  const seaWind = windAt(v3(0, 1.5, SHORE_DISTANCE), world.time)
  const seaSpeed = Math.hypot(seaWind.x, seaWind.y, seaWind.z)
  drawWaves(ctx, layout, 0, world.time, seaSpeed)
  drawSeaSparkle(ctx, layout, world.time, seaSpeed)
  drawSwayingGrass(ctx, layout, world.time, seaSpeed)

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

  if (showWindow) drawWindWindow(ctx, camera, world)
  if (showVectors) drawForceVectors(ctx, kite, camera)

  if (world.stats.maxAltitude > best) {
    best = world.stats.maxAltitude
    localStorage.setItem(BEST_KEY, String(Math.round(best)))
  }
  panel.setLaunchEnabled(world.isGrounded)
  drawHud(ctx, world, {
    fps: Math.round(1 / smoothedFrameTime),
    zoom: camera.zoom,
    best,
    showDebug,
  })

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
