import { config } from './config'
import { hasKeel, keelGeometry } from './keel'
import { LOWER_BRIDLE, NOSE, SPAR, TAIL } from './shape'

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
  // A kite with a keel has no bridle to solve: the line ties straight onto the keel,
  // and that point is the tow point.
  if (hasKeel()) {
    const keel = keelGeometry()
    const radius = Math.hypot(keel.towAlong, keel.towDrop)
    return {
      along: keel.towAlong,
      standoff: keel.towDrop,
      angle:
        radius > 1e-6
          ? Math.acos(Math.max(-1, Math.min(1, -keel.towAlong / radius)))
          : Math.PI / 2,
    }
  }

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

/**
 * The dual-line bridle.
 *
 * Three anchors a side, which is what a stunt kite actually carries: one on the spine
 * shared by both sides, one out on each leading edge level with it, and one further
 * forward up each leading edge. The two forward legs and the shared spine leg meet at
 * a tow point out to that side, and the flying line ties on there. Two tow points, two
 * lines, and the gap between them is the whole of the steering.
 *
 * The wing anchors are placed *on the leading edge spar* rather than given their own
 * spanwise numbers, because that is where a bridle is physically tied. Their spanwise
 * position therefore falls out of how far down the spine they sit, and moving one
 * slides it along the spar exactly as it would on a real kite.
 *
 * The tow point is given directly rather than solved from three leg lengths. Three
 * spheres meet in a point only when their radii agree, and a slider that can be
 * dragged into a bridle with no solution is a bad slider; giving the position and
 * reading the leg lengths off it cannot fail, and on a stunt kite the setting you
 * actually adjust is where that point sits.
 */

/** A point on the sail, in spine-lengths along and in fractions of the half span. */
export interface BridleAnchor {
  along: number
  across: number
}

export interface DualBridle {
  /** The shared spine anchor, and the two on this side's leading edge. */
  anchors: BridleAnchor[]
  /** Where this side's flying line ties on. */
  along: number
  across: number
  standoff: number
}

/** Where the leading edge sits, spanwise, at a given station down the spine. */
function leadingEdgeAt(along: number): number {
  const t = (NOSE - along) / (NOSE - TAIL)
  return Math.max(0, Math.min(1, t))
}

/**
 * One side's bridle. `side` is -1 for the left tow point and +1 for the right; the
 * spine anchor is shared, so it comes back with both.
 */
export function dualBridle(side: number): DualBridle {
  const k = config.kite
  const s = Math.sign(side) || 1
  return {
    anchors: [
      { along: k.bridleAftAlong, across: 0 },
      { along: k.bridleAftAlong, across: s * leadingEdgeAt(k.bridleAftAlong) },
      { along: k.bridleForeAlong, across: s * leadingEdgeAt(k.bridleForeAlong) },
    ],
    along: k.towAlong,
    across: s * k.towSpread,
    standoff: k.towStandoff,
  }
}

export function isDualLine(): boolean {
  return config.kite.dualLine
}
