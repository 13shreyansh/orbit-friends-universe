import {
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from 'react'
import { Line } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import {
  ColorStoneVehicle,
  INTRO_GLOW_FRAGMENT_SHADER,
  INTRO_GLOW_VERTEX_SHADER,
} from './ColorStoneVehicle'
import { CometPassenger } from './CometPassenger'
import {
  CHARACTER_INTRO_DURATION,
  characterShowcaseRotation,
  preflightDuration,
  type TravelAnimationPhase,
} from './travelAnimation'

interface CometRideProps {
  active: boolean
  origin?: THREE.Vector3 | null
  destination: THREE.Vector3 | null
  passengerAssetUrl?: string
  showCharacterIntro?: boolean
  onApproachingArrival?: () => void
  onArrive: () => void
}

const FLIGHT_DURATION_SECONDS = 7.4
const ARRIVAL_FADE_LEAD_SECONDS = 1.15
const MAX_PREFLIGHT_FRAME_DELTA = 0.05
const MAX_VEHICLE_READY_WAIT_SECONDS = 1.2
const METEOR_VISUAL_SCALE = 0.68
const CAMERA_DISTANCE = 6.2
const CAMERA_HEIGHT = 2.8
const INTRO_CAMERA_DISTANCE = 3.8
const INTRO_CAMERA_HEIGHT = 1.45

const worldPosition = new THREE.Vector3()
const forward = new THREE.Vector3()
const cameraTarget = new THREE.Vector3()
const lookTarget = new THREE.Vector3()
const up = new THREE.Vector3(0, 1, 0)
const right = new THREE.Vector3()
const stableUp = new THREE.Vector3()
const orientation = new THREE.Matrix4()
const orbitOffset = new THREE.Vector3()
const orbitAxis = new THREE.Vector3()
const fallbackUpX = new THREE.Vector3(1, 0, 0)
const fallbackUpZ = new THREE.Vector3(0, 0, 1)

const FRAME_EPSILON = 1e-8

/**
 * Projects an existing up vector onto the plane perpendicular to the new
 * forward direction. Carrying the previous frame forward avoids the 180°
 * sign changes produced by repeatedly crossing a fixed world-up vector.
 */
function projectStableUp(
  direction: THREE.Vector3,
  previousUp: THREE.Vector3,
  preferredUp: THREE.Vector3,
  target: THREE.Vector3,
) {
  target.copy(previousUp).addScaledVector(direction, -previousUp.dot(direction))
  if (target.lengthSq() < FRAME_EPSILON) {
    target.copy(preferredUp).addScaledVector(direction, -preferredUp.dot(direction))
  }
  if (target.lengthSq() < FRAME_EPSILON) {
    target.copy(Math.abs(direction.x) < 0.8 ? fallbackUpX : fallbackUpZ)
    target.addScaledVector(direction, -target.dot(direction))
  }
  target.normalize()
  if (target.dot(previousUp) < 0) target.negate()
  return target
}

function stableLookAt(
  camera: THREE.Camera,
  target: THREE.Vector3,
  previousUp: THREE.Vector3,
  viewDirection: THREE.Vector3,
  nextUp: THREE.Vector3,
) {
  viewDirection.copy(target).sub(camera.position)
  if (viewDirection.lengthSq() < FRAME_EPSILON) return
  viewDirection.normalize()
  projectStableUp(viewDirection, previousUp, up, nextUp)
  previousUp.copy(nextUp)
  camera.up.copy(nextUp)
  camera.lookAt(target)
}

function createTravelRoute(origin: THREE.Vector3, destination: THREE.Vector3): THREE.CatmullRomCurve3 {
  const journeyDirection = destination.clone().sub(origin).normalize()
  const start = origin.clone().addScaledVector(journeyDirection, 1.55)
  const end = destination.clone().addScaledVector(journeyDirection, -1.25)
  const side = new THREE.Vector3().crossVectors(journeyDirection, up).normalize()
  if (side.lengthSq() < 0.001) side.set(1, 0, 0)
  const distance = start.distanceTo(end)
  const arcHeight = Math.max(2.2, distance * 0.48)
  const sideBend = Math.max(0.7, distance * 0.16)
  const firstControl = start
    .clone()
    .lerp(end, 0.28)
    .addScaledVector(up, arcHeight)
    .addScaledVector(side, sideBend)
  const secondControl = start
    .clone()
    .lerp(end, 0.72)
    .addScaledVector(up, arcHeight * 0.62)
    .addScaledVector(side, -sideBend * 0.35)

  return new THREE.CatmullRomCurve3(
    [start, firstControl, secondControl, end],
    false,
    'catmullrom',
    0.5,
  )
}

function RiderFallback() {
  return (
    <group position={[-0.2, 0.72, 0]} rotation-z={-0.14}>
      <mesh position={[0, 0.52, 0]}>
        <sphereGeometry args={[0.2, 20, 20]} />
        <meshStandardMaterial color="#f3c5a5" roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.16, 0]}>
        <capsuleGeometry args={[0.17, 0.38, 6, 12]} />
        <meshStandardMaterial color="#ef5d68" emissive="#6e1824" emissiveIntensity={0.35} />
      </mesh>
      <mesh position={[-0.2, -0.12, 0]} rotation-z={-0.36}>
        <capsuleGeometry args={[0.065, 0.35, 4, 8]} />
        <meshStandardMaterial color="#24365f" />
      </mesh>
      <mesh position={[0.2, -0.12, 0]} rotation-z={0.36}>
        <capsuleGeometry args={[0.065, 0.35, 4, 8]} />
        <meshStandardMaterial color="#24365f" />
      </mesh>
      <mesh position={[-0.21, 0.17, 0]} rotation-z={-0.82}>
        <capsuleGeometry args={[0.052, 0.3, 4, 8]} />
        <meshStandardMaterial color="#f3c5a5" />
      </mesh>
      <mesh position={[0.21, 0.17, 0]} rotation-z={0.82}>
        <capsuleGeometry args={[0.052, 0.3, 4, 8]} />
        <meshStandardMaterial color="#f3c5a5" />
      </mesh>
    </group>
  )
}

