import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  ActivityDraft,
  ActivityPost,
  AuthSession,
  CosmosPayload,
  PlanetIdentity,
  PlanetVisualConfig,
  ProductPhase,
  RelationshipDraft,
  SocialRelationship,
  SocialPlanet,
  TimelineRecord,
  UniverseWindowPayload,
  UniverseScale,
  UserProfile,
  MemorySignal,
} from '../contracts'
import type { ConfirmedMemorySummary } from '../../types/memoryObject'
import { apiClient } from '../api/apiClient'
import { planetStyleModule } from '../../modules/planet/style/planetStyleModule'
import { createOptimisticActivity } from '../../modules/activity/optimisticActivity'
import { calibratedNowIso } from '../../utils/time'

interface ProductState {
  phase: ProductPhase
  session: AuthSession | null
  profile: UserProfile | null
  draftIdentity: PlanetIdentity
  draftVisual: PlanetVisualConfig
  selfPlanet: SocialPlanet | null
  friendPlanets: SocialPlanet[]
  samplePlanets: SocialPlanet[]
  relationships: SocialRelationship[]
  memories: ConfirmedMemorySummary[]
  timeline: TimelineRecord[]
  activities: ActivityPost[]
  memorySignals: MemorySignal[]
  universeScale: UniverseScale
  selectedPlanetId: string | null
  activePlanetId: string | null
  travelDestinationId: string | null
  isTraveling: boolean
  universePagination: CosmosPayload['universePagination']

  authenticate: (
    session: AuthSession,
    profile: UserProfile,
    cosmos: CosmosPayload,
    options?: { arrivalComplete?: boolean },
  ) => void
  hydrateCosmos: (cosmos: CosmosPayload) => void
  mergeUniverseWindow: (window: UniverseWindowPayload) => void
  signOut: () => Promise<void>
  updateProfile: (values: Partial<Pick<UserProfile, 'displayName' | 'bio' | 'tags'>>) => void
  updateDraftIdentity: (values: Partial<PlanetIdentity>) => void
  setDraftVisual: (visual: PlanetVisualConfig) => void
  updateDraftVisual: (values: Partial<PlanetVisualConfig>) => void
  beginGenesis: () => void
  completeGenesis: () => Promise<void>
  completeArrival: () => void
  createRelationship: (draft: RelationshipDraft) => Promise<void>
  publishActivity: (draft: ActivityDraft, mediaFiles?: File[]) => Promise<ActivityPost>
  markActivityBroadcastRead: (activityId: string) => Promise<void>
  closeActivityBroadcast: (activityId: string) => Promise<void>
  markMemorySignalRead: (signalId: string) => Promise<void>
  closeMemorySignal: (signalId: string) => Promise<void>
  recordPlanetInteraction: (planetId: string, kind: 'view' | 'visit') => Promise<void>
  setUniverseScale: (scale: UniverseScale) => void
  zoomOut: () => void
  zoomIn: () => void
  selectPlanet: (planetId: string | null) => void
  returnHome: () => void
  startTravel: (destinationPlanetId: string) => void
  startReturnTravel: () => void
  cancelTravel: () => void
  completeTravel: () => void
  resetProduct: () => void
}

const initialIdentity: PlanetIdentity = {
  name: '',
  motto: 'A world waiting for its first signal.',
  description: '',
  tags: [],
  mass: 50,
  influence: 8,
}

const scaleOrder: UniverseScale[] = ['planet', 'galaxy', 'nebula']

function createInitialState() {
  return {
    phase: 'auth' as const,
    session: null,
    profile: null,
    draftIdentity: { ...initialIdentity },
    draftVisual: planetStyleModule.generate({ mode: 'system', archetype: 'terran', seed: 4281 }),
    selfPlanet: null,
    friendPlanets: [],
    samplePlanets: [],
    relationships: [],
    memories: [],
    timeline: [],
    activities: [],
    memorySignals: [],
    universeScale: 'planet' as const,
    selectedPlanetId: null,
    activePlanetId: null,
    travelDestinationId: null,
    isTraveling: false,
    universePagination: undefined,
  }
}

