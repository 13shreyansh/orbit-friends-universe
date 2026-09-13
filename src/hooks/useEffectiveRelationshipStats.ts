import { useSceneStore } from '../store/useSceneStore'
import type { Person } from '../types/person'
import { getTimelineForPerson } from '../data/relationshipTimelines'

export interface EffectiveRelationshipStats {
  intimacy: number
  interactionFrequency: number
}

/** The intimacy/interactionFrequency a person's planet + line should
 * currently render with. Normally this is just the person's live data —
 * but while relationship-timeline playback is scrubbed to a historical
 * node for THIS person, it returns that node's values instead. Every
 * consumer (PersonPlanet, RelationshipLine, FlowParticles) calls this
 * directly, so there's no separate "restore" step: the moment playback
 * exits (timelineIndex resets to null), everything reverts automatically. */
export function useEffectiveRelationshipStats(person: Person): EffectiveRelationshipStats {
  const mode = useSceneStore((state) => state.mode)
  const selectedPersonId = useSceneStore((state) => state.selectedPersonId)
  const timelineIndex = useSceneStore((state) => state.timelineIndex)

  const isTimelined = mode === 'timeline' && selectedPersonId === person.id && timelineIndex !== null

  if (isTimelined) {
    const entry = getTimelineForPerson(person.id)[timelineIndex]
    if (entry) {
      return { intimacy: entry.intimacy, interactionFrequency: entry.interactionFrequency }
    }
  }

  return { intimacy: person.intimacy, interactionFrequency: person.interactionFrequency }
}
