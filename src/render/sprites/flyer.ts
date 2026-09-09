import { C } from '../palette'
import { fillEllipse, fillPolygon, pixelLine, type Point } from '../raster'

/**
 * The flyer, as a procedural rig rather than an animation.
 *
 * Limbs are placed by code each frame: the arms are aimed along the *actual* screen
 * direction of the string and the body leans by the *actual* line tension, so the pose
 * is always correct instead of approximated by the nearest drawn frame. This is what
 * removes the need for a spritesheet, and with it the hardest part of the art.
 *
 * The planned angle-quantised limb cache turned out to be unnecessary. It existed to
 * stop rotated bitmaps shimmering, but these limbs are Bresenham lines between rounded
 * endpoints — already snapped to the pixel grid, with nothing to resample.
 */

export interface FlyerPose {
  feetX: number
  feetY: number
  heightPx: number
  /** Screen-space direction from the hands to the kite, radians. */
  stringAngle: number
  /** Combined hand draw, 0 to 1. Pulls the hands in toward the chest. */
  pull: number
  /** Backward body lean, radians. Driven by line tension. */
  lean: number
}

/** Fractions of total height. Roughly a seven-and-a-half head figure. */
const HIP = 0.47
const SHOULDER = 0.8
const HEAD_CENTRE = 0.885
const HEAD_RADIUS = 0.075
const SHOULDER_HALF_WIDTH = 0.062
const HIP_HALF_WIDTH = 0.048
const UPPER_ARM = 0.19
const FOREARM = 0.17
const FOOT_SPREAD = 0.055

function rotateAround(point: Point, pivot: Point, angle: number): Point {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const dx = point.x - pivot.x
  const dy = point.y - pivot.y
  return { x: pivot.x + dx * c - dy * s, y: pivot.y + dx * s + dy * c }
}

/**
 * Two-bone IK. Places the elbow so the arm reaches the hand, bending `side` outward.
 * Falls back to a straight arm when the target is out of reach.
 */
function elbowFor(
  shoulder: Point,
  hand: Point,
  upper: number,
  fore: number,
  side: number,
): Point {
  const dx = hand.x - shoulder.x
  const dy = hand.y - shoulder.y
  const distance = Math.hypot(dx, dy)
  if (distance < 1e-4) return shoulder

  const base = Math.atan2(dy, dx)
  if (distance >= upper + fore) {
    return { x: shoulder.x + Math.cos(base) * upper, y: shoulder.y + Math.sin(base) * upper }
  }

  const cosine = (upper * upper + distance * distance - fore * fore) / (2 * upper * distance)
  const bend = Math.acos(Math.max(-1, Math.min(1, cosine)))
  const angle = base + bend * side
  return { x: shoulder.x + Math.cos(angle) * upper, y: shoulder.y + Math.sin(angle) * upper }
}

/** Draws the flyer and returns where the string should leave their hands. */
export function drawFlyer(ctx: CanvasRenderingContext2D, pose: FlyerPose): Point {
  const h = pose.heightPx
  const limb = Math.max(1, Math.round(h * 0.035))

  const hip: Point = { x: pose.feetX, y: pose.feetY - h * HIP }

  // Everything above the hip leans back against the pull of the line.
  const lean = (p: Point) => rotateAround(p, hip, pose.lean)

  const shoulderMid = lean({ x: pose.feetX, y: pose.feetY - h * SHOULDER })
  const headCentre = lean({ x: pose.feetX, y: pose.feetY - h * HEAD_CENTRE })
  const shoulderHalf = h * SHOULDER_HALF_WIDTH
  const hipHalf = h * HIP_HALF_WIDTH

  // --- Legs -----------------------------------------------------------------
  for (const side of [-1, 1]) {
    const foot: Point = { x: pose.feetX + side * h * FOOT_SPREAD, y: pose.feetY }
    const knee: Point = {
      x: hip.x + side * h * 0.03,
      y: (hip.y + foot.y) / 2,
    }
    pixelLine(ctx, hip.x, hip.y, knee.x, knee.y, C.ink, limb)
    pixelLine(ctx, knee.x, knee.y, foot.x, foot.y, C.ink, limb)
  }

  // --- Torso ------------------------------------------------------------------
  fillPolygon(
    ctx,
    [
      { x: hip.x - hipHalf, y: hip.y },
      { x: hip.x + hipHalf, y: hip.y },
      { x: shoulderMid.x + shoulderHalf, y: shoulderMid.y },
      { x: shoulderMid.x - shoulderHalf, y: shoulderMid.y },
    ],
    C.ink,
  )

  // --- Arms -------------------------------------------------------------------
  // Reach shortens as the hands draw back, which is what a tug looks like from behind.
  const upper = h * UPPER_ARM
  const fore = h * FOREARM
  const reach = (upper + fore) * (1 - 0.38 * pose.pull)
  const aim = { x: Math.cos(pose.stringAngle), y: Math.sin(pose.stringAngle) }

  let handMid: Point = shoulderMid
  for (const side of [-1, 1]) {
    const shoulder: Point = {
      x: shoulderMid.x + side * shoulderHalf,
      y: shoulderMid.y,
    }
    const hand: Point = {
      x: shoulder.x + aim.x * reach,
      y: shoulder.y + aim.y * reach,
    }
    const elbow = elbowFor(shoulder, hand, upper, fore, side)

    pixelLine(ctx, shoulder.x, shoulder.y, elbow.x, elbow.y, C.ink, limb)
    pixelLine(ctx, elbow.x, elbow.y, hand.x, hand.y, C.ink, limb)

    if (side === 1) handMid = { x: (handMid.x + hand.x) / 2, y: (handMid.y + hand.y) / 2 }
    else handMid = hand
  }

  // --- Head ---------------------------------------------------------------------
  fillEllipse(ctx, headCentre.x, headCentre.y, h * HEAD_RADIUS, h * HEAD_RADIUS, C.ink)

  return handMid
}
