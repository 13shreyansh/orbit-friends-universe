import { create } from 'zustand'

export type ExperienceMode = 'cosmos' | 'person' | 'memories' | 'timeline' | 'cometRide'

interface SceneState {
  isReady: boolean
  setReady: () => void

  hoveredPersonId: string | null
  setHoveredPersonId: (id: string | null) => void

  mode: ExperienceMode
  selectedPersonId: string | null
  selectedMemoryId: string | null
  /** Index into that person's relationship timeline. null = "present" (live data). */
  timelineIndex: number | null
  isTimelinePlaying: boolean

  /** Click a person star: focuses it and opens its detail panel. */
  selectPerson: (id: string) => void
  /** Background click / "Return to Cosmos": drop everything, back to the galaxy. */
  clearSelectedPersonId: () => void
  /** "Explore Memories" button. */
  enterMemories: () => void
  /** "View Relationship Timeline" button. */
  enterTimeline: () => void
  /** "Return to person" from memories/timeline. */
  returnToPersonMode: () => void
  /** Travel from the core planet to the currently selected person's planet. */
  startPlanetVisit: () => void
  /** Cancel travel and return to the destination person's detail view. */
  cancelPlanetVisit: () => void
  /** Finish travel at the destination person's planet. */
  completePlanetVisit: () => void
  selectMemory: (id: string) => void
  clearSelectedMemory: () => void
  /** One shared "go back a level" used by both Escape and back buttons. */
  navigateBack: () => void

  /** Jump straight to a timeline node (click/drag). Pauses autoplay. */
  setTimelineIndex: (index: number) => void
  /** Step by +1/-1, clamped to [0, maxIndex]. Used by autoplay AND by the
   * prev/next buttons (which additionally call pauseTimeline themselves). */
  stepTimelineIndex: (delta: number, maxIndex: number) => void
  playTimeline: (maxIndex: number) => void
  pauseTimeline: () => void
  /** "Return to Present" — show live data without leaving timeline mode. */
  returnToPresentTimeline: () => void
}

export const useSceneStore = create<SceneState>((set) => ({
  isReady: false,
  setReady: () => set({ isReady: true }),

  hoveredPersonId: null,
  setHoveredPersonId: (id) => set({ hoveredPersonId: id }),

  mode: 'cosmos',
  selectedPersonId: null,
  selectedMemoryId: null,
  timelineIndex: null,
  isTimelinePlaying: false,

  selectPerson: (id) =>
    set({
      mode: 'person',
      selectedPersonId: id,
      selectedMemoryId: null,
      timelineIndex: null,
      isTimelinePlaying: false,
    }),
  clearSelectedPersonId: () =>
    set({
      mode: 'cosmos',
      selectedPersonId: null,
      selectedMemoryId: null,
      timelineIndex: null,
      isTimelinePlaying: false,
    }),
  enterMemories: () => set({ mode: 'memories', selectedMemoryId: null }),
  enterTimeline: () =>
    set({ mode: 'timeline', selectedMemoryId: null, timelineIndex: 0, isTimelinePlaying: false }),
  returnToPersonMode: () =>
    set({ mode: 'person', selectedMemoryId: null, timelineIndex: null, isTimelinePlaying: false }),
  startPlanetVisit: () =>
    set((state) =>
      state.selectedPersonId === null
        ? {}
        : {
            mode: 'cometRide',
            hoveredPersonId: null,
            selectedMemoryId: null,
            timelineIndex: null,
            isTimelinePlaying: false,
          },
    ),
  cancelPlanetVisit: () => set({ mode: 'person', hoveredPersonId: null }),
  completePlanetVisit: () => set({ mode: 'person', hoveredPersonId: null }),
  selectMemory: (id) => set({ selectedMemoryId: id }),
  clearSelectedMemory: () => set({ selectedMemoryId: null }),

  navigateBack: () =>
    set((state) => {
      if (state.selectedMemoryId !== null) {
        return { selectedMemoryId: null }
      }
      if (state.mode === 'memories' || state.mode === 'timeline') {
        return { mode: 'person', selectedMemoryId: null, timelineIndex: null, isTimelinePlaying: false }
      }
      if (state.mode === 'cometRide') {
        return { mode: 'person' }
      }
      if (state.mode === 'person') {
        return {
          mode: 'cosmos',
          selectedPersonId: null,
          selectedMemoryId: null,
          timelineIndex: null,
          isTimelinePlaying: false,
        }
      }
      return {}
    }),

  setTimelineIndex: (index) => set({ timelineIndex: index, isTimelinePlaying: false }),
  stepTimelineIndex: (delta, maxIndex) =>
    set((state) => {
      if (state.timelineIndex === null) {
        return { timelineIndex: delta > 0 ? 0 : maxIndex }
      }
      const next = state.timelineIndex + delta
      if (next < 0) return { timelineIndex: 0 }
      if (next > maxIndex) return { timelineIndex: maxIndex, isTimelinePlaying: false }
      return { timelineIndex: next }
    }),
  playTimeline: (maxIndex) =>
    set((state) => {
      if (state.timelineIndex === null || state.timelineIndex >= maxIndex) {
        return { isTimelinePlaying: true, timelineIndex: 0 }
      }
      return { isTimelinePlaying: true }
    }),
  pauseTimeline: () => set({ isTimelinePlaying: false }),
  returnToPresentTimeline: () => set({ timelineIndex: null, isTimelinePlaying: false }),
}))
