import { config } from './config'

/**
 * Flat-plate aerodynamics with a stall.
 *
 * The stall is the important part. Everything the game is about — the dead air at the
 * edge of the wind window, the collapse, the dive, the recovery — falls out of CL
 * dropping off a cliff past the stall angle, rather than being scripted anywhere.
 */

const DEG = Math.PI / 180

/**
 * Lift coefficient. Thin-aerofoil slope up to the stall angle, then blended down to
 * the post-stall flat-plate value over a few degrees.
 */
export function liftCoefficient(alpha: number): number {
  const a = Math.abs(alpha)
  const sign = Math.sign(alpha)
  const stall = config.kite.stallDeg * DEG
  const attached = 2 * Math.PI * a

  if (a <= stall) return sign * attached

  const peak = 2 * Math.PI * stall
  const separated = Math.sin(2 * a)
  const blend = Math.min((a - stall) / (config.kite.stallBlendDeg * DEG), 1)
  return sign * (peak * (1 - blend) + separated * blend)
}

/** Drag coefficient: parasitic drag plus the flat-plate pressure term. */
export function dragCoefficient(alpha: number): number {
  const s = Math.sin(alpha)
  return config.kite.cd0 + 2 * s * s
}

/** Dynamic pressure times area — the common factor of both aerodynamic forces. */
export function dynamicPressure(speed: number): number {
  return 0.5 * config.env.airDensity * speed * speed * config.kite.area
}

/**
 * Sideslip: how much of the air is running across the span rather than down the spine.
 *
 * A kite is a wing, not a symmetric plate, and this is the difference. It makes lift
 * when the flow runs nose to tail; slide it broadside and the sail luffs between the
 * spars, the frame stops being held in shape by the air, and most of the lift goes
 * away while the drag climbs.
 *
 * Without it the aerodynamics are blind to which way the kite points inside its own
 * plane. Rotating a trimmed kite ninety degrees about its own face moved the lift by
 * half a newton in forty-eight, so nothing whatsoever connected where the kite was
 * pointing to where it went, and it crabbed. With it, the only heading at which the
 * kite develops its full force is the one it is facing, which is what makes flying
 * where you point an attractor rather than a coincidence.
 *
 * `alignment` is the cosine of the sideslip angle, and it is folded so that a kite
 * flying *backwards* still counts as aligned — a stunt kite in reverse has air running
 * down its spine and really does still fly.
 */
export function sideslipLiftFactor(alignment: number): number {
  return 1 - config.kite.sideslipLift * (1 - alignment * alignment)
}

/** The matching drag penalty: a kite dragged sideways is a much worse shape. */
export function sideslipDragCoefficient(alignment: number): number {
  return config.kite.sideslipDrag * (1 - alignment * alignment)
}
