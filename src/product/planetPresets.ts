import type { PlanetArchetype, PlanetVisualConfig } from './contracts'

const palettes: Record<PlanetArchetype, PlanetVisualConfig['palette']> = {
  terran: {
    deep: '#191744',
    surface: '#66578f',
    highlight: '#f2aa78',
    atmosphere: '#d79bc5',
  },
  oceanic: {
    deep: '#101947',
    surface: '#405b9f',
    highlight: '#f0ac82',
    atmosphere: '#8dc8ee',
  },
  volcanic: {
    deep: '#28153e',
    surface: '#75405d',
    highlight: '#ff9b5e',
    atmosphere: '#e97888',
  },
  crystalline: {
    deep: '#17153d',
    surface: '#67559b',
    highlight: '#f2b8d0',
    atmosphere: '#b99bea',
  },
  verdant: {
    deep: '#152044',
    surface: '#4a6e78',
    highlight: '#f3b77c',
    atmosphere: '#97c8ca',
  },
}

export function createPlanetPreset(
  archetype: PlanetArchetype,
  seed = Math.floor(Math.random() * 100000),
): PlanetVisualConfig {
  const archetypeValues: Record<
    PlanetArchetype,
    Pick<PlanetVisualConfig, 'terrain' | 'roughness' | 'oceanLevel' | 'cloudDensity'>
  > = {
    terran: { terrain: 0.48, roughness: 0.66, oceanLevel: 0.48, cloudDensity: 0.48 },
    oceanic: { terrain: 0.26, roughness: 0.38, oceanLevel: 0.7, cloudDensity: 0.62 },
    volcanic: { terrain: 0.78, roughness: 0.9, oceanLevel: 0.12, cloudDensity: 0.22 },
    crystalline: { terrain: 0.62, roughness: 0.34, oceanLevel: 0.2, cloudDensity: 0.18 },
    verdant: { terrain: 0.52, roughness: 0.72, oceanLevel: 0.4, cloudDensity: 0.58 },
  }

  return {
    version: 1,
    archetype,
    seed,
    radius: 1,
    ...archetypeValues[archetype],
    atmosphereStrength: 0.65,
    ring: archetype === 'crystalline',
    ringColor: palettes[archetype].highlight,
    satellites: archetype === 'oceanic' ? 2 : 1,
    palette: palettes[archetype],
    backgroundSkinId: 'deep-space',
  }
}

export const PLANET_ARCHETYPES: Array<{
  id: PlanetArchetype
  label: string
  description: string
}> = [
  { id: 'terran', label: 'Terran', description: 'Lavender continents beneath a peach horizon.' },
  { id: 'oceanic', label: 'Oceanic', description: 'Indigo tides crossed by warm reflected light.' },
  { id: 'volcanic', label: 'Volcanic', description: 'Plum rock, coral fissures and restless energy.' },
  { id: 'crystalline', label: 'Crystal', description: 'Rose mineral fields with delicate violet rings.' },
  { id: 'verdant', label: 'Verdant', description: 'Blue forests and softly illuminated cloud seas.' },
]
