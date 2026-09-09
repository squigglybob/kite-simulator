import { config } from '../../sim/config'
import type { Kite } from '../../sim/kite'
import {
  add,
  cross,
  dot,
  length,
  normalize,
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
 */

/** Below this much face-on-ness, open the kite up toward the camera. */
const MIN_FACING = 0.4
/** How completely to billboard at the worst case. Kept under 1 so bank still reads. */
const MAX_CORRECTION = 0.85

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
  /** Nose-to-tail, along the airflow. */
  spine: Vec3
  /** Wingtip to wingtip. */
  span: Vec3
}

function kiteFrame(kite: Kite, view?: Vec3): Frame {
  let normal = kite.diag.normal

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

  const windDir = kite.diag.windDir

  // The spine lies in the kite's plane, aligned with the flow across it.
  let spine = sub(windDir, scale(normal, dot(windDir, normal)))
  spine = length(spine) > 1e-4 ? normalize(spine) : v3(0, 1, 0)

  return { normal, spine, span: cross(normal, spine) }
}

function dimensions(): { spine: number; span: number } {
  // A rhombus of diagonals d1 and d2 has area d1*d2/2, so this tracks the area the
  // physics is using however the player tunes it, then scales up for readability.
  const diagonal = Math.sqrt(2 * config.kite.area) * config.kite.visualScale
  return { spine: diagonal * 1.08, span: diagonal * 0.92 }
}

export class KiteRenderer {
  private tail: Vec3[] = []

  /** Where the tail is tied on: the kite's trailing corner. */
  private anchor(kite: Kite): Vec3 {
    const { spine } = kiteFrame(kite)
    return add(kite.pos, scale(spine, dimensions().spine * 0.42))
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
    const cameraPos = v3(0, config.camera.eyeHeight, -config.camera.dist)
    const view = normalize(sub(centre, cameraPos))

    const { spine, span } = kiteFrame(kite, view)
    const size = dimensions()

    const nose = add(centre, scale(spine, -size.spine * 0.58))
    const tail = add(centre, scale(spine, size.spine * 0.42))
    const sparOffset = scale(spine, -size.spine * 0.08)
    const left = add(add(centre, scale(span, -size.span * 0.5)), sparOffset)
    const right = add(add(centre, scale(span, size.span * 0.5)), sparOffset)

    const pNose = camera.project(nose)
    const pTail = camera.project(tail)
    const pLeft = camera.project(left)
    const pRight = camera.project(right)

    // Looking at the back of the kite gives a duller, shadowed face.
    const facingAway = dot(view, kite.diag.normal) > 0

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