function CharacterIntroFallback({
  passengerAssetUrl,
  sequenceElapsedRef,
}: {
  passengerAssetUrl?: string
  sequenceElapsedRef: MutableRefObject<number>
}) {
  const characterRef = useRef<THREE.Group>(null)
  const glowMaterialRef = useRef<THREE.ShaderMaterial>(null)

  useFrame((state) => {
    if (!characterRef.current) return
    const introProgress = THREE.MathUtils.clamp(
      sequenceElapsedRef.current / CHARACTER_INTRO_DURATION,
      0,
      1,
    )
    const introScale = THREE.MathUtils.smootherstep(
      THREE.MathUtils.clamp(introProgress / 0.32, 0, 1),
      0,
      1,
    )
    characterRef.current.scale.setScalar(introScale)
    characterRef.current.rotation.y = characterShowcaseRotation(introProgress)
    characterRef.current.position.y = Math.sin(state.clock.elapsedTime * 2.4) * 0.035
    if (glowMaterialRef.current) {
      glowMaterialRef.current.uniforms.uOpacity.value =
        Math.sin(introProgress * Math.PI) * 0.12
    }
  })

  return (
    <group>
      <group ref={characterRef} position={[0.14, -0.27, 0]}>
        <CometPassenger assetUrl={passengerAssetUrl} />
      </group>
      <mesh position={[0, 0.45, 0.28]}>
        <planeGeometry args={[1.9, 1.9]} />
        <shaderMaterial
          ref={glowMaterialRef}
          vertexShader={INTRO_GLOW_VERTEX_SHADER}
          fragmentShader={INTRO_GLOW_FRAGMENT_SHADER}
          uniforms={{ uOpacity: { value: 0 } }}
          transparent
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </mesh>
    </group>
  )
}

