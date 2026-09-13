import { useEffect, useMemo, useRef, type ElementRef } from 'react'
import { ArcballControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { UniverseScale } from '../../product/contracts'

interface UniverseCameraRigProps {
  scale: UniverseScale
  planetRadius: number
  traveling: boolean
  focusPosition: [number, number, number] | null
  fieldRadius: number
  resetToken: number
  ready?: boolean
}

const desktopPositions: Record<UniverseScale, THREE.Vector3> = {
  planet: new THREE.Vector3(0, 0.45, 5.1),
  galaxy: new THREE.Vector3(0, 17, 12),
  nebula: new THREE.Vector3(0, 4, 27),
}

const narrowPositions: Record<UniverseScale, THREE.Vector3> = {
  planet: new THREE.Vector3(0, 0.45, 6.2),
  galaxy: new THREE.Vector3(0, 18, 12),
  nebula: new THREE.Vector3(0, 6.5, 43),
}

const distanceLimits: Record<UniverseScale, [number, number]> = {
  planet: [2.15, 12],
  galaxy: [1.45, 58],
  nebula: [1.8, 180],
}

const worldUp = new THREE.Vector3(0, 1, 0)

interface ArcballRuntimeControls {
  setCamera: (camera: THREE.Camera) => void
}

export function UniverseCameraRig({
  scale,
  planetRadius,
  traveling,
  focusPosition,
  fieldRadius,
  resetToken,
  ready = true,
}: UniverseCameraRigProps) {
  const controlsRef = useRef<ElementRef<typeof ArcballControls>>(null)
  const { camera, size } = useThree()
  const desiredCamera = useRef(new THREE.Vector3())
  const desiredTarget = useRef(new THREE.Vector3())
  const transitionStartCamera = useRef(new THREE.Vector3())
  const transitionStartTarget = useRef(new THREE.Vector3())
  const transitionElapsed = useRef(0)
  const transitioningRef = useRef(true)
  const previousScaleRef = useRef(scale)
  const wasTravelingRef = useRef(traveling)
  const pressedKeysRef = useRef(new Set<string>())
  const forward = useMemo(() => new THREE.Vector3(), [])
  const right = useMemo(() => new THREE.Vector3(), [])
  const movement = useMemo(() => new THREE.Vector3(), [])
  const basePosition = useMemo(() => {
    const base = size.width < 700 ? narrowPositions[scale] : desktopPositions[scale]
    if (scale === 'planet') {
      const distance = size.width < 700
        ? Math.max(6.6, planetRadius * 6)
        : Math.max(5.8, planetRadius * 4.8)
      return new THREE.Vector3(0, distance * 0.088, distance)
    }
    const minimumDistance = fieldRadius * (scale === 'galaxy'
      ? (size.width < 700 ? 2.5 : 2.7)
      : (size.width < 700 ? 1.65 : 1.25))
    return base.length() >= minimumDistance ? base : base.clone().setLength(minimumDistance)
  }, [fieldRadius, planetRadius, scale, size.width])
  const safeMinimumDistance = useMemo(() => {
    const configured = distanceLimits[scale][0]
    if (scale === 'galaxy') return Math.max(configured, planetRadius * 2.2, 3.4)
    if (scale === 'planet') return Math.max(configured, planetRadius * 1.35)
    return configured
  }, [planetRadius, scale])
  const safeMaximumDistance = Math.max(distanceLimits[scale][1], basePosition.length() * 1.35)

  useEffect(() => {
    const controls = controlsRef.current
    if (!controls) return
    if (!ready) {
      transitioningRef.current = false
      return
    }

    if (scale !== 'planet' && focusPosition) {
      desiredTarget.current.set(...focusPosition)
      const approach = camera.position.clone().sub(controls.target)
      if (approach.lengthSq() < 0.01) approach.set(0.7, 0.6, 1)
      approach.normalize().multiplyScalar(4.8)
      desiredCamera.current.copy(desiredTarget.current).add(approach)
    } else {
      desiredTarget.current.set(0, 0, 0)
      desiredCamera.current.copy(basePosition)
    }
    const scaleChanged = previousScaleRef.current !== scale
    previousScaleRef.current = scale
    if (scaleChanged) {
      camera.position.copy(desiredCamera.current)
      controls.target.copy(desiredTarget.current)
      camera.up.copy(worldUp)
      camera.lookAt(controls.target)
      camera.updateMatrix()
      ;(controls as unknown as ArcballRuntimeControls).setCamera(camera)
      controls.saveState()
      controls.update()
      transitioningRef.current = false
    } else {
      transitionStartCamera.current.copy(camera.position)
      transitionStartTarget.current.copy(controls.target)
      transitionElapsed.current = 0
      transitioningRef.current = true
    }
  }, [basePosition, camera, focusPosition, ready, resetToken, scale])

  useEffect(() => {
    const controls = controlsRef.current
    const wasTraveling = wasTravelingRef.current
    wasTravelingRef.current = traveling
    if (!controls || traveling || !wasTraveling) return

    // The travel camera uses a transported local up vector. Restore the
    // universe horizon before handing control back to ArcballControls so a
    // completed or cancelled trip cannot leave the user upside down.
    camera.up.copy(worldUp)
    camera.lookAt(controls.target)
    camera.updateMatrix()
    ;(controls as unknown as ArcballRuntimeControls).setCamera(camera)
    controls.saveState()
    controls.update()
  }, [camera, traveling])

  useEffect(() => {
    const pressedKeys = pressedKeysRef.current
    const controlledKeys = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE'])
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!controlledKeys.has(event.code) || event.repeat) return
      pressedKeys.add(event.code)
      transitioningRef.current = false
    }
    const handleKeyUp = (event: KeyboardEvent) => pressedKeys.delete(event.code)
    const handleBlur = () => pressedKeys.clear()
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', handleBlur)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', handleBlur)
      pressedKeys.clear()
    }
  }, [])

  useFrame((_, delta) => {
    const controls = controlsRef.current
    if (!controls || traveling) return

    if (transitioningRef.current) {
      transitionElapsed.current += Math.min(delta, 0.05)
      const duration = size.width < 700 ? 0.82 : 0.72
      const progress = Math.min(1, transitionElapsed.current / duration)
      const eased = 1 - Math.pow(1 - progress, 3)
      camera.position.copy(transitionStartCamera.current).lerp(desiredCamera.current, eased)
      controls.target.copy(transitionStartTarget.current).lerp(desiredTarget.current, eased)
      camera.up.copy(worldUp)
      camera.lookAt(controls.target)
      controls.update()
      if (progress >= 1) {
        camera.position.copy(desiredCamera.current)
        controls.target.copy(desiredTarget.current)
        camera.up.copy(worldUp)
        camera.lookAt(controls.target)
        camera.updateMatrix()
        ;(controls as unknown as ArcballRuntimeControls).setCamera(camera)
        controls.saveState()
        controls.update()
        transitioningRef.current = false
      }
      return
    }

    const pressedKeys = pressedKeysRef.current
    if (pressedKeys.size === 0) return
    forward.copy(controls.target).sub(camera.position).normalize()
    right.crossVectors(forward, camera.up)
    if (right.lengthSq() < 0.0001) right.crossVectors(forward, worldUp)
    right.normalize()
    movement.set(0, 0, 0)
    if (pressedKeys.has('KeyW')) movement.add(forward)
    if (pressedKeys.has('KeyS')) movement.sub(forward)
    if (pressedKeys.has('KeyD')) movement.add(right)
    if (pressedKeys.has('KeyA')) movement.sub(right)
    if (pressedKeys.has('KeyE')) movement.add(worldUp)
    if (pressedKeys.has('KeyQ')) movement.sub(worldUp)
    if (movement.lengthSq() === 0) return

    const distance = camera.position.distanceTo(controls.target)
    const speed = THREE.MathUtils.clamp(distance * 0.85, 2.4, 14)
    movement.normalize().multiplyScalar(speed * delta)
    camera.position.add(movement)
    controls.target.add(movement)
    controls.update()
  })

  return (
    <ArcballControls
      key={`${scale}-${resetToken}`}
      ref={controlsRef}
      enabled={!traveling}
      enableRotate
      enablePan
      enableZoom
      enableAnimations
      dampingFactor={18}
      scaleFactor={1.12}
      minDistance={safeMinimumDistance}
      maxDistance={safeMaximumDistance}
      onStart={() => {
        transitioningRef.current = false
      }}
    />
  )
}
