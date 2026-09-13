import { useMemo, type ReactElement } from 'react'
import { EffectComposer, Bloom, Vignette, Noise } from '@react-three/postprocessing'
import { BlendFunction } from 'postprocessing'
import { SceneLighting } from './SceneLighting'
import { BackgroundStars } from './BackgroundStars'
import { NebulaField } from './NebulaField'
import { CorePlanet } from './CorePlanet'
import { PersonPlanet } from './PersonPlanet'
import { RelationshipLine } from './RelationshipLine'
import { FlowParticles } from './FlowParticles'
import { OrbitRings } from './OrbitRings'
import { MemoryOrbit } from './MemoryOrbit'
import { CameraController } from '../canvas/CameraController'
import { CometRide } from './CometRide'
import { useSceneStore } from '../../store/useSceneStore'
import { usePeopleStore } from '../../store/usePeopleStore'
import { isLowPerformanceDevice } from '../../utils/performance'
import { getPersonWorldPosition } from '../../utils/relationshipVisuals'

export function CosmosScene() {
  const mode = useSceneStore((state) => state.mode)
  const selectedPersonId = useSceneStore((state) => state.selectedPersonId)
  const people = usePeopleStore((state) => state.people)
  const maxMemoryCount = usePeopleStore((state) => state.maxMemoryCount)

  const selectedPerson = useMemo(
    () => people.find((person) => person.id === selectedPersonId) ?? null,
    [people, selectedPersonId],
  )
  const completePlanetVisit = useSceneStore((state) => state.completePlanetVisit)

  // @react-three/postprocessing types EffectComposer's children strictly as
  // Element(s) — a `{condition && <Effect/>}` inline conditional widens the
  // inferred children type to include `false`, which it rejects. Building
  // and filtering the list ahead of time keeps the JSX children genuinely
  // `ReactElement[]`.
  const effects = [
    <Bloom
      key="bloom"
      intensity={0.3}
      luminanceThreshold={0.7}
      luminanceSmoothing={0.9}
      mipmapBlur={!isLowPerformanceDevice}
    />,
    <Vignette key="vignette" eskil={false} offset={0.32} darkness={0.55} />,
    !isLowPerformanceDevice && (
      <Noise key="noise" opacity={0.02} blendFunction={BlendFunction.OVERLAY} />
    ),
  ].filter((effect): effect is ReactElement => Boolean(effect))

  return (
    <>
      <color attach="background" args={['#05060f']} />
      <fog attach="fog" args={['#05060f', 16, 40]} />

      <SceneLighting />
      <NebulaField />
      <BackgroundStars />
      <OrbitRings />
      <CorePlanet />
      <CometRide
        active={mode === 'cometRide'}
        destination={selectedPerson ? getPersonWorldPosition(selectedPerson) : null}
        showCharacterIntro
        onArrive={completePlanetVisit}
      />

      {people.map((person) => (
        <group key={person.id}>
          <PersonPlanet person={person} maxMemoryCount={maxMemoryCount} />
          <RelationshipLine person={person} />
          <FlowParticles person={person} />
        </group>
      ))}

      {selectedPerson && (
        <MemoryOrbit person={selectedPerson} maxMemoryCount={maxMemoryCount} />
      )}

      <CameraController />

      <EffectComposer multisampling={isLowPerformanceDevice ? 0 : undefined}>
        {effects}
      </EffectComposer>
    </>
  )
}
