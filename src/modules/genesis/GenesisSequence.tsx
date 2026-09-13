import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Sparkles, Stars } from '@react-three/drei'
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing'
import { SkipForward } from 'lucide-react'
import * as THREE from 'three'
import type { PlanetVisualConfig } from '../../product/contracts'
import { useI18n } from '../../product/i18n'
import { PlanetRenderer } from '../planet/PlanetRenderer'
import styles from './GenesisSequence.module.css'

interface GenesisSequenceProps {
  config: PlanetVisualConfig
  planetName: string
  onComplete: () => void
  mode?: 'creation' | 'arrival'
}

export interface GenesisFormationProps {
  config: PlanetVisualConfig
  onComplete: () => void
  mode?: 'creation' | 'arrival'
  origin?: [number, number, number]
  sceneScale?: number
  finalPlanetScale?: number
  includeEnvironment?: boolean
  arrivalIgnitionProgress?: number
}

export const GENESIS_FORMATION_DURATION_MS = 7400
const DURATION = GENESIS_FORMATION_DURATION_MS / 1000
const PARTICLE_COUNT = 1600
const GENESIS_ORIGIN_Y = 0.25

const ENERGY_VERTEX_SHADER = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const ENERGY_FRAGMENT_SHADER = `
  precision highp float;
  uniform float uOpacity;
  varying vec2 vUv;

  void main() {
    float distanceFromCenter = length(vUv - 0.5) * 2.0;
    float halo = smoothstep(1.0, 0.0, distanceFromCenter);
    float core = smoothstep(0.34, 0.0, distanceFromCenter);
    float alpha = (halo * halo * 0.42 + core * 0.58) * uOpacity;
    if (alpha < 0.006) discard;
    vec3 color = mix(vec3(0.43, 0.76, 1.0), vec3(1.0, 0.96, 0.78), core);
    gl_FragColor = vec4(color, alpha);
  }
`

const SHOCKWAVE_VERTEX_SHADER = `
  varying vec3 vNormal;
  varying vec3 vViewDirection;
  void main() {
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vViewDirection = normalize(-viewPosition.xyz);
    gl_Position = projectionMatrix * viewPosition;
  }
`

const SHOCKWAVE_FRAGMENT_SHADER = `
  precision highp float;
  uniform float uOpacity;
  varying vec3 vNormal;
  varying vec3 vViewDirection;

  void main() {
    float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewDirection))), 5.2);
    float alpha = rim * uOpacity;
    if (alpha < 0.006) discard;
    gl_FragColor = vec4(0.53, 0.84, 1.0, alpha);
  }
`

function createGenesisParticles(startAtSingularity: boolean) {
  const positions = new Float32Array(PARTICLE_COUNT * 3)
  const origins = new Float32Array(PARTICLE_COUNT * 3)
  const colors = new Float32Array(PARTICLE_COUNT * 3)
  const initialFactor = startAtSingularity ? 0.012 : 1

  for (let index = 0; index < PARTICLE_COUNT; index++) {
    const theta = Math.random() * Math.PI * 2
    const phi = Math.acos(2 * Math.random() - 1)
    const radius = 0.25 + Math.pow(Math.random(), 0.45) * 9
    const x = radius * Math.sin(phi) * Math.cos(theta)
    const y = radius * Math.sin(phi) * Math.sin(theta)
    const z = radius * Math.cos(phi)
    origins[index * 3] = x
    origins[index * 3 + 1] = y
    origins[index * 3 + 2] = z
    // Arrival follows the authentication black hole collapsing into a point.
    // Initialising at the origin prevents one expanded-particle frame from
    // flashing on screen while the new Canvas mounts.
    positions[index * 3] = x * initialFactor
    positions[index * 3 + 1] = y * initialFactor
    positions[index * 3 + 2] = z * initialFactor
    colors[index * 3] = 0.46 + Math.random() * 0.35
    colors[index * 3 + 1] = 0.65 + Math.random() * 0.3
    colors[index * 3 + 2] = 0.82 + Math.random() * 0.18
  }

  return { positions, origins, colors }
}

