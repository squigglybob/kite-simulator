import { config } from './config'
import { bridleGeometry } from './bridle'
import {
  dragCoefficient,
  dynamicPressure,
  liftCoefficient,
  sideslipDragCoefficient,
  sideslipLiftFactor,
} from './aero'
import { solveLine, type LineState } from './line'
import { windAt } from './wind'
import {
  add,
  addScaledInPlace,
  copy,
  cross,
  dot,
  length,
  normalize,
  scale,
  sub,
  v3,
  type Vec3,
} from '../core/vec3'

/**
 * The kite: a rigid body with six degrees of freedom.
 *
 * It carries an orientation and an angular velocity, and turns because torques act on
 * it — not because an angle is being steered toward a target. That distinction is the
 * whole point. A body with angular momentum cannot flip: reversing its attitude means
 * first arresting the rotation it already has, which takes time and torque. Rotation
 * accelerates, coasts and decelerates, the way a real kite's does.
 *
 * Three torques do all the work:
 *
 * - **Aerodynamic**, applied not at the centre of mass but at the centre of pressure,
 *   which slides along the spine as the angle of attack changes. That offset is what
 *   makes pitch self-correcting.
 * - **The line**, pulling at the bridle's tow point, which stands off the face and
 *   forward of centre. This is the bridle physically doing its job — the trim angle is
 *   no longer a number anyone types in, it is wherever those two torques cancel.
 * - **The tail**, as damping that scales with dynamic pressure. A tail in still air
 *   does nothing, so a stalled kite keeps whatever rotation it had and tumbles.
 *
 * Orientation is stored as three orthonormal axes rather than a quaternion. At 240 Hz
 * the drift is tiny, one Gram-Schmidt pass a step removes it, and the renderer wants
 * the axes anyway.
 */

const DEG = Math.PI / 180
const WORLD_UP: Vec3 = { x: 0, y: 1, z: 0 }
const GROUND_Y = 0.15
/** How far the kite is propped back when set down ready to launch. */
const LAUNCH_TILT = 38 * DEG
/** Backstops. Nothing physical should approach either. */
const MAX_SPEED = 90
const MAX_SPIN = 40

export interface KiteDiagnostics {
  apparent: Vec3
  windDir: Vec3
  airspeed: number
  /** Angle of attack, radians. Measured from the orientation, no longer a state. */
  alpha: number
  /** Sideslip: 1 when the air runs down the spine, 0 when it runs across the span. */
  alignment: number
  lift: Vec3
  drag: Vec3
  tensionForce: Vec3
  /** Leeward face normal: the direction the aerodynamic force pushes. */
  normal: Vec3
  /** Centre toward the nose, in world space. */
  nose: Vec3
  /** Wingtip to wingtip, in world space. */
  span: Vec3
  line: LineState
  elevation: number
  azimuth: number
  /** Bank angle for the instrument readout, radians. */
  roll: number
  stalled: boolean
}

export class Kite {
  pos: Vec3 = v3()
  /** Position at the start of the current step, for render interpolation. */
  prevPos: Vec3 = v3()
  vel: Vec3 = v3()

  /** Orientation, as three orthonormal world-space axes. */
  nose: Vec3 = v3(0, 1, 0)
  span: Vec3 = v3(1, 0, 0)
  normal: Vec3 = v3(0, 0, 1)
  /** Angular velocity in world space, radians per second. */
  spin: Vec3 = v3()

  crashed = false

  diag: KiteDiagnostics = {
    apparent: v3(),
    windDir: v3(0, 0, 1),
    airspeed: 0,
    alpha: 0,
    alignment: 1,
    lift: v3(),
    drag: v3(),
    tensionForce: v3(),
    normal: v3(0, 0, 1),
    nose: v3(0, 1, 0),
    span: v3(1, 0, 0),
    line: { dir: v3(0, 1, 0), distance: 0, extension: 0, tension: 0 },
    elevation: 0,
    azimuth: 0,
    roll: 0,
    stalled: false,
  }

