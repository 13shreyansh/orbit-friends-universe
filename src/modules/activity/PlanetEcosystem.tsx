import { Html, Sparkles } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { ActivityPost } from '../../product/contracts'
import { useI18n } from '../../product/i18n'
import type { AuthoredWorldEcologySurface as PlanetEcologySurfaceDefinition } from '../planet/authoredWorldLibrary'
import { ecosystemTraits } from './ecosystemPresentation'

interface PlanetEcosystemProps {
  activity: ActivityPost
  radius: number
  surface: PlanetEcologySurfaceDefinition
  layerIndex?: number
  onSelect: (activity: ActivityPost) => void
  canClose?: boolean
  onClose?: () => void
}

interface SurfaceFeature {
  normal: THREE.Vector3
  position: THREE.Vector3
  quaternion: THREE.Quaternion
  height: number
  width: number
  variation: number
}

function seededRandom(seed: number) {
  let value = seed >>> 0
  return () => {
    value += 0x6d2b79f5
    let result = value
    result = Math.imul(result ^ (result >>> 15), result | 1)
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61)
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296
  }
}

function createCluster(
  activity: ActivityPost,
  radius: number,
  count: number,
  offset: number,
  layerIndex: number,
  spread: number,
  altitudeScale: number,
): SurfaceFeature[] {
  const random = seededRandom(activity.ecosystemEffect.seed + offset + layerIndex * 1013)
  const azimuth = -0.92 + random() * 1.84 + layerIndex * 0.48
  const center = new THREE.Vector3(
    Math.sin(azimuth) * 0.82,
    (random() - 0.5) * 1.1,
    Math.cos(azimuth),
  ).normalize()
  const reference = Math.abs(center.y) > 0.88 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)
  const tangent = new THREE.Vector3().crossVectors(reference, center).normalize()
  const bitangent = new THREE.Vector3().crossVectors(center, tangent).normalize()
  const up = new THREE.Vector3(0, 1, 0)
  return Array.from({ length: count }, () => {
    const distance = Math.sqrt(random()) * spread
    const angle = random() * Math.PI * 2
    const normal = center.clone()
      .addScaledVector(tangent, Math.cos(angle) * distance)
      .addScaledVector(bitangent, Math.sin(angle) * distance)
      .normalize()
    const height = radius * (0.038 + random() * 0.055)
    return {
      normal,
      position: normal.clone().multiplyScalar(radius * (1 + altitudeScale)),
      quaternion: new THREE.Quaternion().setFromUnitVectors(up, normal),
      height,
      width: height * (0.26 + random() * 0.22),
      variation: random(),
    }
  })
}

