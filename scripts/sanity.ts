/**
 * Headless physics checks.
 *
 * Two jobs. First, catch integration blow-ups and NaN leaks, which are miserable to
 * diagnose by eye in a browser. Second, assert the *behaviours* the design depends on
 * actually emerge from the force model rather than being scripted: that letting line
 * out gains height, that a tug loads the line, that losing the wind drops the kite and
 * that it recovers when the wind returns.
 *
 *   npm run sanity
 */

import { World } from '../src/sim/world'
import { config, configSnapshot, restoreConfig } from '../src/sim/config'
import type { InputState } from '../src/input/keys'

const HZ = 240
const DT = 1 / HZ
const DEG = 180 / Math.PI

const NONE: InputState = { left: false, right: false, reelIn: false, reelOut: false }
const PULL: InputState = { left: true, right: true, reelIn: false, reelOut: false }
const REEL_OUT: InputState = { left: false, right: false, reelIn: false, reelOut: true }

const DEFAULTS = configSnapshot()

interface Sample {
  altitude: number
  elevation: number
  tension: number
  speed: number
  alpha: number
  roll: number
}

function sample(world: World): Sample {
  const { pos, vel, diag } = world.kite
  return {
    altitude: pos.y,
    elevation: diag.elevation * DEG,
    tension: diag.line.tension,
    speed: Math.hypot(vel.x, vel.y, vel.z),
    alpha: diag.alpha * DEG,
    roll: diag.roll * DEG,
  }
}

