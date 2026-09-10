import { config } from './config'
import { Flyer } from './flyer'
import { Kite } from './kite'
import { windAt } from './wind'
import { v3 } from '../core/vec3'
import type { InputState } from '../input/keys'

/** Owns all simulation state and advances it one fixed step at a time. */

export interface Stats {
  maxAltitude: number
  timeAloft: number
  crashes: number
}

export class World {
  readonly kite = new Kite()
  readonly flyer = new Flyer()
  time = 0
  stats: Stats = { maxAltitude: 0, timeAloft: 0, crashes: 0 }
  /** Live wind speed at head height, for the windsock and the scenery. */
  windAtGround = 0

  private wasCrashed = false

  constructor() {
    this.reset()
  }

  reset(): void {
    this.time = 0
    this.stats = { maxAltitude: 0, timeAloft: 0, crashes: 0 }
    this.wasCrashed = false
    this.flyer.leftDraw = 0
    this.flyer.rightDraw = 0
    this.kite.reset(this.flyer.handPos)
  }

  /**
   * Low enough to be considered down. Deliberately a height test rather than the
   * crash flag, which latches and would still read false for the frame or two after
   * the kite is set down but before gravity has settled it.
   */
  get isGrounded(): boolean {
    return this.kite.pos.y <= 1.2
  }

  /**
   * Sets the kite down at the end of the line ready to fly, without touching the
   * clock, the best height or the crash count — this is picking the kite up and
   * walking it out, not starting again.
   */
  setUpForLaunch(): void {
    this.kite.placeForLaunch(this.flyer.handPos)
    // It is sitting on the sand by design, so the next ground contact is not a crash.
    this.wasCrashed = true
  }

  step(dt: number, input: InputState): void {
    this.time += dt

    if (input.reelIn) {
      config.line.length = Math.max(
        config.line.minLength,
        config.line.length - config.line.reelRate * dt,
      )
    }
    if (input.reelOut) {
      config.line.length = Math.min(
        config.line.maxLength,
        config.line.length + config.line.reelRate * dt,
      )
    }

    this.flyer.step(dt, input, this.kite.diag.line.dir)
    this.kite.step(dt, this.flyer.handPos, this.time)

    const ground = windAt(v3(0, 2, 6), this.time)
    this.windAtGround = Math.hypot(ground.x, ground.y, ground.z)

    const altitude = this.kite.pos.y
    if (altitude > this.stats.maxAltitude) this.stats.maxAltitude = altitude
    if (!this.kite.crashed) this.stats.timeAloft += dt
    if (this.kite.crashed && !this.wasCrashed) this.stats.crashes++
    this.wasCrashed = this.kite.crashed
  }
}
