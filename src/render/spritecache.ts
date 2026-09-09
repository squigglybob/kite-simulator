/**
 * Memoised procedural sprites.
 *
 * Sprites are drawn by code rather than loaded, so anything whose shape depends only on
 * a few discrete parameters can be drawn once into an offscreen canvas and blitted
 * thereafter. The key must capture every parameter that changes the pixels — including
 * the size, since a procedural sprite is *redrawn* at each size rather than scaled.
 */

/**
 * Bounded, so a sprite parameterised by a continuously varying quantity (a drifting
 * cloud's pixel width, say) cannot grow the cache until the browser is holding hundreds
 * of megabytes of canvases. Map preserves insertion order, so evicting the first key is
 * a least-recently-inserted eviction.
 */
const MAX_ENTRIES = 400

const cache = new Map<string, HTMLCanvasElement>()

export function getSprite(
  key: string,
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D, width: number, height: number) => void,
): HTMLCanvasElement {
  const existing = cache.get(key)
  if (existing) return existing

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error(`2D context unavailable for sprite "${key}"`)
  ctx.imageSmoothingEnabled = false
  draw(ctx, canvas.width, canvas.height)

  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(key, canvas)
  return canvas
}

/** Frees every cached sprite. Called when the palette or a shape parameter changes. */
export function clearSpriteCache(): void {
  cache.clear()
}
