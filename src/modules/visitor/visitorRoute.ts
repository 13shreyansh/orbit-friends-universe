import * as THREE from 'three'
import type { SpatialNodeState } from '../../product/contracts'

export function spatialNodeVector(node: SpatialNodeState | null): THREE.Vector3 | null {
  if (!node) return null
  return new THREE.Vector3(node.position.x, node.position.y, node.position.z)
}

export interface VisitorVehicleConfig {
  type: 'comet'
  passengerName: string
  passengerAssetUrl?: string
}
