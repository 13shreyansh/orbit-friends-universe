import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Stars } from '@react-three/drei'
import * as THREE from 'three'
import { isLowPerformanceDevice } from '../../utils/performance'

const PARTICLE_COUNT = isLowPerformanceDevice ? 120 : 260
const PARTICLE_SPREAD = 40
const STAR_COUNT = isLowPerformanceDevice ? 1200 : 2500

function createParticlePositions(count: number, spread: number): Float32Array {
  const positions = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * spread
    positions[i * 3 + 1] = (Math.random() - 0.5) * spread
    positions[i * 3 + 2] = (Math.random() - 0.5) * spread
  }
  return positions
}

export function BackgroundStars() {
  const particlesRef = useRef<THREE.Points>(null)
  const positions = useMemo(
    () => createParticlePositions(PARTICLE_COUNT, PARTICLE_SPREAD),
    [],
  )

  useFrame((_, delta) => {
    if (particlesRef.current) {
      particlesRef.current.rotation.y += delta * 0.01
    }
  })

  return (
    <>
      <Stars
        radius={60}
        depth={40}
        count={STAR_COUNT}
        factor={2.2}
        saturation={0}
        fade
        speed={0.3}
      />
      <points ref={particlesRef}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[positions, 3]}
          />
        </bufferGeometry>
        <pointsMaterial
          size={0.045}
          sizeAttenuation
          color="#9db4ff"
          transparent
          opacity={0.35}
          depthWrite={false}
        />
      </points>
    </>
  )
}