export const useProductStore = create<ProductState>()(
  persist(
    (set, get) => ({
      ...createInitialState(),

      authenticate: (session, profile, cosmos, options) => {
        const selfPlanet = cosmos.selfPlanet
        set({
          session,
          profile,
          draftIdentity: selfPlanet?.identity ?? {
            ...initialIdentity,
            description: profile.bio,
            tags: profile.tags,
          },
          draftVisual: selfPlanet?.visual ?? planetStyleModule.generate({ mode: 'system', archetype: 'terran', seed: 4281 }),
          selfPlanet,
          friendPlanets: cosmos.friendPlanets,
          samplePlanets: cosmos.samplePlanets ?? [],
          relationships: cosmos.relationships,
          memories: cosmos.memories,
          timeline: cosmos.timeline,
          activities: cosmos.activities ?? [],
          memorySignals: cosmos.memorySignals ?? [],
          universePagination: cosmos.universePagination,
          activePlanetId: selfPlanet?.id ?? null,
          phase: selfPlanet ? (options?.arrivalComplete ? 'universe' : 'arrival') : 'onboarding',
          universeScale: 'planet',
          selectedPlanetId: null,
        })
      },
      hydrateCosmos: (cosmos) =>
        set({
          profile: cosmos.profile,
          ...(cosmos.selfPlanet ? {
            draftIdentity: cosmos.selfPlanet.identity,
            draftVisual: cosmos.selfPlanet.visual,
          } : {}),
          selfPlanet: cosmos.selfPlanet,
          friendPlanets: cosmos.friendPlanets,
          samplePlanets: cosmos.samplePlanets ?? [],
          relationships: cosmos.relationships,
          memories: cosmos.memories,
          timeline: cosmos.timeline,
          activities: cosmos.activities ?? [],
          memorySignals: cosmos.memorySignals ?? [],
          universePagination: cosmos.universePagination,
          activePlanetId: cosmos.selfPlanet?.id ?? null,
        }),
      mergeUniverseWindow: (window) => set((state) => {
        const mergeById = <T extends { id: string }>(current: T[], incoming: T[]) => {
          const values = new Map(current.map((item) => [item.id, item]))
          incoming.forEach((item) => values.set(item.id, item))
          return [...values.values()]
        }
        return {
          friendPlanets: state.friendPlanets.length > 0 ? mergeById(state.friendPlanets, window.planets) : state.friendPlanets,
          samplePlanets: state.friendPlanets.length > 0 ? state.samplePlanets : mergeById(state.samplePlanets, window.planets),
          relationships: mergeById(state.relationships, window.relationships),
          activities: mergeById(state.activities, window.activities),
          universePagination: window.pagination,
        }
      }),
      signOut: async () => {
        try {
          await apiClient.signOut()
        } finally {
          // Account-scoped drafts must not leak into the next registration.
          set(createInitialState())
        }
      },
      updateProfile: (values) =>
        set((state) => ({
          profile: state.profile ? { ...state.profile, ...values } : null,
        })),
      updateDraftIdentity: (values) =>
        set((state) => ({ draftIdentity: { ...state.draftIdentity, ...values } })),
      setDraftVisual: (visual) => set({ draftVisual: visual }),
      updateDraftVisual: (values) =>
        set((state) => ({ draftVisual: { ...state.draftVisual, ...values } })),
      beginGenesis: () => set({ phase: 'genesis' }),
      completeGenesis: async () => {
        const state = get()
        if (!state.profile) return
        const result = await apiClient.createPlanet(state.draftIdentity, state.draftVisual)
        const cosmos = await apiClient.getCosmos().catch(() => null)
        set({
          selfPlanet: cosmos?.selfPlanet ?? result.planet,
          profile: cosmos?.profile ?? result.profile,
          friendPlanets: cosmos?.friendPlanets ?? [],
          samplePlanets: cosmos?.samplePlanets ?? [],
          relationships: cosmos?.relationships ?? [],
          memories: cosmos?.memories ?? [],
          timeline: cosmos?.timeline ?? [],
          activities: cosmos?.activities ?? [],
          memorySignals: cosmos?.memorySignals ?? [],
          phase: 'universe',
          universeScale: 'planet',
          activePlanetId: result.planet.id,
        })
      },
      completeArrival: () => set({ phase: 'universe' }),
      createRelationship: async (draft) => {
        const cosmos = await apiClient.createRelationship(draft)
        set({
          profile: cosmos.profile,
          selfPlanet: cosmos.selfPlanet,
          friendPlanets: cosmos.friendPlanets,
          samplePlanets: cosmos.samplePlanets ?? [],
          relationships: cosmos.relationships,
          memories: cosmos.memories,
          timeline: cosmos.timeline,
          activities: cosmos.activities ?? [],
          memorySignals: cosmos.memorySignals ?? [],
          universeScale: 'galaxy',
        })
      },
      publishActivity: async (draft, mediaFiles = []) => {
        const state = get()
        if (!state.profile || !state.selfPlanet) throw new Error('A planet is required before publishing.')
        const { activity, previewUrls } = createOptimisticActivity(
          draft,
          mediaFiles,
          state.profile,
          state.selfPlanet,
        )
        set((current) => ({ activities: [activity, ...current.activities] }))

        // Publishing continues after the composer closes. AI analysis is not
        // part of this browser task at all; the backend durable worker owns it.
        void (async () => {
          try {
            const media = await Promise.all(mediaFiles.map((file) => apiClient.uploadActivityMedia(file)))
            const result = await apiClient.createActivity(draft, media)
            previewUrls.forEach((url) => URL.revokeObjectURL(url))
            set((current) => ({
              activities: current.activities.map((item) => item.id === activity.id
                ? { ...result.activity, deliveryStatus: 'published' }
                : item),
            }))
          } catch {
            set((current) => ({
              activities: current.activities.map((item) => item.id === activity.id
                ? { ...item, deliveryStatus: 'failed' }
                : item),
            }))
          }
        })()
        return activity
      },
      markActivityBroadcastRead: async (activityId) => {
        set((state) => ({
          activities: state.activities.map((activity) => activity.id === activityId
            ? { ...activity, broadcast: { ...activity.broadcast, visible: false, seenAt: calibratedNowIso() } }
            : activity),
        }))
        const result = await apiClient.markActivityBroadcastRead(activityId)
        set({
          profile: result.cosmos.profile,
          selfPlanet: result.cosmos.selfPlanet,
          friendPlanets: result.cosmos.friendPlanets,
          samplePlanets: result.cosmos.samplePlanets ?? [],
          relationships: result.cosmos.relationships,
          timeline: result.cosmos.timeline,
          activities: result.cosmos.activities ?? [],
          memorySignals: result.cosmos.memorySignals ?? [],
        })
      },
      closeActivityBroadcast: async (activityId) => {
        set((state) => ({
          activities: state.activities.map((activity) => activity.id === activityId
            ? { ...activity, broadcast: { ...activity.broadcast, active: false, visible: false } }
            : activity),
        }))
        const result = await apiClient.closeActivityBroadcast(activityId)
        set((state) => ({
          activities: state.activities.map((activity) => activity.id === activityId ? result.activity : activity),
        }))
      },
      markMemorySignalRead: async (signalId) => {
        set((state) => ({
          memorySignals: state.memorySignals.map((signal) => signal.id === signalId
            ? { ...signal, visible: false, seenAt: calibratedNowIso() }
            : signal),
        }))
        await apiClient.markMemorySignalRead(signalId)
      },
      closeMemorySignal: async (signalId) => {
        set((state) => ({
          memorySignals: state.memorySignals.map((signal) => signal.id === signalId
            ? { ...signal, active: false, visible: false }
            : signal),
        }))
        await apiClient.closeMemorySignal(signalId)
      },
      recordPlanetInteraction: async (planetId, kind) => {
        const result = await apiClient.recordPlanetInteraction(planetId, kind)
        set({
          profile: result.cosmos.profile,
          selfPlanet: result.cosmos.selfPlanet,
          friendPlanets: result.cosmos.friendPlanets,
          samplePlanets: result.cosmos.samplePlanets ?? [],
          relationships: result.cosmos.relationships,
          timeline: result.cosmos.timeline,
          activities: result.cosmos.activities ?? [],
          memorySignals: result.cosmos.memorySignals ?? [],
        })
      },
      setUniverseScale: (universeScale) =>
        set({ universeScale, selectedPlanetId: null }),
      zoomOut: () => {
        const index = scaleOrder.indexOf(get().universeScale)
        if (index < scaleOrder.length - 1) {
          set({ universeScale: scaleOrder[index + 1], selectedPlanetId: null })
        }
      },
      zoomIn: () => {
        const index = scaleOrder.indexOf(get().universeScale)
        if (index > 0) set({ universeScale: scaleOrder[index - 1], selectedPlanetId: null })
      },
      selectPlanet: (selectedPlanetId) => set({ selectedPlanetId }),
      returnHome: () => {
        const selfId = get().selfPlanet?.id ?? null
        set({ activePlanetId: selfId, selectedPlanetId: null, universeScale: 'planet' })
      },
      startTravel: (travelDestinationId) =>
        set({ travelDestinationId, isTraveling: true, selectedPlanetId: null }),
      startReturnTravel: () => {
        const selfId = get().selfPlanet?.id ?? null
        if (!selfId || get().activePlanetId === selfId) return
        set({ travelDestinationId: selfId, isTraveling: true, selectedPlanetId: null })
      },
      cancelTravel: () => set({ travelDestinationId: null, isTraveling: false }),
      completeTravel: () => {
        const destinationId = get().travelDestinationId
        set({
          isTraveling: false,
          travelDestinationId: null,
          selectedPlanetId: null,
          activePlanetId: destinationId,
          universeScale: 'planet',
        })
      },
      resetProduct: () => set(createInitialState()),
    }),
    {
      name: 'social-cosmos-product-v1',
      version: 3,
      migrate: (persistedState) => {
        const stored = persistedState as Partial<ReturnType<typeof createInitialState>>
        return {
          ...createInitialState(),
          ...stored,
          relationships: stored.relationships ?? [],
          memories: stored.memories ?? [],
          timeline: stored.timeline ?? [],
          activities: stored.activities ?? [],
          memorySignals: stored.memorySignals ?? [],
        }
      },
      partialize: (state) => ({
        phase: state.phase,
        session: state.session,
        profile: state.profile,
        draftIdentity: state.draftIdentity,
        draftVisual: state.draftVisual,
        selfPlanet: state.selfPlanet,
        friendPlanets: state.friendPlanets,
        samplePlanets: state.samplePlanets,
        relationships: state.relationships,
        memories: state.memories,
        timeline: state.timeline,
        activities: state.activities.filter((activity) => !activity.deliveryStatus || activity.deliveryStatus === 'published'),
        memorySignals: state.memorySignals,
        universeScale: state.universeScale,
        activePlanetId: state.activePlanetId,
        universePagination: state.universePagination,
      }),
    },
  ),
)
