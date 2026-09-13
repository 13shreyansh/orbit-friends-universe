import type { PlanetArchetype, PlanetVisualConfig } from '../../product/contracts'
import { createPlanetPreset } from '../../product/planetPresets'

export interface AuthoredWorldDefinition {
  id: string
  assetUrl: string
  name: { zh: string; en: string }
  description: { zh: string; en: string }
  archetype: PlanetArchetype
  seed: number
  ecologySurface: AuthoredWorldEcologySurface
}

export interface AuthoredWorldEcologySurface {
  anchorMode: 'spherical-projection'
  radiusScale: number
  altitudeScale: number
}

const worlds: AuthoredWorldDefinition[] = [
  {
    id: 'sc-rose', assetUrl: '/orbit-friends-universe/models/sc-rose.glb', archetype: 'terran', seed: 58101,
    name: { zh: 'Rose World', en: 'Rose World' },
    description: { zh: 'A gentle terrain formed by petals and rock', en: 'A gentle terrain formed by petals and rock' },
    ecologySurface: { anchorMode: 'spherical-projection', radiusScale: 0.78, altitudeScale: 0.018 },
  },
  {
    id: 'sc-duck', assetUrl: '/orbit-friends-universe/models/sc-duck.glb', archetype: 'oceanic', seed: 58102,
    name: { zh: 'Duck World', en: 'Duck World' },
    description: { zh: 'A bright world with a playful toy-like character', en: 'A bright world with a playful toy-like character' },
    ecologySurface: { anchorMode: 'spherical-projection', radiusScale: 0.8, altitudeScale: 0.02 },
  },
  {
    id: 'sc-thunderstorm', assetUrl: '/orbit-friends-universe/models/sc-thunderstorm.glb', archetype: 'oceanic', seed: 58103,
    name: { zh: 'Thunderstorm World', en: 'Thunderstorm World' },
    description: { zh: 'A world shaped by storms, clouds, and charged weather', en: 'A world shaped by storms, clouds, and charged weather' },
    ecologySurface: { anchorMode: 'spherical-projection', radiusScale: 0.81, altitudeScale: 0.022 },
  },
  {
    id: 'sc-pink-ring', assetUrl: '/orbit-friends-universe/models/sc-pink-ring.glb', archetype: 'crystalline', seed: 58104,
    name: { zh: 'Pink Ring World', en: 'Pink Ring World' },
    description: { zh: 'A dreamlike world with a soft pink ring', en: 'A dreamlike world with a soft pink ring' },
    ecologySurface: { anchorMode: 'spherical-projection', radiusScale: 0.76, altitudeScale: 0.018 },
  },
  {
    id: 'sc-oasis', assetUrl: '/orbit-friends-universe/models/sc-oasis.glb', archetype: 'verdant', seed: 58105,
    name: { zh: 'Oasis World', en: 'Oasis World' },
    description: { zh: 'A living world of forests, waterways, and a broad ring', en: 'A living world of forests, waterways, and a broad ring' },
    ecologySurface: { anchorMode: 'spherical-projection', radiusScale: 0.74, altitudeScale: 0.02 },
  },
  {
    id: 'sc-red-spider-lily', assetUrl: '/orbit-friends-universe/models/sc-red-spider-lily.glb', archetype: 'volcanic', seed: 58106,
    name: { zh: 'Red Spider Lily World', en: 'Red Spider Lily World' },
    description: { zh: 'An uncanny ecology of crimson blooms and dark terrain', en: 'An uncanny ecology of crimson blooms and dark terrain' },
    ecologySurface: { anchorMode: 'spherical-projection', radiusScale: 0.8, altitudeScale: 0.02 },
  },
  {
    id: 'sc-arid', assetUrl: '/orbit-friends-universe/models/sc-arid.glb', archetype: 'terran', seed: 58107,
    name: { zh: 'Arid World', en: 'Arid World' },
    description: { zh: 'A cracked, dormant world awaiting renewal', en: 'A cracked, dormant world awaiting renewal' },
    ecologySurface: { anchorMode: 'spherical-projection', radiusScale: 0.82, altitudeScale: 0.018 },
  },
  {
    id: 'sc-koi', assetUrl: '/orbit-friends-universe/models/sc-koi.glb', archetype: 'oceanic', seed: 58108,
    name: { zh: 'Koi World', en: 'Koi World' },
    description: { zh: 'A flowing world inspired by water and koi', en: 'A flowing world inspired by water and koi' },
    ecologySurface: { anchorMode: 'spherical-projection', radiusScale: 0.79, altitudeScale: 0.02 },
  },
  {
    id: 'sc-orange', assetUrl: '/orbit-friends-universe/models/sc-orange.glb', archetype: 'volcanic', seed: 58109,
    name: { zh: 'Amber World', en: 'Amber World' },
    description: { zh: 'A rocky world wrapped in a warm amber spectrum', en: 'A rocky world wrapped in a warm amber spectrum' },
    ecologySurface: { anchorMode: 'spherical-projection', radiusScale: 0.82, altitudeScale: 0.018 },
  },
  {
    id: 'sc-tie-dye', assetUrl: '/orbit-friends-universe/models/sc-tie-dye.glb', archetype: 'crystalline', seed: 58111,
    name: { zh: 'Tie-Dye World', en: 'Tie-Dye World' },
    description: { zh: 'A handcrafted world with flowing dyed patterns', en: 'A handcrafted world with flowing dyed patterns' },
    ecologySurface: { anchorMode: 'spherical-projection', radiusScale: 0.81, altitudeScale: 0.018 },
  },
  {
    id: 'sc-toxic', assetUrl: '/orbit-friends-universe/models/sc-toxic.glb', archetype: 'volcanic', seed: 58112,
    name: { zh: 'Toxic World', en: 'Toxic World' },
    description: { zh: 'A hazardous world of fluorescent, mutated terrain', en: 'A hazardous world of fluorescent, mutated terrain' },
    ecologySurface: { anchorMode: 'spherical-projection', radiusScale: 0.81, altitudeScale: 0.022 },
  },
  {
    id: 'sc-clown', assetUrl: '/orbit-friends-universe/models/sc-clown.glb', archetype: 'terran', seed: 58113,
    name: { zh: 'Clown World', en: 'Clown World' },
    description: { zh: 'A theatrical fantasy world shaped by playful forms and vivid color', en: 'A theatrical fantasy world shaped by playful forms and vivid color' },
    ecologySurface: { anchorMode: 'spherical-projection', radiusScale: 0.78, altitudeScale: 0.02 },
  },
  {
    id: 'sc-crystal-butterfly', assetUrl: '/orbit-friends-universe/models/sc-crystal-butterfly.glb', archetype: 'crystalline', seed: 58114,
    name: { zh: 'Crystal Butterfly World', en: 'Crystal Butterfly World' },
    description: { zh: 'A luminous world where crystal facets meet butterfly forms', en: 'A luminous world where crystal facets meet butterfly forms' },
    ecologySurface: { anchorMode: 'spherical-projection', radiusScale: 0.74, altitudeScale: 0.018 },
  },
  {
    id: 'sc-pink-quicksand', assetUrl: '/orbit-friends-universe/models/sc-pink-quicksand.glb', archetype: 'crystalline', seed: 58115,
    name: { zh: 'Pink Quicksand World', en: 'Pink Quicksand World' },
    description: { zh: 'A flowing world sculpted from pink quicksand and soft contours', en: 'A flowing world sculpted from pink quicksand and soft contours' },
    ecologySurface: { anchorMode: 'spherical-projection', radiusScale: 0.8, altitudeScale: 0.02 },
  },
]

function createVisual(worldId: string, radius = 1): PlanetVisualConfig | null {
  const world = worlds.find((item) => item.id === worldId)
  if (!world) return null
  const base = createPlanetPreset(world.archetype, world.seed)
  return {
    ...base,
    seed: world.seed,
    radius,
    ring: false,
    satellites: 0,
    externalAssetUrl: world.assetUrl,
  }
}

function findByAssetUrl(assetUrl?: string): AuthoredWorldDefinition | null {
  if (!assetUrl) return null
  return worlds.find((item) => item.assetUrl === assetUrl) ?? null
}

function isAuthoredVisual(config: PlanetVisualConfig): boolean {
  return findByAssetUrl(config.externalAssetUrl) !== null
}

function resolveEcologySurface(config: PlanetVisualConfig): AuthoredWorldEcologySurface {
  return findByAssetUrl(config.externalAssetUrl)?.ecologySurface ?? {
    anchorMode: 'spherical-projection',
    radiusScale: 1,
    altitudeScale: 0.006,
  }
}

export const authoredWorldLibrary = {
  worlds,
  createVisual,
  findByAssetUrl,
  isAuthoredVisual,
  resolveEcologySurface,
}
