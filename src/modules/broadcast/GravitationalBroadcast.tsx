import { useFrame } from '@react-three/fiber'
import { useMemo, useRef, type RefObject } from 'react'
import * as THREE from 'three'

interface GravitationalBroadcastProps {
  radius: number
  intensity: number
  onComplete: () => void
}

const vertexShader = /* glsl */ `
  uniform float uProgress;
  uniform float uSeed;
  varying vec3 vNormal;
  varying vec3 vViewDirection;
  varying float vRipple;

  void main() {
    vec3 direction = normalize(position);
    float spatialWave = sin(position.y * 11.0 + position.x * 7.0 - position.z * 5.0 + uSeed);
    float travellingWave = sin((position.x + position.y + position.z) * 8.0 - uProgress * 22.0);
    float ripple = spatialWave * 0.55 + travellingWave * 0.45;
    vec3 displaced = position + direction * ripple * 0.035;
    vec4 worldPosition = modelMatrix * vec4(displaced, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vViewDirection = normalize(cameraPosition - worldPosition.xyz);
    vRipple = ripple;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uProgress;
  varying vec3 vNormal;
  varying vec3 vViewDirection;
  varying float vRipple;

  void main() {
    float fresnel = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewDirection))), 2.1);
    float filaments = 0.68 + 0.32 * sin(vRipple * 5.0 + uProgress * 18.0);
    float alpha = fresnel * filaments * uOpacity;
    gl_FragColor = vec4(uColor * (1.3 + fresnel * 1.8), alpha);
  }
`

interface WaveShellProps {
  radius: number
  maxRadius: number
  delay: number
  color: string
  seed: number
  clockRef: RefObject<number>
}

function WaveShell({ radius, maxRadius, delay, color, seed, clockRef }: WaveShellProps) {
  const meshRef = useRef<THREE.Mesh>(null)
  const material = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uProgress: { value: 0 },
      uSeed: { value: seed },
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: 0 },
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  }), [color, seed])

  useFrame(() => {
    if (!meshRef.current) return
    const progress = THREE.MathUtils.clamp((clockRef.current - delay) / 1.45, 0, 1)
    const eased = THREE.MathUtils.smootherstep(progress, 0, 1)
    const scale = radius * 0.55 + eased * maxRadius
    meshRef.current.scale.setScalar(scale)
    material.uniforms.uProgress.value = progress
    material.uniforms.uOpacity.value = Math.sin(progress * Math.PI) * (1 - progress * 0.28) * 0.82
    meshRef.current.visible = progress > 0 && progress < 1
  })

  return (
    <mesh ref={meshRef} visible={false}>
      <sphereGeometry args={[1, 72, 52]} />
      <primitive object={material} attach="material" />
    </mesh>
  )
}

interface RadialDustProps {
  radius: number
  intensity: number
  clockRef: RefObject<number>
}

function RadialDust({ radius, intensity, clockRef }: RadialDustProps) {
  const pointsRef = useRef<THREE.Points>(null)
  const materialRef = useRef<THREE.PointsMaterial>(null)
  const { directions, positions } = useMemo(() => {
    const count = 180
    const nextDirections = new Float32Array(count * 3)
    const nextPositions = new Float32Array(count * 3)
    for (let index = 0; index < count; index += 1) {
      const y = 1 - (index / (count - 1)) * 2
      const radial = Math.sqrt(Math.max(0, 1 - y * y))
      const angle = index * Math.PI * (3 - Math.sqrt(5))
      const offset = index * 3
      nextDirections[offset] = Math.cos(angle) * radial
      nextDirections[offset + 1] = y
      nextDirections[offset + 2] = Math.sin(angle) * radial
    }
    return { directions: nextDirections, positions: nextPositions }
  }, [])

  useFrame(() => {
    const points = pointsRef.current
    const material = materialRef.current
    if (!points || !material) return
    const progress = THREE.MathUtils.clamp(clockRef.current / 1.55, 0, 1)
    const position = points.geometry.getAttribute('position') as THREE.BufferAttribute
    for (let index = 0; index < position.count; index += 1) {
      const offset = index * 3
      const stagger = (index % 19) / 19
      const distance = radius * (0.82 + progress * (3.5 + stagger * 2.8))
      position.array[offset] = directions[offset] * distance
      position.array[offset + 1] = directions[offset + 1] * distance
      position.array[offset + 2] = directions[offset + 2] * distance
    }
    position.needsUpdate = true
    material.opacity = Math.sin(progress * Math.PI) * (0.52 + intensity * 0.32)
    points.visible = progress < 1
  })

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        ref={materialRef}
        color="#c8f6ff"
        size={radius * 0.052}
        sizeAttenuation
        transparent
        opacity={0}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </points>
  )
}

