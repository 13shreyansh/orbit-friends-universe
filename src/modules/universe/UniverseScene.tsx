import { Suspense, useMemo } from 'react'
import type { ActivityPost, MemorySignal, NebulaSpace, NebulaSummary, SocialPlanet, SpatialNodeState, SpatialSnapshot, UniverseScale } from '../../product/contracts'
import { GalaxyView } from '../galaxy/GalaxyView'
import { NebulaView } from '../nebula/NebulaView'
import { NebulaLobbyView } from '../nebula/NebulaLobbyView'
import { PlanetWorldView } from '../planet/PlanetWorldView'
import { VisitorTravel } from '../visitor/VisitorTravel'
import { CosmicBackdrop } from './CosmicBackdrop'
import { UniverseCameraRig } from './UniverseCameraRig'
import { CosmicBroadcast } from '../broadcast/CosmicBroadcast'
import type { CosmicBroadcastEvent } from '../broadcast/contracts'
import { MemoryBook, type MemoryBookStage } from '../memory-book/MemoryBook'
import type { MemoryPage } from '../memory-book/types'
import { createGalaxyDisplaySnapshot } from '../galaxy/galaxyDisplaySpace'

interface UniverseSceneProps {
  scale: UniverseScale
  activePlanet: SocialPlanet
  selfPlanet: SocialPlanet
  friendPlanets: SocialPlanet[]
  snapshot: SpatialSnapshot
  nebulaSpace?: NebulaSpace | null
  nebulaLobbyItems?: NebulaSummary[]
  selectedNebulaId?: string | null
  activities: ActivityPost[]
  selectedPlanetId: string | null
  traveling: boolean
  originNode: SpatialNodeState | null
  destinationNode: SpatialNodeState | null
  passengerName: string
  passengerAssetUrl?: string | null
  resetViewToken: number
  onSelectPlanet: (planetId: string) => void
  onSelectNebula?: (nebulaId: string) => void
  onEnterNebula?: (nebula: NebulaSummary) => void
  onSelectActivity: (activity: ActivityPost) => void
  uiObscured: boolean
  onTravelApproachingArrival: () => void
  onTravelComplete: () => void
  memoryBookStage: MemoryBookStage | null
  memoryBookPages: MemoryPage[]
  onMemoryBookOpened: () => void
  onMemoryBookTurnStart: () => void
  onMemoryBookTurnComplete: () => void
  onAddMemoryToBook?: () => void
  memoryBookFriendName?: string
  broadcastEvent: CosmicBroadcastEvent | null
  onSelectBroadcast: () => void
  onBroadcastComplete: () => void
  onCloseBroadcast: (activityId: string) => void
  memorySignal?: MemorySignal | null
  onSelectMemorySignal?: () => void
  onMemorySignalComplete?: () => void
}

