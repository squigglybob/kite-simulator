export interface Vec3 {
  x: number
  y: number
  z: number
}

export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z })

export const add = (a: Vec3, b: Vec3): Vec3 => v3(a.x + b.x, a.y + b.y, a.z + b.z)
export const sub = (a: Vec3, b: Vec3): Vec3 => v3(a.x - b.x, a.y - b.y, a.z - b.z)
export const scale = (a: Vec3, s: number): Vec3 => v3(a.x * s, a.y * s, a.z * s)
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z

export const cross = (a: Vec3, b: Vec3): Vec3 =>
  v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x)

export const lengthSq = (a: Vec3): number => dot(a, a)
export const length = (a: Vec3): number => Math.sqrt(dot(a, a))

export function normalize(a: Vec3): Vec3 {
  const len = length(a)
  return len > 1e-9 ? scale(a, 1 / len) : v3()
}

/** Accumulate `b * s` into `a`, in place. Used on the hot path to avoid churn. */
export function addScaledInPlace(a: Vec3, b: Vec3, s: number): void {
  a.x += b.x * s
  a.y += b.y * s
  a.z += b.z * s
}

export const copy = (a: Vec3): Vec3 => v3(a.x, a.y, a.z)

/** Rotate `v` about a unit `axis` by `angle` radians (Rodrigues' rotation formula). */
export function rotateAbout(v: Vec3, axis: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const k = dot(axis, v) * (1 - c)
  return v3(
    v.x * c + (axis.y * v.z - axis.z * v.y) * s + axis.x * k,
    v.y * c + (axis.z * v.x - axis.x * v.z) * s + axis.y * k,
    v.z * c + (axis.x * v.y - axis.y * v.x) * s + axis.z * k,
  )
}
