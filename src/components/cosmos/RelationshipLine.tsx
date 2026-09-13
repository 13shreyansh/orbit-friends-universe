import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Line } from '@react-three/drei'
import * as THREE from 'three'
import type { Person } from '../../types/person'
import { useRelationshipVisibility } from '../../hooks/useRelationshipVisibility'
import { useEffectiveRelationshipStats } from '../../hooks/useEffectiveRelationshipStats'
import { useEffectPulse } from '../../hooks/useEffectPulse'
import {
  buildRelationshipCurve,
  getPersonWorldPosition,
  getRelationColor,
} from '../../utils/relationshipVisuals'

const CURVE_SEGMENTS = 32
const OPACITY_LAMBDA = 3

// "reconnected" briefly relights the connection near-full-bright before
// settling back to its normal strength; "conflict" adds a short flicker.
const RELIT_KINDS = ['relit'] as const
const WOBBLE_KINDS = ['conflictWobble'] as const
const RELIT_DURATION_MS = 2200
const WOBBLE_DURATION_MS = 1200
const WOBBLE_FREQUENCY = 24
const WOBBLE_AMPLITUDE = 0.3

interface RelationshipLineProps {
  person: Person
}

export function RelationshipLine({ person }: RelationshipLineProps) {
  const { isActive, lineOpacity } = useRelationshipVisibility(person)
  const { intimacy: effectiveIntimacy } = useEffectiveRelationshipStats(person)

  // drei's <Line> ref resolves to the underlying three-stdlib Line2 object;
  // its material type isn't cleanly re-exported, so `any` here is a
  // pragmatic escape hatch rather than fighting the library's type surface.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lineRef = useRef<any>(null)
  const currentOpacity = useRef(lineOpacity)
  const relitRef = useEffectPulse(person.id, RELIT_KINDS)
  const wobbleRef = useEffectPulse(person.id, WOBBLE_KINDS)

  const endPosition = useMemo(
    () => getPersonWorldPosition(person, effectiveIntimacy),
    [person, effectiveIntimacy],
  )
  const points = useMemo(
    () => buildRelationshipCurve(endPosition).getPoints(CURVE_SEGMENTS),
    [endPosition],
  )
  const color = useMemo(() => getRelationColor(person.relationType), [person.relationType])

  useFrame((_, delta) => {
    currentOpacity.current = THREE.MathUtils.damp(
      currentOpacity.current,
      lineOpacity,
      OPACITY_LAMBDA,
      delta,
    )

    let opacityOverride: number | null = null
    if (relitRef.current !== null) {
      const t = (performance.now() - relitRef.current) / RELIT_DURATION_MS
      if (t < 1) {
        const boost = Math.sin(t * Math.PI)
        opacityOverride = currentOpacity.current + boost * (1 - currentOpacity.current) * 0.9
      } else {
        relitRef.current = null
      }
    }

    let wobbleDelta = 0
    if (wobbleRef.current !== null) {
      const t = (performance.now() - wobbleRef.current) / WOBBLE_DURATION_MS
      if (t < 1) {
        const envelope = Math.sin(t * Math.PI)
        wobbleDelta = Math.sin(t * WOBBLE_DURATION_MS * 0.001 * WOBBLE_FREQUENCY) * WOBBLE_AMPLITUDE * envelope
      } else {
        wobbleRef.current = null
      }
    }

    const finalOpacity = Math.min(
      1,
      Math.max(0, (opacityOverride ?? currentOpacity.current) + wobbleDelta),
    )
    if (lineRef.current) {
      lineRef.current.material.opacity = finalOpacity
    }
  })

  return (
    <Line
      ref={lineRef}
      points={points}
      color={color}
      transparent
      opacity={currentOpacity.current}
      lineWidth={isActive ? 1.5 : 1}
      depthWrite={false}
    />
  )
}
