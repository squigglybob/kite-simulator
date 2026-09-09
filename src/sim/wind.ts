import { createNoise3D } from 'simplex-noise'
import { config } from './config'
import { v3, type Vec3 } from '../core/vec3'

/**
 * The wind field.
 *
 * Sampled at the kite's actual position rather than globally, so the kite flies
 * *through* gust cells instead of the whole world gusting in unison. Three
 * independently seeded noise fields give the gust a direction as well as a strength,
 * which is what produces the sideways shoves that knock a kite off balance.
 */

const noiseX = createNoise3D(() => 0.11)
const noiseY = createNoise3D(() => 0.53)
const noiseZ = createNoise3D(() => 0.87)

/** Power-law wind shear. This is why letting line out gains you real wind. */
export function shearFactor(height: number): number {
  const { shear, refHeight } = config.wind
  // Clamped below so the profile does not go to zero (or blow up) at ground level.
  return Math.pow(Math.max(height, 0.5) / refHeight, shear)
}

export function windAt(pos: Vec3, time: number, out: Vec3 = v3()): Vec3 {
  const w = config.wind

  const base = w.base * shearFactor(pos.y)
  out.x = 0
  out.y = 0
  out.z = base

  // Gusts. The time axis of the noise advances independently of position, so cells
  // both drift past the kite and evolve in place.
  const s = 1 / w.gustCellSize
  const nx = pos.x * s
  const ny = pos.y * s
  const nz = pos.z * s
  const t = time * w.gustTimeScale

  out.x += noiseX(nx, ny, nz + t) * w.gustAmp
  out.y += noiseY(nx, ny, nz + t) * w.gustAmp * 0.6
  out.z += noiseZ(nx, ny, nz + t) * w.gustAmp

  // Ground turbulence, standing in for the dune wind shadow. Higher frequency and
  // fading out with height, so the air near the sand is genuinely nastier to fly in.
  if (pos.y < w.turbHeight) {
    const fade = 1 - pos.y / w.turbHeight
    const g = 1 / (w.gustCellSize * 0.22)
    const tt = time * w.gustTimeScale * 3
    const amp = w.turbAmp * fade * fade
    out.x += noiseX(pos.x * g, pos.y * g, pos.z * g + tt) * amp
    out.y += noiseY(pos.x * g, pos.y * g, pos.z * g + tt) * amp
    out.z += noiseZ(pos.x * g, pos.y * g, pos.z * g + tt) * amp
  }

  return out
}

/**
 * Lateral gradient of the wind, used to disturb the kite's roll. A gust that hits one
 * wingtip harder than the other is what starts the swing.
 */
export function lateralGustGradient(pos: Vec3, time: number, span: number): number {
  const s = 1 / config.wind.gustCellSize
  const t = time * config.wind.gustTimeScale
  const left = noiseZ((pos.x - span) * s, pos.y * s, pos.z * s + t)
  const right = noiseZ((pos.x + span) * s, pos.y * s, pos.z * s + t)
  return right - left
}
