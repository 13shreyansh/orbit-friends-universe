import { useMemo, useRef } from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { Billboard } from '@react-three/drei'
import * as THREE from 'three'
import type { Person } from '../../types/person'
import { useSceneStore } from '../../store/useSceneStore'
import { usePeopleStore } from '../../store/usePeopleStore'
import { useRelationshipVisibility } from '../../hooks/useRelationshipVisibility'
import { useEffectiveRelationshipStats } from '../../hooks/useEffectiveRelationshipStats'
import { useEffectPulse } from '../../hooks/useEffectPulse'
import {
  getEmissiveIntensity,
  getPersonWorldPosition,
  getPlanetRadius,
  getRelationColor,
  getStatusOpacity,
  hashSeed,
} from '../../utils/relationshipVisuals'
import { createPlanetSurfaceTexture, createRadialGradientTexture } from '../../utils/proceduralTexture'
import { HoverLabel } from './HoverLabel'

interface PersonPlanetProps {
  person: Person
  maxMemoryCount: number
}

const ACTIVE_SCALE = 1.15
// Exponential-damping rate for opacity/emissive fades — matches the
// language used by CameraController so all "mode transition" motion in the
// scene eases the same way instead of snapping instantly.
const FADE_LAMBDA = 3.2
// Slightly slower than the fade — lets the planet visibly "drift" across
// the timeline (or in/out of relevance) rather than snapping to position.
const POSITION_LAMBDA = 2.4
// Faint "breathing" pulse layered on top of the damped emissive value —
// each planet gets its own speed/phase (seeded) so the whole cosmos never
// pulses in unison.
const BREATH_AMPLITUDE = 0.1

// Transient reactions to a memory being added — see usePeopleStore's
// lastEffect signal and useEffectPulse. Read once via refs inside useFrame,
// never through React state, so they cost nothing when idle.
const PULSE_KINDS = ['pulse', 'newMemoryPoint'] as const
const NEW_MEMORY_KINDS = ['newMemoryPoint'] as const
const PULSE_DURATION_MS = 1400
const PULSE_MAGNITUDE = 1.1
const GLINT_DURATION_MS = 1800

// A brand-new person eases in from far away instead of appearing already
// in place — see resolveInitialPosition below.
const ENTRY_DISTANCE = 22
const ENTRY_WINDOW_MS = 3000

function resolveInitialPosition(personId: string, target: THREE.Vector3): THREE.Vector3 {
  const effect = usePeopleStore.getState().lastEffect
  const isFreshEntrance =
    effect !== null &&
    effect.personId === personId &&
    effect.kinds.includes('entrance') &&
    performance.now() - effect.startedAt < ENTRY_WINDOW_MS
  if (!isFreshEntrance) return target.clone()
  const direction = target.length() > 0.001 ? target.clone().normalize() : new THREE.Vector3(1, 0, 0)
  return direction.multiplyScalar(ENTRY_DISTANCE)
}