export function CometRide({
  active,
  origin,
  destination,
  passengerAssetUrl,
  showCharacterIntro = false,
  onApproachingArrival,
  onArrive,
}: CometRideProps) {
  const meteorGroupRef = useRef<THREE.Group>(null)
  const meteorVisualRef = useRef<THREE.Group>(null)
  const progressRef = useRef(0)
  const sequenceElapsedRef = useRef(0)
  const vehicleReadyWaitRef = useRef(0)
  const vehicleReadyRef = useRef(false)
  const phaseRef = useRef<TravelAnimationPhase>('IDLE')
  const [phase, setPhase] = useState<TravelAnimationPhase>('IDLE')
  const arrivalFadeSentRef = useRef(false)
  const arrivalSentRef = useRef(false)
  const draggingRef = useRef(false)
  const orbitYawRef = useRef(0)
  const orbitPitchRef = useRef(0)
  const pointerRef = useRef({ x: 0, y: 0 })
  const vehicleUpRef = useRef(new THREE.Vector3(0, 1, 0))
  const cameraUpRef = useRef(new THREE.Vector3(0, 1, 0))
  const viewDirectionRef = useRef(new THREE.Vector3())
  const nextCameraUpRef = useRef(new THREE.Vector3())
  const { camera, gl } = useThree()

  const route = useMemo(
    () => (destination ? createTravelRoute(origin ?? new THREE.Vector3(), destination) : null),
    [destination, origin],
  )
  const routePreview = useMemo(() => route?.getPoints(120) ?? [], [route])

  useEffect(() => {
    if (!active || !route) return
    progressRef.current = 0
    sequenceElapsedRef.current = 0
    vehicleReadyWaitRef.current = 0
    vehicleReadyRef.current = false
    arrivalFadeSentRef.current = false
    arrivalSentRef.current = false
    orbitYawRef.current = 0
    orbitPitchRef.current = 0
    vehicleUpRef.current.copy(up)
    cameraUpRef.current.copy(up)
    const initialPhase = showCharacterIntro ? 'INTRO_CHARACTER_SHOW' : 'MOUNT_METEOR'
    phaseRef.current = initialPhase
    setPhase(initialPhase)

    route.getPointAt(0, worldPosition)
    route.getTangentAt(0, forward).normalize()
    camera.position
      .copy(worldPosition)
      .addScaledVector(forward, -CAMERA_DISTANCE)
      .addScaledVector(up, CAMERA_HEIGHT)
    lookTarget.copy(worldPosition).addScaledVector(forward, 3.5)
    stableLookAt(
      camera,
      lookTarget,
      cameraUpRef.current,
      viewDirectionRef.current,
      nextCameraUpRef.current,
    )
  }, [active, camera, destination, origin, route, showCharacterIntro])

  useEffect(() => {
    if (!active) return
    const canvas = gl.domElement
    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return
      draggingRef.current = true
      pointerRef.current = { x: event.clientX, y: event.clientY }
      canvas.setPointerCapture?.(event.pointerId)
    }
    const handlePointerMove = (event: PointerEvent) => {
      if (!draggingRef.current) return
      const deltaX = event.clientX - pointerRef.current.x
      const deltaY = event.clientY - pointerRef.current.y
      pointerRef.current = { x: event.clientX, y: event.clientY }
      orbitYawRef.current = THREE.MathUtils.clamp(orbitYawRef.current - deltaX * 0.0065, -Math.PI, Math.PI)
      orbitPitchRef.current = THREE.MathUtils.clamp(orbitPitchRef.current - deltaY * 0.005, -0.85, 0.85)
    }
    const stopDragging = () => {
      draggingRef.current = false
    }
    canvas.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopDragging)
    window.addEventListener('pointercancel', stopDragging)
    return () => {
      canvas.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopDragging)
      window.removeEventListener('pointercancel', stopDragging)
      draggingRef.current = false
    }
  }, [active, gl])

  useFrame((state, delta) => {
    if (!active || !route || !meteorGroupRef.current) return
    const preflightDelta = Math.min(delta, MAX_PREFLIGHT_FRAME_DELTA)
    if (!vehicleReadyRef.current) {
      vehicleReadyWaitRef.current += preflightDelta
    }
    const canAdvanceSequence =
      vehicleReadyRef.current ||
      (showCharacterIntro && sequenceElapsedRef.current < CHARACTER_INTRO_DURATION) ||
      vehicleReadyWaitRef.current >= MAX_VEHICLE_READY_WAIT_SECONDS
    if (canAdvanceSequence) sequenceElapsedRef.current += preflightDelta
    if (
      !vehicleReadyRef.current &&
      showCharacterIntro &&
      vehicleReadyWaitRef.current < MAX_VEHICLE_READY_WAIT_SECONDS
    ) {
      sequenceElapsedRef.current = Math.min(
        sequenceElapsedRef.current,
        CHARACTER_INTRO_DURATION,
      )
    }
    const sequenceElapsed = sequenceElapsedRef.current
    const flying = sequenceElapsed >= preflightDuration(showCharacterIntro)
    const progress = flying
      ? Math.min(1, progressRef.current + delta / FLIGHT_DURATION_SECONDS)
      : 0
    progressRef.current = progress
    const easedProgress = THREE.MathUtils.smootherstep(progress, 0, 1)
    route.getPointAt(easedProgress, worldPosition)
    route.getTangentAt(Math.min(easedProgress, 0.999), forward).normalize()

    meteorGroupRef.current.position.copy(worldPosition)
    projectStableUp(forward, vehicleUpRef.current, up, stableUp)
    right.crossVectors(stableUp, forward).normalize()
    stableUp.crossVectors(forward, right).normalize()
    if (stableUp.dot(vehicleUpRef.current) < 0) {
      stableUp.negate()
      right.negate()
    }
    vehicleUpRef.current.copy(stableUp)
    orientation.makeBasis(right, stableUp, forward)
    meteorGroupRef.current.quaternion.setFromRotationMatrix(orientation)

    let nextPhase: TravelAnimationPhase
    if (!flying) {
      nextPhase =
        showCharacterIntro && sequenceElapsed < CHARACTER_INTRO_DURATION
          ? 'INTRO_CHARACTER_SHOW'
          : 'MOUNT_METEOR'
    } else {
      nextPhase = showCharacterIntro ? 'FLYING_TO_PLANET' : 'FLYING_BACK'
    }
    if (phaseRef.current !== nextPhase) {
      phaseRef.current = nextPhase
      setPhase(nextPhase)
    }

    if (meteorVisualRef.current) {
      const elapsed = state.clock.elapsedTime
      meteorVisualRef.current.position.set(
        Math.sin(elapsed * 0.83) * 0.025,
        Math.cos(elapsed * 0.67) * 0.04,
        0,
      )
      meteorVisualRef.current.rotation.set(
        Math.sin(elapsed * 0.54) * 0.025,
        Math.cos(elapsed * 0.49) * 0.025,
        Math.sin(elapsed * 0.43) * 0.018,
      )
    }

    if (!flying) {
      const showcaseOrbit = Math.sin(sequenceElapsed * 0.7) * 0.22
      cameraTarget
        .copy(worldPosition)
        .addScaledVector(forward, -INTRO_CAMERA_DISTANCE)
        .addScaledVector(stableUp, INTRO_CAMERA_HEIGHT)
        .addScaledVector(right, showcaseOrbit)
      camera.position.lerp(cameraTarget, 1 - Math.exp(-preflightDelta * 3.6))
      lookTarget.copy(worldPosition).addScaledVector(stableUp, 0.42)
      stableLookAt(
        camera,
        lookTarget,
        cameraUpRef.current,
        viewDirectionRef.current,
        nextCameraUpRef.current,
      )
      return
    }

    if (!draggingRef.current) {
      orbitYawRef.current = THREE.MathUtils.damp(
        orbitYawRef.current,
        0,
        1.4,
        delta,
      )
      orbitPitchRef.current = THREE.MathUtils.damp(
        orbitPitchRef.current,
        0,
        1.4,
        delta,
      )
    }
    orbitOffset
      .copy(forward)
      .multiplyScalar(-CAMERA_DISTANCE)
      .addScaledVector(stableUp, CAMERA_HEIGHT)
      .applyAxisAngle(stableUp, orbitYawRef.current)
    orbitAxis.crossVectors(stableUp, orbitOffset).normalize()
    orbitOffset.applyAxisAngle(orbitAxis, orbitPitchRef.current)
    cameraTarget.copy(worldPosition).add(orbitOffset)
    camera.position.lerp(cameraTarget, 1 - Math.exp(-delta * 2.4))
    lookTarget
      .copy(worldPosition)
      .addScaledVector(forward, draggingRef.current ? 0.4 : 3.5)
    stableLookAt(
      camera,
      lookTarget,
      cameraUpRef.current,
      viewDirectionRef.current,
      nextCameraUpRef.current,
    )

    const arrivalFadeThreshold =
      1 - ARRIVAL_FADE_LEAD_SECONDS / FLIGHT_DURATION_SECONDS
    if (progress >= arrivalFadeThreshold && !arrivalFadeSentRef.current) {
      arrivalFadeSentRef.current = true
      onApproachingArrival?.()
    }

    if (progress >= 1 && !arrivalSentRef.current) {
      arrivalSentRef.current = true
      phaseRef.current = 'ARRIVE_PLANET'
      setPhase('ARRIVE_PLANET')
      onArrive()
    }
  })

  if (!active || !route) return null

  return (
    <>
      <Line
        points={routePreview}
        color="#86bfff"
        transparent
        opacity={0.1}
        lineWidth={0.65}
        depthWrite={false}
      />

      <group
        ref={meteorGroupRef}
        scale={METEOR_VISUAL_SCALE}
        userData={{ animationPhase: phase }}
      >
        <group ref={meteorVisualRef}>
            <Suspense
              fallback={
                showCharacterIntro ? (
                  <Suspense fallback={<RiderFallback />}>
                    <CharacterIntroFallback
                      passengerAssetUrl={passengerAssetUrl}
                      sequenceElapsedRef={sequenceElapsedRef}
                    />
                  </Suspense>
                ) : (
                  <RiderFallback />
                )
              }
            >
              <ColorStoneVehicle
                passengerAssetUrl={passengerAssetUrl}
                sequenceElapsedRef={sequenceElapsedRef}
                vehicleReadyRef={vehicleReadyRef}
                showCharacterIntro={showCharacterIntro}
              />
            </Suspense>
        </group>
      </group>
    </>
  )
}
