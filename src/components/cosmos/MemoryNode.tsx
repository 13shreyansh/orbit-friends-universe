import { useMemo, useRef, useState, type CSSProperties } from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { Billboard, Html } from '@react-three/drei'
import * as THREE from 'three'
import type { Memory } from '../../types/memory'
import { useSceneStore } from '../../store/useSceneStore'
import { getEmotionalToneColor, getMemoryNodeSize } from '../../utils/memoryVisuals'
import { hashSeed } from '../../utils/relationshipVisuals'
import { createRadialGradientTexture } from '../../utils/proceduralTexture'

interface MemoryNodeProps {
  memory: Memory
  angle: number
  elevation: number
  orbitRadius: number
  visible: boolean
}

const VISIBILITY_LAMBDA = 3
const FLOAT_AMPLITUDE_BASE = 0.05

const labelStyle: CSSProperties = {
  whiteSpace: 'nowrap',
  padding: '4px 10px',
  fontSize: '10.5px',
  fontWeight: 500,
  letterSpacing: '0.02em',
  color: 'rgba(255, 255, 255, 0.92)',
  background: 'rgba(6, 8, 20, 0.75)',
  border: '1px solid rgba(255, 255, 255, 0.14)',
  borderRadius: '999px',
}

export function MemoryNode({ memory, angle, elevation, orbitRadius, visible }: MemoryNodeProps) {
  const groupRef = useRef<THREE.Group>(null)
  const [hovered, setHovered] = useState(false)
  const visibilityRef = useRef(0)

  const selectMemory = useSceneStore((state) => state.selectMemory)
  const selectedMemoryId = useSceneStore((state) => state.selectedMemoryId)
  const isSelected = selectedMemoryId === memory.id

  const size = useMemo(() => getMemoryNodeSize(memory.importance), [memory.importance])
  const color = useMemo(() => getEmotionalToneColor(memory.emotionalTone), [memory.emotionalTone])
  const seed = useMemo(() => hashSeed(memory.id), [memory.id])

  // Soft radial glow instead of a hard-edged plane — reads as a drifting
  // light-fragment rather than a flat colored card, matching the same
  // additive-glow-sprite language used by NebulaField/planet atmospheres.
  const glowTexture = useMemo(() => {
    const c = new THREE.Color(color)
    const rgb = `${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}`
    return createRadialGradientTexture(`rgba(${rgb}, 1)`, `rgba(${rgb}, 0)`)
  }, [color])

  const localPosition = useMemo(() => {
    const x = Math.cos(angle) * orbitRadius
    const z = Math.sin(angle) * orbitRadius
    return new THREE.Vector3(x, elevation, z)
  }, [angle, elevation, orbitRadius])

  const floatSpeed = 0.3 + seed * 0.35
  const floatAmplitude = FLOAT_AMPLITUDE_BASE + seed * 0.05
  const floatPhase = seed * Math.PI * 2

  useFrame((state, delta) => {
    visibilityRef.current = THREE.MathUtils.damp(
      visibilityRef.current,
      visible ? 1 : 0,
      VISIBILITY_LAMBDA,
      delta,
    )

    if (groupRef.current) {
      const t = state.clock.elapsedTime * floatSpeed + floatPhase
      groupRef.current.position.set(
        localPosition.x,
        localPosition.y + Math.sin(t) * floatAmplitude,
        localPosition.z,
      )
      groupRef.current.scale.setScalar(visibilityRef.current)
    }
  })

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    if (!visible) return
    event.stopPropagation()
    selectMemory(memory.id)
  }

  const handlePointerOver = (event: ThreeEvent<PointerEvent>) => {
    if (!visible) return
    event.stopPropagation()
    setHovered(true)
    document.body.style.cursor = 'pointer'
  }

  const handlePointerOut = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation()
    setHovered(false)
    document.body.style.cursor = 'auto'
  }

  const cardOpacity = isSelected ? 0.95 : hovered ? 0.85 : 0.55

  return (
    <group ref={groupRef}>
      <Billboard>
        <mesh
          onClick={handleClick}
          onPointerOver={handlePointerOver}
          onPointerOut={handlePointerOut}
        >
          <planeGeometry args={[size, size]} />
          <meshBasicMaterial
            map={glowTexture}
            color={color}
            transparent
            opacity={cardOpacity}
            side={THREE.DoubleSide}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>

        <mesh position={[0, 0, -0.01]} scale={2.2}>
          <planeGeometry args={[size, size]} />
          <meshBasicMaterial
            map={glowTexture}
            color={color}
            transparent
            opacity={0.35}
            side={THREE.DoubleSide}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>

        {hovered && (
          <Html position={[0, size * 0.9, 0]} center style={{ pointerEvents: 'none' }}>
            <div style={labelStyle}>{memory.title}</div>
          </Html>
        )}
      </Billboard>
    </group>
  )
}