  /** Spine and span in metres, from the area and aspect the player has set. */
  private dimensions(): { spine: number; span: number } {
    const area = 2 * config.kite.area
    const aspect = Math.max(config.kite.aspect, 0.2)
    return { spine: Math.sqrt(area * aspect), span: Math.sqrt(area / aspect) }
  }

  /** Place the kite downwind at a low elevation, as if just launched. */
  reset(handPos: Vec3, elevationDeg = 38): void {
    const e = elevationDeg * DEG
    const r = config.line.length * 0.98
    this.pos = add(handPos, v3(0, Math.sin(e) * r, Math.cos(e) * r))
    this.prevPos = copy(this.pos)
    this.vel = v3()
    this.spin = v3()
    this.crashed = false

    // Launched at its trim angle, the way someone holds a kite up into the wind before
    // letting go — not square to the line, which is 60 degrees of incidence and deeply
    // stalled. The flat-plate curves have a second, stalled equilibrium at high
    // incidence, and a kite that starts there cannot always climb out of it: with any
    // gust running it just sits at 30 degrees making no lift.
    const bridle = bridleGeometry()
    const trimSin = Math.max(
      -0.9,
      Math.min((bridle.along - config.kite.cpBase) / config.kite.cpSlope, 0.9),
    )
    const trim = Math.asin(trimSin)

    const flow = normalize(windAt(this.pos, 0))
    this.span = normalize(cross(WORLD_UP, flow))
    // Face mostly upward, tipped so the airflow meets it at exactly the trim angle.
    const lift = normalize(cross(flow, this.span))
    this.normal = normalize(
      add(scale(lift, Math.cos(trim)), scale(flow, Math.sin(trim))),
    )
    this.nose = cross(this.normal, this.span)
    this.orthonormalise()
  }

  /**
   * Lays the kite out ready to be launched: walked downwind to the end of the line,
   * set on the sand, and propped with its nose up and its face tilted back into the
   * wind. This is how you actually start a kite, and unlike a relaunch it leaves the
   * clock and the score alone.
   *
   * The prop angle is well past the stall on purpose. A kite lying flat catches
   * nothing; standing it up gives the wind a face to push on, which is what gets it
   * off the ground.
   */
  placeForLaunch(handPos: Vec3): void {
    const reach = config.line.length * 0.98
    const air = windAt(v3(handPos.x, 2, handPos.z + 5), 0)
    let downwind = v3(air.x, 0, air.z)
    downwind = length(downwind) > 1e-3 ? normalize(downwind) : v3(0, 0, 1)

    this.pos = v3(
      handPos.x + downwind.x * reach,
      GROUND_Y + 0.01,
      handPos.z + downwind.z * reach,
    )
    this.prevPos = copy(this.pos)
    this.vel = v3()
    this.spin = v3()
    this.crashed = false

    const flow = normalize(windAt(this.pos, 0))
    this.span = normalize(cross(WORLD_UP, flow))
    const lift = normalize(cross(flow, this.span))
    this.normal = normalize(
      add(scale(lift, Math.cos(LAUNCH_TILT)), scale(flow, Math.sin(LAUNCH_TILT))),
    )
    this.nose = cross(this.normal, this.span)
    this.orthonormalise()
  }

  /** Removes the drift that integrating three axes separately accumulates. */
  private orthonormalise(): void {
    this.nose = normalize(this.nose)
    let span = sub(this.span, scale(this.nose, dot(this.span, this.nose)))
    if (length(span) < 0.3) {
      // Axes collapsed onto each other; rebuild the span from any transverse direction.
      const fallback = Math.abs(this.nose.y) > 0.9 ? v3(1, 0, 0) : WORLD_UP
      span = cross(fallback, this.nose)
    }
    this.span = normalize(span)
    this.normal = normalize(cross(this.span, this.nose))
  }

