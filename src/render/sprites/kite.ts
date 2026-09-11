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
  scale,
  sub,
  v3,
  type Vec3,
} from '../../core/vec3'
import { C } from '../palette'
import { fillPolygon, pixelLine, pixelPath, type Point } from '../raster'
import type { Camera } from '../camera'

/**
 * The kite, drawn straight from its simulated orientation.
 *
 * The simulation carries a real attitude now, so there is nothing to reconstruct: the
 * nose, span and face come off the rigid body as they are. That deleted a great deal of
 * machinery — a pitch floor, a search that raised it until the nose projected above the
 * tail, and a derivation of the nose from the line direction that was ill-conditioned
 * enough to swing 90 degrees on a 7 degree physical change. None of it is needed once
 * the body knows which way it is pointing.
 *
 * The four corners are placed in world space and projected individually, so bank,
 * incidence and viewing angle all fall out of the projection. They land at arbitrary
 * sub-pixel positions, so the outline is scanline-filled rather than path-filled — a
 * canvas `fill()` would anti-alias every edge.
 *
 * One safety net remains. If the kite ever turns far enough edge-on to the camera to
 * vanish, its face is eased toward the viewer. In normal flight it never fires: the
 * kite trims roughly square to its line, which points it near enough at the camera.
 */

/** Below this much face-on-ness, open the kite up toward the camera. */
const MIN_FACING = 0.22
/** How completely to billboard at the worst case. Kept under 1 so bank still reads. */
const MAX_CORRECTION = 0.7

/** Upper bridle legs attach half way out along each spar, not at the tips. */
const BRIDLE_SPAN_FRACTION = 0.25
/** Samples per bridle leg when it is drawn with sag. */
const BRIDLE_SEGMENTS = 5

/**
 * The tail is a short chain of points streaming downwind from the kite's tail corner.
 * Each link relaxes toward the apparent wind, sagging under its own weight when the air
 * is slow, and lags a little more the further down the tail it is, which gives the whip.
 */
const TAIL_LINKS = 12
const TAIL_RESPONSE = 7
const TAIL_SAG = 2.4

interface Frame {
  normal: Vec3
  /** Attitude before the edge-on safety net, for shading. */
  lit: Vec3
  nose: Vec3
  span: Vec3
}

/** Direction from the camera to a world point. */
function viewTo(target: Vec3): Vec3 {
  const cameraPos = v3(0, config.camera.eyeHeight, -config.camera.dist)
  return normalize(sub(target, cameraPos))
}

export function kiteFrame(kite: Kite, view?: Vec3): Frame {
  const lit = kite.normal

  if (view) {
    const facing = Math.abs(dot(view, kite.normal))
    if (facing < MIN_FACING) {
      const correction = (1 - facing / MIN_FACING) * MAX_CORRECTION
      const toCamera = scale(view, -Math.sign(dot(view, kite.normal) || 1))
      const normal = normalize(
        add(scale(kite.normal, 1 - correction), scale(toCamera, correction)),
      )
      // Keep the frame orthonormal by sliding the nose onto the new face, rather than
      // recomputing it from anything — recomputing is what used to make it flip.
      let nose = sub(kite.nose, scale(normal, dot(kite.nose, normal)))
      nose = length(nose) > 1e-4 ? normalize(nose) : kite.nose
      return { normal, lit, nose, span: cross(nose, normal) }
    }
  }

  return { normal: kite.normal, lit, nose: kite.nose, span: kite.span }
}

/**
 * A point on the sail, given as a fraction along the spine and a signed fraction of
 * the half span, placed in world space with the dihedral bend applied.
 *
 * The bend matches the physics: both tips are displaced toward the leeward face, so
 * the sail is a shallow dish facing into the wind — which is exactly what tightening
 * the bow line on a real cross spar does.
 */
