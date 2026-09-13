import { Billboard, Html } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import type { ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import type { NebulaSummary } from '../../product/contracts'
import { useI18n } from '../../product/i18n'

interface NebulaLobbyViewProps {
  nebulae: NebulaSummary[]
  selectedNebulaId: string | null
  onSelect: (nebulaId: string) => void
  onEnter: (nebula: NebulaSummary) => void
}

interface CloudData {
  positions: Float32Array
  colors: Float32Array
}

const positions: Array<[number, number, number]> = [
  [-7.4, 2.45, -1.4],
  [-3.7, -3.15, 0.7],
  [0, 2.55, -1.7],
  [3.7, -3.05, 0.55],
  [7.4, 2.35, -1.25],
]

const vertexShader = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const fragmentShader = `
precision highp float;
uniform float uTime;
uniform float uSeed;
uniform float uOpacity;
uniform float uShape;
uniform vec3 uAccent;
uniform vec3 uSecondary;
uniform vec3 uCore;
varying vec2 vUv;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32 + uSeed * 0.001);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.52;
  mat2 transform = mat2(1.62, 1.18, -1.18, 1.62);
  for (int index = 0; index < 5; index++) {
    value += amplitude * noise(p);
    p = transform * p + vec2(0.17, -0.11);
    amplitude *= 0.48;
  }
  return value;
}

mat2 rotate2d(float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return mat2(c, -s, s, c);
}

void main() {
  vec2 uv = (vUv - 0.5) * 2.0;
  uv.x *= 1.08;
  float time = uTime * 0.018;
  vec2 p = rotate2d(sin(time + uSeed) * 0.065) * uv;
  float radius = length(p);

  if (uShape < 0.5) {
    float angle = atan(p.y, p.x) + radius * 1.85;
    p = vec2(cos(angle), sin(angle)) * radius;
  } else if (uShape > 1.5 && uShape < 2.5) {
    p.y += sin(p.x * 2.2 + time) * 0.22;
    p.x *= 0.78;
  }

  vec2 warp = vec2(
    fbm(p * 1.25 + vec2(time, uSeed * 0.013)),
    fbm(p * 1.31 + vec2(4.7 - time, uSeed * 0.017))
  );
  vec2 warped = p + (warp - 0.5) * 0.64;
  float broad = fbm(warped * 1.42 + vec2(uSeed * 0.007));
  float folds = fbm(warped * 3.25 - vec2(time * 0.7, 0.0));
  float wisps = fbm(warped * 6.4 + warp * 0.65);
  float density = broad * 0.58 + folds * 0.25 + wisps * 0.17;

  float mask = pow(1.0 - smoothstep(0.08, 1.12, length(uv * vec2(0.78, 1.0))), 1.35);
  if (uShape > 0.5 && uShape < 1.5) {
    float ring = abs(length(uv * vec2(0.9, 1.0)) - 0.56);
    mask = (1.0 - smoothstep(0.02, 0.38, ring)) * (1.0 - smoothstep(0.2, 1.2, length(uv)));
  } else if (uShape > 1.5 && uShape < 2.5) {
    mask = pow(1.0 - smoothstep(0.08, 1.2, length(uv * vec2(0.55, 1.25))), 1.18);
  } else if (uShape > 2.5) {
    float rays = 0.72 + 0.28 * sin(atan(uv.y, uv.x) * 7.0 + broad * 5.0);
    mask *= rays;
  }
  float edgeFade = (1.0 - smoothstep(0.72, 1.0, abs(uv.x))) * (1.0 - smoothstep(0.72, 1.0, abs(uv.y)));
  mask *= edgeFade;

  float core = exp(-dot(uv, uv) * 4.1) * (0.42 + broad * 0.42);
  float dust = smoothstep(0.69, 0.9, fbm(warped * 7.2 + vec2(3.0))) * mask;
  float cloud = smoothstep(0.30, 0.72, density);
  cloud *= 0.62 + smoothstep(0.32, 0.78, broad) * 0.38;
  float alpha = mask * cloud * uOpacity;
  alpha += dust * 0.075 * uOpacity;
  alpha += core * 0.11 * uOpacity;
  alpha *= smoothstep(0.0, 0.16, mask);
  if (alpha < 0.004) discard;

  vec3 color = mix(uAccent, uSecondary, smoothstep(0.34, 0.76, folds * 0.7 + warp.x * 0.25));
  color = mix(color, uCore, clamp(core * 0.42, 0.0, 0.42));
  color *= 0.46 + broad * 0.45 + folds * 0.16 + core * 0.26;
  gl_FragColor = vec4(min(color, vec3(1.12)), clamp(alpha, 0.0, 0.62));
}
`

function themeString(theme: Record<string, unknown>, key: string, fallback: string) {
  return typeof theme[key] === 'string' ? theme[key] as string : fallback
}

function themeNumber(theme: Record<string, unknown>, key: string, fallback: number) {
  return typeof theme[key] === 'number' ? theme[key] as number : fallback
}

function randomGenerator(seed: number) {
  let value = seed >>> 0
  return () => {
    value += 0x6d2b79f5
    let result = value
    result = Math.imul(result ^ result >>> 15, result | 1)
    result ^= result + Math.imul(result ^ result >>> 7, result | 61)
    return ((result ^ result >>> 14) >>> 0) / 4294967296
  }
}

function gaussian(random: () => number) {
  return Math.sqrt(-2 * Math.log(Math.max(0.0001, random()))) * Math.cos(Math.PI * 2 * random())
}

function cloudPoint(shape: string, random: () => number): [number, number, number] {
  const radius = Math.pow(random(), 0.62) * 2.2
  const angle = random() * Math.PI * 2
  if (shape === 'ring') {
    const ringRadius = 1.05 + gaussian(random) * 0.32
    return [Math.cos(angle) * ringRadius * 1.55, gaussian(random) * 0.3, Math.sin(angle) * ringRadius * 0.72]
  }
  if (shape === 'veil') {
    const x = gaussian(random) * 1.05
    return [x * 1.45, Math.sin(x * 1.7) * 0.72 + gaussian(random) * 0.42, gaussian(random) * 0.45]
  }
  if (shape === 'burst') {
    const elevation = (random() - 0.5) * Math.PI
    return [Math.cos(angle) * Math.cos(elevation) * radius, Math.sin(elevation) * radius * 0.72, Math.sin(angle) * Math.cos(elevation) * radius * 0.82]
  }
  const arm = Math.floor(random() * 3) * Math.PI * 2 / 3
  const spiralAngle = arm + radius * 1.9 + gaussian(random) * 0.25
  return [Math.cos(spiralAngle) * radius * 1.12, gaussian(random) * (0.17 + radius * 0.08), Math.sin(spiralAngle) * radius * 0.63]
}

function createCloud(theme: Record<string, unknown>, count: number): CloudData {
  const random = randomGenerator(themeNumber(theme, 'seed', 4281))
  const shape = themeString(theme, 'shape', 'spiral')
  const accent = new THREE.Color(themeString(theme, 'accent', '#69d0c8'))
  const secondary = new THREE.Color(themeString(theme, 'secondary', '#ed9a7b'))
  const color = new THREE.Color()
  const pointPositions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  for (let index = 0; index < count; index += 1) {
    const [x, y, z] = cloudPoint(shape, random)
    pointPositions.set([x, y, z], index * 3)
    color.copy(accent).lerp(secondary, Math.pow(random(), 1.6) * 0.78)
    const brightness = 0.62 + random() * 0.48
    colors.set([color.r * brightness, color.g * brightness, color.b * brightness], index * 3)
  }
  return { positions: pointPositions, colors }
}

function useParticleTexture() {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 64
    const context = canvas.getContext('2d')
    if (context) {
      const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32)
      gradient.addColorStop(0, 'rgba(255,255,255,1)')
      gradient.addColorStop(0.18, 'rgba(255,255,255,.88)')
      gradient.addColorStop(0.55, 'rgba(255,255,255,.22)')
      gradient.addColorStop(1, 'rgba(255,255,255,0)')
      context.fillStyle = gradient
      context.fillRect(0, 0, 64, 64)
    }
    const value = new THREE.CanvasTexture(canvas)
    value.colorSpace = THREE.SRGBColorSpace
    return value
  }, [])
  useEffect(() => () => texture.dispose(), [texture])
  return texture
}

