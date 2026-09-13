import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type TransitionEvent,
} from 'react'
import { UserPlus } from 'lucide-react'
import { Canvas } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing'
import { useProductStore } from '../../product/store/useProductStore'
import { useSpatialSnapshot } from './useSpatialSnapshot'
import { PlanetDetailPanel } from './PlanetDetailPanel'
import { UniverseHUD } from './UniverseHUD'
import { UniverseScene } from './UniverseScene'
import { VisitorHUD } from '../visitor/VisitorHUD'
import { RelationshipEditor } from '../relationships/RelationshipEditor'
import { ActivityComposer } from '../activity/ActivityComposer'
import { ActivityDetail } from '../activity/ActivityDetail'
import { latestActivitiesByPlanet } from '../activity/activitySelectors'
import type { ActivityPost, SpatialSnapshot } from '../../product/contracts'
import { useI18n } from '../../product/i18n'
import { PlanetLifePanel } from '../planet/PlanetLifePanel'
import styles from './UniverseExperience.module.css'
import { useCosmicBroadcasts } from '../broadcast/useCosmicBroadcasts'
import { useMemorySignalBroadcasts } from '../broadcast/useMemorySignalBroadcasts'
import { UniverseBackground } from '../background/UniverseBackground'
import { useAddMemoryStore } from '../../store/useAddMemoryStore'
import { CosmosDataDrawer } from '../profile/CosmosDataDrawer'
import { NebulaDirectory } from '../nebula/NebulaDirectory'
import { NebulaHUD } from '../nebula/NebulaHUD'
import { NebulaMemberPanel } from '../nebula/NebulaMemberPanel'
import { NebulaLobbyHUD, NebulaLobbyInfo } from '../nebula/NebulaLobbyInfo'
import { useNebulaSpace } from '../nebula/useNebulaSpace'
import { apiClient } from '../../product/api/apiClient'
import { OnboardingModule } from '../onboarding'
import { ProfileCompletionPrompt } from '../profile/ProfileCompletionPrompt'
import { countProfileFacts, needsProfileSupplement } from '../profile/profileCompletion'
import { usePlanetMemories } from '../memory/planetMemory'
import type { MemoryBookStage } from '../memory-book/MemoryBook'
import { convertMemoryToPages } from '../memory-book/convertMemoryToPages'
import { DEFAULT_PASSENGER_ASSET_URL } from '../../components/cosmos/CometPassenger'
import { getFriendsStory } from '../../demo/friendsStories'
import type { MemoryPage } from '../memory-book/types'
import { NebulaMemberDirectory } from '../nebula/NebulaMemberDirectory'

const MemoryIngestionOverlay = lazy(() =>
  import('../../components/memory/MemoryIngestionOverlay').then((module) => ({
    default: module.MemoryIngestionOverlay,
  })),
)

type VisitStage = 'idle' | 'traveling' | 'book-opening' | 'book-view' | 'page-turning' | 'planet-detail'
type TravelTransitionPhase =
  | 'IDLE'
  | 'FADE_OUT_CURRENT_SCENE'
  | 'INTRO_READY'
  | 'TRAVEL_ACTIVE'
  | 'FADE_OUT_ARRIVAL'
  | 'SWITCH_TARGET_SCENE'
  | 'REVEAL_TARGET_SCENE'

