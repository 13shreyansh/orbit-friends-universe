import { Suspense, useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { PlanetRendererExtension, PlanetVisualConfig } from '../../product/contracts'
import { createCloudTexture, createPlanetSurfaceMaps } from './planetTextureFactory'
import { planetStyleModule, type PlanetResolvedStyle } from './style/planetStyleModule'
import { AuthoredWorldModel } from './AuthoredWorldModel'

const ATMOSPHERE_VERTEX_SHADER = `
  varying vec3 vNormal;
  varying vec3 vViewDirection;
  void main() {
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vViewDirection = normalize(-viewPosition.xyz);
    gl_Position = projectionMatrix * viewPosition;
  }
`

const ATMOSPHERE_FRAGMENT_SHADER = `
  precision highp float;
  uniform vec3 uColor;
  uniform float uStrength;
  varying vec3 vNormal;
  varying vec3 vViewDirection;
  void main() {
    float rim = pow(1.0 - max(dot(vNormal, vViewDirection), 0.0), 3.2);
    float alpha = rim * (0.1 + uStrength * 0.17);
    gl_FragColor = vec4(uColor, alpha);
  }
`

interface PlanetRendererProps {
  config: PlanetVisualConfig
  ecologyMaturity?: number
  scale?: number
  selected?: boolean
  onClick?: () => void
  extension?: PlanetRendererExtension | null
}

interface PlanetSatelliteProps {
  config: PlanetVisualConfig
  style: PlanetResolvedStyle
  index: number
  count: number
}

interface ProceduralPlanetSurfaceProps {
  config: PlanetVisualConfig
  style: PlanetResolvedStyle
  ecologyMaturity: number
}

function ProceduralPlanetSurface({ config, style, ecologyMaturity }: ProceduralPlanetSurfaceProps) {
  const cloudRef = useRef<THREE.Mesh>(null)
  const surfaceMaps = useMemo(() => createPlanetSurfaceMaps(config, 768, ecologyMaturity), [config, ecologyMaturity])
  const cloudTexture = useMemo(() => createCloudTexture(config, 512, ecologyMaturity), [config, ecologyMaturity])

  useEffect(
    () => () => {
      surfaceMaps.colorMap.dispose()
      surfaceMaps.bumpMap.dispose()
      surfaceMaps.roughnessMap.dispose()
      surfaceMaps.emissiveMap.dispose()
      cloudTexture.dispose()
    },
    [cloudTexture, surfaceMaps],
  )

  useFrame((_, delta) => {
    if (cloudRef.current) cloudRef.current.rotation.y += delta * style.clouds.rotationSpeed
  })

  return (
    <>
      <mesh castShadow receiveShadow>
        <sphereGeometry args={[config.radius, 128, 96]} />
        <meshStandardMaterial
          map={surfaceMaps.colorMap}
          color="#ffffff"
          bumpMap={surfaceMaps.bumpMap}
          bumpScale={style.surface.bumpScale}
          displacementMap={surfaceMaps.bumpMap}
          displacementScale={style.surface.displacementScale}
          displacementBias={style.surface.displacementBias}
          roughnessMap={surfaceMaps.roughnessMap}
          roughness={style.surface.materialRoughness}
          metalness={style.surface.metalness}
          emissive={style.surface.emissive}
          emissiveIntensity={style.surface.emissiveIntensity}
          emissiveMap={style.surface.lava.enabled ? surfaceMaps.emissiveMap : undefined}
        />
      </mesh>
      {style.clouds.visible && (
        <mesh ref={cloudRef} scale={1.012}>
          <sphereGeometry args={[config.radius, 96, 64]} />
          <meshStandardMaterial
            map={cloudTexture}
            color="#ffffff"
            transparent
            opacity={style.clouds.opacity}
            alphaTest={0.06}
            roughness={1}
            depthWrite={false}
          />
        </mesh>
      )}
    </>
  )
}

function PlanetSatellite({ config, style, index, count }: PlanetSatelliteProps) {
  const revolutionRef = useRef<THREE.Group>(null)
  const moonRef = useRef<THREE.Mesh>(null)
  const orbitRadius = config.radius * (1.62 + index * 0.34)
  const moonRadius = config.radius * (0.115 + index * 0.014)
  const initialAngle = 0.42 + (index / Math.max(1, count)) * Math.PI * 2
  const inclination = 0.22 + index * 0.19

  useFrame((_, delta) => {
    if (revolutionRef.current) {
      revolutionRef.current.rotation.y += delta * (0.2 / (1 + index * 0.24))
    }
    if (moonRef.current) moonRef.current.rotation.y += delta * 0.18
  })

  return (
    <group rotation-z={inclination}>
      <mesh rotation-x={Math.PI / 2}>
        <torusGeometry args={[orbitRadius, config.radius * 0.004, 8, 160]} />
        <meshBasicMaterial
          color={config.palette.atmosphere}
          transparent
          opacity={0.16}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      <group ref={revolutionRef} rotation-y={initialAngle}>
        <group position={[orbitRadius, 0, 0]}>
          <mesh ref={moonRef} castShadow receiveShadow>
            <icosahedronGeometry args={[moonRadius, 3]} />
            <meshStandardMaterial
              color={style.satellite.color}
              roughness={0.9}
              metalness={0.04}
              emissive={config.palette.deep}
              emissiveIntensity={0.18}
            />
          </mesh>
          <mesh scale={1.14}>
            <sphereGeometry args={[moonRadius, 32, 24]} />
            <meshBasicMaterial
              color={style.satellite.glowColor}
              transparent
              opacity={0.1}
              side={THREE.BackSide}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
        </group>
      </group>
    </group>
  )
}

export function PlanetRenderer({
  config,
  ecologyMaturity = 0,
  scale = 1,
  selected = false,
  onClick,
  extension,
}: PlanetRendererProps) {
  const groupRef = useRef<THREE.Group>(null)
  const style = useMemo(() => planetStyleModule.resolve(config), [config])

  useFrame((_, delta) => {
    if (groupRef.current) groupRef.current.rotation.y += delta * style.rotationSpeed
  })

  const radius = config.radius
  const externalAssetUrl = extension?.assetUrl ?? config.externalAssetUrl

  return (
    <group
      ref={groupRef}
      scale={scale}
      onClick={(event) => {
        if (!onClick) return
        event.stopPropagation()
        onClick()
      }}
    >
      {externalAssetUrl ? (
        <Suspense fallback={null}>
          <AuthoredWorldModel assetUrl={externalAssetUrl} radius={radius} />
        </Suspense>
      ) : (
        <>
          <ProceduralPlanetSurface config={config} style={style} ecologyMaturity={ecologyMaturity} />

          <mesh scale={style.atmosphere.scale}>
            <sphereGeometry args={[radius, 96, 64]} />
            <shaderMaterial
              vertexShader={ATMOSPHERE_VERTEX_SHADER}
              fragmentShader={ATMOSPHERE_FRAGMENT_SHADER}
              uniforms={{
                uColor: { value: new THREE.Color(style.atmosphere.color) },
                uStrength: { value: style.atmosphere.strength },
              }}
              transparent
              side={THREE.BackSide}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>

          {style.ring.visible && (
            <mesh rotation-x={Math.PI / 2.4}>
              <ringGeometry args={[style.ring.innerRadius, style.ring.outerRadius, 128]} />
              <meshStandardMaterial
                color={style.ring.color}
                transparent
                opacity={style.ring.opacity}
                roughness={0.72}
                side={THREE.DoubleSide}
                depthWrite={false}
              />
            </mesh>
          )}

          {Array.from({ length: style.satellite.count }, (_, index) => (
            <PlanetSatellite
              key={index}
              config={config}
              style={style}
              index={index}
              count={style.satellite.count}
            />
          ))}

          {selected && (
            <mesh scale={1.16}>
              <sphereGeometry args={[radius, 64, 48]} />
              <shaderMaterial
                vertexShader={ATMOSPHERE_VERTEX_SHADER}
                fragmentShader={ATMOSPHERE_FRAGMENT_SHADER}
                uniforms={{
                  uColor: { value: new THREE.Color(config.palette.atmosphere) },
                  uStrength: { value: 0.32 },
                }}
                transparent
                side={THREE.BackSide}
                blending={THREE.AdditiveBlending}
                depthWrite={false}
              />
            </mesh>
          )}
        </>
      )}

    </group>
  )
}
