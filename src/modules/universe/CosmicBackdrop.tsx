import { useMemo, useRef } from 'react'
import { Line, Sparkles, Stars } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

const nebulaLayers = [
  { position: [7, 3, -25] as [number, number, number], scale: [11, 3.3, 1] as [number, number, number], color: '#a04b91', opacity: 0.026, rotation: -0.28 },
  { position: [-10, -5, -22] as [number, number, number], scale: [10, 2.8, 1] as [number, number, number], color: '#dc6e8f', opacity: 0.024, rotation: 0.22 },
  { position: [3, -8, -28] as [number, number, number], scale: [15, 2.5, 1] as [number, number, number], color: '#ef9a79', opacity: 0.018, rotation: 0.08 },
]

function travelStream(offset: number) {
  return Array.from({ length: 64 }, (_, index) => {
    const t = index / 63
    const angle = t * Math.PI * 2.4 + offset
    const radius = 2.2 + t * 17
    return new THREE.Vector3(
      Math.cos(angle) * radius,
      Math.sin(angle * 0.52) * (1.2 + t * 2.4) - 0.8,
      -10 - t * 9,
    )
  })
}

export function CosmicBackdrop({ minimal = false }: { minimal?: boolean }) {
  const groupRef = useRef<THREE.Group>(null)
  const streams = useMemo(() => [0, 0.12, -0.14, 0.24].map(travelStream), [])

  useFrame((state) => {
    if (groupRef.current) groupRef.current.rotation.z = Math.sin(state.clock.elapsedTime * 0.018) * 0.018
  })

  return (
    <group ref={groupRef}>
      <Stars radius={62} depth={42} count={3000} factor={2} saturation={0.72} fade speed={0.09} />
      <Sparkles count={230} scale={[36, 21, 24]} size={1.6} speed={0.07} color="#ffad86" opacity={0.58} />
      <Sparkles count={140} scale={[30, 17, 20]} size={1.1} speed={0.05} color="#b79deb" opacity={0.42} />

      {!minimal && nebulaLayers.map((layer) => (
        <mesh key={layer.color + layer.position.join()} position={layer.position} scale={layer.scale} rotation-z={layer.rotation}>
          <circleGeometry args={[1, 96]} />
          <meshBasicMaterial color={layer.color} transparent opacity={layer.opacity} blending={THREE.AdditiveBlending} depthWrite={false} />
        </mesh>
      ))}

      {!minimal && streams.map((points, index) => (
        <Line
          key={index}
          points={points}
          color={index === 0 ? '#ffc17d' : index === 1 ? '#e9869c' : '#a583df'}
          transparent
          opacity={0.13 - index * 0.018}
          lineWidth={1.25 - index * 0.12}
          depthWrite={false}
        />
      ))}

      {!minimal && <pointLight position={[10, 6, -24]} intensity={12} distance={26} color="#ff9b62" />}
    </group>
  )
}
