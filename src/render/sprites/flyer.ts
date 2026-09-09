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
  /**
   * Where the grip is on screen: the *projected simulated hand position*, not a pose
   * the rig invents. The simulation already moves this point — down the body at rest,
   * back along the line under a tug — and the string is drawn from the same point, so
   * the two can never disagree.
   */
  hand: Point
  /** Screen-space direction from the hands to the kite, radians. */
  stringAngle: number
  /** Line tension as a fraction of a hard brace, 0 to 1. Extends the arms. */
  tension: number
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
const FOOT_SPREAD = 0.055

/** Separation of the two hands either side of the grip. */
const HAND_HALF_WIDTH = 0.095
/** Resting elbow: hanging just below the waist, a little clear of the ribs. */
const ELBOW_HEIGHT = 0.605
const ELBOW_FLARE = 1.55
/** How far a fully loaded line straightens the arms up toward it. */
const ELBOW_RAISE = 0.55

function rotateAround(point: Point, pivot: Point, angle: number): Point {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const dx = point.x - pivot.x
  const dy = point.y - pivot.y
  return { x: pivot.x + dx * c - dy * s, y: pivot.y + dx * s + dy * c }
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
  // Posed directly rather than solved. Seen from behind, the forearms point away from
  // the camera, so they are heavily foreshortened — the hand sits just below and inside
  // the elbow. A two-bone IK solve in the screen plane cannot know that and throws the
  // elbows straight out sideways instead, which reads as chicken wings.
  //
  // At rest the upper arms hang, elbows just below the waist. As the line loads up the
  // arms swing toward it and straighten.
  const upper = h * UPPER_ARM
  const aim = { x: Math.cos(pose.stringAngle), y: Math.sin(pose.stringAngle) }
  const raise = pose.tension * ELBOW_RAISE

  const hands: Point[] = []
  for (const side of [-1, 1]) {
    const shoulder: Point = {
      x: shoulderMid.x + side * shoulderHalf,
      y: shoulderMid.y,
    }

    const hanging: Point = {
      x: pose.feetX + side * shoulderHalf * ELBOW_FLARE,
      y: pose.feetY - h * ELBOW_HEIGHT,
    }
    // Loading the line lifts the arms mostly upward — the sideways component is
    // damped, or both elbows swing out together and it reads as pointing, not bracing.
    const reaching: Point = {
      x: shoulder.x + aim.x * upper * 0.35,
      y: shoulder.y + aim.y * upper,
    }
    const elbow: Point = {
      x: hanging.x + (reaching.x - hanging.x) * raise,
      y: hanging.y + (reaching.y - hanging.y) * raise,
    }

    // Both hands are on the one line, so they straddle the simulated grip.
    const hand: Point = {
      x: pose.hand.x + side * h * HAND_HALF_WIDTH,
      y: pose.hand.y,
    }

    pixelLine(ctx, shoulder.x, shoulder.y, elbow.x, elbow.y, C.ink, limb)
    pixelLine(ctx, elbow.x, elbow.y, hand.x, hand.y, C.ink, limb)
    hands.push(hand)
  }

  const handMid: Point = {
    x: (hands[0].x + hands[1].x) / 2,
    y: (hands[0].y + hands[1].y) / 2,
  }

  // --- Head ---------------------------------------------------------------------
  fillEllipse(ctx, headCentre.x, headCentre.y, h * HEAD_RADIUS, h * HEAD_RADIUS, C.ink)

  return handMid
}