  step(dt: number, handPos: Vec3, time: number): void {
    const k = config.kite
    this.prevPos = copy(this.pos)

    const size = this.dimensions()
    const wind = windAt(this.pos, time)
    const apparent = sub(wind, this.vel)
    const airspeed = length(apparent)
    const line = solveLine(this.pos, handPos, this.vel)

    // --- The sail, as two panels ---------------------------------------------------
    // Not one flat plate but two, hinged along the spine and tilted up out of the flat
    // by the dihedral angle. This is the difference between a kite that can right
    // itself and one that cannot.
    //
    // A single plate makes one force at one point *on the spine*, and the cross
    // product of a spine offset with any force has no spine component — so a flat
    // plate produces mathematically zero roll torque, at every angle, always. No
    // amount of tuning reaches that, because it is a property of the geometry rather
    // than of the numbers. Two panels sit half a span apart, so their forces differ
    // and the difference is a real rolling moment.
    //
    // Three things then fall out for free that used to be faked or missing:
    //
    // - **Dihedral effect.** Slide the kite sideways and the windward panel meets the
    //   air more squarely than the leeward one. It makes more lift, and the kite rolls
    //   back upright. This is what a bowed cross spar is *for*.
    // - **Roll and yaw damping**, because each panel's local airflow includes the
    //   velocity its own offset picks up from the kite's rotation. Rotating drives a
    //   flow difference across the two panels that opposes the rotation.
    // - **Gust roll**, because the wind is sampled at each panel's own centre. A gust
    //   that catches one wingtip harder really does hit one panel harder. That used to
    //   be a hand-applied torque with its own gain, which is now gone.
    const dihedral = k.dihedralDeg * DEG
    const cosD = Math.cos(dihedral)
    const sinD = Math.sin(dihedral)
    const halfSpan = size.span * 0.5
    /** Centroid of a half of the sail, a quarter span out from the spine. */
    const panelArm = halfSpan * 0.5

    let windDir = v3(0, 0, 1)
    let alpha = 0
    let alignment = 1
    let lift = v3()
    let drag = v3()

    const aero = v3()
    const torque = v3()

    for (const side of [-1, 1]) {
      // The panel's own face. Both tilt toward the centreline, so the sail forms a
      // shallow V opening downwind — wingtips forward of the spine, as a bow bends.
      const panelNormal = normalize(
        add(scale(this.normal, cosD), scale(this.span, -side * sinD)),
      )
      // and its own spanwise axis, which the dihedral tilts with it. Note the order:
      // `span` is `nose x normal`, so taking the cross the other way round puts every
      // panel on the wrong side of the kite and silently inverts the dihedral.
      const panelSpan = cross(this.nose, panelNormal)

      // Where this panel acts, and what the air is doing there. Both the wind sample
      // and the rotational velocity are taken at the panel, not at the centre — that
      // is the whole source of the roll behaviour.
      const arm = scale(panelSpan, side * panelArm)
      const at = add(this.pos, arm)
      const panelWind = windAt(at, time)
      const panelVel = add(this.vel, cross(this.spin, arm))
      const flow = sub(panelWind, panelVel)
      const speed = length(flow)
      if (speed <= 0.05) continue

      const flowDir = scale(flow, 1 / speed)
      // `panelNormal` is the leeward face, so the flow has a positive component along
      // it at positive incidence.
      const panelAlpha = Math.asin(
        Math.max(-1, Math.min(1, dot(flowDir, panelNormal))),
      )

      // Sideslip, per panel. Kept as squares rather than an angle: it needs no sign,
      // and no normalising of an in-plane flow vector that vanishes when the air comes
      // square to the sail — where, rightly, there is no sideslip to speak of, since a
      // barn door is a barn door whichever way round you hold it.
      const chordwise = dot(flow, this.nose)
      const spanwise = dot(flow, panelSpan)
      const inPlaneSq = chordwise * chordwise + spanwise * spanwise
      const panelAlign =
        inPlaneSq > 1e-6 ? Math.sqrt((chordwise * chordwise) / inPlaneSq) : 1

      // Half the area each, so the two together are the kite the config describes.
      const panelQ = dynamicPressure(speed, config.kite.area * 0.5)

      const panelLift = v3()
      const perpendicular = sub(
        panelNormal,
        scale(flowDir, dot(panelNormal, flowDir)),
      )
      const perpLength = length(perpendicular)
      if (perpLength > 1e-4) {
        addScaledInPlace(
          panelLift,
          perpendicular,
          (panelQ *
            liftCoefficient(panelAlpha) *
            k.clScale *
            sideslipLiftFactor(panelAlign)) /
            perpLength,
        )
      }
      const panelDrag = scale(
        flowDir,
        panelQ *
          (dragCoefficient(panelAlpha) * k.cdScale +
            sideslipDragCoefficient(panelAlign)),
      )
      const panelForce = add(panelLift, panelDrag)
      lift = add(lift, panelLift)
      drag = add(drag, panelDrag)

      // The centre of pressure slides toward the *trailing* edge as incidence rises,
      // which on a kite is the tail, so `cpSlope` is negative. Because the line is
      // anchored at a fixed point, that travel is what restores pitch: too much
      // incidence walks the pressure behind the tow point and the nose comes back down.
      const cpAlong = (k.cpBase + k.cpSlope * Math.sin(panelAlpha)) * size.spine
      addScaledInPlace(arm, this.nose, cpAlong)

      addScaledInPlace(torque, cross(arm, panelForce), 1)

      // Diagnostics are the mean of the two panels, which for a kite flying straight
      // is what a single-plate model would have reported anyway.
      windDir = flowDir
      alpha += panelAlpha * 0.5
      alignment += (panelAlign - 1) * 0.5
    }

    // --- The keel ------------------------------------------------------------------
    // A flat plate facing sideways, hung below and behind the tow point. Edge-on to
    // the airflow in straight flight, so it costs almost nothing; the moment the kite
    // slews across the flow it meets the air face-on, and because it is behind the
    // centre of mass that force swings the nose back into the wind. It is what holds a
    // tailless kite straight, and it is the reason a delta needs no tail.
    if (k.keelArea > 0) {
      const keelAt = add(
        scale(this.nose, k.keelAlong * size.spine),
        // Hangs off the windward face, which is the side away from the normal.
        scale(this.normal, -k.keelDrop * size.spine),
      )
      const keelFlow = sub(
        windAt(add(this.pos, keelAt), time),
        add(this.vel, cross(this.spin, keelAt)),
      )
      const keelSpeed = length(keelFlow)
      if (keelSpeed > 0.05) {
        const keelDir = scale(keelFlow, 1 / keelSpeed)
        // The fin's face looks along the span, so that is the axis its incidence is
        // measured from.
        const keelAlpha = Math.asin(
          Math.max(-1, Math.min(1, dot(keelDir, this.span))),
        )
        const keelQ = dynamicPressure(keelSpeed, k.keelArea)
        const keelForce = scale(keelDir, keelQ * dragCoefficient(keelAlpha))
        const perp = sub(this.span, scale(keelDir, dot(this.span, keelDir)))
        const perpLen = length(perp)
        if (perpLen > 1e-4) {
          addScaledInPlace(keelForce, perp, (keelQ * liftCoefficient(keelAlpha)) / perpLen)
        }
        lift = add(lift, keelForce)
        addScaledInPlace(torque, cross(keelAt, keelForce), 1)
      }
    }

    // Line drag acts on the line, not on either panel, so it is added once at the
    // centre along the airflow the kite as a whole sees.
    const apparentSpeed = length(apparent)
    if (apparentSpeed > 0.05) {
      const lineDragArea = config.line.length * config.line.dragPerMetre
      drag = add(
        drag,
        scale(apparent, 0.5 * config.env.airDensity * apparentSpeed * lineDragArea),
      )
    }
    const aeroTotal = add(lift, drag)
    aero.x = aeroTotal.x
    aero.y = aeroTotal.y
    aero.z = aeroTotal.z

    const tensionForce = scale(line.dir, -line.tension)

    // --- Forces ------------------------------------------------------------------
    const force = add(aero, tensionForce)
    force.y -= k.mass * config.env.gravity

    // --- Torques -------------------------------------------------------------------
    const bridle = bridleGeometry()
    const towPoint = add(
      scale(this.nose, bridle.along * size.spine),
      // The bridle stands off the windward face, which is opposite the normal.
      scale(this.normal, -bridle.standoff * size.spine),
    )
    addScaledInPlace(torque, cross(towPoint, tensionForce), 1)

    // The tail hangs behind and below on a lever arm, and its *weight* is a pendulum:
    // gravity pulling on it keeps the kite the right way up. Unlike everything else
    // holding the attitude, this needs no airflow at all, so it is still working when
    // the wind drops and every aerodynamic term has gone quiet. Its mass comes from
    // the tail length you can see, so a longer tail really is a steadier kite.
    const tailArmLength = k.tailArm * size.spine
    const tailPoint = scale(this.nose, -tailArmLength)
    const tailMass = Math.max(0, config.kite.tailLength * k.tailMassPerMetre)
    if (tailMass > 0) {
      const weight = v3(0, -tailMass * config.env.gravity, 0)
      addScaledInPlace(force, weight, 1)
      addScaledInPlace(torque, cross(tailPoint, weight), 1)
    }

    // The tail, modelled as what it physically is: a drag device on the end of a lever.
    // Because it is offset behind the centre of mass, its drag both damps rotation and
    // *restores* it — any yaw or pitch away from the airflow swings the tail sideways
    // into the wind and it is pushed straight again. A damping-only term could never do
    // that, which is why the kite kept drifting into a slow yaw and falling out.
    const tailAt = tailPoint
    const tailAir = sub(wind, add(this.vel, cross(this.spin, tailAt)))
    const tailSpeed = length(tailAir)
    if (tailSpeed > 1e-3 && k.tailDrag > 0) {
      const tailForce = scale(
        tailAir,
        0.5 * config.env.airDensity * tailSpeed * k.tailDrag,
      )
      addScaledInPlace(force, tailForce, 1)
      addScaledInPlace(torque, cross(tailAt, tailForce), 1)
    }

    // Pitch damping. Turning about the span sweeps the nose and tail through the air
    // in opposite directions, and the pressure difference opposes the turn. Leaving
    // it out is what let a well-trimmed kite slowly diverge in pitch and fall out of
    // the sky. Like every other aerodynamic term it needs airflow, so it fades with
    // airspeed.
    //
    // Only the span axis is damped here. Roll and yaw used to be damped alongside it,
    // and are not any more: the two panels sit half a span apart and sample the air at
    // their own centres, so a kite rotating about its spine or its face already drives
    // a real flow difference between them that opposes the rotation. Damping those
    // axes again by hand double-counted it, and it is precisely the roll-yaw swing
    // that the panels exist to produce.
    if (airspeed > 0.05) {
      const q = dynamicPressure(airspeed)
      const damp = (k.aeroDamping * q) / Math.max(airspeed, 0.5)
      const chord = size.spine * size.spine
      addScaledInPlace(torque, this.span, -damp * chord * dot(this.spin, this.span))
    }

    // A trace of always-on damping, so a kite tumbling in dead air eventually settles
    // rather than spinning for ever.
    addScaledInPlace(torque, this.spin, -k.spinDamping)

    // --- Integrate -------------------------------------------------------------------
    // The tail's weight is applied as a force above, so its mass has to be in the
    // denominator too or the kite falls faster than gravity: 0.14 kg of tail pulling
    // on 0.25 kg of kite came out at 1.56 g. A flying kite is the whole assembly.
    const invMass = 1 / (k.mass + tailMass)
    addScaledInPlace(this.vel, force, dt * invMass)

    const speed = length(this.vel)
    if (speed > MAX_SPEED) this.vel = scale(this.vel, MAX_SPEED / speed)
    addScaledInPlace(this.pos, this.vel, dt)

    // Thin-plate moments of inertia, one per body axis, at their textbook values. The
    // gyroscopic coupling term is left out: at these rates it is far below the
    // aerodynamic torques.
    //
    // The tail is deliberately absent here, and that is the whole point of a tail. It
    // is a flexible streamer, not a spar: the kite has to drag its mass along, which is
    // why it counts toward `invMass` above, but it does not have to be *angularly
    // accelerated* with the body — it trails and flexes instead. Counting it as a rigid
    // point mass on a 1.6 m arm put 79% of the pitch inertia into the tail and made the
    // kite twelve times harder to turn than the plate it is, so a stall became a slow
    // wallow with a 2.9 second period instead of the quick rotation about the bridle a
    // real kite does. Its stabilising work is done by the pendulum and drag torques
    // above, which is how a tail actually steadies a kite.
    const scaleI = k.mass / 12
    const rollInertia = Math.max(scaleI * size.span * size.span, 1e-6)
    const pitchInertia = Math.max(scaleI * size.spine * size.spine, 1e-6)
    const yawInertia = Math.max(
      scaleI * (size.spine * size.spine + size.span * size.span),
      1e-6,
    )

    const angularAcceleration = add(
      add(
        scale(this.nose, dot(torque, this.nose) / rollInertia),
        scale(this.span, dot(torque, this.span) / pitchInertia),
      ),
      scale(this.normal, dot(torque, this.normal) / yawInertia),
    )
    addScaledInPlace(this.spin, angularAcceleration, dt)

    const spinRate = length(this.spin)
    if (spinRate > MAX_SPIN) this.spin = scale(this.spin, MAX_SPIN / spinRate)

    // Rotate each axis by the angular velocity. Valid for small steps, and 240 Hz is
    // very small; the orthonormalise below mops up what error remains.
    addScaledInPlace(this.nose, cross(this.spin, this.nose), dt)
    addScaledInPlace(this.span, cross(this.spin, this.span), dt)
    this.orthonormalise()

    if (this.pos.y < GROUND_Y) {
      this.pos.y = GROUND_Y
      if (this.vel.y < 0) this.vel.y = 0
      this.vel.x *= 0.7
      this.vel.z *= 0.7
      this.spin = scale(this.spin, 0.6)
      this.crashed = true
    } else if (this.pos.y > GROUND_Y + 0.5) {
      this.crashed = false
    }

    // A non-finite state is permanent — it propagates through every later step and the
    // game never recovers. Relaunch instead of wedging.
    if (
      !Number.isFinite(
        this.pos.x + this.pos.y + this.pos.z + this.nose.y + this.spin.x,
      )
    ) {
      this.reset(handPos)
      return
    }

    // --- Diagnostics ------------------------------------------------------------------
    const rel = sub(this.pos, handPos)
    const d = this.diag
    d.apparent = apparent
    d.windDir = windDir
    d.airspeed = airspeed
    d.alpha = alpha
    d.alignment = alignment
    d.lift = lift
    d.drag = drag
    d.tensionForce = tensionForce
    d.normal = this.normal
    d.nose = this.nose
    d.span = this.span
    d.line = line
    d.elevation = Math.asin(
      Math.max(-1, Math.min(1, rel.y / Math.max(line.distance, 1e-4))),
    )
    d.azimuth = Math.atan2(rel.x, rel.z)
    d.roll = Math.asin(Math.max(-1, Math.min(1, dot(this.span, WORLD_UP))))
    d.stalled = Math.abs(alpha) > k.stallDeg * DEG
  }
}
