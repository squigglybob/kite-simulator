import { config } from '../../sim/config'
import { bridleGeometry } from '../../sim/bridle'
import { LOWER_BRIDLE, NOSE, SPAR, TAIL } from '../../sim/shape'
import type { Kite } from '../../sim/kite'
import {
  add,
  cross,
  dot,
  length,
  normalize,
  rotateAbout,
  scale,
  sub,
  v3,
  type Vec3,
} from '../../core/vec3'
import { C } from '../palette'
import { fillPolygon, pixelLine, pixelPath, type Point } from '../raster'
import type { Camera } from '../camera'

/**
 * The kite, drawn from its actual attitude.
 *
 * Rather than picking a sprite for an approximate pose, the four corners are placed in
 * world space from the simulated orientation and projected individually. Foreshortening
 * then comes out right for free: bank, incidence and viewing angle all fall out of the
 * projection, and an edge-on kite genuinely collapses to a sliver.
 *
 * The corners land at arbitrary sub-pixel positions, so the outline is scanline-filled
 * rather than path-filled — a canvas `fill()` would anti-alias every edge.
 *
 * One deliberate cheat. With a near-horizontal camera and a kite whose lift is near
 * vertical, an honest projection shows the kite almost edge-on at low elevation — it
 * collapses to a one-pixel sliver and vanishes. So when the face turns too far away
 * from the viewer, the normal is eased toward the camera until the kite reads again.
 * The orientation, spin and bank all stay continuous; only the foreshortening is
 * flattered.
 *
 * The bridle is drawn but not simulated. Three legs run from the spar holes and the
 * foot of the spine to a tow point standing off the front of the kite, and the flying
 * line ends there rather than at the kite's centre. Simulating the legs as constraints
 * would buy nothing the physics does not already have: what a bridle *does* is set the
 * angle the kite presents to the wind, and that is exactly `kite.trimDeg`.
 */

const DEG = Math.PI / 180

/**
 * How clearly the nose must read as being above the tail on screen.
 *
 * The kite's spine points mostly *away* from this camera, so under perspective the nose
 * — being further off — is dragged toward the horizon faster than its slight rise lifts
 * it. Below roughly 55 degrees of elevation that wins outright and the kite projects
 * upside down. Standing the kite up further fixes it, so the pitch floor is raised until
 * this is satisfied.
 */
const MIN_UPNESS = 0.35
/** Ceiling on that search: past here the kite is edge-on to the wind and reads oddly. */
const MAX_PITCH = (85 * Math.PI) / 180

/** Below this much face-on-ness, open the kite up toward the camera. */
const MIN_FACING = 0.4
/** How completely to billboard at the worst case. Kept under 1 so bank still reads. */
const MAX_CORRECTION = 0.85

/** Upper legs attach half way out along each spar, not at the tips. */
const BRIDLE_SPAN_FRACTION = 0.25

const WORLD_UP: Vec3 = { x: 0, y: 1, z: 0 }

/**
 * The tail is a short chain of points streaming downwind from the kite's tail corner.
 *
 * It was originally a trail of past kite positions, which looked fine while the kite
 * was moving and collapsed to nothing when it hung still — the opposite of a real tail,
 * which streams because of the air, not because of motion. Each link now relaxes toward
 * the apparent wind, sagging under its own weight when the air is slow, and lags a
 * little more the further down the tail it is, which is what gives the whip.
 */
const TAIL_LINKS = 12
/** How fast a link swings toward the airflow, per second. */
const TAIL_RESPONSE = 7
/** Metres per second of droop in still air. */
const TAIL_SAG = 2.4

interface Frame {
  normal: Vec3
  /** Attitude before the edge-on readability correction, for shading. */
  lit: Vec3
  /** Centre toward the nose: up the line, away from the flyer. */
  nose: Vec3
  /** Wingtip to wingtip. */
  span: Vec3
}

function frameAtPitch(kite: Kite, pitch: number, view?: Vec3): Frame {
  let normal = kite.diag.normal

  if (pitch > 1e-3) {
    let lateral = cross(WORLD_UP, kite.diag.windDir)
    lateral = length(lateral) > 1e-4 ? normalize(lateral) : v3(1, 0, 0)
    normal = rotateAbout(normal, lateral, -pitch)
  }
  const litNormal = normal

  if (view) {
    // `-view` is the direction that would face the kite straight at the camera.
    const facing = Math.abs(dot(view, normal))
    if (facing < MIN_FACING) {
      const correction = (1 - facing / MIN_FACING) * MAX_CORRECTION
      const toCamera = scale(view, -Math.sign(dot(view, normal) || 1))
      normal = normalize(
        add(scale(normal, 1 - correction), scale(toCamera, correction)),
      )
    }
  }

  // The nose points up the line, away from the flyer. Deriving it from the airflow
  // instead — which is what this did first — puts the nose on the upwind side, and a
  // kite at any decent elevation then renders hanging upside down. A single-line kite
  // cannot fly inverted: its bridle holds the nose up the line, and the tail hangs back
  // toward the flyer.
  const lineDir = kite.diag.line.dir
  let nose = sub(lineDir, scale(normal, dot(lineDir, normal)))

  if (length(nose) <= 1e-4) {
    // Line square to the face. Fall back to the airflow for a stable axis.
    const windDir = kite.diag.windDir
    nose = sub(windDir, scale(normal, dot(windDir, normal)))
  }
  nose = length(nose) > 1e-4 ? normalize(nose) : v3(0, 1, 0)

  return { normal, lit: litNormal, nose, span: cross(normal, nose) }
}