function shapeIndex(shape: string) {
  return shape === 'ring' ? 1 : shape === 'veil' ? 2 : shape === 'burst' ? 3 : 0
}

function NebulaVolumeLayer({
  theme,
  layer,
  active,
}: {
  theme: Record<string, unknown>
  layer: number
  active: boolean
}) {
  const materialRef = useRef<THREE.ShaderMaterial>(null)
  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uSeed: { value: themeNumber(theme, 'seed', 4281) + layer * 19.7 },
    uOpacity: { value: 0.28 },
    uShape: { value: shapeIndex(themeString(theme, 'shape', 'spiral')) },
    uAccent: { value: new THREE.Color(themeString(theme, 'accent', '#69d0c8')) },
    uSecondary: { value: new THREE.Color(themeString(theme, 'secondary', '#ed9a7b')) },
    uCore: { value: new THREE.Color(themeString(theme, 'core', '#fff0c4')) },
  }), [layer, theme])

  useFrame((state, delta) => {
    const material = materialRef.current
    if (!material) return
    material.uniforms.uTime.value = state.clock.elapsedTime + layer * 3.2
    material.uniforms.uOpacity.value = THREE.MathUtils.damp(
      material.uniforms.uOpacity.value,
      active ? 0.48 - layer * 0.055 : 0.34 - layer * 0.045,
      6,
      delta,
    )
  })

  const layerScale = 1 + layer * 0.12
  return (
    <mesh rotation-z={(layer - 1) * 0.42} position-z={(layer - 1) * 0.08} scale={[layerScale, layerScale * (1 - layer * 0.04), 1]}>
      <planeGeometry args={[6.2, 5.1]} />
      <shaderMaterial
        ref={materialRef}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        depthTest
        blending={THREE.NormalBlending}
        toneMapped={false}
      />
    </mesh>
  )
}

