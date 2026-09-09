import { config } from '../sim/config'
import { BASE_W } from './screen'
import type { Vec3 } from '../core/vec3'

/**
 * Perspective camera, fixed in direction, zooming in discrete steps.
 *
 * Two things make this work with pixel art. First, zoom snaps to a fixed set of levels
 * rather than varying continuously — procedural sprites redraw natively at each level,
 * which they cannot do at an arbitrary scale. Second, the flyer's feet are *pinned* to
 * a fixed screen row and zoom scales about that point, which satisfies both "fit the
 * kite" and "keep the person at the bottom" with one mechanism; the horizon rises
 * toward the flyer as you zoom out, which is what you would actually see.
 *
 * The camera also sits behind the flyer rather than on them. That is deliberate: a kite
 * at 90 degrees of azimuth sits at world z = 0, but is still `dist` metres deep in
 * camera space, so it projects to a finite screen position instead of infinity.
 */

export const ZOOM_LEVELS: readonly number[] = [1, 0.75, 0.5, 0.35, 0.25, 0.18]

/** Screen row the flyer's feet are pinned to. */
export const FEET_Y = 236

/** Kite must stay this far inside the buffer edges. */
const MARGIN_X = 36
const MARGIN_TOP = 18
/** Extra clearance demanded before zooming back in, so the level cannot flicker. */
const HYSTERESIS = 26

export interface Projected {
  x: number
  y: number
  /** Depth in camera space, metres. Used for sprite scaling and draw order. */
  depth: number
}

export class Camera {
  private index = 0

  get zoom(): number {
    return ZOOM_LEVELS[this.index]
  }

  get zoomIndex(): number {
    return this.index
  }

  /** Vertical offset of the flyer's feet from eye level, in unzoomed screen units. */
  private get feetOffset(): number {
    const { eyeHeight, dist, focal } = config.camera
    return (-eyeHeight / dist) * focal
  }

  /** Screen row of the true horizon at the current zoom. */
  get horizonY(): number {
    return FEET_Y + this.feetOffset * this.zoom
  }

  projectAt(pos: Vec3, zoom: number): Projected {
    const { eyeHeight, dist, focal } = config.camera
    // Clamped so geometry level with or behind the camera cannot divide by zero.
    const depth = Math.max(pos.z + dist, 0.5)
    const ndcX = ((pos.x / depth) * focal)
    const ndcY = (((pos.y - eyeHeight) / depth) * focal)
    return {
      x: BASE_W / 2 + ndcX * zoom,
      y: FEET_Y - (ndcY - this.feetOffset) * zoom,
      depth,
    }
  }

  project(pos: Vec3): Projected {
    return this.projectAt(pos, this.zoom)
  }

  private fits(pos: Vec3, zoom: number, inset: number): boolean {
    const p = this.projectAt(pos, zoom)
    return (
      p.x > MARGIN_X + inset &&
      p.x < BASE_W - MARGIN_X - inset &&
      p.y > MARGIN_TOP + inset &&
      p.y < FEET_Y
    )
  }

  /** Pick the largest zoom level that keeps the kite comfortably on screen. */
  update(kitePos: Vec3): void {
    while (
      this.index < ZOOM_LEVELS.length - 1 &&
      !this.fits(kitePos, ZOOM_LEVELS[this.index], 0)
    ) {
      this.index++
    }
    while (
      this.index > 0 &&
      this.fits(kitePos, ZOOM_LEVELS[this.index - 1], HYSTERESIS)
    ) {
      this.index--
    }
  }
}