export function UniverseScene(props: UniverseSceneProps) {
  const renderSnapshot = useMemo(
    () => props.scale === 'galaxy' ? createGalaxyDisplaySnapshot(props.snapshot) : props.snapshot,
    [props.scale, props.snapshot],
  )
  const focusedNode = props.scale !== 'planet'
    ? renderSnapshot.nodes.find((node) => node.planetId === props.selectedPlanetId)
    : null
  const focusPosition: [number, number, number] | null = focusedNode
    ? [focusedNode.position.x, focusedNode.position.y, focusedNode.position.z]
    : null
  const activeActivities = props.activities.filter((activity) => activity.planetId === props.activePlanet.id)
  const renderOriginNode = props.originNode
    ? renderSnapshot.nodes.find((node) => node.planetId === props.originNode?.planetId) ?? props.originNode
    : null
  const renderDestinationNode = props.destinationNode
    ? renderSnapshot.nodes.find((node) => node.planetId === props.destinationNode?.planetId) ?? props.destinationNode
    : null
  return (
    <Suspense fallback={null}>
      <fog attach="fog" args={['#201b48', 28, 72]} />
      <ambientLight intensity={0.55} color="#aaa7dc" />
      <directionalLight position={[-7, 9, 7]} intensity={3.35} color="#ffd0a5" />
      <pointLight position={[8, -4, -8]} intensity={2} color="#e886a7" />
      <pointLight position={[-10, 3, -5]} intensity={1.15} color="#8a72ce" />
      <CosmicBackdrop minimal={props.scale === 'nebula' && !props.nebulaSpace} />

      {!props.traveling && props.scale === 'planet' && (
        <>
          <PlanetWorldView
            planet={props.activePlanet}
            activities={activeActivities}
            onSelectActivity={props.onSelectActivity}
            onCloseBroadcast={props.onCloseBroadcast}
            showLabel={!props.uiObscured && !props.memoryBookStage}
          />
          {props.memoryBookStage && (
            <MemoryBook
              stage={props.memoryBookStage}
              planetRadius={props.activePlanet.visual.radius}
              pages={props.memoryBookPages}
              onOpened={props.onMemoryBookOpened}
              onPageTurnStart={props.onMemoryBookTurnStart}
              onPageTurnComplete={props.onMemoryBookTurnComplete}
              onAddMemory={props.onAddMemoryToBook}
              friendName={props.memoryBookFriendName}
            />
          )}
        </>
      )}
      {!props.traveling && props.scale === 'galaxy' && (
        <GalaxyView
          selfPlanet={props.selfPlanet}
          friendPlanets={props.friendPlanets}
          snapshot={renderSnapshot}
          distanceSnapshot={props.snapshot}
          activities={props.activities}
          showLabels={!props.uiObscured}
          selectedPlanetId={props.selectedPlanetId}
          onSelectPlanet={props.onSelectPlanet}
          onSelectActivity={props.onSelectActivity}
          onCloseBroadcast={props.onCloseBroadcast}
        />
      )}
      {!props.traveling && props.scale === 'nebula' && props.nebulaSpace && (
        <NebulaView
          space={props.nebulaSpace}
          selectedPlanetId={props.selectedPlanetId}
          showLabels={!props.uiObscured}
          onSelectPlanet={props.onSelectPlanet}
          onSelectActivity={props.onSelectActivity}
          onCloseBroadcast={props.onCloseBroadcast}
        />
      )}
      {!props.traveling && props.scale === 'nebula' && !props.nebulaSpace && props.nebulaLobbyItems && (
        <NebulaLobbyView
          nebulae={props.nebulaLobbyItems}
          selectedNebulaId={props.selectedNebulaId ?? null}
          onSelect={props.onSelectNebula ?? (() => undefined)}
          onEnter={props.onEnterNebula ?? (() => undefined)}
        />
      )}

      <VisitorTravel
        active={props.traveling}
        origin={renderOriginNode}
        destination={renderDestinationNode}
        showCharacterIntro={
          renderOriginNode?.planetId === props.selfPlanet.id &&
          renderDestinationNode?.planetId !== props.selfPlanet.id
        }
        vehicle={{
          type: 'comet',
          passengerName: props.passengerName,
          passengerAssetUrl: props.passengerAssetUrl ?? undefined,
        }}
        onApproachingArrival={props.onTravelApproachingArrival}
        onComplete={props.onTravelComplete}
      />
      {!props.traveling && (props.scale !== 'nebula' || Boolean(props.nebulaSpace)) && (
        <CosmicBroadcast
          event={props.broadcastEvent}
          selfPlanetId={props.selfPlanet.id}
          planetRadius={props.activePlanet.visual.radius}
          scale={props.scale}
          snapshot={renderSnapshot}
          onSelectActivity={props.onSelectBroadcast}
          onComplete={props.onBroadcastComplete}
          memorySignal={props.memorySignal}
          onSelectMemorySignal={props.onSelectMemorySignal}
          onMemorySignalComplete={props.onMemorySignalComplete}
        />
      )}
      <UniverseCameraRig
        scale={props.scale}
        planetRadius={props.activePlanet.visual.radius}
        traveling={props.traveling}
        focusPosition={focusPosition}
        fieldRadius={props.scale === 'nebula' && !props.nebulaSpace ? 8 : renderSnapshot.bounds.radius}
        resetToken={props.resetViewToken}
        ready={props.scale !== 'nebula' || Boolean(props.nebulaSpace) || Boolean(props.nebulaLobbyItems?.length)}
      />
    </Suspense>
  )
}
