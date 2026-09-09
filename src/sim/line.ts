import { config } from './config'
import { dot, length, normalize, sub, type Vec3 } from '../core/vec3'

/**
 * The line, as a spring-damper along its own axis rather than a hard constraint.
 *
 * A hard constraint pins the kite to a sphere, which is both less correct and less
 * interesting — it cannot go slack. The spring lets the line genuinely lose tension,
 * and its compliance is what produces the short delay between a tug and the kite
 * reacting, which is most of what "feels like a kite".
 */

export interface LineState {
  /** Unit vector from hand to kite. */
  dir: Vec3
  distance: number
  /** How far the line is stretched past its set length, metres. Negative means slack. */
  extension: number
  tension: number
}

export function solveLine(kitePos: Vec3, handPos: Vec3, kiteVel: Vec3): LineState {
  const offset = sub(kitePos, handPos)
  const distance = length(offset)
  const dir = normalize(offset)
  const extension = distance - config.line.length

  let tension = 0
  if (extension > 0) {
    // Damping acts only on the radial component; lateral motion is the kite's business.
    const radialSpeed = dot(kiteVel, dir)
    tension = Math.max(
      0,
      config.line.spring * extension + config.line.damping * radialSpeed,
    )
    // Capped, because line length can change instantaneously — a slider drag, or a
    // future scripted event — and an unbounded spring force integrates to infinity.
    tension = Math.min(tension, config.line.maxTension)
  }

  return { dir, distance, extension, tension }
}

/**
 * Sag depth in metres for rendering. Purely visual, but it is the clearest readout of
 * tension the player has: a slack line bellies, a taut one snaps straight.
 */
export function sagDepth(line: LineState): number {
  const slackness = 1 - Math.min(line.tension / config.line.tautTension, 1)
  return slackness * slackness * line.distance * config.line.sagFactor
}
