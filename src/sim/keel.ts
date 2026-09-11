import { config } from './config'

/**
 * The keel: the fin a delta hangs under its sail, and the thing its flying line
 * actually ties onto.
 *
 * A delta has no three-leg bridle. There is no left and right — the line attaches at
 * a single point on the keel, and moving that point fore and aft is the only trim
 * adjustment the kite has. So the keel is described by its outline and everything
 * else is read off it: its area, where its drag acts, and where the line begins. The
 * drawn keel and the simulated one are then the same object, which is the same reason
 * the diamond's bridle is described by leg lengths rather than by an angle.
 *
 * The outline is half a kite shape. Three corners, two of them on the spine and one
 * hanging below it, with the apex set well forward so the leading edge is short and
 * the trailing edge long — which is what a real delta keel looks like.
 *
 * Everything is in spine-lengths, measured from the centre of area, positive toward
 * the nose, so the geometry holds at any kite size.
 */

export interface KeelGeometry {
  /** The three corners, as [alongSpine, drop below the sail]. */
  fore: [number, number]
  apex: [number, number]
  aft: [number, number]
  /** Where the flying line ties on. */
  towAlong: number
  towDrop: number
  /** Where its drag acts: the centroid of the triangle. */
  centreAlong: number
  centreDrop: number
  /** Plan area in spine-lengths squared. Multiply by spine² for square metres. */
  area: number
}

export function keelGeometry(): KeelGeometry {
  const k = config.kite
  const fore: [number, number] = [k.keelFore, 0]
  const aft: [number, number] = [k.keelAft, 0]
  const apex: [number, number] = [k.keelApex, k.keelDrop]

  // The tow point slides along the long trailing edge, from the apex back toward the
  // spine. Forward is more angle of attack, aft is less — the same adjustment, and
  // the same direction, as walking a diamond's tow point up its bridle.
  const t = Math.max(0, Math.min(1, k.keelTow))
  const towAlong = apex[0] + (aft[0] - apex[0]) * t
  const towDrop = apex[1] + (aft[1] - apex[1]) * t

  return {
    fore,
    apex,
    aft,
    towAlong,
    towDrop,
    centreAlong: (fore[0] + apex[0] + aft[0]) / 3,
    centreDrop: (fore[1] + apex[1] + aft[1]) / 3,
    // Half base times height, the base lying along the spine.
    area: 0.5 * Math.abs(fore[0] - aft[0]) * k.keelDrop,
  }
}

/** A kite with no keel at all — the diamond, which uses a tail and a bridle instead. */
export function hasKeel(): boolean {
  return config.kite.keelDrop > 1e-4 && Math.abs(config.kite.keelFore - config.kite.keelAft) > 1e-4
}
