import { useMemo } from 'react'
import { getMemoriesForPerson } from '../data/relationshipMemories'
import { useMemoriesStore } from '../store/useMemoriesStore'
import { memoryObjectToMemory } from '../utils/memoryObjectAdapter'
import type { Memory } from '../types/memory'
import type { MemoryObject } from '../types/memoryObject'

// A stable reference for "no user-added memories yet" — returning a fresh
// `[]` literal from the Zustand selector below would give useSyncExternalStore
// a new object identity on every call and spin into an infinite render loop.
const EMPTY_MEMORY_OBJECTS: MemoryObject[] = []

/** Static fixture memories + user-added ones (converted via
 * memoryObjectToMemory), merged so MemoryOrbit/MemoryDetail render both
 * without knowing the difference. */
export function useMemoriesForPerson(personId: string | null): Memory[] {
  const userObjects = useMemoriesStore((state) =>
    personId ? (state.memoriesByPerson[personId] ?? EMPTY_MEMORY_OBJECTS) : EMPTY_MEMORY_OBJECTS,
  )

  return useMemo(() => {
    if (!personId) return []
    return [...getMemoriesForPerson(personId), ...userObjects.map(memoryObjectToMemory)]
  }, [personId, userObjects])
}
