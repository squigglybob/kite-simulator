import { config } from './config'
import { add, cross, normalize, scale, v3, length, type Vec3 } from '../core/vec3'

/**
 * The flyer's hands.
 *
 * Each hand has a draw value that ramps toward 1 while its key is held and decays back
 * to 0 on release, which is what recovers analogue feel from digital keys: a stab is a
 * sharp tug, a hold is a sustained pull, both together is a two-handed power pull.
 *
 * On a single-line kite both hands are on the same line, so the pair combine into one
 * pull along the line plus a small lateral offset. When dual-line arrives these same
 * two values become per-line lengths feeding a yaw torque, and nothing here changes.
 */

const WORLD_UP: Vec3 = { x: 0, y: 1, z: 0 }

export interface HandInput {
  left: boolean
  right: boolean
}

export class Flyer {
  leftDraw = 0
  rightDraw = 0

  /** Where the hands actually are, after the pull is applied. */
  handPos: Vec3 = v3(0, config.hand.height, 0)

  /** Combined pull, 0 to 1. Drives arm pose and the tension the player feels. */
  get pull(): number {
    return (this.leftDraw + this.rightDraw) / 2
  }

  /** Differential, -1 to 1. Becomes the steering input for a two-line kite. */
  get differential(): number {
    return this.rightDraw - this.leftDraw
  }

  step(dt: number, input: HandInput, lineDir: Vec3): void {
    const h = config.hand
    const rise = dt / h.drawTime
    const fall = dt / h.releaseTime

    this.leftDraw = clamp01(this.leftDraw + (input.left ? rise : -fall))
    this.rightDraw = clamp01(this.rightDraw + (input.right ? rise : -fall))

    // Pulling draws the hands back along the line, away from the kite. That stretches
    // the line spring, which is exactly what a real tug does.
    const rest = v3(0, h.height, 0)
    const back = scale(lineDir, -this.pull * h.drawDepth)

    let lateral = cross(WORLD_UP, lineDir)
    lateral = length(lateral) > 1e-4 ? normalize(lateral) : v3(1, 0, 0)
    const sideways = scale(lateral, this.differential * h.lateralOffset)

    this.handPos = add(add(rest, back), sideways)
  }
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n)
