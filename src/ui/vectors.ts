import { C } from '../render/palette'
import { pixelLine } from '../render/raster'
import { add, scale, type Vec3 } from '../core/vec3'
import type { Camera } from '../render/camera'
import type { Kite } from '../sim/kite'

/**
 * Force-vector overlay. Draws the four forces acting on the kite in world space, so a
 * misbehaving simulation shows *which* term is wrong rather than just looking wrong.
 */

interface Arrow {
  vector: Vec3
  color: string
  /** Metres of arrow per newton (or per m/s for the wind). */
  gain: number
}

export function drawForceVectors(
  ctx: CanvasRenderingContext2D,
  kite: Kite,
  camera: Camera,
): void {
  const d = kite.diag
  const arrows: Arrow[] = [
    { vector: d.apparent, color: C.cloud, gain: 0.35 },
    { vector: d.lift, color: C.grass0, gain: 0.25 },
    { vector: d.drag, color: C.kite, gain: 0.25 },
    { vector: d.tensionForce, color: C.kiteTrim, gain: 0.25 },
  ]

  const origin = camera.project(kite.pos)

  for (const arrow of arrows) {
    const tip = camera.project(add(kite.pos, scale(arrow.vector, arrow.gain)))
    pixelLine(ctx, origin.x, origin.y, tip.x, tip.y, arrow.color)
    ctx.fillStyle = arrow.color
    ctx.fillRect(Math.round(tip.x) - 1, Math.round(tip.y) - 1, 3, 3)
  }
}