export function GenesisFormation({
  config,
  onComplete,
  mode = 'creation',
  origin = [0, GENESIS_ORIGIN_Y, 0],
  sceneScale = 1,
  finalPlanetScale = 1,
  includeEnvironment = true,
  arrivalIgnitionProgress = 0.08,
}: GenesisFormationProps) {
  const pointsRef = useRef<THREE.Points>(null)
  const singularityRef = useRef<THREE.Mesh>(null)
  const flashRef = useRef<THREE.Mesh>(null)
  const shockwaveRef = useRef<THREE.Mesh>(null)
  const startRef = useRef<number | null>(null)
  const completeRef = useRef(false)
  const planetRef = useRef<THREE.Group>(null)
  const particleData = useMemo(() => createGenesisParticles(mode === 'arrival'), [mode])

  useFrame((state) => {
    if (startRef.current === null) startRef.current = state.clock.elapsedTime
    const elapsed = state.clock.elapsedTime - startRef.current
    const progress = Math.min(1, elapsed / DURATION)
    const arrivalIgnition = THREE.MathUtils.clamp(arrivalIgnitionProgress, 0.06, 0.24)
    const arrivalExpansionEnd = arrivalIgnition + 0.28

    if (pointsRef.current) {
      const attribute = pointsRef.current.geometry.attributes.position as THREE.BufferAttribute
      for (let index = 0; index < PARTICLE_COUNT; index++) {
        const ox = particleData.origins[index * 3]
        const oy = particleData.origins[index * 3 + 1]
        const oz = particleData.origins[index * 3 + 2]
        let factor = 1
        if (mode === 'arrival') {
          // The auth scene has already collapsed into a singularity. Hold the
          // same point briefly, detonate it, then let gravity form the planet.
          if (progress < arrivalIgnition) {
            factor = 0.012
          } else if (progress < arrivalExpansionEnd) {
            factor = 0.012 + THREE.MathUtils.smootherstep(
              (progress - arrivalIgnition) / 0.28,
              0,
              1,
            ) * 1.248
          } else {
            factor = 1.26 - THREE.MathUtils.smootherstep(
              (progress - arrivalExpansionEnd) / (0.86 - arrivalExpansionEnd),
              0,
              1,
            ) * 1.21
          }
        } else if (progress < 0.28) {
          factor = 1 - THREE.MathUtils.smootherstep(progress / 0.28, 0, 1) * 0.94
        } else if (progress < 0.48) {
          factor = 0.06 + THREE.MathUtils.smootherstep((progress - 0.28) / 0.2, 0, 1) * 1.15
        } else {
          factor = 1.21 - THREE.MathUtils.smootherstep((progress - 0.48) / 0.52, 0, 1) * 1.15
        }
        const swirl = progress * 2.5 + index * 0.002
        const cos = Math.cos(swirl)
        const sin = Math.sin(swirl)
        attribute.setXYZ(
          index,
          (ox * cos - oz * sin) * factor,
          oy * factor,
          (ox * sin + oz * cos) * factor,
        )
      }
      attribute.needsUpdate = true
      const material = pointsRef.current.material as THREE.PointsMaterial
      material.opacity = progress > 0.74 ? (1 - progress) * 3.8 : 0.9
    }

    if (singularityRef.current) {
      const ignitionAt = mode === 'arrival' ? arrivalIgnition : 0.28
      const ignition = THREE.MathUtils.smootherstep(progress, ignitionAt, ignitionAt + 0.055)
      const compression = Math.exp(-Math.pow((progress - ignitionAt) * 22, 2))
      const pulse = 1 + Math.sin(elapsed * 28) * 0.1 * (1 - ignition)
      singularityRef.current.scale.setScalar((0.18 + compression * 0.16) * pulse)
      const material = singularityRef.current.material as THREE.MeshBasicMaterial
      material.opacity = mode === 'arrival'
        ? Math.max(0, 1 - ignition)
        : compression * 0.92
    }

    if (flashRef.current) {
      const flashAt = mode === 'arrival' ? arrivalIgnition + 0.045 : 0.34
      const pulse = Math.exp(-Math.pow((progress - flashAt) * 18, 2))
      flashRef.current.scale.setScalar(0.12 + pulse * 1.05)
      const material = flashRef.current.material as THREE.ShaderMaterial
      material.uniforms.uOpacity.value = pulse * 0.88
    }

    if (shockwaveRef.current) {
      const shockwaveStart = mode === 'arrival' ? arrivalIgnition + 0.02 : 0.3
      const shockwaveEnd = mode === 'arrival' ? arrivalIgnition + 0.34 : 0.58
      const expansion = THREE.MathUtils.smootherstep(progress, shockwaveStart, shockwaveEnd)
      shockwaveRef.current.scale.setScalar(0.08 + expansion * 3.8)
      const material = shockwaveRef.current.material as THREE.ShaderMaterial
      material.uniforms.uOpacity.value = expansion * (1 - expansion)
    }

    if (planetRef.current) {
      const reveal = THREE.MathUtils.smootherstep(progress, 0.53, 0.84)
      const birthPulse = Math.exp(-Math.pow((progress - 0.69) * 10, 2))
      const approach = THREE.MathUtils.smootherstep(progress, 0.82, 1)
      const handoffScale = THREE.MathUtils.lerp(1, finalPlanetScale, approach)
      planetRef.current.visible = reveal > 0.002
      planetRef.current.scale.setScalar(
        Math.max(0.001, reveal * (1 + birthPulse * 0.16) * handoffScale),
      )
      planetRef.current.rotation.y += 0.003 + reveal * 0.004
    }

    if (progress >= 1 && !completeRef.current) {
      completeRef.current = true
      onComplete()
    }
  })

  return (
    <>
      {mode === 'arrival' ? (
        <>
          <ambientLight intensity={0.55} color="#aaa7dc" />
          <directionalLight position={[-7, 9, 7]} intensity={3.35} color="#ffd0a5" />
          <pointLight position={[8, -4, -8]} intensity={2} color="#e886a7" />
          <pointLight position={[-10, 3, -5]} intensity={1.15} color="#8a72ce" />
        </>
      ) : (
        <>
          <ambientLight intensity={0.2} color="#8ebcff" />
          <directionalLight position={[-4, 5, 5]} intensity={2.4} color="#eaf8ff" />
        </>
      )}
      {includeEnvironment && (
        <>
          <Stars radius={45} depth={30} count={1800} factor={1.25} saturation={0.3} fade speed={0.12} />
          <Sparkles count={120} scale={18} size={1.1} speed={0.22} color="#8dcfff" opacity={0.3} />
        </>
      )}
      <group position={origin} scale={sceneScale}>
        <points ref={pointsRef}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[particleData.positions, 3]} />
            <bufferAttribute attach="attributes-color" args={[particleData.colors, 3]} />
          </bufferGeometry>
          <pointsMaterial
            size={0.045}
            vertexColors
            transparent
            opacity={0.9}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </points>
        <mesh ref={singularityRef} scale={mode === 'arrival' ? 0.18 : 0.001}>
          <sphereGeometry args={[0.72, 40, 40]} />
          <meshBasicMaterial
            color="#fff5d8"
            transparent
            opacity={mode === 'arrival' ? 1 : 0}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
        <mesh ref={flashRef}>
          <planeGeometry args={[2, 2]} />
          <shaderMaterial
            vertexShader={ENERGY_VERTEX_SHADER}
            fragmentShader={ENERGY_FRAGMENT_SHADER}
            uniforms={{ uOpacity: { value: 0 } }}
            transparent
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
        <mesh ref={shockwaveRef} scale={0.08}>
          <sphereGeometry args={[1, 64, 64]} />
          <shaderMaterial
            vertexShader={SHOCKWAVE_VERTEX_SHADER}
            fragmentShader={SHOCKWAVE_FRAGMENT_SHADER}
            uniforms={{ uOpacity: { value: 0 } }}
            transparent
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>
        <group ref={planetRef} visible={false} scale={0.001}>
          <PlanetRenderer config={config} scale={1.42} />
        </group>
      </group>
    </>
  )
}

