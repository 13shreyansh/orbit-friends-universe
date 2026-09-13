import type { PlanetArchetype, PlanetVisualConfig } from '../../../product/contracts'
import { createPlanetPreset } from '../../../product/planetPresets'

export type PlanetGenerationMode = NonNullable<PlanetVisualConfig['generationMode']>

type GeneratedOverride = Partial<Pick<
  PlanetVisualConfig,
  | 'terrain'
  | 'roughness'
  | 'oceanLevel'
  | 'cloudDensity'
  | 'atmosphereStrength'
  | 'ring'
  | 'ringColor'
  | 'satellites'
>>

export interface PlanetGenerationRequest {
  mode: PlanetGenerationMode
  seed?: number
  archetype?: PlanetArchetype | 'auto'
  radius?: number
  preserve?: Partial<Pick<PlanetVisualConfig, 'ring' | 'satellites'>>
  overrides?: GeneratedOverride
}

type Rgb = [number, number, number]

export interface PlanetResolvedStyle {
  surface: {
    palette: {
      oceanDeep: Rgb
      oceanShallow: Rgb
      coast: Rgb
      lowland: Rgb
      forest: Rgb
      highland: Rgb
      peak: Rgb
    }
    tintMix: number
    bumpScale: number
    displacementScale: number
    displacementBias: number
    materialRoughness: number
    metalness: number
    emissive: string
    emissiveIntensity: number
    lava: { enabled: boolean; color: Rgb; threshold: number }
    crystal: { enabled: boolean; color: Rgb; threshold: number }
  }
  clouds: {
    visible: boolean
    opacity: number
    threshold: number
    rotationSpeed: number
  }
  atmosphere: {
    color: string
    strength: number
    scale: number
  }
  ring: {
    visible: boolean
    color: string
    innerRadius: number
    outerRadius: number
    opacity: number
  }
  satellite: {
    count: number
    color: string
    glowColor: string
  }
  rotationSpeed: number
}

function seededUnit(seed: number, salt: number): number {
  const value = Math.sin(seed * 12.9898 + salt * 78.233) * 43758.5453
  return value - Math.floor(value)
}

function hslToHex(hue: number, saturation: number, lightness: number): string {
  const s = saturation / 100
  const l = lightness / 100
  const chroma = (1 - Math.abs(2 * l - 1)) * s
  const section = ((hue % 360) + 360) % 360 / 60
  const intermediate = chroma * (1 - Math.abs((section % 2) - 1))
  const [red, green, blue] = section < 1 ? [chroma, intermediate, 0]
    : section < 2 ? [intermediate, chroma, 0]
      : section < 3 ? [0, chroma, intermediate]
        : section < 4 ? [0, intermediate, chroma]
          : section < 5 ? [intermediate, 0, chroma]
            : [chroma, 0, intermediate]
  const match = l - chroma / 2
  return `#${[red, green, blue].map((channel) => Math.round((channel + match) * 255).toString(16).padStart(2, '0')).join('')}`
}

const archetypes: PlanetArchetype[] = ['terran', 'oceanic', 'volcanic', 'crystalline', 'verdant']

const hueRanges: Record<PlanetArchetype, Array<[number, number]>> = {
  terran: [[18, 82], [188, 224], [258, 302]],
  oceanic: [[184, 246], [252, 278]],
  volcanic: [[0, 38], [324, 359]],
  crystalline: [[248, 326], [174, 204]],
  verdant: [[82, 172], [174, 198]],
}

const surfacePalettes: Record<PlanetArchetype, PlanetResolvedStyle['surface']['palette']> = {
  terran: {
    oceanDeep: [5, 29, 54], oceanShallow: [20, 92, 119], coast: [194, 176, 119],
    lowland: [76, 111, 66], forest: [25, 74, 52], highland: [105, 101, 79], peak: [216, 220, 207],
  },
  oceanic: {
    oceanDeep: [4, 24, 64], oceanShallow: [18, 102, 151], coast: [184, 174, 130],
    lowland: [69, 105, 84], forest: [22, 70, 63], highland: [97, 104, 91], peak: [209, 220, 218],
  },
  volcanic: {
    oceanDeep: [18, 13, 29], oceanShallow: [49, 25, 43], coast: [116, 73, 63],
    lowland: [61, 48, 52], forest: [44, 38, 42], highland: [83, 67, 67], peak: [139, 119, 106],
  },
  crystalline: {
    oceanDeep: [18, 18, 57], oceanShallow: [50, 56, 112], coast: [151, 126, 169],
    lowland: [83, 74, 128], forest: [64, 70, 116], highland: [142, 112, 159], peak: [218, 201, 225],
  },
  verdant: {
    oceanDeep: [4, 34, 53], oceanShallow: [18, 105, 119], coast: [180, 169, 112],
    lowland: [62, 123, 74], forest: [18, 82, 49], highland: [91, 106, 75], peak: [211, 220, 204],
  },
}