export function PlanetEcosystem({
  activity,
  radius,
  surface,
  layerIndex = 0,
  onSelect,
  canClose = false,
  onClose,
}: PlanetEcosystemProps) {
  const { t } = useI18n()
  const ecosystemRef = useRef<THREE.Group>(null)
  const beaconRef = useRef<THREE.Group>(null)
  const effect = activity.ecosystemEffect
  const traits = ecosystemTraits(effect)
  const dominantBiome = [
    { kind: 'forest', weight: traits.vitality * 0.7 + traits.connection * 0.3 },
    { kind: 'water', weight: traits.serenity * 0.72 + traits.motion * 0.22 + traits.memory * 0.06 },
    { kind: 'volcano', weight: traits.intensity * 0.78 + traits.novelty * 0.22 },
    { kind: 'mountain', weight: traits.novelty * 0.48 + traits.memory * 0.3 + traits.intensity * 0.22 },
    { kind: 'desert', weight: (1 - traits.vitality) * 0.52 + (1 - traits.serenity) * 0.18 + traits.novelty * 0.18 + traits.intensity * 0.12 },
  ].reduce((strongest, candidate) => candidate.weight > strongest.weight ? candidate : strongest).kind
  const forestCount = dominantBiome === 'forest' ? Math.round(10 + traits.vitality * 12) : 0
  const mountainCount = dominantBiome === 'mountain'
    ? Math.round(4 + traits.novelty * 5)
    : dominantBiome === 'volcano' ? 2 : 0
  const waterCount = dominantBiome === 'water' ? Math.round(2 + traits.serenity * 3) : 0
  const volcanoCount = dominantBiome === 'volcano' ? Math.round(1 + traits.intensity) : 0
  const desertCount = dominantBiome === 'desert' ? Math.round(7 + (1 - traits.vitality) * 8) : 0
  const trees = useMemo(
    () => createCluster(activity, radius, forestCount, 17, layerIndex, 0.34 + traits.connection * 0.11, surface.altitudeScale),
    [activity, forestCount, layerIndex, radius, surface.altitudeScale, traits.connection],
  )
  const mountains = useMemo(
    () => createCluster(activity, radius, mountainCount, 431, layerIndex, 0.3, surface.altitudeScale),
    [activity, layerIndex, mountainCount, radius, surface.altitudeScale],
  )
  const waters = useMemo(
    () => createCluster(activity, radius, waterCount, 907, layerIndex, 0.27 + traits.motion * 0.08, surface.altitudeScale),
    [activity, layerIndex, radius, surface.altitudeScale, traits.motion, waterCount],
  )
  const volcanoes = useMemo(
    () => createCluster(activity, radius, volcanoCount, 1301, layerIndex, 0.22, surface.altitudeScale),
    [activity, layerIndex, radius, surface.altitudeScale, volcanoCount],
  )
  const dunes = useMemo(
    () => createCluster(activity, radius, desertCount, 1723, layerIndex, 0.31, surface.altitudeScale),
    [activity, desertCount, layerIndex, radius, surface.altitudeScale],
  )
  const beaconFeature = trees[0] ?? mountains[0] ?? waters[0] ?? volcanoes[0] ?? dunes[0]
  const beaconHeight = radius * (4.2 + effect.signalStrength * 2.8)

  useFrame((state, delta) => {
    if (ecosystemRef.current) ecosystemRef.current.rotation.y += delta * 0.035
    if (beaconRef.current) {
      const pulse = 1 + Math.sin(state.clock.elapsedTime * 2.5 + layerIndex) * 0.08
      beaconRef.current.scale.setScalar(pulse)
      beaconRef.current.rotation.y += delta * 0.18
    }
  })

  return (
    <group ref={ecosystemRef} userData={{ activityId: activity.id, ecosystemKind: effect.kind, anchorMode: surface.anchorMode }}>
      {trees[0] && (
        <group position={trees[0].position} quaternion={trees[0].quaternion}>
          <mesh position={[0, radius * 0.0005, 0]} scale={[2.5, 1, 1.55]} receiveShadow>
            <cylinderGeometry args={[radius * 0.055, radius * 0.062, radius * 0.003, 28]} />
            <meshStandardMaterial color="#315b36" roughness={1} />
          </mesh>
        </group>
      )}

      {waters.map((feature, index) => (
        <group key={`water-${index}`} position={feature.position} quaternion={feature.quaternion}>
          <mesh position={[0, radius * 0.0015, 0]} scale={[1.45 + feature.variation, 1, 0.72 + feature.variation * 0.42]} receiveShadow>
            <cylinderGeometry args={[radius * 0.052, radius * 0.058, radius * 0.004, 32]} />
            <meshPhysicalMaterial
              color={index % 2 ? '#2e91ae' : '#176b91'}
              roughness={0.12}
              metalness={0.08}
              clearcoat={0.9}
              clearcoatRoughness={0.08}
              transparent
              opacity={0.9}
            />
          </mesh>
          <mesh position={[0, radius * 0.004, 0]} rotation-x={-Math.PI / 2} scale={0.82 + feature.variation * 0.3}>
            <ringGeometry args={[radius * 0.044, radius * 0.047, 40]} />
            <meshBasicMaterial color="#8bd7d4" transparent opacity={0.38} depthWrite={false} />
          </mesh>
        </group>
      ))}

      {trees.map((feature, index) => {
        const height = feature.height * (0.7 + traits.vitality * 0.42)
        const canopy = index % 3 === 0 ? '#6f9b50' : index % 3 === 1 ? '#2f7548' : '#255d3d'
        return (
          <group key={`tree-${index}`} position={feature.position} quaternion={feature.quaternion}>
            <mesh position={[0, height * 0.26, 0]} castShadow receiveShadow>
              <cylinderGeometry args={[feature.width * 0.22, feature.width * 0.34, height * 0.52, 6]} />
              <meshStandardMaterial color="#4b3525" roughness={0.98} />
            </mesh>
            <mesh position={[0, height * 0.68, 0]} castShadow receiveShadow scale={[1, 0.9 + feature.variation * 0.3, 1]}>
              <coneGeometry args={[feature.width * (1.35 + traits.connection * 0.35), height * 0.72, 7]} />
              <meshStandardMaterial color={canopy} roughness={0.88} />
            </mesh>
            {index % 5 === 0 && (
              <mesh position={[0, height * 0.54, 0]} castShadow>
                <icosahedronGeometry args={[feature.width * 0.92, 1]} />
                <meshStandardMaterial color="#4f8650" roughness={0.92} />
              </mesh>
            )}
          </group>
        )
      })}

      {mountains.map((feature, index) => {
        const height = feature.height * (1.05 + traits.novelty * 0.75)
        return (
          <group key={`mountain-${index}`} position={feature.position} quaternion={feature.quaternion}>
            <mesh position={[0, height * 0.44, 0]} castShadow receiveShadow rotation-y={feature.variation * Math.PI}>
              <coneGeometry args={[feature.width * 1.65, height, 7]} />
              <meshStandardMaterial color={index % 2 ? '#6f6c61' : '#817661'} roughness={0.96} />
            </mesh>
            {height > radius * 0.085 && (
              <mesh position={[0, height * 0.81, 0]} castShadow>
                <coneGeometry args={[feature.width * 0.58, height * 0.27, 7]} />
                <meshStandardMaterial color="#d8d8c9" roughness={0.82} />
              </mesh>
            )}
          </group>
        )
      })}

      {volcanoes.map((feature, index) => {
        const height = feature.height * 1.45
        return (
          <group key={`volcano-${index}`} position={feature.position} quaternion={feature.quaternion}>
            <mesh position={[0, height * 0.42, 0]} castShadow receiveShadow>
              <coneGeometry args={[feature.width * 2.05, height, 12]} />
              <meshStandardMaterial color="#382d2a" roughness={0.98} />
            </mesh>
            <mesh position={[0, height * 0.88, 0]} rotation-x={Math.PI / 2}>
              <torusGeometry args={[feature.width * 0.48, feature.width * 0.19, 8, 24]} />
              <meshStandardMaterial color="#e14f22" emissive="#ff3a14" emissiveIntensity={1.6} roughness={0.5} />
            </mesh>
            <pointLight position={[0, height, 0]} color="#ff5428" intensity={0.42} distance={radius * 0.3} />
          </group>
        )
      })}

      {dunes.map((feature, index) => (
        <group key={`dune-${index}`} position={feature.position} quaternion={feature.quaternion}>
          <mesh
            position={[0, feature.height * 0.12, 0]}
            rotation-y={feature.variation * Math.PI}
            scale={[1.7 + feature.variation, 0.28, 0.72 + feature.variation * 0.28]}
            castShadow
            receiveShadow
          >
            <sphereGeometry args={[feature.width * 1.75, 14, 8]} />
            <meshStandardMaterial color={index % 3 === 0 ? '#c9995f' : index % 3 === 1 ? '#b9854f' : '#d5ad70'} roughness={0.98} />
          </mesh>
        </group>
      ))}

      {beaconFeature && activity.broadcast.active && activity.broadcast.visible && (
        <group
          ref={beaconRef}
          position={beaconFeature.normal.clone().multiplyScalar(radius * 1.055)}
          quaternion={beaconFeature.quaternion}
          onClick={(event) => {
            event.stopPropagation()
            onSelect(activity)
          }}
        >
          <mesh position={[0, beaconHeight * 0.5, 0]}>
            <cylinderGeometry args={[radius * 0.013, radius * 0.013, beaconHeight, 18, 1, true]} />
            <meshBasicMaterial
              color="#ffffff"
              transparent
              opacity={0.98}
              side={THREE.DoubleSide}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
          <mesh position={[0, beaconHeight * 0.5, 0]}>
            <cylinderGeometry args={[radius * 0.035, radius * 0.035, beaconHeight, 20, 1, true]} />
            <meshBasicMaterial
              color="#a7e7ff"
              transparent
              opacity={0.32 + effect.signalStrength * 0.1}
              side={THREE.DoubleSide}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
          />
          </mesh>
          <mesh position={[0, beaconHeight * 0.5, 0]}>
            <cylinderGeometry args={[radius * 0.085, radius * 0.085, beaconHeight, 20, 1, true]} />
            <meshBasicMaterial
              color="#4f9dff"
              transparent
              opacity={0.055 + effect.signalStrength * 0.035}
              side={THREE.DoubleSide}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
          <mesh position={[0, radius * 0.024, 0]} scale={[1, 0.18, 1]}>
            <sphereGeometry args={[radius * 0.22, 28, 18]} />
            <meshBasicMaterial
              color={effect.primaryColor}
              transparent
              opacity={0.42}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
          <mesh position={[0, radius * 0.018, 0]}>
            <octahedronGeometry args={[radius * 0.024, 0]} />
            <meshStandardMaterial color={effect.secondaryColor} emissive={effect.primaryColor} emissiveIntensity={2.2} roughness={0.35} />
          </mesh>
          <mesh position={[0, radius * 0.012, 0]} rotation-x={Math.PI / 2}>
            <torusGeometry args={[radius * 0.12, radius * 0.006, 8, 64]} />
            <meshBasicMaterial
              color={effect.primaryColor}
              transparent
              opacity={0.72}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
          <mesh position={[0, radius * 0.016, 0]} rotation-x={Math.PI / 2}>
            <torusGeometry args={[radius * 0.22, radius * 0.0035, 8, 80]} />
            <meshBasicMaterial
              color={effect.secondaryColor}
              transparent
              opacity={0.38}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
          <pointLight
            position={[0, radius * 0.16, 0]}
            color={effect.primaryColor}
            intensity={1.8 + effect.signalStrength * 2.6}
            distance={radius * 2.4}
          />
          {canClose && onClose && (
            <Html
              position={[0, radius * 0.16, 0]}
              center
              zIndexRange={[12, 0]}
              style={{ pointerEvents: 'auto' }}
            >
              <button
                type="button"
                aria-label={t('broadcast.close')}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation()
                  onClose()
                }}
                style={{
                  padding: '7px 12px',
                  border: '1px solid rgba(207,240,255,.38)',
                  borderRadius: 999,
                  background: 'rgba(8,15,33,.9)',
                  boxShadow: `0 0 22px ${effect.primaryColor}45`,
                  color: 'rgba(235,250,255,.92)',
                  fontSize: 10,
                  letterSpacing: '.08em',
                  whiteSpace: 'nowrap',
                  cursor: 'pointer',
                }}
              >
                × {t('broadcast.close')}
              </button>
            </Html>
          )}
        </group>
      )}

      <Sparkles
        count={Math.round(2 + effect.signalStrength * 4)}
        scale={radius * 2.05}
        size={0.65}
        speed={0.08}
        color="#d8e7cf"
        opacity={0.18}
      />
    </group>
  )
}