/**
 * How far the nose rises on screen per unit travelled along the spine. Negative means
 * the nose projects *below* the tail — the kite renders inverted.
 *
 * Moving along the spine changes both height and depth, and depth pulls a point above
 * the horizon back down toward it. This is the derivative of the projected height, so
 * it captures both effects at once.
 */
function noseUpness(nose: Vec3, centre: Vec3): number {
  const depth = Math.max(centre.z + config.camera.dist, 0.5)
  return nose.y - ((centre.y - config.camera.eyeHeight) * nose.z) / depth
}

export function kiteFrame(kite: Kite, centre: Vec3, view?: Vec3): Frame {
  // Pitch the drawn kite back, but only by the shortfall. The simulated attitude is
  // honest — the bridle geometry already stands the kite up when it is low in the
  // window and lays it flat near the zenith — but this camera looks along the wind
  // rather than up at the kite, and a flat kite seen from there is edge-on. A viewer
  // would tilt their head; the camera cannot, so the kite is tipped toward it instead.
  const floor = Math.max(
    0,
    config.kite.drawPitchFloorDeg * DEG - Math.abs(kite.diag.alpha),
  )

  const base = frameAtPitch(kite, floor, view)
  if (noseUpness(base.nose, centre) >= MIN_UPNESS) return base

  // Perspective is winning. Stand the kite up further until the nose reads above the
  // tail. Bisection rather than a flip, so the correction changes smoothly as the kite
  // moves instead of popping over at the crossover.
  let low = floor
  let high = MAX_PITCH
  for (let i = 0; i < 10; i++) {
    const mid = (low + high) / 2
    if (noseUpness(frameAtPitch(kite, mid, view).nose, centre) >= MIN_UPNESS) high = mid
    else low = mid
  }
  return frameAtPitch(kite, high, view)
}

/** Direction from the camera to a world point. */
function viewTo(target: Vec3): Vec3 {
  const cameraPos = v3(0, config.camera.eyeHeight, -config.camera.dist)
  return normalize(sub(target, cameraPos))
}

function dimensions(): { spine: number; span: number } {
  // A kite quadrilateral of diagonals d1 and d2 has area d1*d2/2. Splitting that by the
  // aspect ratio keeps the area exactly what the physics is using at any proportion,
  // then scales the whole thing up for readability.
  const area = 2 * config.kite.area
  const aspect = Math.max(config.kite.aspect, 0.2)
  const scaleUp = config.kite.visualScale
  return {
    spine: Math.sqrt(area * aspect) * scaleUp,
    span: Math.sqrt(area / aspect) * scaleUp,
  }
}

export class KiteRenderer {
  private tail: Vec3[] = []

  /** Where the tail is tied on: the foot of the spine, nearest the flyer. */
  private anchor(kite: Kite): Vec3 {
    const { nose } = kiteFrame(kite, kite.pos, viewTo(kite.pos))
    return add(kite.pos, scale(nose, dimensions().spine * TAIL))
  }

  /**
   * The tow point, where the three bridle legs meet and the flying line begins. Its
   * position comes from the same leg-length solve the physics uses, so the drawn bridle
   * and the simulated one cannot drift apart. It stands off the windward face, which is
   * why the line reads as attaching to the near side of the kite rather than
   * disappearing behind it.
   */
  bridlePoint(kite: Kite, centre: Vec3): Vec3 {
    const size = dimensions()
    const { nose, normal } = kiteFrame(kite, centre, viewTo(centre))
    const bridle = bridleGeometry()
    return add(
      add(centre, scale(nose, size.spine * bridle.along)),
      // `normal` is the leeward side, so the bridle hangs off its opposite.
      scale(normal, -size.spine * bridle.standoff),
    )
  }

  update(kite: Kite, dt: number): void {
    const anchor = this.anchor(kite)
    // Scaled by visualScale alongside the kite body, so a kite drawn larger than life
    // keeps its proportions instead of sprouting a stub.
    const link =
      (config.kite.tailLength * config.kite.visualScale) / (TAIL_LINKS - 1)

    if (this.tail.length !== TAIL_LINKS) {
      this.tail = Array.from({ length: TAIL_LINKS }, (_, i) =>
        add(anchor, scale(kite.diag.windDir, link * i)),
      )
      return
    }

    // Slower air lets the tail hang; fast air pulls it straight out behind.
    const sag = Math.min(TAIL_SAG / Math.max(kite.diag.airspeed, 0.5), 2)
    let flow = add(kite.diag.windDir, v3(0, -sag, 0))
    flow = length(flow) > 1e-4 ? normalize(flow) : v3(0, -1, 0)

    this.tail[0] = anchor
    for (let i = 1; i < TAIL_LINKS; i++) {
      const previous = this.tail[i - 1]
      let dir = sub(this.tail[i], previous)
      dir = length(dir) > 1e-4 ? normalize(dir) : flow

      // Links further down the tail lag more, which is what makes it crack.
      const response = TAIL_RESPONSE * (1 - (i / TAIL_LINKS) * 0.55)
      const blend = Math.min(response * dt, 1)
      const eased = add(scale(dir, 1 - blend), scale(flow, blend))
      const settled = length(eased) > 1e-4 ? normalize(eased) : flow

      this.tail[i] = add(previous, scale(settled, link))
    }
  }