function sailPoint(
  centre: Vec3,
  frame: Frame,
  size: { spine: number; span: number },
  alongSpine: number,
  acrossSpan: number,
): Vec3 {
  const dihedral = config.kite.dihedralDeg * DEG
  const out = Math.abs(acrossSpan) * size.span * 0.5
  return add(
    add(centre, scale(frame.nose, alongSpine * size.spine)),
    add(
      scale(frame.span, Math.sign(acrossSpan) * out * Math.cos(dihedral)),
      scale(frame.normal, out * Math.sin(dihedral)),
    ),
  )
}

const DEG = Math.PI / 180

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
    return add(kite.pos, scale(kite.nose, dimensions().spine * TAIL))
  }

  /**
   * The tow point, where the three bridle legs meet and the flying line begins. Its
   * position comes from the same leg-length solve the physics uses, so the drawn bridle
   * and the simulated one cannot drift apart.
   */
  bridlePoint(kite: Kite, centre: Vec3): Vec3 {
    const size = dimensions()
    const { nose, normal } = kiteFrame(kite, viewTo(centre))
    const bridle = bridleGeometry()
    return add(
      add(centre, scale(nose, size.spine * bridle.along)),
      // `normal` is the leeward side, so the bridle hangs off its opposite.
      scale(normal, -size.spine * bridle.standoff),
    )
  }

  update(kite: Kite, dt: number): void {
    const anchor = this.anchor(kite)
    const link = (config.kite.tailLength * config.kite.visualScale) / (TAIL_LINKS - 1)

    if (this.tail.length !== TAIL_LINKS) {
      this.tail = Array.from({ length: TAIL_LINKS }, (_, i) =>
        add(anchor, scale(kite.diag.windDir, link * i)),
      )
      return
    }

    const sag = Math.min(TAIL_SAG / Math.max(kite.diag.airspeed, 0.5), 2)
    let flow = add(kite.diag.windDir, v3(0, -sag, 0))
    flow = length(flow) > 1e-4 ? normalize(flow) : v3(0, -1, 0)

    this.tail[0] = anchor
    for (let i = 1; i < TAIL_LINKS; i++) {
      const previous = this.tail[i - 1]
      let dir = sub(this.tail[i], previous)
      dir = length(dir) > 1e-4 ? normalize(dir) : flow

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
    const frame = kiteFrame(kite, view)
    const size = dimensions()
    const at = (alongSpine: number, acrossSpan: number) =>
      camera.project(sailPoint(centre, frame, size, alongSpine, acrossSpan))

    // Looking at the back of the kite gives a duller, shadowed face.
    const facingAway = dot(view, frame.lit) > 0
    const body = facingAway ? C.kiteShade : C.kite
    const upper = facingAway ? C.kiteTrimShade : C.kiteTrim

    const pNose = at(NOSE, 0)
    const pTail = at(TAIL, 0)
    const pLeft = at(SPAR, -1)
    const pRight = at(SPAR, 1)
    const spanPx = Math.hypot(pRight.x - pLeft.x, pRight.y - pLeft.y)

    if (config.kiteType === 'delta') {
      // A delta is a swept triangle: the nose leads, the wingtips trail well behind
      // it, and the trailing edge is cut away between them.
      const tipL = at(TAIL, -1)
      const tipR = at(TAIL, 1)
      const notch = at(TAIL + 0.28, 0)
      const tipSpan = Math.hypot(tipR.x - tipL.x, tipR.y - tipL.y)

      this.drawTail(ctx, camera, notch, tipSpan)
      // Each half filled on its own, so the fold along the spine reads as two tones
      // and the dihedral is visible rather than implied.
      fillPolygon(ctx, [pNose, tipL, notch], body)
      fillPolygon(ctx, [pNose, tipR, notch], upper)
      this.drawKeel(ctx, camera, frame, centre, size, facingAway, tipSpan)

      if (tipSpan > 7) pixelLine(ctx, pNose.x, pNose.y, notch.x, notch.y, C.ink)
      if (tipSpan > 12) pixelPath(ctx, [pNose, tipL, notch, tipR, pNose], C.ink)
      return
    }

    this.drawTail(ctx, camera, pTail, spanPx)

    // The two halves again, each filled separately across the fold.
    fillPolygon(ctx, [pNose, pLeft, pTail], body)
    fillPolygon(ctx, [pNose, pRight, pTail], upper)

    if (spanPx > 7) {
      pixelLine(ctx, pNose.x, pNose.y, pTail.x, pTail.y, C.ink)
      pixelLine(ctx, pLeft.x, pLeft.y, pRight.x, pRight.y, C.ink)
    }
    if (spanPx > 12) {
      pixelPath(ctx, [pNose, pLeft, pTail, pRight, pNose], C.ink)
    }
  }

  /**
   * The keel: the fin a delta hangs under its sail. Drawn on the windward side, which
   * is the face away from the normal, so it reads as standing out toward the flyer.
   */
  private drawKeel(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    frame: Frame,
    centre: Vec3,
    size: { spine: number; span: number },
    facingAway: boolean,
    spanPx: number,
  ): void {
    const k = config.kite
    if (k.keelArea <= 0 || spanPx < 9) return
    const drop = k.keelDrop * size.spine
    const front = add(centre, scale(frame.nose, k.keelAlong * size.spine + size.spine * 0.3))
    const back = add(centre, scale(frame.nose, k.keelAlong * size.spine - size.spine * 0.25))
    const tip = add(
      add(centre, scale(frame.nose, k.keelAlong * size.spine)),
      scale(frame.normal, -drop),
    )
    const poly = [camera.project(front), camera.project(tip), camera.project(back)]
    fillPolygon(ctx, poly, facingAway ? C.kiteTrimShade : C.kiteTrim)
    if (spanPx > 14) pixelPath(ctx, [...poly, poly[0]], C.ink)
  }

  /**
   * The three bridle legs, drawn last so they sit over both the kite face and the
   * flying line — they genuinely stand in front of both.
   *
   * They are drawn with sag, because they are line and not wire. How much they belly is
   * driven by the tension the simulation is actually carrying, so when the air drops
   * and the kite goes weightless the bridle visibly goes soft, and it pulls straight
   * again the moment the line loads up.
   */
  drawBridle(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    kite: Kite,
    centre: Vec3,
  ): void {
    const view = viewTo(centre)
    const frame = kiteFrame(kite, view)
    const size = dimensions()

    const anchors: Vec3[] = [
      sailPoint(centre, frame, size, SPAR, -BRIDLE_SPAN_FRACTION * 2),
      sailPoint(centre, frame, size, SPAR, BRIDLE_SPAN_FRACTION * 2),
      sailPoint(centre, frame, size, LOWER_BRIDLE, 0),
    ]

    const pLeft = camera.project(anchors[0])
    const pRight = camera.project(anchors[1])
    const spanPx = Math.hypot(pRight.x - pLeft.x, pRight.y - pLeft.y)
    if (spanPx < 9) return

    const tow = this.bridlePoint(kite, centre)
    const slackness =
      1 - Math.min(kite.diag.line.tension / config.line.tautTension, 1)
    const sag = slackness * slackness * size.spine * config.line.bridleSag

    for (const anchor of anchors) {
      if (sag < 0.01) {
        const a = camera.project(tow)
        const b = camera.project(anchor)
        pixelLine(ctx, a.x, a.y, b.x, b.y, C.ink)
        continue
      }
      // Quadratic through a midpoint dropped by the sag, built in world space so
      // perspective applies along the leg.
      const midpoint = scale(add(tow, anchor), 0.5)
      const control = sub(scale(sub(midpoint, v3(0, sag, 0)), 2), midpoint)
      const points: Point[] = []
      for (let i = 0; i <= BRIDLE_SEGMENTS; i++) {
        const t = i / BRIDLE_SEGMENTS
        const u = 1 - t
        points.push(
          camera.project(
            add(
              add(scale(tow, u * u), scale(control, 2 * u * t)),
              scale(anchor, t * t),
            ),
          ),
        )
      }
      pixelPath(ctx, points, C.ink)
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

    const thickness = spanPx > 26 ? 2 : 1

    for (let i = 1; i < points.length; i++) {
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
