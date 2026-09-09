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
