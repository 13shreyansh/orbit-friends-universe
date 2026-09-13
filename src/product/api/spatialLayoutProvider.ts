import type {
  SocialPlanet,
  SpatialNodeState,
  SpatialSimulationInput,
  SpatialSnapshot,
  UniverseWindowPayload,
  SpatialVector3,
} from '../contracts'
import { apiClient } from './apiClient'

export interface SpatialLayoutProvider {
  getSnapshot(input: SpatialSimulationInput): Promise<SpatialSnapshot>
  getWindow?(offset: number, limit: number): Promise<UniverseWindowPayload>
  subscribe?(
    input: SpatialSimulationInput,
    onSnapshot: (snapshot: SpatialSnapshot) => void,
  ): () => void
}

function tupleToVector(position: SocialPlanet['position']): SpatialVector3 {
  return { x: position[0], y: position[1], z: position[2] }
}

function normalize(vector: SpatialVector3): SpatialVector3 {
  const length = Math.hypot(vector.x, vector.y, vector.z) || 1
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length }
}

function createNode(planet: SocialPlanet): SpatialNodeState {
  const position = tupleToVector(planet.position)
  const towardCenter = normalize({ x: -position.x, y: -position.y, z: -position.z })
  const gravityMagnitude = (planet.identity.mass / 100) * (0.3 + planet.relationshipStrength)

  return {
    planetId: planet.id,
    position,
    velocity: { x: 0, y: 0, z: 0 },
    gravityVector: {
      x: towardCenter.x * gravityMagnitude,
      y: towardCenter.y * gravityMagnitude,
      z: towardCenter.z * gravityMagnitude,
    },
    mass: planet.identity.mass,
    relationshipForce: planet.relationshipStrength,
    clusterId: planet.relationshipStrength > 0.8 ? 'inner-circle' : 'extended-circle',
    orbitBand: Math.hypot(position.x, position.y, position.z),
  }
}

/** Development provider. It adapts hard-coded fixture coordinates into the
 * same versioned snapshot that the production relationship simulator will
 * return over HTTP/WebSocket. */
export const localSpatialLayoutProvider: SpatialLayoutProvider = {
  async getSnapshot(input) {
    const allPlanets = [input.centerPlanet, ...input.planets]
    const nodes = allPlanets.map(createNode)
    const radius = Math.max(
      10,
      ...nodes.map((node) => Math.hypot(node.position.x, node.position.y, node.position.z)),
    )

    return {
      schemaVersion: 1,
      coordinateSystem: 'social-cartesian-v1',
      generatedAt: new Date().toISOString(),
      centerPlanetId: input.centerPlanet.id,
      nodes,
      edges: input.planets.map((planet) => ({
        sourcePlanetId: input.centerPlanet.id,
        targetPlanetId: planet.id,
        strength: planet.relationshipStrength,
        restLength: Math.hypot(...planet.position),
        flow: 0.25 + planet.relationshipStrength * 0.75,
      })),
      bounds: {
        radius,
        center: { x: 0, y: 0, z: 0 },
      },
    }
  },
}

export const apiSpatialLayoutProvider: SpatialLayoutProvider = {
  getSnapshot() {
    return apiClient.getUniverseSnapshot()
  },
  getWindow(offset, limit) {
    return apiClient.getUniverseWindow(offset, limit)
  },
}

export function spatialPositionToTuple(node: SpatialNodeState): [number, number, number] {
  return [node.position.x, node.position.y, node.position.z]
}
