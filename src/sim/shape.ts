/**
 * The kite's spine landmarks, in spine-lengths from its centre of area, positive
 * toward the nose.
 *
 * A diamond kite is a *kite* quadrilateral, not a rhombus: the cross spar sits about a
 * quarter of the way down from the nose, so the two upper edges are short and the two
 * lower ones long. Putting the spar at the midpoint gives equal edges all round, which
 * reads as a playing-card diamond rather than a kite.
 *
 * The values are measured from the centre of area rather than the spar so the drawn
 * shape sits balanced around the point the physics actually simulates. For a kite of
 * upper height `a` and lower height `b`, that centroid is `(a - b) / 3` from the spar.
 */

/** Upper section: a quarter of the spine. */
const UPPER = 0.25
/** Lower section: the remaining three quarters. */
const LOWER = 0.75

/** Centroid offset from the spar, toward the nose. Negative: it sits below the spar. */
const CENTROID = (UPPER - LOWER) / 3

export const SPAR = -CENTROID
export const NOSE = SPAR + UPPER
export const TAIL = SPAR - LOWER

/** Lower bridle attachment: a quarter of the spine up from the tail tip. */
export const LOWER_BRIDLE = TAIL + 0.25
