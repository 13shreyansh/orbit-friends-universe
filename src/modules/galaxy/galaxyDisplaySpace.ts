import type { SpatialSnapshot, SpatialVector3 } from '../../product/contracts'

export const GALAXY_DISPLAY_POSITION_SCALE = 0.9

function scaleVector(vector: SpatialVector3): SpatialVector3 {
  return {
    x: vector.x * GALAXY_DISPLAY_POSITION_SCALE,
    y: vector.y * GALAXY_DISPLAY_POSITION_SCALE,
    z: vector.z * GALAXY_DISPLAY_POSITION_SCALE,
  }
}

/** Keep semantic distances intact while bringing rendered worlds slightly closer. */
export function createGalaxyDisplaySnapshot(snapshot: SpatialSnapshot): SpatialSnapshot {
  return {
    ...snapshot,
    nodes: snapshot.nodes.map((node) => ({
      ...node,
      position: scaleVector(node.position),
      velocity: scaleVector(node.velocity),
      orbitBand: node.orbitBand * GALAXY_DISPLAY_POSITION_SCALE,
      sphericalPosition: node.sphericalPosition
        ? { ...node.sphericalPosition, radius: node.sphericalPosition.radius * GALAXY_DISPLAY_POSITION_SCALE }
        : undefined,
    })),
    edges: snapshot.edges.map((edge) => ({
      ...edge,
      restLength: edge.restLength * GALAXY_DISPLAY_POSITION_SCALE,
    })),
  }
}