export function PersonPlanet({ person, maxMemoryCount }: PersonPlanetProps) {
  const groupRef = useRef<THREE.Group>(null)
  const planetRef = useRef<THREE.Mesh>(null)
  const planetMaterialRef = useRef<THREE.MeshStandardMaterial>(null)
  const rimMaterialRef = useRef<THREE.MeshBasicMaterial>(null)
  const glowMaterialRef = useRef<THREE.MeshBasicMaterial>(null)
  const glintMeshRef = useRef<THREE.Mesh>(null)
  const glintMaterialRef = useRef<THREE.MeshBasicMaterial>(null)

  const pulseRef = useEffectPulse(person.id, PULSE_KINDS)
  const newMemoryRef = useEffectPulse(person.id, NEW_MEMORY_KINDS)
  const glintTexture = useMemo(
    () => createRadialGradientTexture('rgba(255, 255, 255, 1)', 'rgba(255, 255, 255, 0)'),
    [],
  )

  const setHoveredPersonId = useSceneStore((state) => state.setHoveredPersonId)
  const selectPerson = useSceneStore((state) => state.selectPerson)
  const { isActive, interactive, opacityMultiplier, emissiveMultiplier } =
    useRelationshipVisibility(person)
  const { intimacy: effectiveIntimacy, interactionFrequency: effectiveFrequency } =
    useEffectiveRelationshipStats(person)

  const targetPosition = useMemo(
    () => getPersonWorldPosition(person, effectiveIntimacy),
    [person, effectiveIntimacy],
  )
  const planetRadius = useMemo(
    () => getPlanetRadius(person.memoryCount, maxMemoryCount),
    [person.memoryCount, maxMemoryCount],
  )
  const color = useMemo(() => getRelationColor(person.relationType), [person.relationType])
  const seed = useMemo(() => hashSeed(person.id), [person.id])
  const surfaceTexture = useMemo(
    () => createPlanetSurfaceTexture(seed, color),
    [seed, color],
  )

  const baseEmissiveIntensity = getEmissiveIntensity(effectiveFrequency)
  const baseOpacity = getStatusOpacity(person.status)
  const targetOpacity = baseOpacity * opacityMultiplier
  const targetEmissive = baseEmissiveIntensity * emissiveMultiplier
  const scale = isActive ? ACTIVE_SCALE : 1

  const currentOpacity = useRef(targetOpacity)
  const currentEmissive = useRef(targetEmissive)
  const currentPosition = useRef(resolveInitialPosition(person.id, targetPosition))

  // Deterministic per-person animation offsets so planets don't move in sync.
  const rotationSpeed = 0.15 + seed * 0.3
  const floatSpeed = 0.3 + seed * 0.4
  const floatAmplitude = 0.04 + seed * 0.06
  const floatPhase = seed * Math.PI * 2
  const breathSpeed = 0.25 + seed * 0.3
  const breathPhase = seed * Math.PI * 2

  useFrame((state, delta) => {
    if (planetRef.current) {
      planetRef.current.rotation.y += delta * rotationSpeed
    }

    currentPosition.current.x = THREE.MathUtils.damp(
      currentPosition.current.x,
      targetPosition.x,
      POSITION_LAMBDA,
      delta,
    )
    currentPosition.current.y = THREE.MathUtils.damp(
      currentPosition.current.y,
      targetPosition.y,
      POSITION_LAMBDA,
      delta,
    )
    currentPosition.current.z = THREE.MathUtils.damp(
      currentPosition.current.z,
      targetPosition.z,
      POSITION_LAMBDA,
      delta,
    )

    if (groupRef.current) {
      const t = state.clock.elapsedTime * floatSpeed + floatPhase
      groupRef.current.position.set(
        currentPosition.current.x,
        currentPosition.current.y + Math.sin(t) * floatAmplitude,
        currentPosition.current.z,
      )
    }

    currentOpacity.current = THREE.MathUtils.damp(
      currentOpacity.current,
      targetOpacity,
      FADE_LAMBDA,
      delta,
    )
    currentEmissive.current = THREE.MathUtils.damp(
      currentEmissive.current,
      targetEmissive,
      FADE_LAMBDA,
      delta,
    )
    const breath =
      Math.sin(state.clock.elapsedTime * breathSpeed + breathPhase) *
      BREATH_AMPLITUDE *
      currentOpacity.current

    let pulseBoost = 0
    if (pulseRef.current !== null) {
      const pulseT = (performance.now() - pulseRef.current) / PULSE_DURATION_MS
      if (pulseT < 1) {
        pulseBoost = Math.sin(pulseT * Math.PI) * PULSE_MAGNITUDE
      } else {
        pulseRef.current = null
      }
    }

    if (planetMaterialRef.current) {
      planetMaterialRef.current.opacity = currentOpacity.current
      planetMaterialRef.current.emissiveIntensity = Math.max(
        0,
        currentEmissive.current + breath + pulseBoost,
      )
    }
    if (rimMaterialRef.current) {
      rimMaterialRef.current.opacity = 0.24 * currentOpacity.current
    }
    if (glowMaterialRef.current) {
      glowMaterialRef.current.opacity = 0.14 * currentOpacity.current
    }

    if (glintMeshRef.current && glintMaterialRef.current) {
      if (newMemoryRef.current !== null) {
        const glintT = (performance.now() - newMemoryRef.current) / GLINT_DURATION_MS
        if (glintT < 1) {
          const eased = Math.sin(glintT * Math.PI)
          glintMeshRef.current.visible = true
          glintMaterialRef.current.opacity = eased * 0.9
          glintMeshRef.current.scale.setScalar(0.4 + eased * 0.7)
        } else {
          glintMeshRef.current.visible = false
          newMemoryRef.current = null
        }
      } else {
        glintMeshRef.current.visible = false
      }
    }
  })

  const handlePointerOver = (event: ThreeEvent<PointerEvent>) => {
    if (!interactive) return
    event.stopPropagation()
    setHoveredPersonId(person.id)
    document.body.style.cursor = 'pointer'
  }

  const handlePointerOut = (event: ThreeEvent<PointerEvent>) => {
    if (!interactive) return
    event.stopPropagation()
    setHoveredPersonId(null)
    document.body.style.cursor = 'auto'
  }

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    if (!interactive) return
    event.stopPropagation()
    selectPerson(person.id)
  }

  return (
    <group ref={groupRef} scale={scale}>
      <mesh
        ref={planetRef}
        onPointerOver={handlePointerOver}
        onPointerOut={handlePointerOut}
        onClick={handleClick}
      >
        <sphereGeometry args={[planetRadius, 20, 20]} />
        <meshStandardMaterial
          ref={planetMaterialRef}
          map={surfaceTexture}
          color={color}
          emissive={color}
          emissiveIntensity={targetEmissive}
          roughness={0.5}
          metalness={0.1}
          transparent
          opacity={targetOpacity}
        />
      </mesh>

      {/* Tight rim highlight, same recipe as the core planet's. */}
      <mesh scale={1.08}>
        <sphereGeometry args={[planetRadius, 16, 16]} />
        <meshBasicMaterial
          ref={rimMaterialRef}
          color={color}
          transparent
          opacity={0.24 * targetOpacity}
          side={THREE.BackSide}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>

      <mesh scale={1.5}>
        <sphereGeometry args={[planetRadius, 12, 12]} />
        <meshBasicMaterial
          ref={glowMaterialRef}
          color={color}
          transparent
          opacity={0.14 * targetOpacity}
          side={THREE.BackSide}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>

      {isActive && <HoverLabel name={person.name} color={color} radius={planetRadius} />}

      {/* A new memory's arrival glint — invisible except for the brief
          window right after addMemoryToPerson fires (see useFrame above). */}
      <Billboard position={[planetRadius * 1.7, planetRadius * 1.3, planetRadius * 0.4]}>
        <mesh ref={glintMeshRef} visible={false}>
          <planeGeometry args={[planetRadius * 1.2, planetRadius * 1.2]} />
          <meshBasicMaterial
            ref={glintMaterialRef}
            map={glintTexture}
            transparent
            opacity={0}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
      </Billboard>
    </group>
  )
}