function NebulaCloud({
  nebula,
  position,
  selected,
  mobile,
  onSelect,
  onEnter,
}: {
  nebula: NebulaSummary
  position: [number, number, number]
  selected: boolean
  mobile: boolean
  onSelect: () => void
  onEnter: () => void
}) {
  const { t } = useI18n()
  const groupRef = useRef<THREE.Group>(null)
  const scaleTarget = useMemo(() => new THREE.Vector3(), [])
  const [hovered, setHovered] = useState(false)
  const density = THREE.MathUtils.clamp(themeNumber(nebula.theme, 'density', 0.75), 0.4, 1)
  const cloud = useMemo(() => createCloud(nebula.theme, Math.round((mobile ? 430 : 720) * density)), [density, mobile, nebula.theme])
  const texture = useParticleTexture()
  const accent = themeString(nebula.theme, 'accent', '#69d0c8')
  const core = themeString(nebula.theme, 'core', '#fff0c4')

  useFrame((state, delta) => {
    const group = groupRef.current
    if (!group) return
    group.rotation.y += delta * (selected ? 0.025 : 0.008)
    group.position.y = position[1] + Math.sin(state.clock.elapsedTime * 0.22 + themeNumber(nebula.theme, 'seed', 0)) * 0.08
    const targetScale = (mobile ? 1.38 : 1) * (selected ? 1.18 : hovered ? 1.08 : 1)
    group.scale.lerp(scaleTarget.setScalar(targetScale), 1 - Math.exp(-delta * 8))
  })

  const select = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation()
    onSelect()
  }

  return (
    <group
      ref={groupRef}
      position={position}
      onClick={select}
      onPointerOver={() => setHovered(true)}
      onPointerOut={() => setHovered(false)}
    >
      <Billboard follow>
        <NebulaVolumeLayer theme={nebula.theme} layer={0} active={selected || hovered} />
        <NebulaVolumeLayer theme={nebula.theme} layer={1} active={selected || hovered} />
        <NebulaVolumeLayer theme={nebula.theme} layer={2} active={selected || hovered} />
      </Billboard>
      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[cloud.positions, 3]} />
          <bufferAttribute attach="attributes-color" args={[cloud.colors, 3]} />
        </bufferGeometry>
        <pointsMaterial
          map={texture}
          alphaMap={texture}
          color="#ffffff"
          size={selected ? 0.11 : 0.085}
          vertexColors
          transparent
          opacity={selected ? 0.68 : 0.42}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          sizeAttenuation
        />
      </points>
      <sprite scale={[0.62, 0.62, 1]}>
        <spriteMaterial map={texture} color={core} transparent opacity={selected ? 0.42 : 0.26} depthWrite={false} blending={THREE.AdditiveBlending} />
      </sprite>
      <pointLight color={accent} intensity={selected ? 2.4 : 1.15} distance={6} />
      <Html position={[0, -3.05, 0]} center zIndexRange={[12, 0]}>
        <div style={{ display: 'grid', justifyItems: 'center', gap: 5 }}>
          <button
            type="button"
            onClick={onSelect}
            aria-label={`${t('nebula.groupInfo')} ${nebula.name}`}
            style={{
              minWidth: 112,
              padding: '6px 9px',
              border: `1px solid ${selected ? 'rgba(112,226,215,.48)' : 'rgba(255,255,255,.13)'}`,
              borderRadius: 5,
              background: selected ? 'rgba(9,25,38,.88)' : 'rgba(6,11,28,.74)',
              color: 'rgba(241,250,255,.9)',
              fontSize: 10,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {nebula.name}
          </button>
          {selected && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                onEnter()
              }}
              aria-label={`${nebula.joined ? t('nebula.enterGroup') : t('nebula.joinAndEnter')} ${nebula.name}`}
              style={{
                minWidth: 112,
                padding: '7px 10px',
                border: '1px solid rgba(112,226,215,.5)',
                borderRadius: 5,
                background: 'rgba(42,151,145,.28)',
                boxShadow: '0 8px 26px rgba(0,0,0,.34)',
                color: '#d4faf6',
                fontSize: 10,
                fontWeight: 650,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {nebula.joined ? t('nebula.enterGroup') : t('nebula.joinAndEnter')}
            </button>
          )}
        </div>
      </Html>
    </group>
  )
}

export function NebulaLobbyView({ nebulae, selectedNebulaId, onSelect, onEnter }: NebulaLobbyViewProps) {
  const { size } = useThree()
  return (
    <group>
      {nebulae.slice(0, 5).map((nebula, index) => (
        <NebulaCloud
          key={nebula.id}
          nebula={nebula}
          position={positions[index]}
          selected={nebula.id === selectedNebulaId}
          mobile={size.width < 700}
          onSelect={() => onSelect(nebula.id)}
          onEnter={() => onEnter(nebula)}
        />
      ))}
    </group>
  )
}
