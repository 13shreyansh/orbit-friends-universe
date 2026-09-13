import { useSceneStore } from '../store/useSceneStore'
import type { Person } from '../types/person'
import { LINE_INTIMACY_THRESHOLD } from '../utils/relationshipVisuals'
import { useEffectiveRelationshipStats } from './useEffectiveRelationshipStats'

const ACTIVE_LINE_OPACITY = 0.85
const DEFAULT_LINE_OPACITY = 0.22
const DIMMED_LINE_OPACITY = 0.03

const ACTIVE_EMISSIVE_BOOST = 1.6
const DIMMED_OPACITY_FACTOR = 0.3
const DIMMED_EMISSIVE_FACTOR = 0.35
// A deeper recede used in memories/timeline focus modes — everyone but the
// selected person should fade almost fully out, not just dim.
const DEEP_FADE_OPACITY_FACTOR = 0.05
const DEEP_FADE_EMISSIVE_FACTOR = 0.12

// While scrubbing the relationship timeline, the selected person's line
// strength tracks that era's intimacy instead of a fixed "active" value.
const TIMELINE_LINE_OPACITY_MIN = 0.08
const TIMELINE_LINE_OPACITY_MAX = 0.9

export interface RelationshipVisibility {
  /** This person is the one currently hovered or selected. */
  isActive: boolean
  /** This person is THE selected one (persists without hover). */
  isSelected: boolean
  /** Whether this planet should still respond to pointer events right now. */
  interactive: boolean
  /** Multiply into the planet material's opacity. */
  opacityMultiplier: number
  /** Multiply into the planet material's emissiveIntensity. */
  emissiveMultiplier: number
  /** Resolved opacity for this person's connection line + flow particles. */
  lineOpacity: number
}

/** Shared hover/selection/mode-driven visibility state, used by PersonPlanet,
 * RelationshipLine and FlowParticles so all three agree on when a
 * relationship is "in focus" vs "in the background". */
export function useRelationshipVisibility(person: Person): RelationshipVisibility {
  const hoveredPersonId = useSceneStore((state) => state.hoveredPersonId)
  const selectedPersonId = useSceneStore((state) => state.selectedPersonId)
  const mode = useSceneStore((state) => state.mode)
  const { intimacy: effectiveIntimacy } = useEffectiveRelationshipStats(person)

  const activePersonId = hoveredPersonId ?? selectedPersonId
  const isActive = activePersonId === person.id
  const isSelected = selectedPersonId === person.id
  const inMemoriesMode = mode === 'memories'
  const inTimelineMode = mode === 'timeline'
  const inFocusMode = inMemoriesMode || inTimelineMode
  const interactive = mode === 'cosmos' || mode === 'person' || isSelected

  let opacityMultiplier = 1
  let emissiveMultiplier = 1
  let lineOpacity = 0

  if (inFocusMode) {
    if (isSelected) {
      emissiveMultiplier = ACTIVE_EMISSIVE_BOOST
      if (inTimelineMode) {
        // The line becomes the timeline's "strength" readout: it visibly
        // brightens/dims as the scrubbed era's intimacy rises and falls.
        const t = Math.min(1, Math.max(0, effectiveIntimacy / 100))
        lineOpacity =
          TIMELINE_LINE_OPACITY_MIN + (TIMELINE_LINE_OPACITY_MAX - TIMELINE_LINE_OPACITY_MIN) * t
      }
      // In memories mode the relationship-arc metaphor isn't relevant, so
      // the line stays hidden (lineOpacity remains 0) even for the selected person.
    } else {
      opacityMultiplier = DEEP_FADE_OPACITY_FACTOR
      emissiveMultiplier = DEEP_FADE_EMISSIVE_FACTOR
    }
  } else if (isActive) {
    emissiveMultiplier = ACTIVE_EMISSIVE_BOOST
    lineOpacity = ACTIVE_LINE_OPACITY
  } else if (activePersonId !== null) {
    opacityMultiplier = DIMMED_OPACITY_FACTOR
    emissiveMultiplier = DIMMED_EMISSIVE_FACTOR
    lineOpacity = DIMMED_LINE_OPACITY
  } else if (person.intimacy >= LINE_INTIMACY_THRESHOLD) {
    lineOpacity = DEFAULT_LINE_OPACITY
  }

  return { isActive, isSelected, interactive, opacityMultiplier, emissiveMultiplier, lineOpacity }
}
