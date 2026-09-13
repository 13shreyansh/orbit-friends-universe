import { useEffect, useMemo, useRef, type MutableRefObject } from 'react'
import { useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { BlueEnergyFlame } from './BlueEnergyFlame'
import { CometPassenger } from './CometPassenger'
import {
  CHARACTER_INTRO_DURATION,
  characterShowcaseRotation,
  IGNITION_DURATION,
  RETURN_MOUNT_DURATION,
  VISIT_MOUNT_DURATION,
} from './travelAnimation'

export const COLOR_STONE_ASSET_URL = '/orbit-friends-universe/models/color-stone.glb'

// Tune this single value if the supplied GLB looks too large or small in flight.
export const METEOR_TARGET_SIZE = 1.5
const PASSENGER_SEAT_OFFSET = 0.14
const STONE_ROTATION_OFFSET = new THREE.Euler(-0.12, 0.06, -0.08)
const INTRO_DUST_COUNT = 52

interface VehicleFit {
  center: THREE.Vector3
  scale: number
  passengerPosition: THREE.Vector3
  showcaseOffset: THREE.Vector3
  emitterPosition: THREE.Vector3
  flameLength: number
  flameRadius: number
}

const stoneCloneCache = new WeakMap<THREE.Object3D, THREE.Object3D>()
const vehicleFitCache = new WeakMap<THREE.Object3D, VehicleFit>()

export const INTRO_GLOW_VERTEX_SHADER = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

export const INTRO_GLOW_FRAGMENT_SHADER = `
  precision highp float;
  uniform float uOpacity;
  varying vec2 vUv;
  void main() {
    float distanceFromCenter = length(vUv - 0.5) * 2.0;
    float glow = 1.0 - smoothstep(0.0, 1.0, distanceFromCenter);
    glow = glow * glow * (3.0 - 2.0 * glow);
    gl_FragColor = vec4(vec3(0.50, 0.86, 1.0), glow * uOpacity);
  }
`

interface ColorStoneVehicleProps {
  passengerAssetUrl?: string
  sequenceElapsedRef: MutableRefObject<number>
  vehicleReadyRef: MutableRefObject<boolean>
  showCharacterIntro: boolean
}

function createIntroDustGeometry(): THREE.BufferGeometry {
  const positions = new Float32Array(INTRO_DUST_COUNT * 3)
  for (let index = 0; index < INTRO_DUST_COUNT; index += 1) {
    const seed = ((index * 48271) % 2147483647) / 2147483647
    const angle = seed * Math.PI * 2
    const height = ((seed * 19.73) % 1) * 1.6 - 0.8
    const radius = 0.62 + ((seed * 41.17) % 1) * 0.46
    positions[index * 3] = Math.cos(angle) * radius
    positions[index * 3 + 1] = height
    positions[index * 3 + 2] = Math.sin(angle) * radius
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  return geometry
}

function cloneStoneOnce(scene: THREE.Object3D): THREE.Object3D {
  const cached = stoneCloneCache.get(scene)
  if (cached) return cached
  const clone = scene.clone(true)
  stoneCloneCache.set(scene, clone)
  return clone
}

function measureVehicleOnce(scene: THREE.Object3D): VehicleFit {
  const cached = vehicleFitCache.get(scene)
  if (cached) return cached

  const box = new THREE.Box3().setFromObject(scene)
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const maximum = Math.max(size.x, size.y, size.z) || 1
  const scale = METEOR_TARGET_SIZE / maximum
  const fittedSize = size.clone().multiplyScalar(scale)
  const fittedMin = box.min.clone().sub(center).multiplyScalar(scale)
  const fittedMax = box.max.clone().sub(center).multiplyScalar(scale)
  const fit = {
    center,
    scale,
    passengerPosition: new THREE.Vector3(
      -fittedSize.x * 0.08,
      fittedMax.y + PASSENGER_SEAT_OFFSET,
      0,
    ),
    showcaseOffset: new THREE.Vector3(0, 0.45, 0).sub(
      new THREE.Vector3(
        -fittedSize.x * 0.08,
        fittedMax.y + PASSENGER_SEAT_OFFSET,
        0,
      ),
    ),
    emitterPosition: new THREE.Vector3(
      0,
      0,
      fittedMin.z - Math.max(0.08, fittedSize.z * 0.06),
    ),
    flameLength: THREE.MathUtils.clamp(fittedSize.z * 3.2, 2.2, 4.6),
    flameRadius: THREE.MathUtils.clamp(
      Math.max(fittedSize.x, fittedSize.y) * 0.2,
      0.12,
      0.32,
    ),
  }
  vehicleFitCache.set(scene, fit)
  return fit
}

export function ColorStoneVehicle({
  passengerAssetUrl,
  sequenceElapsedRef,
  vehicleReadyRef,
  showCharacterIntro,
}: ColorStoneVehicleProps) {
  const { scene } = useGLTF(COLOR_STONE_ASSET_URL)
  const stone = useMemo(() => cloneStoneOnce(scene), [scene])
  const stoneSpinRef = useRef<THREE.Group>(null)
  const stoneEntryRef = useRef<THREE.Group>(null)
  const passengerEntryRef = useRef<THREE.Group>(null)
  const introAuraRef = useRef<THREE.Group>(null)
  const introDustMaterialRef = useRef<THREE.PointsMaterial>(null)
  const introGlowMaterialRef = useRef<THREE.ShaderMaterial>(null)
  const flameLightRef = useRef<THREE.PointLight>(null)
  const flamePowerRef = useRef(0)
  const introDustGeometry = useMemo(() => createIntroDustGeometry(), [])
  const fit = useMemo(() => measureVehicleOnce(scene), [scene])

  useEffect(() => {
    vehicleReadyRef.current = true
    stone.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      object.castShadow = true
      object.receiveShadow = true
    })
    return () => {
      vehicleReadyRef.current = false
    }
  }, [stone, vehicleReadyRef])

  useFrame((state) => {
    if (!stoneSpinRef.current || !stoneEntryRef.current || !passengerEntryRef.current) return
    const elapsed = state.clock.elapsedTime
    const sequenceElapsed = sequenceElapsedRef.current

    stoneSpinRef.current.rotation.set(
      STONE_ROTATION_OFFSET.x + Math.sin(elapsed * 0.72) * 0.025,
      STONE_ROTATION_OFFSET.y + Math.cos(elapsed * 0.61) * 0.035,
      STONE_ROTATION_OFFSET.z + elapsed * 0.11,
    )

    if (showCharacterIntro) {
      const introProgress = THREE.MathUtils.clamp(
        sequenceElapsed / CHARACTER_INTRO_DURATION,
        0,
        1,
      )
      const mountProgress = THREE.MathUtils.clamp(
        (sequenceElapsed - CHARACTER_INTRO_DURATION) / VISIT_MOUNT_DURATION,
        0,
        1,
      )
      const ignitionProgress = THREE.MathUtils.clamp(
        (sequenceElapsed - CHARACTER_INTRO_DURATION - VISIT_MOUNT_DURATION) /
          IGNITION_DURATION,
        0,
        1,
      )
      const introScale = THREE.MathUtils.smootherstep(
        THREE.MathUtils.clamp(introProgress / 0.32, 0, 1),
        0,
        1,
      )
      const mountEase = THREE.MathUtils.smootherstep(mountProgress, 0, 1)

      const meteorEntering = sequenceElapsed >= CHARACTER_INTRO_DURATION - 0.04
      stoneEntryRef.current.visible = true
      stoneEntryRef.current.position.set(
        THREE.MathUtils.lerp(2.65, 0, mountEase),
        THREE.MathUtils.lerp(-0.5, 0, mountEase) + Math.sin(mountProgress * Math.PI) * 0.16,
        THREE.MathUtils.lerp(-0.35, 0, mountEase),
      )
      stoneEntryRef.current.scale.setScalar(
        meteorEntering ? THREE.MathUtils.lerp(0.72, 1, mountEase) : 0.001,
      )

      passengerEntryRef.current.position.copy(fit.showcaseOffset).multiplyScalar(1 - mountEase)
      passengerEntryRef.current.position.y +=
        Math.sin(elapsed * 2.4) * 0.035 * (1 - mountEase) +
        Math.sin(mountProgress * Math.PI) * 0.2
      passengerEntryRef.current.rotation.set(
        0,
        introProgress < 1 ? characterShowcaseRotation(introProgress) : 0,
        Math.sin(elapsed * 1.5) * 0.025 * (1 - mountEase),
      )
      passengerEntryRef.current.scale.setScalar(introScale)
      flamePowerRef.current = THREE.MathUtils.smootherstep(ignitionProgress, 0, 1) * 1.08

      if (introAuraRef.current) {
        introAuraRef.current.visible =
          sequenceElapsed < CHARACTER_INTRO_DURATION + VISIT_MOUNT_DURATION * 0.42
        introAuraRef.current.position.copy(fit.passengerPosition).add(fit.showcaseOffset)
        introAuraRef.current.position.y += Math.sin(elapsed * 2.4) * 0.035
        introAuraRef.current.rotation.y = elapsed * 0.22
        introAuraRef.current.scale.setScalar(0.92 + Math.sin(elapsed * 2.1) * 0.035)
      }
      const auraFade = Math.sin(Math.min(1, introProgress) * Math.PI) * (1 - mountProgress)
      if (introDustMaterialRef.current) introDustMaterialRef.current.opacity = auraFade * 0.72
      if (introGlowMaterialRef.current) {
        introGlowMaterialRef.current.uniforms.uOpacity.value = auraFade * 0.12
      }
    } else {
      const mountProgress = THREE.MathUtils.clamp(
        sequenceElapsed / RETURN_MOUNT_DURATION,
        0,
        1,
      )
      const mountEase = THREE.MathUtils.smootherstep(mountProgress, 0, 1)
      stoneEntryRef.current.visible = true
      stoneEntryRef.current.position.set(
        THREE.MathUtils.lerp(1.45, 0, mountEase),
        THREE.MathUtils.lerp(-0.28, 0, mountEase),
        THREE.MathUtils.lerp(-0.2, 0, mountEase),
      )
      stoneEntryRef.current.scale.setScalar(THREE.MathUtils.lerp(0.82, 1, mountEase))
      passengerEntryRef.current.position.set(0, (1 - mountEase) * 0.24, 0)
      passengerEntryRef.current.rotation.set(0, 0, 0)
      passengerEntryRef.current.scale.setScalar(1)
      flamePowerRef.current = THREE.MathUtils.smootherstep(
        THREE.MathUtils.clamp((mountProgress - 0.5) / 0.5, 0, 1),
        0,
        1,
      )
      if (introAuraRef.current) introAuraRef.current.visible = false
    }

    if (flameLightRef.current) {
      flameLightRef.current.intensity =
        1.25 * flamePowerRef.current * (0.94 + Math.sin(elapsed * 3.1) * 0.06)
    }
  })

  return (
    <>
      <group ref={stoneEntryRef}>
        <group ref={stoneSpinRef}>
          <primitive
            object={stone}
            scale={fit.scale}
            position={[
              -fit.center.x * fit.scale,
              -fit.center.y * fit.scale,
              -fit.center.z * fit.scale,
            ]}
          />
        </group>
      </group>

      <group ref={passengerEntryRef}>
        <CometPassenger
          assetUrl={passengerAssetUrl}
          position={fit.passengerPosition}
        />
      </group>

      {showCharacterIntro && (
        <group ref={introAuraRef}>
          <points geometry={introDustGeometry}>
            <pointsMaterial
              ref={introDustMaterialRef}
              color="#B8F3FF"
              size={0.045}
              transparent
              opacity={0}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
              toneMapped={false}
            />
          </points>
          <mesh position={[0, 0, 0.28]}>
            <planeGeometry args={[1.9, 1.9]} />
            <shaderMaterial
              ref={introGlowMaterialRef}
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
      )}

      <BlueEnergyFlame
        emitterPosition={fit.emitterPosition}
        length={fit.flameLength}
        radius={fit.flameRadius}
        powerRef={flamePowerRef}
      />
      <pointLight
        ref={flameLightRef}
        position={fit.emitterPosition}
        color="#7FDBFF"
        intensity={0}
        distance={4.2}
      />
    </>
  )
}

useGLTF.preload(COLOR_STONE_ASSET_URL)
