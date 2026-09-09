import { config } from './config'
import { bridleGeometry } from './bridle'
import { dragCoefficient, dynamicPressure, liftCoefficient } from './aero'
import { solveLine, type LineState } from './line'
import { lateralGustGradient, windAt } from './wind'
import {
  add,
  addScaledInPlace,
  copy,
  dot,
  length,
  normalize,
  rotateAbout,
  scale,
  sub,
  v3,
  type Vec3,
} from '../core/vec3'

/**
 * The kite: a point mass with one rotational degree of freedom.
 *
 * Attitude is built from the *apparent wind*, not the line: a kite weathercocks into
 * the airflow rather than hanging rigidly off its string. Angle of attack is therefore
 * a state variable, pitching on a damped spring toward the trim angle the bridle sets.
 * The line's job is to hold the kite in place against the resulting force, which is
 * what makes it settle where tan(elevation) = lift/drag.
 *
 * Two DOFs beyond position: pitch (angle of attack) and roll about the wind axis. Both
 * restoring terms scale with dynamic pressure, because a plate with no airflow over it
 * has no aerodynamic authority. That is the whole mechanism behind a stall turning into
 * a dive — lift collapses, the tail stops working, roll runs away, and the kite falls
 * off on one side. None of that is scripted.
 */

const DEG = Math.PI / 180
const HALF_PI = Math.PI / 2
const WORLD_UP: Vec3 = { x: 0, y: 1, z: 0 }
const GROUND_Y = 0.15
/** Backstop on kite speed. Nothing physical should approach this. */
const MAX_SPEED = 90

export interface KiteDiagnostics {
  apparent: Vec3
  windDir: Vec3
  airspeed: number
  /** Angle of attack, radians. */
  alpha: number
  lift: Vec3
  drag: Vec3
  tensionForce: Vec3
  normal: Vec3
  line: LineState
  elevation: number
  azimuth: number
  stalled: boolean
}

export class Kite {
  pos: Vec3 = v3()
  /** Position at the start of the current step, for render interpolation. */
  prevPos: Vec3 = v3()
  vel: Vec3 = v3()
  /** Angle of attack, radians. A state variable, not a derived quantity. */
  alpha = 0
  alphaRate = 0
  roll = 0
  rollRate = 0
  crashed = false

  diag: KiteDiagnostics = {
    apparent: v3(),
    windDir: v3(0, 0, 1),
    airspeed: 0,
    alpha: 0,
    lift: v3(),
    drag: v3(),
    tensionForce: v3(),
    normal: v3(),
    line: { dir: v3(0, 1, 0), distance: 0, extension: 0, tension: 0 },
    elevation: 0,
    azimuth: 0,
    stalled: false,
  }

  /** Place the kite downwind at a low elevation, as if just launched. */
  reset(handPos: Vec3, elevationDeg = 28): void {
    const e = elevationDeg * DEG
    const r = config.line.length * 0.98
    this.pos = add(handPos, v3(0, Math.sin(e) * r, Math.cos(e) * r))
    this.prevPos = copy(this.pos)
    this.vel = v3()
    this.alpha = bridleGeometry().angle * 0.4
    this.alphaRate = 0
    this.roll = 0
    this.rollRate = 0
    this.crashed = false
  }