/** Advance `seconds` of simulation, returning every sample taken along the way. */
function run(world: World, seconds: number, input: InputState = NONE): Sample[] {
  const samples: Sample[] = []
  for (let i = 0; i < seconds * HZ; i++) {
    world.step(DT, input)
    samples.push(sample(world))
  }
  return samples
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(xs.length, 1)
const last = (xs: Sample[], seconds: number) => xs.slice(-Math.round(seconds * HZ))
const finite = (s: Sample) => Object.values(s).every(Number.isFinite)

// ---------------------------------------------------------------------------

const failures: string[] = []

function check(name: string, condition: boolean, detail: string): void {
  if (!condition) failures.push(`${name}: ${detail}`)
}

function scenario(name: string, body: () => void): void {
  // Each scenario tunes the config, so restore defaults before the next one. Through
  // the helper, because a plain assign would replace the `kite` alias with a detached
  // copy and every slider path would then write somewhere the simulation cannot see.
  restoreConfig(DEFAULTS)
  console.log(`\n${name}`)
  body()
}

// ---------------------------------------------------------------------------

scenario('steady flight settles and stays finite', () => {
  const world = new World()
  const samples = run(world, 60)

  const bad = samples.findIndex((s) => !finite(s))
  check('finiteness', bad < 0, `state went non-finite at t=${(bad * DT).toFixed(2)}s`)

  const settled = last(samples, 10)
  const elevation = mean(settled.map((s) => s.elevation))
  const swing = Math.max(...settled.map((s) => s.elevation)) -
    Math.min(...settled.map((s) => s.elevation))
  const peakSpeed = Math.max(...samples.map((s) => s.speed))

  check('elevation', elevation > 20 && elevation < 75, `${elevation.toFixed(1)} deg, want 20-75`)
  check('stability', swing < 45, `still swinging ${swing.toFixed(1)} deg after settling`)
  check('integration', peakSpeed < 120, `peak speed ${peakSpeed.toFixed(1)} m/s`)
  check('crashes', world.stats.crashes === 0, `${world.stats.crashes} crashes with no input`)

  console.log(`  elevation   ${elevation.toFixed(1)} deg (swing ${swing.toFixed(1)})`)
  console.log(`  altitude    ${mean(settled.map((s) => s.altitude)).toFixed(1)} m`)
  console.log(`  tension     ${mean(settled.map((s) => s.tension)).toFixed(1)} N`)
  console.log(`  peak speed  ${peakSpeed.toFixed(1)} m/s`)
})

scenario('letting line out gains height', () => {
  const world = new World()
  run(world, 40)
  const before = mean(last(run(world, 5), 5).map((s) => s.altitude))

  // Reel out to roughly double the line, then let it settle again.
  run(world, 6, REEL_OUT)
  const after = mean(last(run(world, 40), 10).map((s) => s.altitude))

  check('altitude gain', after > before + 5, `${before.toFixed(1)} m -> ${after.toFixed(1)} m`)
  console.log(`  line        30.0 m -> ${config.line.length.toFixed(1)} m`)
  console.log(`  altitude    ${before.toFixed(1)} m -> ${after.toFixed(1)} m`)
})

scenario('a two-handed tug loads the line', () => {
  const world = new World()
  const settled = last(run(world, 45), 5)
  const baseline = mean(settled.map((s) => s.tension))

  const tug = run(world, 0.5, PULL)
  const peak = Math.max(...tug.map((s) => s.tension))

  check('tension spike', peak > baseline * 1.3, `${baseline.toFixed(1)} N -> peak ${peak.toFixed(1)} N`)
  console.log(`  tension     ${baseline.toFixed(1)} N -> peak ${peak.toFixed(1)} N`)
})

scenario('losing the wind drops the kite, and it recovers', () => {
  const world = new World()
  const flying = mean(last(run(world, 45), 5).map((s) => s.altitude))

  config.wind.base = 0.4
  const dying = run(world, 20)
  const dropped = mean(last(dying, 3).map((s) => s.altitude))
  const rollWander = Math.max(...dying.map((s) => Math.abs(s.roll)))

  config.wind.base = DEFAULTS.wind.base
  const recovered = mean(last(run(world, 40), 5).map((s) => s.altitude))

  check('drops', dropped < flying * 0.6, `${flying.toFixed(1)} m -> ${dropped.toFixed(1)} m`)
  check('recovers', recovered > flying * 0.7, `only regained ${recovered.toFixed(1)} m of ${flying.toFixed(1)} m`)
  check('roll wanders', rollWander > 2, `roll stayed at ${rollWander.toFixed(1)} deg in dead air`)

  console.log(`  altitude    ${flying.toFixed(1)} m -> ${dropped.toFixed(1)} m -> ${recovered.toFixed(1)} m`)
  console.log(`  roll wander ${rollWander.toFixed(1)} deg`)
})

scenario('a violent line length change does not blow up', () => {
  // Reeling is rate-limited, but the tuning panel can set line length instantly, and a
  // large jump puts a huge extension on the spring. Unclamped, that integrated to
  // infinity in a single step and left the whole simulation stuck at NaN.
  config.line.length = 80
  const world = new World()
  run(world, 40)

  config.line.length = 10
  const shock = run(world, 25)

  const bad = shock.findIndex((s) => !finite(s))
  check('finiteness', bad < 0, `state went non-finite at t=${(bad * DT).toFixed(2)}s`)

  const peak = Math.max(...shock.map((s) => s.speed))
  const settled = mean(last(shock, 5).map((s) => s.altitude))

  check('bounded', peak < 95, `peak speed ${peak.toFixed(1)} m/s`)
  // Not asserting it flies again. A kite dumped on the sand stays there until someone
  // walks over and picks it up — that is what the relaunch key is for — so the useful
  // assertion is that the state stays sane, not that it recovers by itself.
  const settledSpin = Math.abs(last(shock, 3).map((s) => s.roll).reduce((a, b) => a + b, 0))
  check('settles', Number.isFinite(settled) && Number.isFinite(settledSpin), 'state went non-finite')

  console.log(`  peak speed  ${peak.toFixed(1)} m/s`)
  console.log(`  altitude    ${settled.toFixed(1)} m on a 10 m line`)
})

scenario('pitch does not flip-flop', () => {
  // The pitch spring's stiffness scales with dynamic pressure, so a fixed damping
  // coefficient is only right at one wind speed. The original 0.9 worked out to a
  // damping ratio of about 0.24, and at 10 m/s that rang at roughly 12 Hz *with no
  // disturbance at all* — 36 direction changes a second, over a 22 degree swing.
  // Expressing damping as a fraction of critical instead holds it steady at any wind.
  config.wind.base = 10
  const world = new World()
  run(world, 45)

  const reversalsPerSecond = (samples: Sample[], pick: (s: Sample) => number) => {
    let n = 0
    for (let i = 2; i < samples.length; i++) {
      const before = pick(samples[i - 1]) - pick(samples[i - 2])
      const after = pick(samples[i]) - pick(samples[i - 1])
      if (before !== 0 && after !== 0 && Math.sign(before) !== Math.sign(after)) n++
    }
    return n / (samples.length / HZ)
  }

  const steady = run(world, 3)
  const steadyPitch = reversalsPerSecond(steady, (s) => s.alpha)
  check('steady pitch', steadyPitch < 5, `${steadyPitch.toFixed(1)} reversals/s in steady flight`)

  // Adjusting the bridle in flight is the sharpest disturbance available: it moves the
  // trim target instantly.
  config.kite.bridleLower = 0.45
  const settling = run(world, 3)
  const jumpPitch = reversalsPerSecond(settling, (s) => s.alpha)
  const jumpRoll = reversalsPerSecond(settling, (s) => s.roll)

  check('pitch settles', jumpPitch < 5, `${jumpPitch.toFixed(1)} reversals/s after a bridle change`)
  check('roll settles', jumpRoll < 5, `${jumpRoll.toFixed(1)} reversals/s after a bridle change`)

  console.log(`  steady      ${steadyPitch.toFixed(1)} pitch reversals/s`)
  console.log(`  after jump  ${jumpPitch.toFixed(1)} pitch, ${jumpRoll.toFixed(1)} roll reversals/s`)
})

// ---------------------------------------------------------------------------

if (failures.length) {
  console.error('\nFAIL')
  for (const message of failures) console.error(`  - ${message}`)
  process.exit(1)
}
console.log('\nPASS')
