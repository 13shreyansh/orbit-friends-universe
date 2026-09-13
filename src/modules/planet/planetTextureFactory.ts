import * as THREE from 'three'
import type { PlanetVisualConfig } from '../../product/contracts'
import { planetStyleModule } from './style/planetStyleModule'

type Rgb = [number, number, number]

export interface PlanetSurfaceMaps {
  colorMap: THREE.CanvasTexture
  bumpMap: THREE.CanvasTexture
  roughnessMap: THREE.CanvasTexture
  emissiveMap: THREE.CanvasTexture
}

function clamp(value: number, minimum = 0, maximum = 1) {
  return Math.max(minimum, Math.min(maximum, value))
}

function smooth(value: number) {
  return value * value * (3 - 2 * value)
}

function mix(left: number, right: number, amount: number) {
  return left + (right - left) * amount
}

function mixRgb(left: Rgb, right: Rgb, amount: number): Rgb {
  return [
    mix(left[0], right[0], amount),
    mix(left[1], right[1], amount),
    mix(left[2], right[2], amount),
  ]
}

function colorToRgb(value: string): Rgb {
  const color = new THREE.Color(value)
  return [color.r * 255, color.g * 255, color.b * 255]
}

function hash3(x: number, y: number, z: number, seed: number) {
  let value = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 2147483647) + Math.imul(seed, 1274126177)
  value = Math.imul(value ^ (value >>> 13), 1274126177)
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295
}

function valueNoise3(x: number, y: number, z: number, seed: number) {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const z0 = Math.floor(z)
  const tx = smooth(x - x0)
  const ty = smooth(y - y0)
  const tz = smooth(z - z0)
  const sample = (dx: number, dy: number, dz: number) => hash3(x0 + dx, y0 + dy, z0 + dz, seed)
  const x00 = mix(sample(0, 0, 0), sample(1, 0, 0), tx)
  const x10 = mix(sample(0, 1, 0), sample(1, 1, 0), tx)
  const x01 = mix(sample(0, 0, 1), sample(1, 0, 1), tx)
  const x11 = mix(sample(0, 1, 1), sample(1, 1, 1), tx)
  return mix(mix(x00, x10, ty), mix(x01, x11, ty), tz)
}

function fractalNoise(x: number, y: number, z: number, seed: number, octaves = 5) {
  let frequency = 1
  let amplitude = 0.55
  let total = 0
  let weight = 0
  for (let octave = 0; octave < octaves; octave++) {
    total += valueNoise3(x * frequency, y * frequency, z * frequency, seed + octave * 97) * amplitude
    weight += amplitude
    frequency *= 2.03
    amplitude *= 0.5
  }
  return total / weight
}

function createTexture(canvas: HTMLCanvasElement, color = false) {
  const texture = new THREE.CanvasTexture(canvas)
  if (color) texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.anisotropy = 8
  texture.needsUpdate = true
  return texture
}

