/**
 * Every tunable constant in the simulation, in one mutable object.
 *
 * This is the model the tuning panel binds to — sliders write straight into it and
 * the next physics step picks the change up. Nothing outside this file may hardcode a
 * physical constant; if a number wants tuning, it belongs here.
 */

export interface Config {
  env: {
    airDensity: number
    gravity: number
  }
  wind: {
    /** Base speed at reference height, m/s. */
    base: number
    /** Power-law shear exponent. 0.11 open sea, 0.14 open terrain. */
    shear: number
    refHeight: number
    gustAmp: number
    /** Metres per unit of noise. Larger = broader gust cells. */
    gustCellSize: number
    gustTimeScale: number
    /** Height below which ground turbulence applies. */
    turbHeight: number
    turbAmp: number
  }
  kite: {
    mass: number
    area: number
    /**
     * Bridle leg lengths, in spine-lengths. The upper pair run from the cross spar, the
     * lower one from down the spine; where they meet is the tow point, and the angle the
     * line makes with the kite falls out of that triangle. Adjusting a length is what
     * you would actually do to a kite, and it keeps the drawn bridle and the simulated
     * one the same object.
     *
     * Lengthening the lower leg walks the tow point toward the nose, which raises the
     * angle of attack — the fore-aft adjustment every kite flyer makes.
     */
    bridleUpper: number
    bridleLower: number
    /** Aerodynamic restoring moment toward trim. Scales with dynamic pressure, so a
     *  kite with no airflow over it has no pitch authority and wanders. */
    pitchStiffness: number
    /** Damping as a fraction of critical, not an absolute coefficient. Critical damping
     *  depends on dynamic pressure, so a fixed coefficient is badly underdamped in the
     *  wind speeds that matter and the kite flip-flops in pitch at several hertz. */
    pitchDampRatio: number
    pitchInertia: number
    /** Angle of attack at which lift collapses, degrees. */
    stallDeg: number
    /** Degrees over which the stall blends in. */
    stallBlendDeg: number
    clScale: number
    cdScale: number
    /** Parasitic drag at zero angle of attack. */
    cd0: number
    rollInertia: number
    /** As `pitchDampRatio`: a fraction of critical, not an absolute coefficient. */
    rollDampRatio: number
    /** Aerodynamic roll restoring strength — the tail. Scales with dynamic pressure,
     *  so it vanishes when the kite stalls. That is what makes a stall turn into a dive. */
    tailStrength: number
    /** Roll disturbance from the gust field. */
    rollGustGain: number
    /** Drawn size relative to true size. Purely visual — the physics always uses the
     *  real area. A kite 30 m away is honestly only a few pixels across, which is
     *  unreadable when it is the thing you are controlling. */
    visualScale: number
    /**
     * Spine length divided by span — how tall the kite is relative to its width. Area
     * is held constant as this changes, so the physics is untouched: the flat-plate
     * model only cares about area. (A real aspect ratio does change lift slope and
     * induced drag; this model does not capture that.)
     *
     * Worth knowing that the drawn kite always looks wider than this value suggests,
     * because the spine points away from the camera and foreshortens while the span
     * does not.
     */
    aspect: number
    /** Tail length in metres, before `visualScale` is applied. */
    tailLength: number
    /**
     * Floor on how far the *drawn* kite is pitched from flat, degrees. Compensation for
     * the camera looking horizontally at a kite well above the horizon: a real viewer
     * tilts their head up and sees the kite face-on, this camera cannot, so an honest
     * attitude presents edge-on and vanishes.
     *
     * Applied only as the shortfall below this angle, so it fades out entirely when the
     * kite genuinely stands up — which it now does low in the window, where the bridle
     * geometry puts it at a high angle of attack. Nothing to do with the bridle; that is
     * `bridleDeg`, and it is physical.
     */
    drawPitchFloorDeg: number
  }
  line: {
    length: number
    minLength: number
    maxLength: number
    /** Spring stiffness, N/m. Stiff enough to read as inextensible at 240 Hz. */
    spring: number
    damping: number
    /** Drag contributed per metre of line. */
    dragPerMetre: number
    /** Metres per second of reel in/out. */
    reelRate: number
    /** Tension at which the line renders dead straight. */
    tautTension: number
    /** Ceiling on line tension. A real line would part; here it stops a large, sudden
     *  length change from launching the kite to infinity in a single step. */
    maxTension: number
    /** Sag depth as a fraction of line length when fully slack. */
    sagFactor: number
  }
  hand: {
    /** Seconds to reach full draw while a key is held. */
    drawTime: number
    /** Seconds to return to rest after release. */
    releaseTime: number
    /** Metres the hand travels back along the line at full draw. This is also what
     *  the rig's hands visibly do, so an unrealistically deep draw looks wrong as well
     *  as hitting the line far too hard. */
    drawDepth: number
    /** Metres of lateral hand separation at full differential. */
    lateralOffset: number
    /** Grip height in metres. Should read as waist height on a 1.75 m figure. */
    height: number
  }
  camera: {
    /** Distance the camera sits behind the flyer. Also what keeps a kite at 90 degrees
     *  of azimuth on screen, since it never reaches zero depth in camera space. */
    dist: number
    eyeHeight: number
    focal: number
  }
}

export const config: Config = {
  env: {
    airDensity: 1.225,
    gravity: 9.81,
  },
  wind: {
    base: 6,
    shear: 0.14,
    refHeight: 10,
    gustAmp: 1.6,
    gustCellSize: 18,
    gustTimeScale: 0.25,
    turbHeight: 8,
    turbAmp: 1.1,
  },
  kite: {
    mass: 0.25,
    area: 0.6,
    bridleUpper: 0.467,
    bridleLower: 0.413,
    pitchStiffness: 5.5,
    pitchDampRatio: 1,
    pitchInertia: 0.05,
    stallDeg: 16,
    stallBlendDeg: 9,
    clScale: 1,
    cdScale: 1,
    cd0: 0.1,
    rollInertia: 0.06,
    rollDampRatio: 0.9,
    tailStrength: 2.4,
    rollGustGain: 0.5,
    visualScale: 2.2,
    aspect: 1.5,
    tailLength: 3.5,
    drawPitchFloorDeg: 40,
  },
  line: {
    length: 30,
    minLength: 5,
    maxLength: 80,
    spring: 900,
    damping: 12,
    dragPerMetre: 0.004,
    reelRate: 6,
    tautTension: 14,
    maxTension: 1200,
    sagFactor: 0.16,
  },
  hand: {
    drawTime: 0.28,
    releaseTime: 0.4,
    drawDepth: 0.55,
    lateralOffset: 0.6,
    height: 1.0,
  },
  camera: {
    dist: 20,
    eyeHeight: 1.6,
    focal: 416,
  },
}

/** Snapshot for the tuning panel's copy-to-clipboard. */
export const cloneConfig = (): Config => structuredClone(config)
