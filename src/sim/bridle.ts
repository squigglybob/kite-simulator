import { config } from './config'
import { LOWER_BRIDLE, SPAR } from './shape'

/**
 * Bridle geometry.
 *
 * The bridle is described by the *lengths of its legs*, not by an angle, because that
 * is what it physically is and what you would actually adjust on a real kite. The angle
 * the line makes with the kite then falls out of the triangle, which keeps the drawn
 * bridle and the simulated one the same object rather than two numbers that have to be
 * kept in step by hand.
 *
 * All lengths and positions are in spine-lengths, so they hold at any kite size.
 */


export interface BridleGeometry {
  /** Tow point along the spine, from the centre, positive toward the nose. */
  along: number
  /** Tow point standoff off the windward face. */
  standoff: number
  /** Angle between the flying line and the kite's chord, radians. */
  angle: number
}

/**
 * Solve the tow point: the intersection of two circles, one about each attachment.
 *
 * Only `along` sets the angle of attack — moving the tow point toward the nose raises
 * it, toward the tail lowers it, which is the fore-aft adjustment every kite flyer
 * makes. The standoff does not affect it, only how far the bridle stands proud.
 */
export function bridleGeometry(): BridleGeometry {
  const upper = config.kite.bridleUpper
  const lower = config.kite.bridleLower
  const along =
    (upper * upper - lower * lower - SPAR * SPAR + LOWER_BRIDLE * LOWER_BRIDLE) /
    (2 * (LOWER_BRIDLE - SPAR))

  // A leg pair too short to reach, or too lopsided, leaves the triangle open. Hold the
  // tow point just off the face rather than producing an imaginary standoff.
  const reach = upper * upper - (along - SPAR) * (along - SPAR)
  const standoff = reach > 1e-6 ? Math.sqrt(reach) : 0.02

  const radius = Math.hypot(along, standoff)
  const angle =
    radius > 1e-6
      ? Math.acos(Math.max(-1, Math.min(1, -along / radius)))
      : Math.PI / 2

  return { along, standoff, angle }
}
