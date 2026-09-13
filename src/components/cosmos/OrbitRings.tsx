import { useMemo } from 'react'
import * as THREE from 'three'
import {
  INTIMACY_TIERS,
  getTierRingRadius,
} from '../../utils/relationshipVisuals'

const RING_COLOR = '#5b6aa0'
const RING_OPACITY = 0.055
const TUBE_RADIUS = 0.006

/** Static, very faint reference rings marking the four intimacy tiers.
 * Purely a spatial guide — no interaction, no animation. */
export function OrbitRings() {
  const radii = useMemo(
    () => INTIMACY_TIERS.map((tier) => getTierRingRadius(tier)),
    [],
  )

  return (
    <>
      {radii.map((radius) => (
        <mesh key={radius} rotation-x={Math.PI / 2}>
          <torusGeometry args={[radius, TUBE_RADIUS, 8, 128]} />
          <meshBasicMaterial
            color={RING_COLOR}
            transparent
            opacity={RING_OPACITY}
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}
    </>
  )
}
