import { create } from 'zustand'
import { relationshipData } from '../data/relationshipData'
import type { Person } from '../types/person'
import type { MemoryObject } from '../types/memoryObject'
import { RELATIONSHIP_CHANGE_NUDGE } from '../constants/relationshipChangeEffects'
import { SPHERE_LAYOUT_CONFIG } from '../constants/sphereLayoutConfig'
import { getIntimacyForOrbitRadius, getOrbitRadius, getPlanetRadius } from '../utils/relationshipVisuals'
import {
  buildOccupiedSpheresFromPeople,
  findNearestSafeRadius,
  getCoreOccupiedSphere,
} from '../utils/spherePlacement'

export type PersonEffectKind = 'pulse' | 'newMemoryPoint' | 'relit' | 'conflictWobble' | 'entrance'

export interface PersonEffectSignal {
  personId: string
  kinds: PersonEffectKind[]
  startedAt: number
}

interface PeopleState {
  people: Person[]
  maxMemoryCount: number
  lastEffect: PersonEffectSignal | null
  addMemoryToPerson: (personId: string, memory: MemoryObject) => void
  addNewPerson: (person: Person) => void
  triggerEffect: (personId: string, kinds: PersonEffectKind[]) => void
}

function clamp0to100(value: number): number {
  return Math.min(100, Math.max(0, value))
}

function computeMaxMemoryCount(people: Person[]): number {
  return Math.max(...people.map((person) => person.memoryCount))
}

export const usePeopleStore = create<PeopleState>((set) => ({
  people: relationshipData,
  maxMemoryCount: computeMaxMemoryCount(relationshipData),

  lastEffect: null,

  addMemoryToPerson: (personId, memory) =>
    set((state) => {
      const targetPerson = state.people.find((person) => person.id === personId)
      if (!targetPerson) return state

      const change = memory.relationshipSignals.relationshipChange
      const nudge = RELATIONSHIP_CHANGE_NUDGE[change]
      const updatedMemoryCount = targetPerson.memoryCount + 1
      const naiveIntimacy = clamp0to100(targetPerson.intimacy + nudge.intimacy)
      const updatedFrequency = clamp0to100(targetPerson.interactionFrequency + nudge.frequency)

      const peopleWithNewCount = state.people.map((person) =>
        person.id === personId ? { ...person, memoryCount: updatedMemoryCount } : person,
      )
      const newMaxMemoryCount = computeMaxMemoryCount(peopleWithNewCount)

      // closer/reconnected nudges shrink the orbit radius, which is exactly
      // the kind of move that can walk a planet into a sibling it
      // previously had plenty of clearance from — re-validate against
      // every other planet + the core before committing the new position,
      // same as a brand-new contact's spawn point.
      const personRadius = getPlanetRadius(updatedMemoryCount, newMaxMemoryCount)
      const otherSpheres = [
        getCoreOccupiedSphere(),
        ...buildOccupiedSpheresFromPeople(peopleWithNewCount, newMaxMemoryCount, personId),
      ]
      const safePlacement = findNearestSafeRadius({
        angleDeg: targetPerson.position.angle,
        elevation: targetPerson.position.elevation,
        targetOrbitRadius: getOrbitRadius(naiveIntimacy),
        newRadius: personRadius,
        existingSpheres: otherSpheres,
        safetyGap: SPHERE_LAYOUT_CONFIG.defaultSafetyGap,
      })
      const finalIntimacy = getIntimacyForOrbitRadius(safePlacement.orbitRadius)

      const people = peopleWithNewCount.map((person) => {
        if (person.id !== personId) return person
        return {
          ...person,
          intimacy: finalIntimacy,
          interactionFrequency: updatedFrequency,
          lastInteraction: memory.eventTime || person.lastInteraction,
          status: 'active' as const,
        }
      })

      const kinds: PersonEffectKind[] = ['pulse', 'newMemoryPoint']
      if (change === 'reconnected') kinds.push('relit')
      if (change === 'conflict') kinds.push('conflictWobble')
      // A brand-new person's first memory is added in the same synchronous
      // commit as addNewPerson (see ConfirmStep) — without this, the
      // 'entrance' signal it just set would be clobbered before
      // PersonPlanet ever mounts to read it.
      if (state.lastEffect?.personId === personId && state.lastEffect.kinds.includes('entrance')) {
        kinds.push('entrance')
      }

      return {
        people,
        maxMemoryCount: newMaxMemoryCount,
        lastEffect: { personId, kinds, startedAt: performance.now() },
      }
    }),

  addNewPerson: (person) =>
    set((state) => {
      const people = [...state.people, person]
      return {
        people,
        maxMemoryCount: computeMaxMemoryCount(people),
        lastEffect: { personId: person.id, kinds: ['entrance'], startedAt: performance.now() },
      }
    }),

  triggerEffect: (personId, kinds) =>
    set({ lastEffect: { personId, kinds, startedAt: performance.now() } }),
}))
