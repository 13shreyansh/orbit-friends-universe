import { useEffect, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { useSceneStore } from '../../store/useSceneStore'
import { usePeopleStore } from '../../store/usePeopleStore'
import { getPersonWorldPosition, getPlanetRadius } from '../../utils/relationshipVisuals'

// Default "roaming" camera pose — matches CosmosCanvas's initial camera prop.
const RETURN_POSITION = new THREE.Vector3(0, 4, 14)
const RETURN_TARGET = new THREE.Vector3(0, 0, 0)

const FOCUS_BASE_DISTANCE = 2.2
const FOCUS_RADIUS_FACTOR = 2.4 // extra distance per unit of planet radius
const FOCUS_HEIGHT = 0.65
const FOCUS_APPROACH_ANGLE = THREE.MathUtils.degToRad(38)
// Extra pull-back so the memory-fragment orbit around the person fits in frame.
const MEMORIES_MODE_EXTRA_DISTANCE = 2.1

// Exponential-damping rate: higher = snappier convergence, lower = more
// gradual. ~2.3 reads as an unhurried ~1.5-2s cinematic settle rather than
// a snap — slow enough to track with the eye instead of disorienting it.
const DAMP_LAMBDA = 2.3
const ARRIVE_EPSILON = 0.12

/**
 * Owns the camera: flies it smoothly to a selected person (or back to the
 * default establishing shot) and hands control to/from OrbitControls.
 *
 * OrbitControls is only ever mounted while nothing is selected AND the
 * camera has fully settled back at the default pose — mounting it any other
 * time would fight this component's per-frame camera writes (OrbitControls
 * recomputes camera.position from its own internal state every frame it's
 * active, regardless of its `enabled` flag).
 */
export function CameraController() {
  const { camera } = useThree()
  const [orbitEnabled, setOrbitEnabled] = useState(true)

  const selectedPersonId = useSceneStore((state) => state.selectedPersonId)
  const mode = useSceneStore((state) => state.mode)
  const people = usePeopleStore((state) => state.people)
  const maxMemoryCount = usePeopleStore((state) => state.maxMemoryCount)

  const targetCameraPos = useRef(new THREE.Vector3().copy(RETURN_POSITION))
  const targetLookAt = useRef(new THREE.Vector3().copy(RETURN_TARGET))
  const currentLookAt = useRef(new THREE.Vector3().copy(RETURN_TARGET))

  // Recompute the flight target whenever the selection changes, and hand
  // camera control away from OrbitControls immediately.
  useEffect(() => {
    if (mode === 'cometRide') {
      setOrbitEnabled(false)
      return
    }

    if (selectedPersonId === null) {
      targetCameraPos.current.copy(RETURN_POSITION)
      targetLookAt.current.copy(RETURN_TARGET)
      return
    }

    const person = people.find((candidate) => candidate.id === selectedPersonId)
    if (!person) return

    const personPosition = getPersonWorldPosition(person)
    const planetRadius = getPlanetRadius(person.memoryCount, maxMemoryCount)
    const distance =
      FOCUS_BASE_DISTANCE +
      planetRadius * FOCUS_RADIUS_FACTOR +
      (mode === 'memories' ? MEMORIES_MODE_EXTRA_DISTANCE : 0)

    // Approach from a three-quarter angle rather than straight out along the
    // core→person line — otherwise the relationship arc points directly at
    // the camera and reads as a stray line cutting through the planet.
    const radialDirection = personPosition.clone().normalize()
    const approachDirection = radialDirection.applyAxisAngle(
      new THREE.Vector3(0, 1, 0),
      FOCUS_APPROACH_ANGLE,
    )
    const offset = approachDirection.multiplyScalar(distance)
    offset.y += FOCUS_HEIGHT

    targetCameraPos.current.copy(personPosition).add(offset)
    targetLookAt.current.copy(personPosition)
    setOrbitEnabled(false)
  }, [selectedPersonId, mode, people, maxMemoryCount])

  useFrame((_, delta) => {
    if (mode === 'cometRide') return
    if (orbitEnabled) return // OrbitControls owns the camera entirely right now

    camera.position.x = THREE.MathUtils.damp(camera.position.x, targetCameraPos.current.x, DAMP_LAMBDA, delta)
    camera.position.y = THREE.MathUtils.damp(camera.position.y, targetCameraPos.current.y, DAMP_LAMBDA, delta)
    camera.position.z = THREE.MathUtils.damp(camera.position.z, targetCameraPos.current.z, DAMP_LAMBDA, delta)

    currentLookAt.current.x = THREE.MathUtils.damp(currentLookAt.current.x, targetLookAt.current.x, DAMP_LAMBDA, delta)
    currentLookAt.current.y = THREE.MathUtils.damp(currentLookAt.current.y, targetLookAt.current.y, DAMP_LAMBDA, delta)
    currentLookAt.current.z = THREE.MathUtils.damp(currentLookAt.current.z, targetLookAt.current.z, DAMP_LAMBDA, delta)
    camera.lookAt(currentLookAt.current)

    if (selectedPersonId === null) {
      const arrived = camera.position.distanceTo(targetCameraPos.current) < ARRIVE_EPSILON
      if (arrived) {
        camera.position.copy(RETURN_POSITION)
        camera.lookAt(RETURN_TARGET)
        setOrbitEnabled(true)
      }
    }
  })

  if (!orbitEnabled) return null

  return (
    <OrbitControls
      enablePan={false}
      enableDamping
      dampingFactor={0.06}
      rotateSpeed={0.55}
      zoomSpeed={0.7}
      minDistance={3.5}
      maxDistance={22}
      minPolarAngle={Math.PI / 5}
      maxPolarAngle={(Math.PI * 4) / 5}
    />
  )
}
