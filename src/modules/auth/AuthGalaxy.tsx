import { useMemo, useRef } from 'react'
import { Sparkles, Stars } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing'
import * as THREE from 'three'
import type { PlanetVisualConfig } from '../../product/contracts'
import { GenesisFormation } from '../genesis/GenesisSequence'

export type AuthVisualPhase = 'idle' | 'collapse' | 'formation'

const ACCRETION_VERTEX_SHADER = `
  varying vec2 vUv;
  varying vec3 vPosition;
  void main() {
    vUv = uv;
    vPosition = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

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

function DeepStarField() {
  const pointsRef = useRef<THREE.Points>(null)
  const data = useMemo(() => {
    const random = seededRandom(72193)
    const count = 7200
    const positions = new Float32Array(count * 3)
    const colors = new Float32Array(count * 3)
    const blue = new THREE.Color('#8b77c7')
    const violet = new THREE.Color('#d1699a')
    const white = new THREE.Color('#ffd29c')
    const color = new THREE.Color()

    for (let index = 0; index < count; index++) {
      positions[index * 3] = (random() - 0.5) * 48
      positions[index * 3 + 1] = (random() - 0.5) * 27
      positions[index * 3 + 2] = -7 - random() * 42
      color.copy(blue).lerp(violet, random() * 0.42)
      if (random() > 0.88) color.lerp(white, 0.78)
      colors[index * 3] = color.r
      colors[index * 3 + 1] = color.g
      colors[index * 3 + 2] = color.b
    }

    return { positions, colors }
  }, [])

  useFrame((state) => {
    if (!pointsRef.current) return
    pointsRef.current.rotation.z = Math.sin(state.clock.elapsedTime * 0.025) * 0.01
  })

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[data.positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[data.colors, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={0.055}
        vertexColors
        transparent
        opacity={0.72}
        sizeAttenuation
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  )
}

const ACCRETION_FRAGMENT_SHADER = `
  precision highp float;
  uniform float uTime;
  uniform vec3 uInnerColor;
  uniform vec3 uOuterColor;
  uniform float uOpacity;
  varying vec2 vUv;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
      f.y
    );
  }

  void main() {
    vec2 centered = vUv - 0.5;
    float radius = length(centered) * 2.0;
    float angle = atan(centered.y, centered.x);
    float swirl = noise(vec2(angle * 4.0 - uTime * 0.24, radius * 18.0 + uTime * 0.1));
    float filaments = sin(angle * 34.0 - radius * 48.0 - uTime * 1.25) * 0.5 + 0.5;
    float radialFade = smoothstep(1.0, 0.06, abs(radius - 0.55));
    radialFade *= smoothstep(0.03, 0.26, radius);
    float brokenEdge = smoothstep(0.2, 0.86, swirl * 0.76 + filaments * 0.24);
    float hotSide = 0.62 + 0.38 * smoothstep(-0.9, 0.8, cos(angle - 0.25));
    vec3 color = mix(uOuterColor, uInnerColor, smoothstep(0.78, 0.24, radius));
    float alpha = radialFade * mix(0.32, 1.0, brokenEdge) * hotSide * uOpacity;
    if (alpha < 0.008) discard;
    gl_FragColor = vec4(color, alpha);
  }