export function GenesisSequence({ config, planetName, onComplete, mode = 'creation' }: GenesisSequenceProps) {
  const { t } = useI18n()
  const [stage, setStage] = useState(0)

  useEffect(() => {
    const timers = [
      window.setTimeout(() => setStage(1), 1500),
      window.setTimeout(() => setStage(2), 3000),
      window.setTimeout(() => setStage(3), 4850),
    ]
    return () => timers.forEach(window.clearTimeout)
  }, [])

  const labels = [
    mode === 'arrival' ? t('genesis.releaseLight') : t('genesis.gatherMatter'),
    mode === 'arrival' ? t('genesis.rememberOrbit') : t('genesis.igniteSignal'),
    t('genesis.gravityCenter'),
    mode === 'arrival' ? t('genesis.returnCosmos', { name: planetName }) : t('genesis.takingForm', { name: planetName }),
  ]

  return (
    <main className={styles.screen}>
      <Canvas camera={{ position: [0, 0.88, 7.2], fov: 48 }} dpr={[1, 1.5]}>
        <color attach="background" args={['#111637']} />
        <GenesisFormation config={config} onComplete={onComplete} mode={mode} />
        <EffectComposer multisampling={0}>
          <Bloom intensity={0.82} luminanceThreshold={0.3} luminanceSmoothing={0.86} />
          <Vignette offset={0.2} darkness={0.62} />
        </EffectComposer>
      </Canvas>
      <div className={styles.status}>
        <span>{t('auth.genesis')} / {String(stage + 1).padStart(2, '0')}</span>
        <p>{labels[stage]}</p>
      </div>
      <button type="button" className={styles.skip} onClick={onComplete}>
        <SkipForward size={15} />
        {t('auth.skipFormation')}
      </button>
    </main>
  )
}
