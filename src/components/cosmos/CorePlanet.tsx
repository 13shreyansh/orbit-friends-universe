import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { createPlanetSurfaceTexture } from '../../utils/proceduralTexture'
import { CORE_ATMOSPHERE_SCALE, CORE_PLANET_RADIUS } from '../../utils/relationshipVisuals'

const ROTATION_SPEED = 0.05
const FLOAT_SPEED = 0.4
const FLOAT_AMPLITUDE = 0.08

// Slow, barely-perceptible "breathing" — a faint pulse in the glow, not a
// visible size change. Keeps the core feeling alive without being showy.
const BREATH_SPEED = 0.35
const BREATH_AMPLITUDE = 0.08
const BASE_EMISSIVE = 0.55

export function CorePlanet() {
  const groupRef = useRef<THREE.Group>(null)
  const planetRef = useRef<THREE.Mesh>(null)
  const materialRef = useRef<THREE.MeshStandardMaterial>(null)

  const surfaceTexture = useMemo(() => createPlanetSurfaceTexture(0.42, '#3346a8'), [])

  useFrame((state, delta) => {
    if (planetRef.current) {
      planetRef.current.rotation.y += delta * ROTATION_SPEED
    }
    if (groupRef.current) {
      groupRef.current.position.y =
        Math.sin(state.clock.elapsedTime * FLOAT_SPEED) * FLOAT_AMPLITUDE
    }
    if (materialRef.current) {
      const breath = Math.sin(state.clock.elapsedTime * BREATH_SPEED) * BREATH_AMPLITUDE
      materialRef.current.emissiveIntensity = BASE_EMISSIVE + breath
    }
  })

  return (
    <group ref={groupRef}>
      <mesh ref={planetRef}>
        <sphereGeometry args={[CORE_PLANET_RADIUS, 64, 64]} />
        <meshStandardMaterial
          ref={materialRef}
          map={surfaceTexture}
          color="#3346a8"
          emissive="#1c2870"
          emissiveIntensity={BASE_EMISSIVE}
          roughness={0.45}
          metalness={0.15}
        />
      </mesh>

      {/* Tight rim highlight — thin shell close to the surface reads as a
          soft edge light where the sphere curves away from view. */}
      <mesh scale={1.04}>
        <sphereGeometry args={[CORE_PLANET_RADIUS, 32, 32]} />
        <meshBasicMaterial
          color="#a6b8ff"
          transparent
          opacity={0.22}
          side={THREE.BackSide}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>

      {/* Broad soft atmosphere halo. */}
      <mesh scale={CORE_ATMOSPHERE_SCALE}>
        <sphereGeometry args={[CORE_PLANET_RADIUS, 32, 32]} />
        <meshBasicMaterial
          color="#7d95ff"
          transparent
          opacity={0.14}
          side={THREE.BackSide}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </group>
  )
}
