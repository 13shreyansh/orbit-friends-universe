import type { PlanetVisualConfig, SocialPlanet } from '../../product/contracts'
import { planetStyleModule as planetGenerator } from './style/planetStyleModule'

function stablePlanetSeed(id: string): number {
  let hash = 2166136261
  for (const character of id) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) % 900000 + 10000
}

function isLegacyClonedVisual(visual: PlanetVisualConfig): boolean {
  return visual.archetype === 'terran'
    && visual.seed === 4281
    && visual.palette.surface.toLowerCase() === '#6f5a9f'
}

/** Preserve authored worlds and only diversify the original cloned fallback. */
export function resolvePlanetVisual(planet: Pick<SocialPlanet, 'id' | 'visual'>): PlanetVisualConfig {
  if (!isLegacyClonedVisual(planet.visual)) return planet.visual
  const archetypes: PlanetVisualConfig['archetype'][] = ['terran', 'oceanic', 'volcanic', 'crystalline', 'verdant']
  const seed = stablePlanetSeed(planet.id)
  const generated = planetGenerator.generate({
    mode: 'legacy',
    archetype: archetypes[seed % archetypes.length],
    seed,
    radius: planet.visual.radius,
  })
  return { ...generated, radius: planet.visual.radius }
}
