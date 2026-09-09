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

/** Seconds between tail samples. Sets how far back in time the streamer reaches. */
const TAIL_INTERVAL = 0.045
const TAIL_SAMPLES = 15

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
  private trail: Vec3[] = []
  private nextSample = 0

  /** Sampled on a timer so the streamer covers a fixed span of time, not of frames. */
  update(kite: Kite, time: number): void {
    if (time < this.nextSample) return
    this.nextSample = time + TAIL_INTERVAL

    const { spine } = kiteFrame(kite)
    const size = dimensions()
    this.trail.push(add(kite.pos, scale(spine, size.spine * 0.42)))
    if (this.trail.length > TAIL_SAMPLES) this.trail.shift()
  }

  reset(): void {
    this.trail = []
    this.nextSample = 0
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

    this.drawTail(ctx, camera, pTail)

    // Looking at the back of the kite gives a duller, shadowed face.
    const facingAway = dot(view, kite.diag.normal) > 0

    // The back of the kite is the unlit side, not a different fabric.
    const body = facingAway ? C.kiteShade : C.kite
    const upper = facingAway ? C.kiteTrimShade : C.kiteTrim

    const outline: Point[] = [pNose, pLeft, pTail, pRight]
    fillPolygon(ctx, outline, body)
    fillPolygon(ctx, [pNose, pLeft, pRight], upper)

    // Spars, and an outline only once the kite is big enough to carry one without
    // the ink swallowing the whole shape.
    const spanPx = Math.hypot(pRight.x - pLeft.x, pRight.y - pLeft.y)
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
  ): void {
    if (this.trail.length < 2) return

    // Oldest first, so the streamer is drawn from its free end back to the kite.
    const points: Point[] = this.trail.map((p) => camera.project(p))
    points.push(attach)

    for (let i = 1; i < points.length; i++) {
      // Alternating bands, the way a real kite tail is tied from scrap ribbon.
      const color = i % 2 === 0 ? C.kiteTrim : C.kite
      pixelLine(ctx, points[i - 1].x, points[i - 1].y, points[i].x, points[i].y, color)
    }
  }
}