export function createPlanetSurfaceMaps(config: PlanetVisualConfig, width = 768, maturity = 0): PlanetSurfaceMaps {
  const height = Math.round(width / 2)
  const colorCanvas = document.createElement('canvas')
  const bumpCanvas = document.createElement('canvas')
  const roughnessCanvas = document.createElement('canvas')
  const emissiveCanvas = document.createElement('canvas')
  colorCanvas.width = bumpCanvas.width = roughnessCanvas.width = emissiveCanvas.width = width
  colorCanvas.height = bumpCanvas.height = roughnessCanvas.height = emissiveCanvas.height = height
  const colorContext = colorCanvas.getContext('2d')
  const bumpContext = bumpCanvas.getContext('2d')
  const roughnessContext = roughnessCanvas.getContext('2d')
  const emissiveContext = emissiveCanvas.getContext('2d')
  if (!colorContext || !bumpContext || !roughnessContext || !emissiveContext) {
    return {
      colorMap: createTexture(colorCanvas, true),
      bumpMap: createTexture(bumpCanvas),
      roughnessMap: createTexture(roughnessCanvas),
      emissiveMap: createTexture(emissiveCanvas),
    }
  }

  const colorImage = colorContext.createImageData(width, height)
  const bumpImage = bumpContext.createImageData(width, height)
  const roughnessImage = roughnessContext.createImageData(width, height)
  const emissiveImage = emissiveContext.createImageData(width, height)
  const style = planetStyleModule.resolve(config)
  const palette = style.surface.palette
  const tint = colorToRgb(config.palette.surface)
  const isVolcanic = config.archetype === 'volcanic'
  const isPersonalityWorld = config.generationMode === 'personality'
  const seaLevel = isVolcanic
    ? 0.235 + config.oceanLevel * 0.075
    : 0.43 + config.oceanLevel * 0.2
  const ecologyMaturity = clamp(maturity)

  for (let py = 0; py < height; py++) {
    const latitude = (py / (height - 1) - 0.5) * Math.PI
    const polar = Math.abs(Math.sin(latitude))
    const cosLatitude = Math.cos(latitude)
    for (let px = 0; px < width; px++) {
      const longitude = (px / width) * Math.PI * 2
      const sx = Math.cos(longitude) * cosLatitude
      const sy = Math.sin(latitude)
      const sz = Math.sin(longitude) * cosLatitude
      const continental = fractalNoise(sx * 1.72 + 4.3, sy * 1.72 - 2.1, sz * 1.72 + 7.4, config.seed, 5)
      const detail = fractalNoise(sx * 6.8 - 5.7, sy * 6.8 + 9.1, sz * 6.8, config.seed + 211, 4)
      const moisture = fractalNoise(sx * 3.6 + 12.4, sy * 3.6, sz * 3.6 - 8.2, config.seed + 487, 4)
      const elevation = continental * 0.78 + detail * 0.22
      const altitude = clamp((elevation - seaLevel) / Math.max(0.08, 1 - seaLevel))
      const temperature = clamp(1 - polar * 1.18 - altitude * 0.38)
      const isOcean = elevation < seaLevel
      let color: Rgb
      let bump = 0
      let roughness = 0
      let emission = 0

      if (isOcean) {
        const depth = clamp((seaLevel - elevation) * 8)
        const wave = detail * 0.09 + Math.sin(longitude * 44 + latitude * 19) * 0.018
        color = mixRgb(palette.oceanShallow, palette.oceanDeep, clamp(depth + wave))
        color = mixRgb(color, tint, 0.12 + style.surface.tintMix * 0.38)
        bump = 42 + wave * 48
        roughness = 42 + detail * 28
        if (polar > 0.82) {
          color = mixRgb(color, [205, 221, 228], clamp((polar - 0.82) * 4.8))
          roughness = 180
        }
      } else {
        const coast = clamp((elevation - seaLevel) / 0.045)
        const vegetation = clamp((moisture - 0.38) * 2.4) * clamp(temperature * 1.5) * (0.16 + ecologyMaturity * 0.84)
        if (coast < 1) color = mixRgb(palette.coast, palette.lowland, coast)
        else if (altitude > 0.67) color = mixRgb(palette.highland, palette.peak, clamp((altitude - 0.67) * 3))
        else color = mixRgb(palette.lowland, palette.forest, vegetation)
        color = mixRgb(color, tint, style.surface.tintMix)
        const grain = (detail - 0.5) * 26
        color = [color[0] + grain, color[1] + grain, color[2] + grain]
        bump = 92 + altitude * 138 + detail * 26
        roughness = 180 + detail * 58

        if (style.surface.lava.enabled) {
          const threshold = style.surface.lava.threshold
          const faultNoise = fractalNoise(
            sx * 13.5 + 2.7,
            sy * 13.5 - 6.4,
            sz * 13.5 + 4.1,
            config.seed + 1223,
            4,
          )
          const fractureDistance = Math.abs(faultNoise - 0.5)
          const fissure = clamp((0.062 - fractureDistance) * 18)
          const vent = detail > threshold && moisture < 0.58
            ? clamp((detail - threshold) * 7)
            : 0
          const lava = clamp(Math.max(fissure * (0.48 + detail * 0.7), vent))
          color = mixRgb(color, style.surface.lava.color, lava)
          bump -= lava * 58
          roughness -= lava * 110
          emission = lava
        }
        if (style.surface.crystal.enabled && detail > style.surface.crystal.threshold) {
          color = mixRgb(color, style.surface.crystal.color, clamp((detail - style.surface.crystal.threshold) * 3))
          roughness -= 70
        }
      }

      if (!style.surface.lava.enabled && !style.surface.crystal.enabled) {
        color = isOcean
          ? mixRgb([13, 43, 58], color, isPersonalityWorld ? 0.86 : 0.48 + ecologyMaturity * 0.52)
          : mixRgb([103, 91, 74], color, isPersonalityWorld ? 0.9 : 0.18 + ecologyMaturity * 0.82)
      }
      if (!isOcean) bump *= 0.72 + ecologyMaturity * 0.28

      const index = (py * width + px) * 4
      colorImage.data[index] = clamp(color[0], 0, 255)
      colorImage.data[index + 1] = clamp(color[1], 0, 255)
      colorImage.data[index + 2] = clamp(color[2], 0, 255)
      colorImage.data[index + 3] = 255
      bumpImage.data[index] = bumpImage.data[index + 1] = bumpImage.data[index + 2] = clamp(bump, 0, 255)
      bumpImage.data[index + 3] = 255
      roughnessImage.data[index] = roughnessImage.data[index + 1] = roughnessImage.data[index + 2] = clamp(roughness, 0, 255)
      roughnessImage.data[index + 3] = 255
      emissiveImage.data[index] = emissiveImage.data[index + 1] = emissiveImage.data[index + 2] = emission * 255
      emissiveImage.data[index + 3] = 255
    }
  }

  colorContext.putImageData(colorImage, 0, 0)
  bumpContext.putImageData(bumpImage, 0, 0)
  roughnessContext.putImageData(roughnessImage, 0, 0)
  emissiveContext.putImageData(emissiveImage, 0, 0)
  return {
    colorMap: createTexture(colorCanvas, true),
    bumpMap: createTexture(bumpCanvas),
    roughnessMap: createTexture(roughnessCanvas),
    emissiveMap: createTexture(emissiveCanvas),
  }
}

