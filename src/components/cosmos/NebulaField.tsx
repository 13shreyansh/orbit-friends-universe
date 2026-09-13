import { useMemo } from 'react'
import { Billboard } from '@react-three/drei'
import * as THREE from 'three'
import { createRadialGradientTexture } from '../../utils/proceduralTexture'
import { isLowPerformanceDevice } from '../../utils/performance'

interface NebulaBlob {
  position: [number, number, number]
  size: number
  color: string
  opacity: number
}

// Kept within the same cool blue/violet/teal family as the rest of the
// cosmos — soft depth, not a rainbow backdrop.
const NEBULA_BLOBS: NebulaBlob[] = [
  { position: [-18, 6, -22], size: 26, color: '70, 90, 200', opacity: 0.05 },
  { position: [20, -5, -26], size: 30, color: '120, 85, 195', opacity: 0.045 },
  { position: [-9, -11, -30], size: 20, color: '60, 140, 165', opacity: 0.04 },
  { position: [15, 13, -18], size: 18, color: '90, 100, 210', opacity: 0.05 },
]

/** A handful of very soft, additive-blended glow sprites far behind the
 * scene — reads as distant nebula/space haze without any per-frame cost
 * beyond four draw calls (or two, on low-performance devices). */
export function NebulaField() {
  const blobs = useMemo(
    () => (isLowPerformanceDevice ? NEBULA_BLOBS.slice(0, 2) : NEBULA_BLOBS),
    [],
  )

  const textures = useMemo(
    () =>
      blobs.map((blob) =>
        createRadialGradientTexture(`rgba(${blob.color}, 1)`, `rgba(${blob.color}, 0)`),
      ),
    [blobs],
  )

  return (
    <>
      {blobs.map((blob, index) => (
        <Billboard key={blob.position.join(',')} position={blob.position}>
          <mesh>
            <planeGeometry args={[blob.size, blob.size]} />
            <meshBasicMaterial
              map={textures[index]}
              transparent
              opacity={blob.opacity}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
        </Billboard>
      ))}
    </>
  )
}