  reset(): void {
    this.tail = []
  }

  draw(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    kite: Kite,
    centre: Vec3,
  ): void {
    const view = viewTo(centre)
    const { nose: noseDir, span, lit } = kiteFrame(kite, centre, view)
    const size = dimensions()

    const nose = add(centre, scale(noseDir, size.spine * NOSE))
    const tail = add(centre, scale(noseDir, size.spine * TAIL))
    // The cross spar sits a quarter of the way down from the nose, which is what makes
    // the outline a kite rather than a rhombus.
    const sparOffset = scale(noseDir, size.spine * SPAR)
    const left = add(add(centre, scale(span, -size.span * 0.5)), sparOffset)
    const right = add(add(centre, scale(span, size.span * 0.5)), sparOffset)
    const pNose = camera.project(nose)
    const pTail = camera.project(tail)
    const pLeft = camera.project(left)
    const pRight = camera.project(right)

    // Looking at the back of the kite gives a duller, shadowed face.
    const facingAway = dot(view, lit) > 0

    // The back of the kite is the unlit side, not a different fabric.
    const body = facingAway ? C.kiteShade : C.kite
    const upper = facingAway ? C.kiteTrimShade : C.kiteTrim

    const spanPx = Math.hypot(pRight.x - pLeft.x, pRight.y - pLeft.y)
    this.drawTail(ctx, camera, pTail, spanPx)

    const outline: Point[] = [pNose, pLeft, pTail, pRight]
    fillPolygon(ctx, outline, body)
    fillPolygon(ctx, [pNose, pLeft, pRight], upper)

    // Spars, and an outline only once the kite is big enough to carry one without
    // the ink swallowing the whole shape.
    if (spanPx > 7) {
      pixelLine(ctx, pNose.x, pNose.y, pTail.x, pTail.y, C.ink)
      pixelLine(ctx, pLeft.x, pLeft.y, pRight.x, pRight.y, C.ink)
    }
    if (spanPx > 12) {
      pixelPath(ctx, [...outline, pNose], C.ink)
    }
  }

  /**
   * The three bridle legs, drawn last so they sit over both the kite face and the
   * flying line — they genuinely stand in front of both.
   *
   * Seen from behind the flyer, the tow point stands off almost straight along the view
   * axis, so the legs foreshorten to a small fan across the face rather than a visible
   * triangle. That is honest to the viewpoint; the payoff is that the line now clearly
   * ends *on* the kite instead of vanishing behind it.
   */
  drawBridle(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    kite: Kite,
    centre: Vec3,
  ): void {
    const view = viewTo(centre)
    const { nose: noseDir, span } = kiteFrame(kite, centre, view)
    const size = dimensions()

    const sparOffset = scale(noseDir, size.spine * SPAR)
    const inboard = size.span * BRIDLE_SPAN_FRACTION
    const pLeft = camera.project(add(add(centre, scale(span, -inboard)), sparOffset))
    const pRight = camera.project(add(add(centre, scale(span, inboard)), sparOffset))
    const pFoot = camera.project(
      add(centre, scale(noseDir, size.spine * LOWER_BRIDLE)),
    )
    const pTow = camera.project(this.bridlePoint(kite, centre))

    const tipSpanPx = Math.hypot(
      camera.project(add(centre, scale(span, size.span * 0.5))).x -
        camera.project(add(centre, scale(span, -size.span * 0.5))).x,
      0,
    )
    if (tipSpanPx < 9) return

    for (const anchor of [pLeft, pRight, pFoot]) {
      pixelLine(ctx, pTow.x, pTow.y, anchor.x, anchor.y, C.ink)
    }
  }

  private drawTail(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    attach: Point,
    spanPx: number,
  ): void {
    if (this.tail.length < 2 || config.kite.tailLength <= 0) return

    const points: Point[] = this.tail.map((p) => camera.project(p))
    points[0] = attach

    // A big kite gets a ribbon thick enough to read; a distant one stays hairline.
    const thickness = spanPx > 26 ? 2 : 1

    for (let i = 1; i < points.length; i++) {
      // Alternating bands, the way a real kite tail is tied from scrap ribbon.
      const color = i % 2 === 0 ? C.kiteTrim : C.kite
      pixelLine(
        ctx,
        points[i - 1].x,
        points[i - 1].y,
        points[i].x,
        points[i].y,
        color,
        thickness,
      )
    }
  }
}
