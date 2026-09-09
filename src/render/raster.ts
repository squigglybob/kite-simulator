/**
 * Hard-edged pixel rasterisation.
 *
 * Canvas path strokes and fills are anti-aliased, which quietly ruins pixel art — a
 * one-pixel line comes out as two grey ones. Everything that would otherwise use
 * `ctx.stroke` or `ctx.fill` goes through here instead, so every edge lands on exactly
 * one pixel of exactly one colour.
 */

export interface Point {
  x: number
  y: number
}

/** Bresenham line. `thickness` draws a square brush of that size at each step. */
export function pixelLine(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: string,
  thickness = 1,
): void {
  let x = Math.round(x0)
  let y = Math.round(y0)
  const ex = Math.round(x1)
  const ey = Math.round(y1)

  const dx = Math.abs(ex - x)
  const dy = -Math.abs(ey - y)
  const sx = x < ex ? 1 : -1
  const sy = y < ey ? 1 : -1
  let error = dx + dy

  const offset = Math.floor(thickness / 2)
  ctx.fillStyle = color

  // Bounded so a pathological call cannot lock the frame.
  for (let guard = 0; guard < 4096; guard++) {
    ctx.fillRect(x - offset, y - offset, thickness, thickness)
    if (x === ex && y === ey) break
    const e2 = 2 * error
    if (e2 >= dy) {
      error += dy
      x += sx
    }
    if (e2 <= dx) {
      error += dx
      y += sy
    }
  }
}

/** Polyline through a list of points. */
export function pixelPath(
  ctx: CanvasRenderingContext2D,
  points: readonly Point[],
  color: string,
  thickness = 1,
): void {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    pixelLine(ctx, a.x, a.y, b.x, b.y, color, thickness)
  }
}

/**
 * Scanline fill of a simple polygon. Used for the kite, whose outline is the projection
 * of its four corners and so changes shape every frame — there is nothing to cache.
 */
export function fillPolygon(
  ctx: CanvasRenderingContext2D,
  points: readonly Point[],
  color: string,
): void {
  if (points.length < 3) return

  let minY = Infinity
  let maxY = -Infinity
  for (const p of points) {
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }

  const first = Math.max(Math.round(minY), 0)
  const lastRow = Math.min(Math.round(maxY), ctx.canvas.height - 1)
  if (lastRow < first) return

  ctx.fillStyle = color
  const crossings: number[] = []

  for (let y = first; y <= lastRow; y++) {
    // Sample at pixel centres so edges land predictably.
    const scan = y + 0.5
    crossings.length = 0

    for (let i = 0; i < points.length; i++) {
      const a = points[i]
      const b = points[(i + 1) % points.length]
      if (a.y === b.y) continue
      if (scan < Math.min(a.y, b.y) || scan >= Math.max(a.y, b.y)) continue
      crossings.push(a.x + ((scan - a.y) / (b.y - a.y)) * (b.x - a.x))
    }

    if (crossings.length < 2) continue
    crossings.sort((p, q) => p - q)

    for (let i = 0; i + 1 < crossings.length; i += 2) {
      const x0 = Math.round(crossings[i])
      const x1 = Math.round(crossings[i + 1])
      if (x1 > x0) ctx.fillRect(x0, y, x1 - x0, 1)
      else ctx.fillRect(x0, y, 1, 1)
    }
  }
}

/** Hard-edged filled ellipse. The building block for cloud shapes. */
export function fillEllipse(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  color: string,
): void {
  if (rx <= 0 || ry <= 0) return
  ctx.fillStyle = color
  const top = Math.round(cy - ry)
  const bottom = Math.round(cy + ry)
  for (let y = top; y <= bottom; y++) {
    const dy = (y + 0.5 - cy) / ry
    if (dy < -1 || dy > 1) continue
    const halfWidth = rx * Math.sqrt(1 - dy * dy)
    const x0 = Math.round(cx - halfWidth)
    const x1 = Math.round(cx + halfWidth)
    if (x1 > x0) ctx.fillRect(x0, y, x1 - x0, 1)
  }
}
