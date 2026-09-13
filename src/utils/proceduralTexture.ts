import * as THREE from 'three'

/** A soft circular gradient, fully transparent at the edge — used for
 * nebula clouds and glow sprites. Caller passes full rgba strings so it
 * controls both color and edge falloff. */
export function createRadialGradientTexture(
  innerColor: string,
  outerColor: string,
  size = 256,
): THREE.Texture {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return new THREE.Texture()

  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  gradient.addColorStop(0, innerColor)
  gradient.addColorStop(1, outerColor)
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)

  const texture = new THREE.CanvasTexture(canvas)
  texture.needsUpdate = true
  return texture
}

/** Deterministic PRNG (mulberry32) so the same seed always produces the
 * same texture — planets don't get a new random surface every render. */
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Soft, blotchy surface variation for a planet — subtle light/dark
 * patches over a base color. Every planet uses this same recipe (so the
 * whole cosmos reads as one consistent material family) but a different
 * seed, so no two planets look identical. */
export function createPlanetSurfaceTexture(seed: number, baseColor: string, size = 256): THREE.Texture {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return new THREE.Texture()

  ctx.fillStyle = baseColor
  ctx.fillRect(0, 0, size, size)

  const random = mulberry32(Math.floor(seed * 4294967296) || 1)
  const blotchCount = 12
  for (let i = 0; i < blotchCount; i++) {
    const x = random() * size
    const y = random() * size
    const radius = size * (0.1 + random() * 0.22)
    const lightness = random() > 0.5 ? 255 : 0
    const alpha = 0.04 + random() * 0.07
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius)
    gradient.addColorStop(0, `rgba(${lightness}, ${lightness}, ${lightness}, ${alpha})`)
    gradient.addColorStop(1, `rgba(${lightness}, ${lightness}, ${lightness}, 0)`)
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, size, size)
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.needsUpdate = true
  return texture
}
