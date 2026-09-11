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

export function solveLine(
  kitePos: Vec3,
  handPos: Vec3,
  kiteVel: Vec3,
  /** Set length of this line. Given per line, because a two-line kite steers by
   *  having one of them shorter than the other. */
  lineLength = config.line.length,
): LineState {
  const offset = sub(kitePos, handPos)
  const distance = length(offset)
  const dir = normalize(offset)
  const extension = distance - lineLength

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
 * Sag depth in metres for rendering.
 *
 * Driven by how much *spare line* there is, not by how much tension there is. Those
 * sound equivalent and are not: tension is zero the instant the line stops being taut,
 * so a tension-based sag looks the same whether you have a centimetre of slack or
 * twenty metres of it — and it snaps straight the moment any load appears. What you
 * would actually see is a great loop of line on the ground that has to be reeled in
 * before pulling on it does anything at all.
 *
 * A cable of length L spanning a distance d hangs with sag s, and for a shallow
 * parabolic curve the extra length it needs is 8s²/3d. Turned round, that gives the
 * sag from the excess — which is exactly what the simulation already knows.
 */
export function sagDepth(line: LineState): number {
  // `extension` is how far the line is stretched past its length, so its negative is
  // how much line is spare.
  const spare = -line.extension
  if (spare <= 0) return 0
  return Math.sqrt((3 * line.distance * spare) / 8) * config.line.sagFactor
}