function generate(request: PlanetGenerationRequest): PlanetVisualConfig {
  const seed = request.seed ?? createSeed()
  const archetype = request.archetype && request.archetype !== 'auto'
    ? request.archetype
    : archetypes[Math.floor(seededUnit(seed, 0) * archetypes.length)]
  const base = createPlanetPreset(archetype, seed)
  const ranges = hueRanges[archetype]
  const range = ranges[Math.floor(seededUnit(seed, 1) * ranges.length)]
  const hue = range[0] + seededUnit(seed, 2) * (range[1] - range[0])
  const accentHue = hue + 82 + seededUnit(seed, 3) * 78
  const atmosphereHue = hue + 18 + seededUnit(seed, 4) * 42
  const jitter = (salt: number, amplitude: number) => (seededUnit(seed, salt) - 0.5) * amplitude
  const clamp01 = (value: number) => Math.max(0.04, Math.min(0.96, value))

  return {
    ...base,
    generatorVersion: 'planet-generator.v1',
    generationMode: request.mode,
    radius: request.radius ?? base.radius,
    terrain: clamp01(base.terrain + jitter(5, 0.34)),
    roughness: clamp01(base.roughness + jitter(6, 0.28)),
    oceanLevel: clamp01(base.oceanLevel + jitter(7, 0.3)),
    cloudDensity: clamp01(base.cloudDensity + jitter(8, 0.34)),
    atmosphereStrength: clamp01(0.54 + seededUnit(seed, 9) * 0.34),
    ring: request.preserve?.ring ?? (seededUnit(seed, 10) > (archetype === 'crystalline' ? 0.3 : 0.72)),
    satellites: request.preserve?.satellites ?? Math.floor(seededUnit(seed, 11) * 4),
    palette: {
      deep: hslToHex(hue + jitter(12, 18), 54 + seededUnit(seed, 13) * 20, 10 + seededUnit(seed, 14) * 8),
      surface: hslToHex(hue, 34 + seededUnit(seed, 15) * 34, 35 + seededUnit(seed, 16) * 16),
      highlight: hslToHex(accentHue, 68 + seededUnit(seed, 17) * 22, 61 + seededUnit(seed, 18) * 15),
      atmosphere: hslToHex(atmosphereHue, 58 + seededUnit(seed, 19) * 26, 64 + seededUnit(seed, 20) * 17),
    },
    ringColor: hslToHex(accentHue, 70, 70),
    ...request.overrides,
  }
}

function resolve(config: PlanetVisualConfig): PlanetResolvedStyle {
  const isVolcanic = config.archetype === 'volcanic'
  const isCrystalline = config.archetype === 'crystalline'
  const isPersonalityWorld = config.generationMode === 'personality'

  return {
    surface: {
      palette: surfacePalettes[config.archetype],
      tintMix: isPersonalityWorld ? 0.8 : config.archetype === 'terran' ? 0.16 : 0.24,
      bumpScale: 0.025 + config.terrain * 0.055,
      displacementScale: isVolcanic ? 0.105 : 0.035 + config.terrain * 0.035,
      displacementBias: isVolcanic ? -0.036 : -0.022,
      materialRoughness: 0.7 + config.roughness * 0.18,
      metalness: isCrystalline ? 0.42 : 0.08,
      emissive: isVolcanic ? '#ff4f1f' : config.palette.deep,
      emissiveIntensity: isVolcanic ? 1.65 : 0.025,
      lava: { enabled: isVolcanic, color: [255, 68, 18], threshold: 0.68 },
      crystal: { enabled: isCrystalline, color: [198, 166, 255], threshold: 0.7 },
    },
    clouds: {
      visible: config.cloudDensity > 0.08,
      opacity: 0.28 + config.cloudDensity * 0.34,
      threshold: 0.66 - config.cloudDensity * 0.2,
      rotationSpeed: 0.052,
    },
    atmosphere: {
      color: config.palette.atmosphere,
      strength: config.atmosphereStrength,
      scale: 1.035,
    },
    ring: {
      visible: config.ring,
      color: config.ringColor,
      innerRadius: config.radius * 1.25,
      outerRadius: config.radius * 1.72,
      opacity: 0.56,
    },
    satellite: {
      count: config.satellites,
      color: config.palette.highlight,
      glowColor: config.palette.atmosphere,
    },
    rotationSpeed: 0.035,
  }
}

function createSeed(): number {
  return Math.floor(Math.random() * 900000) + 10000
}

function thumbnail(config: PlanetVisualConfig): { background: string } {
  return {
    background: `radial-gradient(circle at 32% 28%, ${config.palette.highlight}, ${config.palette.surface} 38%, ${config.palette.deep} 78%)`,
  }
}

/**
 * Single public boundary for planet appearance. The generator emits stable
 * visual parameters; renderers consume only the resolved style tokens.
 */
export const planetStyleModule = {
  version: 'planet-generator.v1' as const,
  archetypes,
  createSeed,
  generate,
  resolve,
  thumbnail,
}
