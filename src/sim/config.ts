/**
 * Every tunable constant in the simulation, in one mutable object.
 *
 * This is the model the tuning panel binds to — sliders write straight into it and
 * the next physics step picks the change up. Nothing outside this file may hardcode a
 * physical constant; if a number wants tuning, it belongs here.
 */

/**
 * `generated` is reserved for the procedural engine and is deliberately absent from the
 * tuning panel until that lands — an option that does nothing is worse than no option.
 */
export type MusicSource = 'off' | 'generated' | 'tracks'

/** The kites you can put on the line. */
export type KiteType = 'diamond' | 'delta' | 'stunt'

/**
 * One kite's numbers. Every kite carries its own full set, so tuning the delta cannot
 * quietly move the diamond out from under you.
 */
export interface KiteParams {
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
  /**
   * Where the centre of pressure sits along the spine, in spine-lengths from the
   * centre, as `base + slope * sin(alpha)`. Its travel with incidence is what makes
   * pitch self-correcting: the kite trims to wherever the pressure lines up with the
   * bridle's tow point, so the two together set the flying angle.
   */
  cpBase: number
  cpSlope: number
  /** The tail's drag area in square metres, and how far behind the centre of mass
   *  it acts, in spine-lengths. Being on a lever arm is what makes it *restore*
   *  attitude and not merely damp it — and it stops working in still air, which is
   *  what lets a stalled kite tumble. */
  tailDrag: number
  tailArm: number
  /** Tail weight per metre of length. Gravity on this, out on the tail's arm, is a
   *  pendulum holding the kite upright — and unlike the aerodynamic terms it keeps
   *  working when the wind drops. Multiplied by `tailLength`, so the tail you can
   *  see is the tail that steadies the kite. */
  tailMassPerMetre: number
  /** The kite's own surface resisting rotation — a large moment for a flat plate,
   *  and the main thing keeping pitch from slowly diverging. Needs airflow. */
  aeroDamping: number
  /** A trace of always-on damping, so a kite turning in dead air eventually stops. */
  spinDamping: number
  /**
   * Sideslip response — what happens when the air runs across the span instead of
   * down the spine. `sideslipLift` is the fraction of its lift a kite dragged
   * broadside gives up, `sideslipDrag` the extra drag coefficient it picks up.
   *
   * This is the pair that ties heading to travel. A flat plate makes exactly the
   * same lift whichever way round it is within its own plane, so nothing connects
   * where the kite points to where it goes and it crabs; a real kite's sail luffs
   * the moment it is slid sideways, so the only heading that works is the one it is
   * facing. Set `sideslipLift` to zero to get the old direction-blind plate back.
   */
  sideslipLift: number
  sideslipDrag: number
  /**
   * How far each half of the sail is tilted up out of the flat plane, about the
   * spine, in degrees. On a real kite this is the bow in the cross spar, or the
   * angle a delta's spreader holds between its two sides.
   *
   * This is the kite's roll stability, and it cannot be faked with a flat plate. When
   * a kite slides sideways, the windward half of a dihedralled sail meets the air more
   * squarely than the leeward half; the two halves then make unequal lift and the kite
   * rolls back upright. A single plate makes one force on one point of the spine and
   * so has no way to produce a rolling moment at all, whatever the angle.
   */
  dihedralDeg: number
  /**
   * The keel: the fin a delta hangs under its sail, given as an outline rather than
   * as an area, because on a delta the keel *is* the bridle. There is no left and
   * right leg — the flying line ties onto a single point on the keel, and sliding
   * that point along it is the kite's only trim adjustment.
   *
   * `keelFore` and `keelAft` are where it meets the spine and `keelApex` where its
   * lowest corner sits, all in spine-lengths from the centre of area and positive
   * toward the nose; `keelDrop` is how far that corner hangs below the sail. The apex
   * goes well forward, so the leading edge is short and the trailing edge long — half
   * a kite shape, which is what a real delta keel looks like. `keelTow` is where on
   * that long trailing edge the line attaches, 0 at the apex and 1 back at the spine.
   *
   * Area and the point the keel's drag acts through are read off these, so the drawn
   * keel and the simulated one cannot drift apart. A diamond has no keel — it uses a
   * tail and a three-leg bridle instead — and sets `keelDrop` to zero.
   *
   * The keel is how a tailless kite knows which way is up. It is edge-on in straight
   * flight and costs nothing; slew across the airflow and it meets the air face-on,
   * and sitting behind the centre of mass that bite swings the nose back into wind. A
   * stunt kite deliberately runs a small one — too much and the kite insists on
   * pointing into the wind, which is the opposite of steerable.
   */
  keelFore: number
  keelAft: number
  keelApex: number
  keelDrop: number
  keelTow: number
  /**
   * Two lines instead of one. The kite then carries a bridle a side, each meeting at
   * its own tow point out toward that wing, and the difference in pull between the
   * two is what turns it.
   */
  dualLine: boolean
  /**
   * The dual-line bridle. `bridleAftAlong` is the spine station of the shared spine
   * anchor and of the wing anchor level with it; `bridleForeAlong` is the station of
   * the forward wing anchor. Both wing anchors ride on the leading edge, so how far
   * out they sit follows from these.
   *
   * `towAlong`, `towSpread` and `towStandoff` place each tow point: down the spine,
   * out toward its wingtip as a fraction of the half span, and off the windward face.
   *
   * The spread is what gives the kite a steering moment at all, and the standoff is
   * what decides whether that moment comes out as *yaw* — the kite rotating in the
   * plane of its own sail, which is what a stunt kite does — or merely as roll. A
   * line pulling square to the sail at an offset point can only ever roll it.
   */
  bridleAftAlong: number
  bridleForeAlong: number
  towAlong: number
  towSpread: number
  towStandoff: number
  /**
   * Which tow point each hand's line runs to: false is left hand to left tow point.
   *
   * This is a control-layer correction, and it is worth being honest about what it
   * compensates for rather than burying it. Whether a tug turns the kite toward that
   * hand or away from it is decided by one thing: whether the flyer lies on the nose
   * side or the tail side of the kite *within the plane of the sail*. The crossover
   * is exactly where angle of attack plus elevation reaches ninety degrees.
   *
   * A real sport kite sits with its face to you and its nose up the window, putting
   * you on the tail side, and a left tug then turns it left. This kite trims with its
   * nose toward you, so the same geometry turns it right. Pushing the trim past the
   * crossover does flip the couple — measured at minus 0.36 — but it needs better
   * than thirty degrees of incidence, and by then the flat-plate stall has collapsed
   * the lift and the kite mushes instead of flying where it points. Correct sense,
   * no flight; or flight with the wrong sense.
   *
   * Until the swept planform carries lift to that incidence the way a real sport kite
   * does, this routes the lines so the control reads correctly to the player. Setting
   * it false shows the underlying behaviour unaltered.
   */
  steerInvert: boolean
  /** Angle of attack at which lift collapses, degrees. */
  stallDeg: number
  /** Degrees over which the stall blends in. */
  stallBlendDeg: number
  clScale: number
  cdScale: number
  /** Parasitic drag at zero angle of attack. */
  cd0: number
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
}

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
  /** Which kite is on the line. */
  kiteType: KiteType
  /** Every kite's own numbers, tuned independently. */
  kites: Record<KiteType, KiteParams>
  /**
   * The kite currently flying. This is an *alias* into `kites`, not a copy, so a
   * slider bound to `kite.mass` writes straight into the active preset and the other
   * presets never see it. Always change it through `selectKite`.
   */
  kite: KiteParams
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
    /** Multiplier on the physically derived sag. One is the honest catenary; less
     *  understates the droop, more exaggerates it. */
    sagFactor: number
    /** The same, for the bridle legs, as a fraction of the spine. They are line and
     *  not wire, so they go soft when the kite is unloaded. */
    bridleSag: number
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
    /** How far apart the two hands are held on a dual-line kite, metres. This is the
     *  lever the steering works through, so it is a real control and not cosmetic. */
    separation: number
    /**
     * How far a hand travels on a dual-line kite, metres. Much shorter than
     * `drawDepth`, and it has to be: the tow points are only a half metre apart, so
     * the kite has to rotate a long way to take up any slack difference between the
     * two lines. Ask for more than it can rotate to and the line simply loads up
     * instead — half a metre of draw put 495 N through one line of a kite that weighs
     * two and a half, and it was hauled out of the sky rather than steered.
     */
    steerDepth: number
    /** Grip height in metres. Should read as waist height on a 1.75 m figure. */
    height: number
  }
  scenery: {
    /** How much light the water throws back. Scaled by the live wind, so the sea
     *  picks up when it starts blowing. */
    seaSparkle: number
    /** Flicker rate in steps per second. */
    seaSparkleRate: number
    /** How far the grass tips bend, in source pixels at full wind. */
    grassSway: number
    /** Flutter rate in radians per second. */
    grassRate: number
    /** How far the swell lifts the water band, in pixels. */
    waveHeight: number
    /** Distance between wave crests along the shore, in pixels. */
    waveLength: number
    /** How fast crests travel. Fixed: an ocean swell ignores the local breeze. */
    waveSpeed: number
  }
  audio: {
    /** Everything, after the per-channel levels. 0 to 1. */
    masterVolume: number
    masterMuted: boolean
    /** Sea and gulls. */
    ambienceVolume: number
    ambienceMuted: boolean
    /**
     * Which music plays, if any. `generated` is the procedural engine and joins the
     * tuning panel once it exists; the two never play together, since beat-driven lofi
     * over a tempo-less drone is mud.
     */
    musicSource: MusicSource
    musicVolume: number
    musicMuted: boolean
    /** Seconds of overlap where each pass of the ambience loop crossfades into the next. */
    crossfadeSeconds: number
    /** Seconds of overlap between one recorded track and the next. */
    trackCrossfadeSeconds: number
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
    base: 9,
    shear: 0.14,
    refHeight: 10,
    gustAmp: 1.6,
    gustCellSize: 18,
    gustTimeScale: 0.25,
    turbHeight: 8,
    turbAmp: 1.1,
  },
  kiteType: 'diamond',
  kites: {
    diamond: {
      mass: 0.25,
      area: 0.6,
      bridleUpper: 0.467,
      bridleLower: 0.413,
      cpBase: -0.16,
      cpSlope: -0.3,
      tailDrag: 0.02,
      tailArm: 1.2,
      tailMassPerMetre: 0.04,
      aeroDamping: 0.35,
      spinDamping: 0.03,
      sideslipLift: 0.9,
      sideslipDrag: 0.7,
      stallDeg: 16,
      stallBlendDeg: 9,
      clScale: 1,
      cdScale: 1,
      cd0: 0.1,
      visualScale: 2.2,
      aspect: 1.5,
      tailLength: 3.5,
      dihedralDeg: 6,
      keelFore: 0,
      keelAft: 0,
      keelApex: 0,
      keelDrop: 0,
      keelTow: 0.3,
      dualLine: false,
      bridleAftAlong: -0.383,
      bridleForeAlong: 0.167,
      towAlong: -0.1,
      towSpread: 0.4,
      towStandoff: 0.35,
      steerInvert: false,
    },
    delta: {
      mass: 0.3,
      area: 0.85,
      bridleUpper: 0.467,
      // Well forward of the diamond's, which puts the tow point *above* the centre of
      // mass rather than below it. That is what a kite with little tail needs: hung
      // from a point below its centre it wants to flip nose-down, and only a heavy
      // tail holds it up. Swept headlessly — at the diamond's 0.413 this kite does not
      // survive a single wind speed, and from about 0.62 it flies at all of them.
      bridleLower: 0.64,
      cpBase: -0.16,
      cpSlope: -0.3,
      tailDrag: 0.006,
      tailArm: 1.2,
      tailMassPerMetre: 0.04,
      aeroDamping: 0.22,
      spinDamping: 0.02,
      sideslipLift: 0.9,
      sideslipDrag: 0.7,
      dihedralDeg: 20,
      keelFore: 0.3,
      keelAft: -0.3,
      keelApex: 0.1,
      keelDrop: 0.38,
      keelTow: 0.2,
      dualLine: false,
      bridleAftAlong: -0.383,
      bridleForeAlong: 0.167,
      towAlong: -0.1,
      towSpread: 0.4,
      towStandoff: 0.35,
      steerInvert: false,
      stallDeg: 18,
      stallBlendDeg: 9,
      clScale: 1,
      cdScale: 1,
      cd0: 0.08,
      visualScale: 2.2,
      aspect: 0.75,
      tailLength: 1.5,
    },
    stunt: {
      mass: 0.28,
      area: 0.8,
      bridleUpper: 0.467,
      // Well forward of the diamond's, which puts the tow point *above* the centre of
      // mass rather than below it. That is what a kite with little tail needs: hung
      // from a point below its centre it wants to flip nose-down, and only a heavy
      // tail holds it up. Swept headlessly — at the diamond's 0.413 this kite does not
      // survive a single wind speed, and from about 0.62 it flies at all of them.
      bridleLower: 0.64,
      cpBase: -0.16,
      cpSlope: -0.3,
      tailDrag: 0.002,
      tailArm: 1.2,
      tailMassPerMetre: 0.04,
      aeroDamping: 0.22,
      spinDamping: 0.02,
      sideslipLift: 0.9,
      sideslipDrag: 0.7,
      dihedralDeg: 10,
      keelFore: 0.3,
      keelAft: -0.3,
      keelApex: 0.1,
      keelDrop: 0.16,
      keelTow: 0.2,
      dualLine: true,
      bridleAftAlong: -0.383,
      bridleForeAlong: 0.167,
      towAlong: 0,
      towSpread: 0.4,
      towStandoff: 0.18,
      steerInvert: true,
      stallDeg: 18,
      stallBlendDeg: 9,
      clScale: 1,
      cdScale: 1,
      cd0: 0.08,
      visualScale: 2.2,
      aspect: 0.6,
      tailLength: 0,
    },
  },
  // Replaced immediately below by `selectKite`, which points it at `kites.diamond`.
  // Written out in full first so the object satisfies `Config` on its own.
  kite: null as unknown as KiteParams,
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
    sagFactor: 1,
    bridleSag: 0.13,
  },
  hand: {
    drawTime: 0.28,
    releaseTime: 0.4,
    drawDepth: 0.55,
    lateralOffset: 0.6,
    separation: 0.5,
    steerDepth: 0.1,
    height: 1.0,
  },
  scenery: {
    seaSparkle: 0.05,
    seaSparkleRate: 9,
    grassSway: 9,
    grassRate: 2.4,
    waveHeight: 2,
    waveLength: 90,
    waveSpeed: 1.1,
  },
  audio: {
    masterVolume: 0.9,
    masterMuted: false,
    ambienceVolume: 0.55,
    ambienceMuted: false,
    musicSource: 'tracks',
    musicVolume: 0.35,
    musicMuted: false,
    crossfadeSeconds: 4,
    trackCrossfadeSeconds: 8,
  },
  camera: {
    dist: 20,
    eyeHeight: 1.6,
    focal: 416,
  },
}