export function GravitationalBroadcast({ radius, intensity, onComplete }: GravitationalBroadcastProps) {
  const elapsedRef = useRef(0)
  const completedRef = useRef(false)
  const coreRef = useRef<THREE.Mesh>(null)
  const coreMaterialRef = useRef<THREE.MeshBasicMaterial>(null)
  const ringRefs = useRef<Array<THREE.Mesh | null>>([])
  const ringMaterials = useMemo(() => Array.from({ length: 3 }, () => new THREE.MeshBasicMaterial({
    color: '#9eeeff',
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  })), [])

  useFrame((_, delta) => {
    elapsedRef.current += Math.min(delta, 0.05)
    const elapsed = elapsedRef.current
    const coreProgress = THREE.MathUtils.clamp(elapsed / 1.05, 0, 1)
    if (coreRef.current && coreMaterialRef.current) {
      coreRef.current.scale.setScalar(radius * (0.12 + THREE.MathUtils.smootherstep(coreProgress, 0, 1) * 1.08))
      coreMaterialRef.current.opacity = Math.sin(coreProgress * Math.PI) * 0.92
      coreRef.current.visible = coreProgress < 1
    }

    ringRefs.current.forEach((ring, index) => {
      if (!ring) return
      const progress = THREE.MathUtils.clamp((elapsed - index * 0.16) / 1.7, 0, 1)
      ring.scale.setScalar(radius * (0.55 + progress * (4.2 + index * 0.72)))
      ring.rotation.z += delta * (0.24 + index * 0.07)
      ringMaterials[index].opacity = Math.sin(progress * Math.PI) * (0.68 - index * 0.1)
      ring.visible = progress > 0 && progress < 1
    })

    if (elapsed >= 3.25 && !completedRef.current) {
      completedRef.current = true
      onComplete()
    }
  })

  return (
    <group userData={{ effect: 'gravitational-broadcast' }}>
      <pointLight color="#b7f2ff" intensity={4.5 + intensity * 5} distance={radius * 13} decay={1.7} />
      <mesh ref={coreRef}>
        <sphereGeometry args={[1, 36, 24]} />
        <meshBasicMaterial
          ref={coreMaterialRef}
          color="#eaffff"
          transparent
          opacity={0}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      {[0, 1, 2].map((index) => (
        <mesh
          key={index}
          ref={(node) => { ringRefs.current[index] = node }}
          rotation={[Math.PI * (0.32 + index * 0.17), Math.PI * index * 0.23, 0]}
          visible={false}
        >
          <torusGeometry args={[1, 0.012 + index * 0.006, 10, 180]} />
          <primitive object={ringMaterials[index]} attach="material" />
        </mesh>
      ))}
      <WaveShell radius={radius} maxRadius={radius * 4.8} delay={0.08} color="#ecffff" seed={1.7} clockRef={elapsedRef} />
      <WaveShell radius={radius} maxRadius={radius * 6.4} delay={0.34} color="#74dfff" seed={4.2} clockRef={elapsedRef} />
      <WaveShell radius={radius} maxRadius={radius * 8.2} delay={0.62} color="#8e9dff" seed={7.8} clockRef={elapsedRef} />
      <RadialDust radius={radius} intensity={intensity} clockRef={elapsedRef} />
    </group>
  )
}