export function UniverseExperience() {
  const { isZh, t } = useI18n()
  const selfPlanet = useProductStore((state) => state.selfPlanet)
  const profile = useProductStore((state) => state.profile)
  const isFriendsDemo = profile?.id.startsWith('friends-') ?? false
  const guestSession = useProductStore((state) => state.session?.readOnly)
  const friendPlanets = useProductStore((state) => state.friendPlanets)
  const samplePlanets = useProductStore((state) => state.samplePlanets)
  const relationships = useProductStore((state) => state.relationships)
  const memories = useProductStore((state) => state.memories)
  const activities = useProductStore((state) => state.activities)
  const memorySignals = useProductStore((state) => state.memorySignals)
  const scale = useProductStore((state) => state.universeScale)
  const selectedPlanetId = useProductStore((state) => state.selectedPlanetId)
  const activePlanetId = useProductStore((state) => state.activePlanetId)
  const destinationId = useProductStore((state) => state.travelDestinationId)
  const traveling = useProductStore((state) => state.isTraveling)
  const setScale = useProductStore((state) => state.setUniverseScale)
  const selectPlanet = useProductStore((state) => state.selectPlanet)
  const startTravel = useProductStore((state) => state.startTravel)
  const startReturnTravel = useProductStore((state) => state.startReturnTravel)
  const cancelTravel = useProductStore((state) => state.cancelTravel)
  const completeTravel = useProductStore((state) => state.completeTravel)
  const signOut = useProductStore((state) => state.signOut)
  const publishActivity = useProductStore((state) => state.publishActivity)
  const markActivityBroadcastRead = useProductStore((state) => state.markActivityBroadcastRead)
  const closeActivityBroadcast = useProductStore((state) => state.closeActivityBroadcast)
  const markMemorySignalRead = useProductStore((state) => state.markMemorySignalRead)
  const memoryStep = useAddMemoryStore((state) => state.step)
  const memoryLibraryOpen = useAddMemoryStore((state) => state.libraryOpen)
  const memoryAgentOpen = useAddMemoryStore((state) => state.agentOpen)
  const openMemoryDrawer = useAddMemoryStore((state) => state.openDrawer)
  const recordPlanetInteraction = useProductStore((state) => state.recordPlanetInteraction)
  const mergeUniverseWindow = useProductStore((state) => state.mergeUniverseWindow)
  const [resetViewToken, setResetViewToken] = useState(0)
  const [relationshipEditorOpen, setRelationshipEditorOpen] = useState(false)
  const [activityComposerOpen, setActivityComposerOpen] = useState(false)
  const [selectedActivity, setSelectedActivity] = useState<ActivityPost | null>(null)
  const [dataDrawerOpen, setDataDrawerOpen] = useState(false)
  const [nebulaMembersOpen, setNebulaMembersOpen] = useState(false)
  const [selectedNebulaId, setSelectedNebulaId] = useState<string | null>(null)
  const [profileEditorOpen, setProfileEditorOpen] = useState(false)
  const [profilePromptDismissed, setProfilePromptDismissed] = useState(false)
  const [profileIncomplete, setProfileIncomplete] = useState(false)
  const [profileAnswered, setProfileAnswered] = useState(0)
  const [visitStage, setVisitStage] = useState<VisitStage>('idle')
  const [travelTransitionPhase, setTravelTransitionPhase] =
    useState<TravelTransitionPhase>('IDLE')
  const transitionIntentRef = useRef<'visit' | 'return' | null>(null)
  const transitionDestinationRef = useRef<string | null>(null)
  const flightFinishedRef = useRef(false)
  const veilOpaqueRef = useRef(false)
  const arrivalCommittedRef = useRef(false)
  const returnNebulaIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!profile?.id) return
    let active = true
    apiClient.getProfileIntake()
      .then((intake) => {
        if (!active) return
        setProfileAnswered(countProfileFacts(intake))
        setProfileIncomplete(needsProfileSupplement(intake))
      })
      .catch(() => undefined)
    return () => { active = false }
  }, [profile?.id, profileEditorOpen])
  useEffect(() => {
    if (!profile?.id) return
    let disposed = false
    const refreshMemorySignals = () => {
      void apiClient.listMemorySignals()
        .then(({ signals }) => {
          if (disposed) return
          useProductStore.setState({ memorySignals: signals })
        })
        .catch(() => undefined)
    }
    const interval = window.setInterval(refreshMemorySignals, 12000)
    return () => {
      disposed = true
      window.clearInterval(interval)
    }
  }, [profile?.id])
  const navigablePlanets = friendPlanets.length > 0 ? friendPlanets : samplePlanets
  const { snapshot, error } = useSpatialSnapshot(
    selfPlanet,
    navigablePlanets,
    scale === 'galaxy',
    mergeUniverseWindow,
  )
  const nebula = useNebulaSpace(scale === 'nebula')
  const nebulaPlanets = useMemo(
    () => nebula.space?.members.map((member) => member.planet) ?? [],
    [nebula.space?.members],
  )
  const lobbyNebulae = useMemo(() => {
    const featured = [...nebula.directory.joined, ...nebula.directory.recommended]
      .find((item) => item.slug === 'adventurex')
    return [
      ...(featured ? [featured] : []),
      ...nebula.directory.recommended.filter((item) => item.id !== featured?.id),
    ].slice(0, 5)
  }, [nebula.directory.joined, nebula.directory.recommended])
  const selectedNebula = lobbyNebulae.find((item) => item.id === selectedNebulaId) ?? null
  const allNavigablePlanets = useMemo(
    () => [...navigablePlanets, ...nebulaPlanets.filter((planet) => !navigablePlanets.some((item) => item.id === planet.id))],
    [nebulaPlanets, navigablePlanets],
  )
  const sceneActivities = useMemo(() => {
    const byId = new Map(activities.map((activity) => [activity.id, activity]))
    nebula.space?.activities.forEach((activity) => byId.set(activity.id, activity))
    return [...byId.values()]
  }, [activities, nebula.space?.activities])
  const scenePlanetIds = useMemo(
    () => (scale === 'nebula' ? nebulaPlanets : navigablePlanets).map((planet) => planet.id),
    [nebulaPlanets, navigablePlanets, scale],
  )
  const nebulaLobbySnapshot = useMemo<SpatialSnapshot | null>(() => selfPlanet ? ({
    schemaVersion: 2,
    coordinateSystem: 'social-cartesian-v1',
    layoutAlgorithmVersion: 'layout.v2',
    generatedAt: new Date(0).toISOString(),
    centerPlanetId: selfPlanet.id,
    graphVersion: `nebula-lobby:${selfPlanet.id}`,
    nodes: [{
      planetId: selfPlanet.id,
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      gravityVector: { x: 0, y: 0, z: 0 },
      mass: selfPlanet.identity.mass,
      massScore: selfPlanet.identity.mass,
      visualRadius: selfPlanet.visual.radius,
      relationshipForce: 1,
      clusterId: 'self',
      orbitBand: 0,
      sphericalPosition: { radius: 0, azimuth: 0, elevation: 0 },
    }],
    edges: [],
    bounds: { radius: 10, center: { x: 0, y: 0, z: 0 } },
  }) : null, [selfPlanet])
  const sceneSnapshot = scale === 'nebula' && nebula.space
    ? nebula.space.snapshot
    : scale === 'nebula'
      ? nebulaLobbySnapshot
      : scale === 'planet'
        ? snapshot ?? nebulaLobbySnapshot
        : snapshot
  const activityByPlanet = useMemo(() => latestActivitiesByPlanet(sceneActivities), [sceneActivities])

  const activePlanet = useMemo(
    () => [selfPlanet, ...allNavigablePlanets].find((planet) => planet?.id === activePlanetId) ?? selfPlanet,
    [activePlanetId, allNavigablePlanets, selfPlanet],
  )
  const selectedPlanet = allNavigablePlanets.find((planet) => planet.id === selectedPlanetId) ?? null
  const selectedRelationship = relationships.find((relationship) => relationship.targetPlanetId === selectedPlanetId) ?? null
  const activeRelationship = relationships.find((relationship) => relationship.targetPlanetId === activePlanet?.id) ?? null
  const selectedPlanetActivity = selectedPlanetId ? activityByPlanet.get(selectedPlanetId) ?? null : null
  const destinationPlanet = [selfPlanet, ...allNavigablePlanets].find((planet) => planet?.id === destinationId) ?? null
  const activeNode = sceneSnapshot?.nodes.find((node) => node.planetId === activePlanetId) ?? null
  const destinationNode = sceneSnapshot?.nodes.find((node) => node.planetId === destinationId) ?? null
  const homeNode = sceneSnapshot?.nodes.find((node) => node.planetId === selfPlanet?.id) ?? null
  const selectedNode = sceneSnapshot?.nodes.find((node) => node.planetId === selectedPlanetId) ?? null
  const selectedDistance = homeNode && selectedNode
    ? Math.hypot(selectedNode.position.x - homeNode.position.x, selectedNode.position.y - homeNode.position.y, selectedNode.position.z - homeNode.position.z)
    : null
  const activeActivities = useMemo(
    () => sceneActivities.filter((activity) => activity.planetId === activePlanet?.id),
    [activePlanet?.id, sceneActivities],
  )
  const activePlanetMemories = usePlanetMemories(activePlanet?.id ?? '')
  const activeConfirmedMemories = useMemo(
    () => activeRelationship
      ? memories.filter((memory) => (
        memory.relationshipId === activeRelationship.id
        || (memory.shared && memory.sharedByUserId === activePlanet?.ownerId)
      ))
      : memories.filter((memory) => memory.shared && memory.sharedByUserId === activePlanet?.ownerId),
    [activePlanet?.ownerId, activeRelationship, memories],
  )
  const memoryBookPages = useMemo<MemoryPage[]>(() => {
    const story = getFriendsStory(profile?.id ?? '', activePlanet?.ownerId ?? '')
    if (story) return [
      {id:'friends-book-cover',type:'cover',title:story.title,text:story.relationship},
      ...story.photos.map((photo,index):MemoryPage=>({id:`friends-photo-${index}`,type:'photo',title:photo.caption,mediaUrl:photo.url,fileName:photo.caption})),
      {id:'friends-book-ending',type:'text',title:'And all the moments in between',text:story.description},
    ]
    return convertMemoryToPages(activePlanet?.ownerName ?? 'Friend', activePlanetMemories, activeConfirmedMemories)
  }, [activeConfirmedMemories, activePlanet?.ownerId, activePlanet?.ownerName, activePlanetMemories, profile?.id])
  const initialPlanetDistance = activePlanet
    ? Math.max(5.8, activePlanet.visual.radius * 4.8)
    : 5.8
  const mediaOverlayOpen = activityComposerOpen || selectedActivity !== null || dataDrawerOpen || profileEditorOpen
  const {
    activeEvent: broadcastEvent,
    completeActiveBroadcast,
    emitLocalPublication,
  } = useCosmicBroadcasts({
    activities: sceneActivities,
    selfPlanetId: selfPlanet?.id ?? '',
    visiblePlanetIds: scenePlanetIds,
    scale,
  })
  const {
    activeSignal,
    completeActiveSignal,
  } = useMemorySignalBroadcasts({
    signals: memorySignals,
    selfPlanetId: profile?.id ?? '',
    visiblePlanetIds: scenePlanetIds,
    scale,
  })

  const openActivity = (activity: ActivityPost) => {
    if (activity.planetId !== selfPlanet?.id && (activity.broadcast?.visible ?? true)) {
      if (scale === 'nebula' && nebula.space?.activities.some((item) => item.id === activity.id)) {
        void nebula.markActivityRead(activity.id)
      } else {
        void markActivityBroadcastRead(activity.id)
      }
    }
    setSelectedActivity(activity)
  }

  const handleSelectPlanet = (planetId: string) => {
    selectPlanet(planetId)
    if (planetId !== selfPlanet?.id && !isFriendsDemo) {
      void recordPlanetInteraction(planetId, 'view').catch(() => undefined)
    }
  }

  const resetTransitionGuards = useCallback(() => {
    flightFinishedRef.current = false
    veilOpaqueRef.current = false
    arrivalCommittedRef.current = false
  }, [])

  const beginVisit = (planetId: string, remote = false) => {
    if (traveling || travelTransitionPhase !== 'IDLE') return
    if (!remote) window.dispatchEvent(new CustomEvent('orbit-local-travel', { detail: { planetId } }))
    returnNebulaIdRef.current = scale === 'nebula' ? nebula.activeNebulaId : null
    transitionIntentRef.current = 'visit'
    transitionDestinationRef.current = planetId
    resetTransitionGuards()
    setTravelTransitionPhase('FADE_OUT_CURRENT_SCENE')
  }

  const cancelVisit = () => {
    if (
      travelTransitionPhase === 'FADE_OUT_ARRIVAL' ||
      travelTransitionPhase === 'SWITCH_TARGET_SCENE' ||
      travelTransitionPhase === 'REVEAL_TARGET_SCENE'
    ) return
    cancelTravel()
    setVisitStage('idle')
    transitionIntentRef.current = null
    transitionDestinationRef.current = null
    setTravelTransitionPhase('IDLE')
  }

  const returnHome = (remote = false) => {
    if (traveling || travelTransitionPhase !== 'IDLE') return
    if (!selfPlanet?.id || activePlanetId === selfPlanet.id) return
    if (!remote) window.dispatchEvent(new CustomEvent('orbit-local-travel', { detail: { planetId: selfPlanet.id } }))
    transitionIntentRef.current = 'return'
    transitionDestinationRef.current = selfPlanet.id
    resetTransitionGuards()
    setVisitStage('traveling')
    startReturnTravel()
    setTravelTransitionPhase('TRAVEL_ACTIVE')
  }

  useEffect(() => {
    const sharedTravel = (event: Event) => {
      const planetId = (event as CustomEvent<{planetId:string}>).detail.planetId
      if (planetId === activePlanetId) return
      if (planetId === selfPlanet?.id) returnHome(true)
      else if (allNavigablePlanets.some(planet => planet.id === planetId)) beginVisit(planetId, true)
    }
    window.addEventListener('orbit-shared-travel', sharedTravel)
    return () => window.removeEventListener('orbit-shared-travel', sharedTravel)
  })

  const commitArrival = useCallback(() => {
    if (
      !flightFinishedRef.current ||
      !veilOpaqueRef.current ||
      arrivalCommittedRef.current
    ) return
    arrivalCommittedRef.current = true
    const arrivedPlanetId = transitionDestinationRef.current
    setTravelTransitionPhase('SWITCH_TARGET_SCENE')
    completeTravel()
    if (arrivedPlanetId && arrivedPlanetId !== selfPlanet?.id) {
      setVisitStage('book-opening')
    } else {
      setVisitStage('planet-detail')
      if (isFriendsDemo) setScale('galaxy')
    }
  }, [completeTravel, selfPlanet?.id, isFriendsDemo, setScale])

  const handleTravelApproachingArrival = useCallback(() => {
    setTravelTransitionPhase((phase) =>
      phase === 'TRAVEL_ACTIVE' ? 'FADE_OUT_ARRIVAL' : phase,
    )
  }, [])

  const handleTravelComplete = useCallback(() => {
    flightFinishedRef.current = true
    setTravelTransitionPhase((phase) =>
      phase === 'TRAVEL_ACTIVE' ? 'FADE_OUT_ARRIVAL' : phase,
    )
    commitArrival()
  }, [commitArrival])

  const handleTransitionEnd = (event: TransitionEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || event.propertyName !== 'opacity') return

    if (travelTransitionPhase === 'FADE_OUT_CURRENT_SCENE') {
      const targetPlanetId = transitionDestinationRef.current
      if (!targetPlanetId || transitionIntentRef.current !== 'visit') {
        setTravelTransitionPhase('IDLE')
        return
      }
      setVisitStage('traveling')
      startTravel(targetPlanetId)
      setTravelTransitionPhase('INTRO_READY')
      return
    }

    if (travelTransitionPhase === 'FADE_OUT_ARRIVAL') {
      veilOpaqueRef.current = true
      commitArrival()
      return
    }

    if (travelTransitionPhase === 'REVEAL_TARGET_SCENE') {
      transitionIntentRef.current = null
      transitionDestinationRef.current = null
      resetTransitionGuards()
      setTravelTransitionPhase('IDLE')
    }
  }

  const memoryBookStage: MemoryBookStage | null = visitStage === 'book-opening'
    ? 'opening'
    : visitStage === 'book-view'
      ? 'view'
      : visitStage === 'page-turning'
        ? 'turning'
      : null

  useEffect(() => {
    if (travelTransitionPhase !== 'INTRO_READY' || !traveling) return
    let secondFrame = 0
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        setTravelTransitionPhase('TRAVEL_ACTIVE')
      })
    })
    return () => {
      window.cancelAnimationFrame(firstFrame)
      if (secondFrame) window.cancelAnimationFrame(secondFrame)
    }
  }, [travelTransitionPhase, traveling])

  useEffect(() => {
    if (
      travelTransitionPhase !== 'SWITCH_TARGET_SCENE' ||
      traveling ||
      activePlanetId !== transitionDestinationRef.current
    ) return

    let secondFrame = 0
    let readyTimer = 0
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        // The target planet/book and camera rig have now mounted with their
        // final data. Keep them concealed briefly so camera settling and HTML
        // media bindings finish before the reveal begins.
        readyTimer = window.setTimeout(() => {
          setTravelTransitionPhase('REVEAL_TARGET_SCENE')
        }, 180)
      })
    })
    return () => {
      window.cancelAnimationFrame(firstFrame)
      if (secondFrame) window.cancelAnimationFrame(secondFrame)
      if (readyTimer) window.clearTimeout(readyTimer)
    }
  }, [
    activePlanetId,
    memoryBookPages,
    travelTransitionPhase,
    traveling,
  ])

  useEffect(() => {
    useGLTF.preload(profile?.avatar3dAssetUrl || DEFAULT_PASSENGER_ASSET_URL)
  }, [profile?.avatar3dAssetUrl])

  const handleScaleChange = (nextScale: typeof scale) => {
    selectPlanet(null)
    setNebulaMembersOpen(false)
    if (nextScale === 'nebula') {
      setSelectedNebulaId(null)
      nebula.leaveNebula()
    }
    setScale(nextScale)
    setResetViewToken((value) => value + 1)
  }

  const openActivePlanetMemory = useCallback(() => {
    if (!activeRelationship) {
      openMemoryDrawer()
      return
    }
    openMemoryDrawer({
      relationshipId: activeRelationship.id,
      targetUserId: activeRelationship.targetUserId,
      targetPlanetId: activeRelationship.targetPlanetId,
      targetName: activeRelationship.targetName || activePlanet?.ownerName || 'Friend',
    })
  }, [activePlanet?.ownerName, activeRelationship, openMemoryDrawer])

  const handleLeaveNebula = () => {
    selectPlanet(null)
    setNebulaMembersOpen(false)
    setSelectedNebulaId(null)
    nebula.leaveNebula()
    setResetViewToken((value) => value + 1)
  }

  if (!selfPlanet || !profile || !activePlanet) return null

  return (
    <main className={styles.experience}>
      <UniverseBackground className={styles.cosmicBackground} skinId={selfPlanet.visual.backgroundSkinId} />
      <Canvas
        frameloop={mediaOverlayOpen ? 'demand' : 'always'}
        camera={{
          position: [0, initialPlanetDistance * 0.088, initialPlanetDistance],
          fov: 46,
          near: 0.08,
          far: 240,
        }}
        dpr={[1, 1.65]}
        gl={{ antialias: true, powerPreference: 'high-performance', alpha: true }}
      >
        {sceneSnapshot && (
          <UniverseScene
            scale={scale}
            activePlanet={activePlanet}
            selfPlanet={selfPlanet}
            friendPlanets={navigablePlanets}
            snapshot={sceneSnapshot}
            nebulaSpace={nebula.space}
            nebulaLobbyItems={scale === 'nebula' && !nebula.activeNebulaId ? lobbyNebulae : undefined}
            selectedNebulaId={selectedNebulaId}
            activities={sceneActivities}
            selectedPlanetId={selectedPlanetId}
            traveling={traveling}
            originNode={activeNode}
            destinationNode={destinationNode}
            passengerName={profile.displayName}
            passengerAssetUrl={profile.avatar3dAssetUrl}
            resetViewToken={resetViewToken}
            onSelectPlanet={handleSelectPlanet}
            onSelectNebula={setSelectedNebulaId}
            onEnterNebula={(lobbyNebula) => {
              setSelectedNebulaId(null)
              if (lobbyNebula.joined) {
                nebula.enterNebula(lobbyNebula.id)
              } else {
                void nebula.joinNebula(lobbyNebula.id)
              }
            }}
            onSelectActivity={openActivity}
            uiObscured={
              activityComposerOpen
              || selectedActivity !== null
              || relationshipEditorOpen
              || nebula.directoryOpen
              || profileEditorOpen
              || dataDrawerOpen
              || nebulaMembersOpen
              || memoryStep !== 'closed'
              || memoryLibraryOpen
              || memoryAgentOpen
            }
            onTravelApproachingArrival={handleTravelApproachingArrival}
            onTravelComplete={handleTravelComplete}
            memoryBookStage={memoryBookStage}
            memoryBookPages={memoryBookPages}
            onMemoryBookOpened={() => setVisitStage('book-view')}
            onMemoryBookTurnStart={() => setVisitStage('page-turning')}
            onMemoryBookTurnComplete={() => setVisitStage('book-view')}
            onAddMemoryToBook={!isFriendsDemo && activeRelationship && !guestSession && !activePlanet.ownerId.startsWith('chapter-') ? openActivePlanetMemory : undefined}
            memoryBookFriendName={activeRelationship?.targetName || activePlanet.ownerName}
            broadcastEvent={isFriendsDemo ? null : broadcastEvent}
            onSelectBroadcast={() => {
              if (!broadcastEvent) return
              handleSelectPlanet(broadcastEvent.activity.planetId)
              openActivity(broadcastEvent.activity)
              completeActiveBroadcast()
            }}
            onBroadcastComplete={completeActiveBroadcast}
            memorySignal={isFriendsDemo ? null : activeSignal}
            onSelectMemorySignal={() => {
              if (!activeSignal?.sourcePlanetId) return
              void markMemorySignalRead(activeSignal.id).catch(() => undefined)
              completeActiveSignal()
              beginVisit(activeSignal.sourcePlanetId)
            }}
            onMemorySignalComplete={completeActiveSignal}
            onCloseBroadcast={(activityId) => {
              if (scale === 'nebula' && nebula.space?.activities.some((item) => item.id === activityId)) {
                void nebula.closeActivity(activityId)
              } else {
                void closeActivityBroadcast(activityId)
              }
            }}
          />
        )}
        <EffectComposer multisampling={0}>
          <Bloom intensity={0.48} luminanceThreshold={0.58} luminanceSmoothing={0.88} />
          <Vignette offset={0.26} darkness={0.56} />
        </EffectComposer>
      </Canvas>

      {!traveling && (
        <UniverseHUD
          activePlanet={activePlanet}
          selfPlanet={selfPlanet}
          scale={scale}
          nebulaName={nebula.space?.nebula.name}
          returnLabel={returnNebulaIdRef.current && nebula.space ? t('nebula.return', { name: nebula.space.nebula.name }) : undefined}
          onScaleChange={handleScaleChange}
          onResetView={() => {
            selectPlanet(null)
            setResetViewToken((value) => value + 1)
          }}
          onOpenRelationship={() => setRelationshipEditorOpen(true)}
          onOpenActivity={() => setActivityComposerOpen(true)}
          onOpenData={() => setDataDrawerOpen(true)}
          onOpenNebulaMembers={() => setNebulaMembersOpen(true)}
          onOpenProfile={() => setProfileEditorOpen(true)}
          profileIncomplete={profileIncomplete}
          onReturnHome={() => returnHome()}
          onSignOut={signOut}
        />
      )}
      {!traveling && scale === 'galaxy' && friendPlanets.length === 0 && (
        <section className={styles.friendEmptyState} aria-label={t('universe.friendEmptyTitle')}>
          <div className={styles.friendEmptyIcon}><UserPlus size={19} /></div>
          <span>{t('universe.friendEmptyEyebrow')}</span>
          <h2>{t('universe.friendEmptyTitle')}</h2>
          <p>{t('universe.friendEmptyDescription')}</p>
          <button type="button" onClick={() => setRelationshipEditorOpen(true)}>
            <UserPlus size={16} />
            {t('universe.addFriend')}
          </button>
        </section>
      )}
      {!traveling && scale === 'planet' && activePlanet.id === selfPlanet.id && profileIncomplete && !profilePromptDismissed && !profileEditorOpen && !profile.id.startsWith('friends-') && !profile.id.startsWith('album-owner-') && (
        <ProfileCompletionPrompt
          answered={profileAnswered}
          isZh={isZh}
          onDismiss={() => setProfilePromptDismissed(true)}
          onOpen={() => setProfileEditorOpen(true)}
        />
      )}
      {!traveling && scale !== 'nebula' && selectedPlanet && (
        <PlanetDetailPanel
          planet={selectedPlanet}
          relationship={selectedRelationship}
          activity={selectedPlanetActivity}
          distanceFromHome={selectedDistance}
          onClose={() => selectPlanet(null)}
          onVisit={() => beginVisit(selectedPlanet.id)}
          onEditRelationship={() => setRelationshipEditorOpen(true)}
          onInspectActivity={() => selectedPlanetActivity && openActivity(selectedPlanetActivity)}
          onAddMemory={selectedRelationship ? () => openMemoryDrawer({
            relationshipId: selectedRelationship.id,
            targetUserId: selectedRelationship.targetUserId,
            targetPlanetId: selectedRelationship.targetPlanetId,
            targetName: selectedRelationship.targetName || selectedPlanet.ownerName,
          }) : undefined}
        />
      )}
      {!traveling && scale === 'nebula' && nebula.activeNebulaId && (
        <NebulaHUD
          space={nebula.space}
          loading={nebula.loading || nebula.directoryLoading}
          onLeaveNebula={handleLeaveNebula}
        />
      )}
      {!traveling && scale === 'nebula' && nebula.space && (
        <NebulaMemberDirectory
          open={nebulaMembersOpen}
          space={nebula.space}
          selfPlanetId={selfPlanet.id}
          onClose={() => setNebulaMembersOpen(false)}
          onSelectPlanet={(planetId) => {
            setNebulaMembersOpen(false)
            handleSelectPlanet(planetId)
          }}
        />
      )}
      {!traveling && scale === 'nebula' && !nebula.activeNebulaId && (
        <NebulaLobbyHUD count={lobbyNebulae.length} onBrowse={() => nebula.setDirectoryOpen(true)} />
      )}
      {!traveling && scale === 'nebula' && !nebula.activeNebulaId && selectedNebula && !nebula.directoryOpen && (
        <NebulaLobbyInfo
          nebula={selectedNebula}
          onClose={() => setSelectedNebulaId(null)}
          onEnter={(nebulaId) => {
            setSelectedNebulaId(null)
            nebula.enterNebula(nebulaId)
          }}
          onJoin={nebula.joinNebula}
        />
      )}
      {!traveling && scale === 'nebula' && selectedPlanet && nebula.space && (() => {
        const member = nebula.space.members.find((item) => item.planet.id === selectedPlanet.id)
        if (!member) return null
        return (
          <NebulaMemberPanel
            member={member}
            activity={selectedPlanetActivity}
            onClose={() => selectPlanet(null)}
            onVisit={() => beginVisit(selectedPlanet.id)}
            onInspectActivity={() => selectedPlanetActivity && openActivity(selectedPlanetActivity)}
          />
        )
      })()}
      {scale === 'nebula' && (
        <NebulaDirectory
          open={nebula.directoryOpen}
          directory={nebula.directory}
          activeNebulaId={nebula.activeNebulaId}
          loading={nebula.loading || nebula.directoryLoading}
          error={nebula.error}
          onClose={() => nebula.setDirectoryOpen(false)}
          onEnter={nebula.enterNebula}
          onJoin={nebula.joinNebula}
          onJoinByCode={nebula.joinByCode}
          onCreate={nebula.createNebula}
          onSearch={nebula.loadDirectory}
        />
      )}
      {relationshipEditorOpen && (
        <RelationshipEditor
          relationship={selectedRelationship}
          onClose={() => setRelationshipEditorOpen(false)}
          onSaved={(targetUserId) => {
            setRelationshipEditorOpen(false)
            setScale('galaxy')
            const target = useProductStore.getState().friendPlanets.find((planet) => planet.ownerId === targetUserId)
            if (target) selectPlanet(target.id)
          }}
        />
      )}
      {traveling && destinationPlanet && (
        <VisitorHUD
          originName={activePlanet.identity.name}
          destinationName={destinationPlanet.identity.name}
          onCancel={cancelVisit}
        />
      )}
      {!isFriendsDemo && !traveling && scale === 'planet' && (visitStage === 'idle' || visitStage === 'planet-detail') && (
        <PlanetLifePanel
          planet={activePlanet}
          activities={activeActivities}
          isOwnPlanet={activePlanet.id === selfPlanet.id}
          onPublish={() => setActivityComposerOpen(true)}
          onAddMemory={activeRelationship ? openActivePlanetMemory : () => openMemoryDrawer()}
          onOpenActivity={openActivity}
          memories={activePlanetMemories}
        />
      )}
      {activityComposerOpen && (
        <ActivityComposer
          onClose={() => setActivityComposerOpen(false)}
          onPublish={publishActivity}
          onPublished={(activity) => {
            setActivityComposerOpen(false)
            emitLocalPublication(activity)
          }}
        />
      )}
      {selectedActivity && (
        <ActivityDetail activity={selectedActivity} onClose={() => setSelectedActivity(null)} />
      )}
      <CosmosDataDrawer open={dataDrawerOpen} onClose={() => setDataDrawerOpen(false)} />
      {!isFriendsDemo && <Suspense fallback={null}>
        <MemoryIngestionOverlay
          showButton={
            !traveling
            && !selectedPlanet
            && !activityComposerOpen
            && !selectedActivity
            && !relationshipEditorOpen
            && !dataDrawerOpen
            && !nebulaMembersOpen
          }
        />
      </Suspense>}
      {profileEditorOpen && (
        <OnboardingModule
          mode="edit"
          initialStep="profile"
          onClose={() => setProfileEditorOpen(false)}
          onSaved={() => {
            setProfileIncomplete(false)
            setProfilePromptDismissed(true)
          }}
        />
      )}
      {error && <div className={styles.error}>{error}</div>}
      {scale === 'galaxy' && !snapshot && !error && <div className={styles.loading}>{t('universe.resolving')}</div>}
      <div
        className={[
          styles.travelVeil,
          travelTransitionPhase === 'FADE_OUT_CURRENT_SCENE' ||
          travelTransitionPhase === 'INTRO_READY' ||
          travelTransitionPhase === 'FADE_OUT_ARRIVAL' ||
          travelTransitionPhase === 'SWITCH_TARGET_SCENE'
            ? styles.travelVeilOpaque
            : '',
          travelTransitionPhase === 'TRAVEL_ACTIVE'
          && transitionIntentRef.current === 'visit'
            ? styles.travelVeilIntroReveal
            : '',
          travelTransitionPhase === 'FADE_OUT_ARRIVAL'
            ? styles.travelVeilArrivalFade
            : '',
          travelTransitionPhase === 'REVEAL_TARGET_SCENE'
            ? styles.travelVeilTargetReveal
            : '',
        ].filter(Boolean).join(' ')}
        data-transition-phase={travelTransitionPhase}
        aria-hidden="true"
        onTransitionEnd={handleTransitionEnd}
      >
        <span className={styles.travelSpotlight} />
      </div>
    </main>
  )
}