export function createCloudTexture(config: PlanetVisualConfig, width = 512, maturity = 0) {
  const height = Math.round(width / 2)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) return createTexture(canvas, true)
  const image = context.createImageData(width, height)
  const style = planetStyleModule.resolve(config)
  const threshold = style.clouds.threshold + (1 - clamp(maturity)) * 0.06
  const cloudColor: Rgb = config.archetype === 'volcanic' ? [126, 108, 113] : [225, 238, 245]
  for (let py = 0; py < height; py++) {
    const latitude = (py / (height - 1) - 0.5) * Math.PI
    const cosLatitude = Math.cos(latitude)
    for (let px = 0; px < width; px++) {
      const longitude = (px / width) * Math.PI * 2
      const sx = Math.cos(longitude) * cosLatitude
      const sy = Math.sin(latitude)
      const sz = Math.sin(longitude) * cosLatitude
      const noise = fractalNoise(sx * 4.5, sy * 4.5, sz * 4.5, config.seed + 701, 5)
      const wisps = fractalNoise(sx * 11 + 3, sy * 6, sz * 11 - 2, config.seed + 907, 3)
      const alpha = clamp((noise * 0.8 + wisps * 0.2 - threshold) * 5.2)
      const index = (py * width + px) * 4
      image.data[index] = cloudColor[0]
      image.data[index + 1] = cloudColor[1]
      image.data[index + 2] = cloudColor[2]
      image.data[index + 3] = alpha * 210
    }
  }
  context.putImageData(image, 0, 0)
  return createTexture(canvas, true)
}
