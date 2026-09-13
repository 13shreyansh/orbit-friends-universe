import type { SocialPlanet } from './contracts'
import { planetStyleModule } from '../modules/planet/style/planetStyleModule'

export const DEMO_ACCOUNT = {
  email: 'demo@socialcosmos.local',
  password: 'Cosmos2026!',
  userId: 'demo-zaosusu',
  planetId: 'planet-demo-zaosusu',
} as const

export function createDemoSelfPlanet(): SocialPlanet {
  return {
    id: DEMO_ACCOUNT.planetId,
    ownerId: DEMO_ACCOUNT.userId,
    ownerName: 'Zaosusu',
    identity: {
      name: 'Nocturne Garden',
      motto: 'Memories bloom after dark.',
      description: 'A quiet world shaped by thoughtful tools, night-sky stories and durable friendships.',
      tags: ['builder', 'stargazer', 'calm', 'curious'],
      mass: 68,
      influence: 84,
    },
    visual: planetStyleModule.generate({
      mode: 'system',
      archetype: 'verdant',
      seed: 4281,
      overrides: {
        terrain: 0.67,
        oceanLevel: 0.38,
        cloudDensity: 0.42,
        atmosphereStrength: 0.74,
        ring: false,
        satellites: 1,
      },
    }),
    position: [0, 0, 0],
    relationshipStrength: 1,
    isSelf: true,
  }
}

const friendDefinitions = [
  {
    id: 'maya',
    name: 'Maya Chen',
    planetName: 'Cyan Harbor',
    archetype: 'oceanic' as const,
    tags: ['curious', 'night talks', 'photography'],
    position: [6.2, 1.2, -1.8] as [number, number, number],
    relationshipStrength: 0.92,
  },
  {
    id: 'lin',
    name: 'Lin Wei',
    planetName: 'Rose Hearth',
    archetype: 'terran' as const,
    tags: ['family', 'warmth', 'home'],
    position: [-4.5, -0.6, 3.8] as [number, number, number],
    relationshipStrength: 0.97,
  },
  {
    id: 'jonas',
    name: 'Jonas Berg',
    planetName: 'Forge Meridian',
    archetype: 'volcanic' as const,
    tags: ['builder', 'direct', 'work'],
    position: [2.8, -2.4, 6.4] as [number, number, number],
    relationshipStrength: 0.66,
  },
  {
    id: 'priya',
    name: 'Priya Nair',
    planetName: 'Mosslight',
    archetype: 'verdant' as const,
    tags: ['coffee', 'weekends', 'calm'],
    position: [-7.2, 2.1, -3.7] as [number, number, number],
    relationshipStrength: 0.58,
  },
  {
    id: 'alex',
    name: 'Alex Rivera',
    planetName: 'Violet Archive',
    archetype: 'crystalline' as const,
    tags: ['memory', 'distance', 'music'],
    position: [8.7, 3.4, 5.8] as [number, number, number],
    relationshipStrength: 0.34,
  },
]

export function createMockFriendPlanets(): SocialPlanet[] {
  return friendDefinitions.map((friend, index) => ({
    id: 'planet-' + friend.id,
    ownerId: friend.id,
    ownerName: friend.name,
    identity: {
      name: friend.planetName,
      motto: friend.tags.join(' / '),
      description: 'A personal world shaped by ' + friend.name + "'s memories and relationships.",
      tags: friend.tags,
      mass: 48 + index * 9,
      influence: Math.round(friend.relationshipStrength * 100),
    },
    visual: planetStyleModule.generate({
      mode: 'system',
      archetype: friend.archetype,
      seed: 1701 + index * 971,
      radius: 0.72 + friend.relationshipStrength * 0.26,
      overrides: {
        satellites: index % 3,
        ring: friend.archetype === 'crystalline' || index === 2,
      },
    }),
    position: friend.position,
    relationshipStrength: friend.relationshipStrength,
  }))
}
