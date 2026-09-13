import { Html } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import type { ActivityPost, UniverseScale } from '../../product/contracts'

interface MeteorBroadcastProps {
  activity?: ActivityPost
  signal?: {
    id: string
    senderName: string
    intensity: number
    primaryColor: string
    secondaryColor: string
  }
  target: [number, number, number]
  fieldRadius: number
  scale: UniverseScale
  onSelect: () => void
  onComplete: () => void
}

const trailVertexShader = /* glsl */ `
  varying float vProgress;
  void main() {
    vProgress = uv.x;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const trailFragmentShader = /* glsl */ `
  uniform float uHead;
  uniform float uTrail;
  uniform float uOpacity;
  uniform vec3 uColor;
  varying float vProgress;
  void main() {
    float behindHead = step(vProgress, uHead);
    float distanceBehind = max(0.0, uHead - vProgress);
    float tail = (1.0 - smoothstep(0.0, uTrail, distanceBehind)) * behindHead;
    float head = 1.0 - smoothstep(0.0, 0.028, abs(distanceBehind));
    float alpha = max(tail * 0.76, head) * uOpacity;
    gl_FragColor = vec4(uColor * (1.4 + head * 2.0), alpha);
  }
`

function createTrailMaterial(color: string, opacity: number, trail: number) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uHead: { value: 0 },
      uTrail: { value: trail },
      uOpacity: { value: opacity },
      uColor: { value: new THREE.Color(color) },
    },
    vertexShader: trailVertexShader,
    fragmentShader: trailFragmentShader,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  })
}

export function MeteorBroadcast({ activity, signal, target, fieldRadius, scale, onSelect, onComplete }: MeteorBroadcastProps) {
  const headRef = useRef<THREE.Group>(null)
  const impactRef = useRef<THREE.Mesh>(null)
  const impactMaterialRef = useRef<THREE.MeshBasicMaterial>(null)
  const elapsedRef = useRef(0)
  const completedRef = useRef(false)
  const [hovered, setHovered] = useState(false)
  const { camera } = useThree()
  const intensity = activity?.ecosystemEffect.signalStrength ?? signal?.intensity ?? 0.9
  const effectId = activity?.id ?? signal?.id ?? 'memory-signal'
  const primaryColor = activity?.ecosystemEffect.primaryColor ?? signal?.primaryColor ?? '#9eeaff'
  const secondaryColor = activity?.ecosystemEffect.secondaryColor ?? signal?.secondaryColor ?? '#d7a5ff'
  const { curve, innerTrail, outerTrail } = useMemo(() => {
    const end = new THREE.Vector3(...target)
    const travelRadius = scale === 'galaxy' ? Math.max(12, fieldRadius * 1.35) : 9
    const viewDirection = end.clone().sub(camera.position).normalize()
    const screenRight = new THREE.Vector3().crossVectors(viewDirection, camera.up).normalize()
    if (screenRight.lengthSq() < 0.001) screenRight.set(1, 0, 0)
    const screenUp = new THREE.Vector3().crossVectors(screenRight, viewDirection).normalize()
    const hash = Array.from(effectId).reduce((total, character) => total + character.charCodeAt(0), 0)
    const directionSign = hash % 2 === 0 ? 1 : -1
    const start = end.clone()
      .addScaledVector(screenRight, travelRadius * 0.58 * directionSign)
      .addScaledVector(screenUp, travelRadius * 0.42)
      .addScaledVector(viewDirection, -travelRadius * 0.05)
    const middle = end.clone()
      .addScaledVector(screenRight, travelRadius * 0.08 * directionSign)
      .addScaledVector(screenUp, travelRadius * 0.3)
      .addScaledVector(viewDirection, -travelRadius * 0.12)
    const nextCurve = new THREE.CatmullRomCurve3([
      start,
      start.clone().lerp(middle, 0.52).addScaledVector(screenUp, travelRadius * 0.08),
      middle,
      middle.clone().lerp(end, 0.62),
      end,
    ])
    const tubeRadius = scale === 'galaxy' ? 0.028 : 0.04
    return {
      curve: nextCurve,
      innerTrail: new THREE.TubeGeometry(nextCurve, 180, tubeRadius, 7, false),
      outerTrail: new THREE.TubeGeometry(nextCurve, 180, tubeRadius * 3.6, 8, false),
    }
  }, [camera, effectId, fieldRadius, scale, target])
  const innerMaterial = useMemo(() => createTrailMaterial('#f5ffff', 1, 0.38), [])
  const outerMaterial = useMemo(
    () => createTrailMaterial('#77dfff', 0.36, 0.52),
    [],
  )
  const currentPosition = useMemo(() => new THREE.Vector3(), [])
  const tangent = useMemo(() => new THREE.Vector3(), [])
  const lookTarget = useMemo(() => new THREE.Vector3(), [])

  useFrame((_, delta) => {
    if (!hovered) elapsedRef.current += Math.min(delta, 0.05)
    const progress = THREE.MathUtils.clamp(elapsedRef.current / 10, 0, 1)
    const flightProgress = THREE.MathUtils.smootherstep(progress, 0, 1)
    innerMaterial.uniforms.uHead.value = flightProgress
    outerMaterial.uniforms.uHead.value = flightProgress
    innerMaterial.uniforms.uOpacity.value = progress > 0.94 ? (1 - progress) / 0.06 : 1
    outerMaterial.uniforms.uOpacity.value = (progress > 0.9 ? (1 - progress) / 0.1 : 1) * 0.42

    if (headRef.current) {
      curve.getPointAt(Math.min(flightProgress, 0.999), currentPosition)
      curve.getTangentAt(Math.min(flightProgress, 0.999), tangent)
      headRef.current.position.copy(currentPosition)
      lookTarget.copy(currentPosition).add(tangent)
      headRef.current.lookAt(lookTarget)
      headRef.current.scale.setScalar(1 + Math.sin(elapsedRef.current * 13) * 0.12)
    }

    const impactProgress = THREE.MathUtils.clamp((progress - 0.78) / 0.22, 0, 1)
    if (impactRef.current && impactMaterialRef.current) {
      impactRef.current.visible = impactProgress > 0 && impactProgress < 1
      impactRef.current.scale.setScalar(0.25 + impactProgress * Math.max(1.6, fieldRadius * 0.11))
      impactMaterialRef.current.opacity = Math.sin(impactProgress * Math.PI) * 0.78
    }

    if (progress >= 1 && !completedRef.current) {
      completedRef.current = true
      onComplete()
    }
  })

  const selectMeteor = (event?: { stopPropagation?: () => void }) => {
    event?.stopPropagation?.()
    document.body.style.cursor = ''
    onSelect()
  }

  return (
    <group userData={{ effect: signal ? 'shared-memory-meteor' : 'friend-meteor-broadcast', activityId: activity?.id, signalId: signal?.id }}>
      <mesh geometry={outerTrail} material={outerMaterial} />
      <mesh geometry={innerTrail} material={innerMaterial} />
      <group ref={headRef}>
        <pointLight color="#b9f3ff" intensity={5 + intensity * 5} distance={4.5} decay={1.5} />
        <mesh>
          <icosahedronGeometry args={[0.11, 2]} />
          <meshBasicMaterial color="#ffffff" toneMapped={false} />
        </mesh>
        <mesh scale={2.8}>
          <sphereGeometry args={[0.11, 20, 14]} />
          <meshBasicMaterial
            color={primaryColor}
            transparent
            opacity={0.3}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
        <mesh
          onClick={selectMeteor}
          onPointerEnter={(event) => {
            event.stopPropagation()
            setHovered(true)
            document.body.style.cursor = 'pointer'
          }}
          onPointerLeave={() => {
            setHovered(false)
            document.body.style.cursor = ''
          }}
        >
          <sphereGeometry args={[0.48, 16, 12]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
        <Html position={[0, 0.42, 0]} center zIndexRange={[18, 0]} style={{ pointerEvents: 'auto' }}>
          <button
            type="button"
            onClick={selectMeteor}
            onPointerEnter={() => setHovered(true)}
            onPointerLeave={() => setHovered(false)}
            style={{
              padding: '6px 10px',
              border: '1px solid rgba(190,244,255,.55)',
              borderRadius: 999,
              background: 'rgba(5,11,30,.82)',
              boxShadow: '0 0 25px rgba(108,218,255,.38)',
              color: '#e9fcff',
              font: 'inherit',
              fontSize: 9,
              letterSpacing: '.08em',
              whiteSpace: 'nowrap',
              cursor: 'pointer',
            }}
          >
            {signal ? `${signal.senderName} · Shared memory` : `${activity?.authorName ?? 'Friend'} · BROADCAST`}
          </button>
        </Html>
      </group>
      <mesh ref={impactRef} position={target} rotation-x={Math.PI / 2} visible={false}>
        <torusGeometry args={[1, 0.018, 10, 128]} />
        <meshBasicMaterial
          ref={impactMaterialRef}
          color={secondaryColor}
          transparent
          opacity={0}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </group>
  )
}
