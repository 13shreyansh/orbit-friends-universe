import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { Person } from '../../types/person'
import { useRelationshipVisibility } from '../../hooks/useRelationshipVisibility'
import { useEffectiveRelationshipStats } from '../../hooks/useEffectiveRelationshipStats'
import {
  buildRelationshipCurve,
  getPersonWorldPosition,
  getRelationColor,
  hashSeed,
} from '../../utils/relationshipVisuals'

const PARTICLE_COUNT = 3
const FLOW_SPEED = 0.06 // loops per second along the curve — slow drift

interface FlowParticlesProps {
  person: Person
}

export function FlowParticles({ person }: FlowParticlesProps) {
  const { lineOpacity, isActive } = useRelationshipVisibility(person)
  const { intimacy: effectiveIntimacy } = useEffectiveRelationshipStats(person)
  const pointsRef = useRef<THREE.Points>(null)

  const endPosition = useMemo(
    () => getPersonWorldPosition(person, effectiveIntimacy),
    [person, effectiveIntimacy],
  )
  const curve = useMemo(() => buildRelationshipCurve(endPosition), [endPosition])
  const color = useMemo(() => getRelationColor(person.relationType), [person.relationType])
  const seed = useMemo(() => hashSeed(person.id), [person.id])
  const positions = useMemo(() => new Float32Array(PARTICLE_COUNT * 3), [])

  useFrame((state) => {
    const points = pointsRef.current
    if (!points) return
    const attr = points.geometry.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const t = (state.clock.elapsedTime * FLOW_SPEED + seed + i / PARTICLE_COUNT) % 1
      const point = curve.getPointAt(t)
      attr.setXYZ(i, point.x, point.y, point.z)
    }
    attr.needsUpdate = true
  })

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={0.07}
        color={color}
        transparent
        opacity={isActive ? lineOpacity : lineOpacity * 0.8}
        sizeAttenuation
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  )
}
