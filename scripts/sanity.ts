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
import { config } from '../src/sim/config'
import type { InputState } from '../src/input/keys'

const HZ = 240
const DT = 1 / HZ
const DEG = 180 / Math.PI

const NONE: InputState = { left: false, right: false, reelIn: false, reelOut: false }
const PULL: InputState = { left: true, right: true, reelIn: false, reelOut: false }
const REEL_OUT: InputState = { left: false, right: false, reelIn: false, reelOut: true }

const DEFAULTS = structuredClone(config)

interface Sample {
  altitude: number
  elevation: number
  tension: number
  speed: number
  alpha: number
  roll: number
}

function sample(world: World): Sample {
  const { pos, vel, diag, roll } = world.kite
  return {
    altitude: pos.y,
    elevation: diag.elevation * DEG,
    tension: diag.line.tension,
    speed: Math.hypot(vel.x, vel.y, vel.z),
    alpha: diag.alpha * DEG,
    roll: roll * DEG,
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
  // Each scenario tunes the config, so restore defaults before the next one.
  Object.assign(config, structuredClone(DEFAULTS))
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

// ---------------------------------------------------------------------------

if (failures.length) {
  console.error('\nFAIL')
  for (const message of failures) console.error(`  - ${message}`)
  process.exit(1)
}
console.log('\nPASS')
