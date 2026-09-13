import { Canvas } from '@react-three/fiber'
import { OrbitControls, Stars } from '@react-three/drei'
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing'
import type { PlanetVisualConfig } from '../../product/contracts'
import { UniverseBackground } from '../background/UniverseBackground'
import { PlanetRenderer } from './PlanetRenderer'
import styles from './PlanetPreview.module.css'

interface PlanetPreviewProps {
  config: PlanetVisualConfig
}

export function PlanetPreview({ config }: PlanetPreviewProps) {
  const usesAuthoredModel = Boolean(config.externalAssetUrl)

  return (
    <div className={styles.root}>
      <UniverseBackground className={styles.background} skinId={config.backgroundSkinId} />
      <Canvas
        camera={{ position: [0, 0.5, 4.2], fov: 42 }}
        dpr={[1, 1.6]}
        gl={{ antialias: true, powerPreference: 'high-performance', alpha: true }}
      >
        <ambientLight intensity={usesAuthoredModel ? 0.42 : 0.22} color="#8bb7e8" />
        <directionalLight position={[-4, 5, 4]} intensity={2.5} color="#e7f4ff" />
        <pointLight position={[4, -2, -3]} intensity={usesAuthoredModel ? 1.35 : 0.9} color={config.palette.atmosphere} />
        {usesAuthoredModel && (
          <directionalLight position={[4, 1, -5]} intensity={1.15} color="#b7d5ff" />
        )}
        <Stars radius={35} depth={22} count={900} factor={1.4} saturation={0.2} fade speed={0.15} />
        <PlanetRenderer config={config} scale={1.18 / Math.max(1, config.radius)} />
        <OrbitControls
          enablePan={false}
          enableDamping
          dampingFactor={0.08}
          minDistance={2.7}
          maxDistance={6}
          autoRotate
          autoRotateSpeed={0.35}
        />
        <EffectComposer multisampling={0}>
          <Bloom intensity={0.32} luminanceThreshold={0.72} luminanceSmoothing={0.85} />
          <Vignette offset={0.28} darkness={0.55} />
        </EffectComposer>
      </Canvas>
    </div>
  )
}
