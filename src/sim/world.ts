import { config } from './config'
import { Flyer } from './flyer'
import { Kite } from './kite'
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

    const altitude = this.kite.pos.y
    if (altitude > this.stats.maxAltitude) this.stats.maxAltitude = altitude
    if (!this.kite.crashed) this.stats.timeAloft += dt
    if (this.kite.crashed && !this.wasCrashed) this.stats.crashes++
    this.wasCrashed = this.kite.crashed
  }
}
