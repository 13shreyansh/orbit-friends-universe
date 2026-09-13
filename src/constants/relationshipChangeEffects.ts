import type { RelationshipChange } from '../types/memoryObject'

/** How much a confirmed memory nudges a person's intimacy/interactionFrequency,
 * keyed by the AI-detected (or user-edited) relationshipChange. Small values —
 * this is a gentle drift per memory, not a snap to a new relationship state. */
export const RELATIONSHIP_CHANGE_NUDGE: Record<
  RelationshipChange,
  { intimacy: number; frequency: number }
> = {
  closer: { intimacy: 5, frequency: 4 },
  distant: { intimacy: -4, frequency: -3 },
  reconnected: { intimacy: 7, frequency: 8 },
  conflict: { intimacy: -2, frequency: -1 },
  stable: { intimacy: 0, frequency: 0 },
}

export const RELATIONSHIP_CHANGE_LABELS: Record<RelationshipChange, string> = {
  closer: 'Growing closer',
  stable: 'Steady',
  distant: 'Drifting apart',
  reconnected: 'Reconnected',
  conflict: 'Friction',
}
