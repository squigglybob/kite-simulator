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
 * Cumulus outline.
 *
 * Built as a per-column span between a top profile and a bottom profile rather than as
 * stamped ellipses, because stamped shapes that overrun the sprite get clipped square
 * at the edges. Every lump is inset so the silhouette tapers to nothing before the
 * boundary.
 *
 * The base is *near* flat, as a real cumulus base is, but not dead level — a few
 * shallow sags hang below the baseline so it undulates. The shaded underside follows
 * that bottom profile at a proportional thickness rather than being cut off at a fixed
 * row, which is what stops its edges going stair-steppy where the cloud thins out.
 */
function shapeSprite(shape: number, widthPx: number): HTMLCanvasElement {
  const heightPx = Math.max(4, Math.round(widthPx * 0.5))
  return getSprite(`cloud:${shape}:${widthPx}`, widthPx, heightPx, (ctx, w, h) => {
    const random = mulberry32(shape * 7717 + 13)

    // --- Top profile: rounded lumps piled up ---------------------------------
    const lumps: { cx: number; rx: number; ry: number }[] = []
    const count = 3 + Math.floor(random() * 3)
    for (let i = 0; i < count; i++) {
      const rx = w * (0.16 + random() * 0.12)
      const ry = h * (0.52 + random() * 0.45)
      // Positioned within [rx, w - rx] so the lump cannot run off the edge.
      const spread = Math.max(0, w - 2 * rx)
      const cx = rx + spread * ((i + 0.5) / count + (random() - 0.5) * 0.22)
      lumps.push({ cx: Math.min(Math.max(cx, rx), w - rx), rx, ry })
    }
    // A broad shallow lump ties the others into one mass and closes the silhouette
    // smoothly at both ends.
    lumps.push({ cx: w * 0.5, rx: w * 0.5, ry: h * 0.42 })

    // --- Bottom profile: a baseline with a few sags hanging below it ----------
    const baseline = h * 0.86
    const maxSag = h - baseline
    const sags: { cx: number; rx: number; depth: number }[] = []
    const sagCount = 2 + Math.floor(random() * 2)
    for (let i = 0; i < sagCount; i++) {
      sags.push({
        cx: w * ((i + 0.5) / sagCount + (random() - 0.5) * 0.3),
        rx: w * (0.14 + random() * 0.2),
        depth: maxSag * (0.45 + random() * 0.55),
      })
    }

    const cornerRadius = Math.min(w * 0.14, h * 0.45)

    for (let x = 0; x < w; x++) {
      const px = x + 0.5

      let top = h
      for (const lump of lumps) {
        const dx = (px - lump.cx) / lump.rx
        if (dx <= -1 || dx >= 1) continue
        top = Math.min(top, h - lump.ry * Math.sqrt(1 - dx * dx))
      }

      let bottom = baseline
      for (const sag of sags) {
        const dx = (px - sag.cx) / sag.rx
        if (dx <= -1 || dx >= 1) continue
        bottom = Math.max(bottom, baseline + sag.depth * Math.sqrt(1 - dx * dx))
      }

      // Round off the bottom corners: within `cornerRadius` of either end the base
      // lifts along a circular arc.
      const edge = Math.min(px, w - px)
      if (edge < cornerRadius) {
        const inset = cornerRadius - edge
        const lift = cornerRadius - Math.sqrt(Math.max(0, cornerRadius * cornerRadius - inset * inset))
        bottom = Math.min(bottom, h - lift)
      }

      const y0 = Math.round(top)
      const y1 = Math.round(Math.min(bottom, h))
      const column = y1 - y0
      if (column <= 0) continue

      ctx.fillStyle = C.cloud
      ctx.fillRect(x, y0, 1, column)

      // Underside shading, thickness proportional to the column so it tapers away
      // with the cloud instead of ending on a hard horizontal line.
      if (column >= 3) {
        const shade = Math.max(1, Math.round(column * 0.32))
        ctx.fillStyle = C.cloudShade
        ctx.fillRect(x, y1 - shade, 1, shade)
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
