import { create } from 'zustand'
import type { MemoryObject } from '../types/memoryObject'

interface MemoriesState {
  /** User-added rich memory objects, keyed by person id. Separate from the
   * static `relationshipMemories` fixture — see useMemoriesForPerson for
   * the merged view components actually read from. */
  memoriesByPerson: Record<string, MemoryObject[]>
  addMemoryObject: (personId: string, memory: MemoryObject) => void
}

export const useMemoriesStore = create<MemoriesState>((set) => ({
  memoriesByPerson: {},

  addMemoryObject: (personId, memory) =>
    set((state) => ({
      memoriesByPerson: {
        ...state.memoriesByPerson,
        [personId]: [...(state.memoriesByPerson[personId] ?? []), memory],
      },
    })),
}))
