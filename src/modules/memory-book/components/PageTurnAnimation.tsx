import { useFrame } from '@react-three/fiber'
import { useEffect, useRef, type RefObject } from 'react'
import * as THREE from 'three'
import type { PageDirection } from '../types'

interface PageTurnAnimationProps {
  direction: PageDirection | null
  leftPageRef: RefObject<THREE.Group | null>
  rightPageRef: RefObject<THREE.Group | null>
  leftShadowRef: RefObject<THREE.MeshBasicMaterial | null>
  rightShadowRef: RefObject<THREE.MeshBasicMaterial | null>
  onComplete: () => void
}

const TURN_DURATION = 0.95
const LEFT_OPEN_ROTATION = 0.075
const RIGHT_OPEN_ROTATION = -0.075

function easeInOut(value: number) {
  return value < 0.5 ? 4 * value * value * value : 1 - Math.pow(-2 * value + 2, 3) / 2
}

export function PageTurnAnimation({
  direction,
  leftPageRef,
  rightPageRef,
  leftShadowRef,
  rightShadowRef,
  onComplete,
}: PageTurnAnimationProps) {
  const elapsedRef = useRef(0)
  const completedRef = useRef(false)

  useEffect(() => {
    elapsedRef.current = 0
    completedRef.current = false
  }, [direction])

  useFrame((_, delta) => {
    if (!direction || completedRef.current) return
    const page = direction === 'next' ? rightPageRef.current : leftPageRef.current
    const shadow = direction === 'next' ? rightShadowRef.current : leftShadowRef.current
    if (!page) return

    elapsedRef.current = Math.min(TURN_DURATION, elapsedRef.current + delta)
    const progress = easeInOut(elapsedRef.current / TURN_DURATION)
    page.rotation.y = direction === 'next'
      ? THREE.MathUtils.lerp(RIGHT_OPEN_ROTATION, -Math.PI + LEFT_OPEN_ROTATION, progress)
      : THREE.MathUtils.lerp(LEFT_OPEN_ROTATION, Math.PI + RIGHT_OPEN_ROTATION, progress)
    const pageCompression = 1 - Math.sin(progress * Math.PI) * 0.02
    page.scale.set(pageCompression, pageCompression, 1)
    if (shadow) shadow.opacity = Math.sin(progress * Math.PI) * 0.34

    if (elapsedRef.current >= TURN_DURATION) {
      completedRef.current = true
      page.rotation.y = direction === 'next' ? RIGHT_OPEN_ROTATION : LEFT_OPEN_ROTATION
      page.scale.set(1, 1, 1)
      if (shadow) shadow.opacity = 0
      onComplete()
    }
  })

  return null
}
