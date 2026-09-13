import { Float, Html, Sparkles, Stars } from '@react-three/drei'
import { Canvas, useFrame } from '@react-three/fiber'
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing'
import { ArrowLeft, ArrowRight, LoaderCircle, SkipForward } from 'lucide-react'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { PlanetVisualConfig } from '../../product/contracts'
import { PlanetRenderer } from '../planet/PlanetRenderer'
import { planetStyleModule } from '../planet/style/planetStyleModule'
import { GUIDED_PROFILE_FIELDS } from './guidedProfileFields'
import type { GuidedProfileDraft, GuidedProfileField } from './profileDistanceModel'
import styles from './ProfileCoordinateJourney.module.css'

interface ProfileCoordinateJourneyProps {
  visual: PlanetVisualConfig
  planetName: string
  draft: GuidedProfileDraft
  fieldIndex: number
  isZh: boolean
  saving: boolean
  error: string
  onChange: (field: GuidedProfileField, value: string) => void
  onBack: () => void
  onAdvance: () => void
  onSkip: () => void
}

function TurningPlanet({ config, scale }: { config: PlanetVisualConfig; scale: number }) {
  const ref = useRef<THREE.Group>(null)
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += delta * 0.105
  })
  return <group ref={ref}><PlanetRenderer config={config} scale={scale} /></group>
}

function EncounterScene({
  selfVisual,
  encounterVisual,
  selfName,
  isZh,
  progress,
}: {
  selfVisual: PlanetVisualConfig
  encounterVisual: PlanetVisualConfig
  selfName: string
  isZh: boolean
  progress: number
}) {
  const leftRef = useRef<THREE.Group>(null)
  const rightRef = useRef<THREE.Group>(null)
  const connectionRef = useRef<THREE.Mesh>(null)
  const orbitRef = useRef<THREE.Mesh>(null)
  const sparklesRef = useRef<THREE.Points>(null)
  const pulseRef = useRef<THREE.Mesh>(null)
  const animatedProgressRef = useRef(0)

  useFrame((state, delta) => {
    animatedProgressRef.current = THREE.MathUtils.damp(animatedProgressRef.current, progress, 1.7, delta)
    // Nine profile answers should each produce a visible response. A concave
    // curve gives the first few facts enough movement while still converging
    // gently as the two worlds become close.
    const eased = Math.pow(THREE.MathUtils.clamp(animatedProgressRef.current, 0, 1), 0.72)
    const separation = THREE.MathUtils.lerp(5.45, 3.05, eased)

    if (leftRef.current) {
      leftRef.current.position.x = THREE.MathUtils.damp(leftRef.current.position.x, -separation / 2, 2.2, delta)
    }
    if (rightRef.current) {
      rightRef.current.position.x = THREE.MathUtils.damp(rightRef.current.position.x, separation / 2, 2.2, delta)
    }
    if (connectionRef.current) {
      connectionRef.current.scale.y = separation
      const material = connectionRef.current.material as THREE.MeshBasicMaterial
      material.opacity = THREE.MathUtils.damp(material.opacity, 0.1 + eased * 0.58, 1.8, delta)
    }
    if (orbitRef.current) {
      orbitRef.current.scale.x = THREE.MathUtils.damp(orbitRef.current.scale.x, separation * 0.69, 1.8, delta)
      orbitRef.current.scale.y = THREE.MathUtils.damp(orbitRef.current.scale.y, 1.34 - eased * 0.13, 1.8, delta)
      const material = orbitRef.current.material as THREE.MeshBasicMaterial
      material.opacity = THREE.MathUtils.damp(material.opacity, 0.06 + eased * 0.28, 1.8, delta)
    }
    if (sparklesRef.current) {
      const material = sparklesRef.current.material as THREE.ShaderMaterial
      material.opacity = THREE.MathUtils.damp(material.opacity, 0.05 + eased * 0.3, 1.6, delta)
    }
    if (pulseRef.current) {
      const pulse = 1 + Math.sin(state.clock.elapsedTime * (2.2 + progress * 2.8)) * 0.05
      pulseRef.current.scale.setScalar((0.7 + progress * 4.8) * pulse)
      const material = pulseRef.current.material as THREE.MeshBasicMaterial
      material.opacity = Math.max(0, Math.sin(progress * Math.PI) * 0.22)
    }
  })

  return (
    <>
      <ambientLight intensity={0.56} color="#9daee8" />
      <directionalLight position={[-5, 7, 6]} intensity={2.8} color="#ffe0c6" />
      <pointLight position={[4, -2, 4]} intensity={2.1} color="#d28ba7" />
      <Stars radius={45} depth={28} count={1650} factor={1.2} saturation={0.18} fade speed={0.1} />
      <Sparkles ref={sparklesRef} count={86} scale={[8.5, 4.4, 3]} size={1.25} speed={0.16} color="#e9c2bd" opacity={0.05} />

      <mesh ref={connectionRef} rotation={[0, 0, Math.PI / 2]} scale={[1, 5.45, 1]}>
        <cylinderGeometry args={[0.009, 0.009, 1, 10]} />
        <meshBasicMaterial color="#efc6bf" transparent opacity={0.1} />
      </mesh>
      <mesh ref={orbitRef} scale={[3.75, 1.34, 1]}>
        <torusGeometry args={[1, 0.0075, 8, 180]} />
        <meshBasicMaterial color="#b7a8df" transparent opacity={0.06} />
      </mesh>
      <mesh ref={pulseRef} scale={0.7}>
        <ringGeometry args={[0.98, 1, 96]} />
        <meshBasicMaterial color="#f4c9bd" transparent opacity={0} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>

      <group ref={leftRef} position={[-3.25, 0.82, 0]}>
        <Float speed={0.7} rotationIntensity={0.06} floatIntensity={0.18}>
          <TurningPlanet config={selfVisual} scale={0.86 / Math.max(1, selfVisual.radius)} />
        </Float>
        <Html center position={[0, -1.38, 0]} className={styles.planetLabel} aria-hidden="true">
          <span>{isZh ? 'My world' : 'My world'}</span><strong>{selfName}</strong>
        </Html>
      </group>

      <group ref={rightRef} position={[3.25, 0.62, 0]}>
        <Float speed={0.64} rotationIntensity={0.06} floatIntensity={0.2}>
          <TurningPlanet config={encounterVisual} scale={0.86 / Math.max(1, encounterVisual.radius)} />
        </Float>
        <Html center position={[0, -1.38, 0]} className={styles.planetLabel} aria-hidden="true">
          <span>{isZh ? 'Potential encounter' : 'Potential encounter'}</span>
          <strong>{isZh ? 'A world in the living cosmos' : 'A world in the living cosmos'}</strong>
        </Html>
      </group>

      <EffectComposer multisampling={0}>
        <Bloom intensity={0.54 + progress * 0.2} luminanceThreshold={0.4} luminanceSmoothing={0.88} />
        <Vignette offset={0.22} darkness={0.62} />
      </EffectComposer>
    </>
  )
}