/** Snapshot for the tuning panel's copy-to-clipboard. */
export const cloneConfig = (): Config => structuredClone(config)

/**
 * Put a kite on the line. Repoints the `kite` alias rather than copying values, so
 * every `config.kite.*` read in the simulation follows the switch and every slider
 * writes into the preset it belongs to.
 */
export function selectKite(type: KiteType): void {
  // A saved config from an older build can name a kite that no longer exists. Leaving
  // `config.kite` undefined throws on the very next physics step and blacks the game
  // out, which is a miserable way to find out your localStorage is stale.
  const known = config.kites[type] ? type : 'diamond'
  config.kiteType = known
  config.kite = config.kites[known]
}

selectKite(config.kiteType)

/**
 * A copy safe to serialise. `kite` is an alias into `kites` and would otherwise be
 * written out twice, then read back as a separate object — which silently breaks the
 * aliasing on the next load.
 */
export function configSnapshot(): Omit<Config, 'kite'> {
  const { kite: _active, ...rest } = config
  return structuredClone(rest)
}

/** Restore a whole config, keeping the `kite` alias intact. Used by the test harness. */
export function restoreConfig(saved: Omit<Config, 'kite'>): void {
  Object.assign(config, structuredClone(saved))
  selectKite(config.kiteType)
}
