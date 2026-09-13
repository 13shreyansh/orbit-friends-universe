import { useMemo, useRef, type MutableRefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

const PARTICLE_COUNT = 240

const FLAME_VERTEX_SHADER = `
  uniform float uTime;
  uniform float uLength;
  uniform float uRadius;
  uniform float uPixelRatio;
  uniform float uPower;
  attribute float aSeed;
  varying float vAlpha;
  varying float vColorMix;

  void main() {
    float speed = 0.24 + aSeed * 0.08;
    float travel = fract(position.z + uTime * speed);
    float angle = position.x * 6.2831853 + sin(uTime * 0.8 + aSeed * 9.0) * 0.22;
    float spread = uRadius * (0.12 + travel * 0.88) * position.y;
    float flicker = 0.88 + sin(uTime * 3.2 + aSeed * 31.0) * 0.12;

    vec3 animated = vec3(
      cos(angle) * spread + sin(uTime * 1.4 + aSeed * 17.0) * uRadius * 0.05,
      sin(angle) * spread * 0.72 + cos(uTime * 1.1 + aSeed * 13.0) * uRadius * 0.04,
      -travel * uLength * mix(0.35, 1.0, uPower)
    );

    vec4 viewPosition = modelViewMatrix * vec4(animated, 1.0);
    gl_Position = projectionMatrix * viewPosition;
    gl_PointSize = (2.0 + (1.0 - travel) * 3.5 + aSeed * 1.4)
      * uPixelRatio
      * mix(0.55, 1.0, uPower)
      * (34.0 / max(2.0, -viewPosition.z));

    float headFade = smoothstep(0.0, 0.08, travel);
    float tailFade = 1.0 - smoothstep(0.55, 1.0, travel);
    vAlpha = headFade * tailFade * flicker * uPower;
    vColorMix = clamp(travel * 0.8 + aSeed * 0.25, 0.0, 1.0);
  }
`

const FLAME_FRAGMENT_SHADER = `
  precision highp float;
  uniform vec3 uPrimaryColor;
  uniform vec3 uSecondaryColor;
  uniform float uOpacity;
  varying float vAlpha;
  varying float vColorMix;

  void main() {
    vec2 centered = gl_PointCoord - 0.5;
    float radial = length(centered) * 2.0;
    float glow = 1.0 - smoothstep(0.0, 1.0, radial);
    glow *= glow;
    if (glow < 0.008) discard;

    vec3 color = mix(uPrimaryColor, uSecondaryColor, vColorMix);
    gl_FragColor = vec4(color, glow * vAlpha * uOpacity);
  }
`

interface BlueEnergyFlameProps {
  emitterPosition: THREE.Vector3
  length: number
  radius: number
  powerRef?: MutableRefObject<number>
}

function createParticleGeometry(): THREE.BufferGeometry {
  const positions = new Float32Array(PARTICLE_COUNT * 3)
  const seeds = new Float32Array(PARTICLE_COUNT)

  for (let index = 0; index < PARTICLE_COUNT; index += 1) {
    // These values are stable and only act as shader seeds; no particles are
    // allocated or repositioned on the CPU during the flight.
    const seed = ((index * 16807) % 2147483647) / 2147483647
    positions[index * 3] = (seed * 13.37) % 1
    positions[index * 3 + 1] = 0.28 + ((seed * 47.11) % 1) * 0.72
    positions[index * 3 + 2] = index / PARTICLE_COUNT
    seeds[index] = seed
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1))
  return geometry
}

export function BlueEnergyFlame({ emitterPosition, length, radius, powerRef }: BlueEnergyFlameProps) {
  const materialRef = useRef<THREE.ShaderMaterial>(null)
  const { gl } = useThree()
  const geometry = useMemo(() => createParticleGeometry(), [])
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uLength: { value: length },
      uRadius: { value: radius },
      uPixelRatio: { value: Math.min(gl.getPixelRatio(), 2) },
      uPower: { value: powerRef?.current ?? 1 },
      uPrimaryColor: { value: new THREE.Color('#7FDBFF') },
      uSecondaryColor: { value: new THREE.Color('#B8F3FF') },
      uOpacity: { value: 0.88 },
    }),
    [gl, length, powerRef, radius],
  )

  useFrame((state) => {
    if (!materialRef.current) return
    const elapsed = state.clock.elapsedTime
    const power = powerRef?.current ?? 1
    materialRef.current.uniforms.uTime.value = elapsed
    materialRef.current.uniforms.uPower.value = power
    materialRef.current.uniforms.uOpacity.value =
      (0.82 + Math.sin(elapsed * 2.1) * 0.08) * THREE.MathUtils.clamp(power, 0, 1.25)
  })

  return (
    <points position={emitterPosition} geometry={geometry} frustumCulled={false}>
      <shaderMaterial
        ref={materialRef}
        vertexShader={FLAME_VERTEX_SHADER}
        fragmentShader={FLAME_FRAGMENT_SHADER}
        uniforms={uniforms}
        transparent
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        toneMapped={false}
      />
    </points>
  )
}