`

interface PortalLayout {
  position: [number, number, number]
  scale: number
}

const AUTH_CAMERA_POSITION = new THREE.Vector3(0, 2.1, 14)
const AUTH_CAMERA_FORWARD = new THREE.Vector3(0, 0, 0)
  .sub(AUTH_CAMERA_POSITION)
  .normalize()

function getFormationHandoffScale(
  layout: PortalLayout,
  planetRadius: number,
  viewportWidth: number,
) {
  const universeDistance = viewportWidth < 700
    ? Math.max(6.6, planetRadius * 6)
    : Math.max(5.8, planetRadius * 4.8)
  const universeCameraDistance = universeDistance * Math.sqrt(1 + 0.088 ** 2)
  const authDepth = new THREE.Vector3(...layout.position)
    .sub(AUTH_CAMERA_POSITION)
    .dot(AUTH_CAMERA_FORWARD)
  const authSceneScale = layout.scale * 1.72
  const rendererScaleRatio = 1.38 / 1.42
  const fovRatio = Math.tan(THREE.MathUtils.degToRad(48 / 2))
    / Math.tan(THREE.MathUtils.degToRad(46 / 2))

  return THREE.MathUtils.clamp(
    rendererScaleRatio
      * (authDepth / (authSceneScale * universeCameraDistance))
      * fovRatio,
    0.72,
    1.5,
  )
}

function getPortalLayout(aspect: number): PortalLayout {
  if (aspect < 0.9) return { position: [0, 2.3, -4.2], scale: 0.7 }
  if (aspect > 1.72) return { position: [0, 0.05, -3.25], scale: 1.36 }
  return { position: [0, 0.05, -2.7], scale: 1.28 }
}

function BlackHolePortal({ phase, layout }: { phase: AuthVisualPhase; layout: PortalLayout }) {
  const groupRef = useRef<THREE.Group>(null)
  const singularityRef = useRef<THREE.Mesh>(null)
  const singularityMaterialRef = useRef<THREE.MeshBasicMaterial>(null)
  const diskMaterialRef = useRef<THREE.ShaderMaterial>(null)
  const outerMaterialRef = useRef<THREE.ShaderMaterial>(null)
  const targetScale = useMemo(() => new THREE.Vector3(), [])
  const collapsing = phase !== 'idle'

  useFrame((state, delta) => {
    if (groupRef.current) {
      groupRef.current.rotation.z += delta * (collapsing ? 2.8 : 0.009)
      targetScale.setScalar(collapsing ? 0.018 : layout.scale)
      groupRef.current.scale.lerp(targetScale, 1 - Math.exp(-delta * (collapsing ? 3.1 : 6)))
    }
    if (singularityRef.current) {
      const pulse = collapsing ? 0.34 + Math.sin(state.clock.elapsedTime * 18) * 0.055 : 0.01
      targetScale.setScalar(pulse)
      singularityRef.current.scale.lerp(targetScale, 1 - Math.exp(-delta * 4.4))
    }
    if (singularityMaterialRef.current) {
      singularityMaterialRef.current.opacity = THREE.MathUtils.damp(
        singularityMaterialRef.current.opacity,
        phase === 'collapse' ? 1 : 0,
        4,
        delta,
      )
    }
    if (diskMaterialRef.current) diskMaterialRef.current.uniforms.uTime.value = state.clock.elapsedTime
    if (outerMaterialRef.current) outerMaterialRef.current.uniforms.uTime.value = state.clock.elapsedTime * 0.72
  })

  return (
    <>
    <group
      ref={groupRef}
      position={layout.position}
      scale={layout.scale}
    >
      <mesh rotation-x={1.24} rotation-z={-0.17} scale={[1.42, 0.72, 1]}>
        <ringGeometry args={[4.35, 8.2, 256, 1]} />
        <shaderMaterial
          ref={outerMaterialRef}
          vertexShader={ACCRETION_VERTEX_SHADER}
          fragmentShader={ACCRETION_FRAGMENT_SHADER}
          uniforms={{
            uTime: { value: 0 },
            uInnerColor: { value: new THREE.Color('#ffc58f') },
            uOuterColor: { value: new THREE.Color('#8a4f9e') },
            uOpacity: { value: 0.24 },
          }}
          transparent
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      <mesh rotation-x={1.18} rotation-z={-0.08} scale={[1.24, 0.58, 1]}>
        <ringGeometry args={[4.28, 7.1, 256, 1]} />
        <shaderMaterial
          ref={diskMaterialRef}
          vertexShader={ACCRETION_VERTEX_SHADER}
          fragmentShader={ACCRETION_FRAGMENT_SHADER}
          uniforms={{
            uTime: { value: 0 },
            uInnerColor: { value: new THREE.Color('#fff0c8') },
            uOuterColor: { value: new THREE.Color('#e66f8e') },
            uOpacity: { value: 0.6 },
          }}
          transparent
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      <mesh position={[0, 0, 0.08]}>
        <circleGeometry args={[4.28, 192]} />
        <meshBasicMaterial color="#000104" />
      </mesh>

      <mesh position={[0, 0, 0.15]}>
        <ringGeometry args={[4.26, 4.38, 256]} />
        <meshBasicMaterial
          color="#ffd198"
          transparent
          opacity={0.54}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>

      <mesh position={[0, 0, 0.1]}>
        <ringGeometry args={[4.04, 4.62, 256]} />
        <meshBasicMaterial
          color="#ee8a92"
          transparent
          opacity={0.1}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      <mesh position={[0, 0, 0.09]}>
        <ringGeometry args={[4.38, 5.02, 256]} />
        <meshBasicMaterial
          color="#8c65bb"
          transparent
          opacity={0.045}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
    <mesh ref={singularityRef} position={layout.position} scale={0.01}>
      <sphereGeometry args={[1, 48, 48]} />
      <meshBasicMaterial
        ref={singularityMaterialRef}
        color="#fff4d0"
        transparent
        opacity={0}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </mesh>
    </>
  )
}

interface AuthSceneProps {
  phase: AuthVisualPhase
  formationConfig?: PlanetVisualConfig
  onFormationComplete: () => void
  formationIgnitionProgress: number
}

function AuthScene({
  phase,
  formationConfig,
  onFormationComplete,
  formationIgnitionProgress,
}: AuthSceneProps) {
  const { size } = useThree()
  const layout = getPortalLayout(size.width / Math.max(1, size.height))
  const finalPlanetScale = formationConfig
    ? getFormationHandoffScale(layout, formationConfig.radius, size.width)
    : 1

  return (
    <>
      <BlackHolePortal phase={phase} layout={layout} />
      {phase === 'formation' && formationConfig && (
        <GenesisFormation
          config={formationConfig}
          onComplete={onFormationComplete}
          mode="arrival"
          origin={layout.position}
          sceneScale={layout.scale * 1.72}
          finalPlanetScale={finalPlanetScale}
          includeEnvironment={false}
          arrivalIgnitionProgress={formationIgnitionProgress}
        />
      )}
    </>
  )
}

interface AuthGalaxyProps {
  phase?: AuthVisualPhase
  formationConfig?: PlanetVisualConfig
  onFormationComplete?: () => void
  formationIgnitionProgress?: number
}

export function AuthGalaxy({
  phase = 'idle',
  formationConfig,
  onFormationComplete = () => undefined,
  formationIgnitionProgress = 0.08,
}: AuthGalaxyProps) {
  return (
    <div style={{ position: 'absolute', inset: 0 }} aria-hidden="true">
      <Canvas
        camera={{ position: [0, 2.1, 14], fov: 48, near: 0.1, far: 90 }}
        dpr={[1, 1.6]}
        gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
      >
        <color attach="background" args={['#111637']} />
        <fog attach="fog" args={['#111637', 20, 58]} />
        <DeepStarField />
        <Stars radius={48} depth={34} count={4200} factor={1.65} saturation={0.42} fade speed={0.12} />
        <Sparkles
          count={260}
          scale={[34, 19, 18]}
          size={1.55}
          speed={0.08}
          color="#ffb284"
          opacity={0.44}
        />
        <AuthScene
          phase={phase}
          formationConfig={formationConfig}
          onFormationComplete={onFormationComplete}
          formationIgnitionProgress={formationIgnitionProgress}
        />
        <EffectComposer multisampling={0}>
          <Bloom intensity={1.05} luminanceThreshold={0.29} luminanceSmoothing={0.9} />
          <Vignette offset={0.18} darkness={0.74} />
        </EffectComposer>
      </Canvas>
    </div>
  )
}
