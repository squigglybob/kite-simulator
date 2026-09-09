import { hash1, mulberry32 } from '../../core/rng'
import { config } from '../../sim/config'
import { v3 } from '../../core/vec3'
import { C } from '../palette'
import { getSprite } from '../spritecache'
import type { Camera } from '../camera'

/**
 * Drifting cumulus.
 *
 * The clouds travel downwind at a fraction of the wind speed, which quietly doubles as
 * a wind indicator — the scenery itself shows which way and how hard it is blowing.
 * They recede toward the vanishing point because the camera looks downwind, which is
 * what you would actually see standing behind a kite flyer.
 */

const COUNT = 14
const NEAR_Z = 90
const FAR_Z = 900
/** Clouds are pushed along by the wind, but slower than the air at kite height. */
const DRIFT_FRACTION = 0.55

/**
 * Rendered widths snap to this many pixels. Without it every cloud would want a
 * freshly rasterised sprite on almost every frame as it drifts, which allocates a
 * canvas per cloud per frame and grows the cache without bound.
 */
const WIDTH_STEP = 8
const MAX_WIDTH = 240

interface Cloud {
  x: number
  y: number
  z: number
  /** Width in metres. */
  size: number
  shape: number
}

/**
 * Cumulus outline: a flat base with rounded lumps piled on it, built as a per-column
 * height so the silhouette is genuinely round rather than a stack of boxes.
 */
function shapeSprite(shape: number, widthPx: number): HTMLCanvasElement {
  const heightPx = Math.max(3, Math.round(widthPx * 0.5))
  return getSprite(`cloud:${shape}:${widthPx}`, widthPx, heightPx, (ctx, w, h) => {
    const random = mulberry32(shape * 7717 + 13)

    const bumps: { x: number; r: number; h: number }[] = []
    const count = 3 + Math.floor(random() * 3)
    for (let i = 0; i < count; i++) {
      bumps.push({
        x: w * ((i + 0.5) / count + (random() - 0.5) * 0.16),
        r: w * (0.2 + random() * 0.22),
        h: h * (0.55 + random() * 0.45),
      })
    }
    // A long shallow bump ties the others together into one mass.
    bumps.push({ x: w * 0.5, r: w * 0.52, h: h * 0.5 })

    const shadeFrom = h * 0.7
    for (let x = 0; x < w; x++) {
      let top = h
      for (const bump of bumps) {
        const dx = (x + 0.5 - bump.x) / bump.r
        if (dx <= -1 || dx >= 1) continue
        top = Math.min(top, h - bump.h * Math.sqrt(1 - dx * dx))
      }
      const y = Math.round(top)
      if (y >= h) continue

      ctx.fillStyle = C.cloud
      ctx.fillRect(x, y, 1, h - y)
      if (h > shadeFrom) {
        ctx.fillStyle = C.cloudShade
        const shadeTop = Math.max(y, Math.round(shadeFrom))
        ctx.fillRect(x, shadeTop, 1, h - shadeTop)
      }
    }
  })
}

export class CloudField {
  private readonly clouds: Cloud[] = []

  constructor(seed = 4242) {
    const random = mulberry32(seed)
    for (let i = 0; i < COUNT; i++) {
      this.clouds.push({
        x: (random() - 0.5) * 900,
        y: 55 + random() * 190,
        z: NEAR_Z + random() * (FAR_Z - NEAR_Z),
        size: 40 + random() * 90,
        shape: i,
      })
    }
  }

  update(dt: number): void {
    const drift = config.wind.base * DRIFT_FRACTION * dt
    for (const cloud of this.clouds) {
      cloud.z += drift
      if (cloud.z > FAR_Z) {
        // Recycle to the near plane with a fresh lateral position, so the sky does
        // not visibly repeat.
        cloud.z = NEAR_Z
        cloud.x = (hash1(Math.round(cloud.z + cloud.shape * 91), 3) - 0.5) * 900
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera, horizonY: number): void {
    // Far clouds first, so nearer ones overlap them correctly.
    const ordered = [...this.clouds].sort((a, b) => b.z - a.z)

    for (const cloud of ordered) {
      const p = camera.project(v3(cloud.x, cloud.y, cloud.z))
      const exact = (cloud.size * config.camera.focal * camera.zoom) / p.depth
      if (exact < 4 || exact > MAX_WIDTH) continue

      const widthPx = Math.max(WIDTH_STEP, Math.round(exact / WIDTH_STEP) * WIDTH_STEP)
      const sprite = shapeSprite(cloud.shape, widthPx)
      const x = Math.round(p.x - sprite.width / 2)
      const y = Math.round(p.y - sprite.height / 2)

      // Nothing floats below the horizon.
      if (y + sprite.height > horizonY) continue
      if (x > ctx.canvas.width || x + sprite.width < 0) continue

      ctx.drawImage(sprite, x, y)
    }
  }
}