  step(dt: number, handPos: Vec3, time: number): void {
    const k = config.kite
    this.prevPos = copy(this.pos)

    const wind = windAt(this.pos, time)
    const apparent = sub(wind, this.vel)
    const airspeed = length(apparent)
    const line = solveLine(this.pos, handPos, this.vel)

    // --- Pitch ----------------------------------------------------------------
    // The bridle holds a fixed angle between the line and the kite's chord, so the
    // incidence the kite presents is *geometric*: it is that bridle angle less the
    // angle between the line and the airflow. A kite low in the window therefore runs
    // at a high angle of attack — near stall, poor lift, high drag — and one near the
    // zenith runs nearly flat. That is what a real kite does, and it is what makes the
    // elevation self-correcting: climbing reduces incidence, which reduces lift.
    //
    // Angle of attack stays a state on a damped spring toward that geometric target
    // rather than snapping to it, which preserves the lag that lets a gust push the
    // kite transiently past the stall.
    const q = dynamicPressure(airspeed)

    let target = bridleGeometry().angle
    if (airspeed > 0.05) {
      const toWind = Math.acos(
        Math.max(-1, Math.min(1, dot(line.dir, scale(apparent, 1 / airspeed)))),
      )
      target -= toWind
    }
    // Kept off the extremes: a negative target flies the kite inverted into the ground,
    // and beyond edge-on the flat-plate curves stop meaning anything.
    target = Math.max(-2 * DEG, Math.min(target, 70 * DEG))

    // Damping is expressed as a fraction of critical rather than an absolute
    // coefficient, because critical damping scales with dynamic pressure: a fixed
    // coefficient that feels right in a stiff breeze is badly underdamped elsewhere,
    // and the kite oscillates in pitch at several hertz.
    const pitchRate = k.pitchStiffness * q
    const pitchCritical = 2 * Math.sqrt(Math.max(pitchRate * k.pitchInertia, 1e-9))
    const pitchMoment =
      pitchRate * (target - this.alpha) - k.pitchDampRatio * pitchCritical * this.alphaRate
    this.alphaRate += (pitchMoment / k.pitchInertia) * dt
    this.alpha += this.alphaRate * dt
    this.alpha = Math.max(-HALF_PI, Math.min(HALF_PI, this.alpha))

    // --- Attitude ---------------------------------------------------------------
    // Built from the apparent wind: the kite weathercocks into the airflow. `windUp` is
    // the lift direction at zero bank; tilting the normal off it by alpha sets the
    // incidence, and rolling about the wind axis banks the lift vector sideways.
    let windDir = v3(0, 0, 1)
    let normal = v3(0, 1, 0)
    let liftDir = v3(0, 1, 0)

    let lift = v3()
    let drag = v3()

    if (airspeed > 0.05) {
      windDir = scale(apparent, 1 / airspeed)

      let windUp = sub(WORLD_UP, scale(windDir, dot(WORLD_UP, windDir)))
      windUp =
        length(windUp) > 1e-4
          ? normalize(windUp)
          : normalize(sub(line.dir, scale(windDir, dot(line.dir, windDir))))
      windUp = rotateAbout(windUp, windDir, this.roll)

      liftDir = windUp
      normal = add(scale(windUp, Math.cos(this.alpha)), scale(windDir, -Math.sin(this.alpha)))

      lift = scale(liftDir, q * liftCoefficient(this.alpha) * k.clScale)

      const lineDragArea = config.line.length * config.line.dragPerMetre
      const lineDrag =
        0.5 * config.env.airDensity * airspeed * airspeed * lineDragArea
      drag = scale(windDir, q * dragCoefficient(this.alpha) * k.cdScale + lineDrag)
    }

    const tensionForce = scale(line.dir, -line.tension)

    // --- Integrate translation ----------------------------------------------
    const force = add(add(lift, drag), tensionForce)
    force.y -= k.mass * config.env.gravity

    const invMass = 1 / k.mass
    addScaledInPlace(this.vel, force, dt * invMass)

    const speed = length(this.vel)
    if (speed > MAX_SPEED) this.vel = scale(this.vel, MAX_SPEED / speed)

    addScaledInPlace(this.pos, this.vel, dt)

    if (this.pos.y < GROUND_Y) {
      this.pos.y = GROUND_Y
      if (this.vel.y < 0) this.vel.y = 0
      this.vel.x *= 0.7
      this.vel.z *= 0.7
      this.crashed = true
    } else if (this.pos.y > GROUND_Y + 0.5) {
      this.crashed = false
    }

    // --- Integrate roll -------------------------------------------------------
    // Every term scales with dynamic pressure, because a tail in dead air does
    // nothing. That is deliberate: it is what turns a stall into a dive.
    const rollRateConstant = k.tailStrength * q
    const rollCritical = 2 * Math.sqrt(Math.max(rollRateConstant * k.rollInertia, 1e-9))
    const restoring = -rollRateConstant * Math.sin(this.roll)
    const disturbance =
      lateralGustGradient(this.pos, time, 0.8) * k.rollGustGain * q
    const damping = -k.rollDampRatio * rollCritical * this.rollRate
    this.rollRate += ((restoring + disturbance + damping) / k.rollInertia) * dt
    this.roll += this.rollRate * dt
    this.roll = Math.max(-Math.PI, Math.min(Math.PI, this.roll))

    // A NaN anywhere in the state is permanent — it propagates through every later
    // step and the game never recovers. Relaunch instead of wedging.
    if (!Number.isFinite(this.pos.x + this.pos.y + this.pos.z + this.roll)) {
      this.reset(handPos)
      return
    }

    // --- Diagnostics ----------------------------------------------------------
    const rel = sub(this.pos, handPos)
    const d = this.diag
    d.apparent = apparent
    d.windDir = windDir
    d.airspeed = airspeed
    d.alpha = this.alpha
    d.lift = lift
    d.drag = drag
    d.tensionForce = tensionForce
    d.normal = normal
    d.line = line
    d.elevation = Math.asin(Math.max(-1, Math.min(1, rel.y / Math.max(line.distance, 1e-4))))
    d.azimuth = Math.atan2(rel.x, rel.z)
    d.stalled = Math.abs(this.alpha) > k.stallDeg * DEG
  }
}