export function ProfileCoordinateJourney({
  visual,
  planetName,
  draft,
  fieldIndex,
  isZh,
  saving,
  error,
  onChange,
  onBack,
  onAdvance,
  onSkip,
}: ProfileCoordinateJourneyProps) {
  const field = GUIDED_PROFILE_FIELDS[fieldIndex]
  const value = draft[field.id]
  const multiline = field.id === 'projectDirection' || field.id === 'bio'
  const isLast = fieldIndex === GUIDED_PROFILE_FIELDS.length - 1
  const answered = Object.values(draft).filter((item) => item.trim()).length
  const completedBefore = GUIDED_PROFILE_FIELDS
    .slice(0, fieldIndex)
    .filter((item) => draft[item.id].trim()).length
  const inputEnergy = Math.min(1, value.trim().length / 18)
  const approachProgress = Math.min(1, (completedBefore + inputEnergy) / GUIDED_PROFILE_FIELDS.length)
  const encounterVisual = useMemo(() => planetStyleModule.generate({
    mode: 'system',
    archetype: 'auto',
    seed: Math.abs((visual.seed * 1664525 + 1013904223) % 2147483647),
    radius: 1,
  }), [visual.seed])

  return (
    <main className={styles.screen} aria-label={isZh ? 'Build your universe coordinates' : 'Build your universe coordinates'}>
      <Canvas camera={{ position: [0, 0.72, 8.8], fov: 42 }} dpr={[1, 1.5]} gl={{ antialias: true, powerPreference: 'high-performance' }}>
        <color attach="background" args={['#080a25']} />
        <EncounterScene
          selfVisual={visual}
          encounterVisual={encounterVisual}
          selfName={planetName}
          isZh={isZh}
          progress={approachProgress}
        />
      </Canvas>

      <header className={styles.header}>
        <span>SOCIAL COSMOS</span>
        <strong>{isZh ? 'Give encounters coordinates' : 'Give encounters coordinates'}</strong>
        <small>{isZh ? `${answered} / ${GUIDED_PROFILE_FIELDS.length} coordinates illuminated` : `${answered} / ${GUIDED_PROFILE_FIELDS.length} coordinates illuminated`}</small>
      </header>

      <section className={styles.formPanel}>
        <div className={styles.eyebrow}><i />{field.step} / {String(GUIDED_PROFILE_FIELDS.length).padStart(2, '0')} · {isZh ? field.title.zh : field.title.en}</div>
        <h1>{isZh ? field.question.zh : field.question.en}</h1>
        <p>{isZh ? field.why.zh : field.why.en}</p>
        <label>
          {multiline ? (
            <textarea autoFocus rows={3} value={value} onChange={(event) => onChange(field.id, event.target.value)} placeholder={isZh ? field.placeholder.zh : field.placeholder.en} disabled={saving} />
          ) : (
            <input autoFocus value={value} onChange={(event) => onChange(field.id, event.target.value)} placeholder={isZh ? field.placeholder.zh : field.placeholder.en} disabled={saving} />
          )}
        </label>
        <div className={styles.signal}><i />{isZh ? 'Your input is changing the distance between these worlds' : 'Your input is changing the distance between these worlds'}</div>
        {error && <p className={styles.error}>{error}</p>}
        {saving && <div className={styles.saving}><LoaderCircle size={15} />{isZh ? 'Saving your coordinates…' : 'Saving your coordinates…'}</div>}
        <footer>
          <div className={styles.secondaryActions}>
            <button type="button" className={styles.previousField} onClick={onBack} disabled={saving}>
              <ArrowLeft size={15} />
              {fieldIndex === 0
                ? (isZh ? 'Back to world selection' : 'Back to world selection')
                : (isZh ? 'Previous question' : 'Previous question')}
            </button>
            <button type="button" className={styles.skipField} onClick={onSkip} disabled={saving}><SkipForward size={15} />{isZh ? 'Skip' : 'Skip'}</button>
          </div>
          <button type="button" className={styles.advance} onClick={onAdvance} disabled={saving}>
            {isLast ? (isZh ? 'Finish profile' : 'Finish profile') : (isZh ? 'Confirm and watch them move' : 'Confirm and watch them move')}
            <ArrowRight size={16} />
          </button>
        </footer>
      </section>
    </main>
  )
}
