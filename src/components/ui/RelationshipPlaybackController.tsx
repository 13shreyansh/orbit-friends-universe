import { useEffect, useMemo } from 'react'
import { useSceneStore } from '../../store/useSceneStore'
import { getTimelineForPerson } from '../../data/relationshipTimelines'

const AUTOPLAY_INTERVAL_MS = 2000

/**
 * Owns the relationship-timeline autoplay clock. Advances `timelineIndex`
 * on a fixed interval while `isTimelinePlaying` is true, and stops itself
 * automatically once it reaches the last stage (handled inside
 * `stepTimelineIndex`, which clamps and clears `isTimelinePlaying`).
 *
 * This is deliberately separate from RelationshipTimeline (the visual/
 * interactive UI): the actual on-screen response — planet distance,
 * brightness, connection-line strength — lives in PersonPlanet /
 * RelationshipLine / FlowParticles, which react to `timelineIndex` on
 * their own via useEffectiveRelationshipStats. This component's only job
 * is being the clock.
 */
export function RelationshipPlaybackController() {
  const selectedPersonId = useSceneStore((state) => state.selectedPersonId)
  const isPlaying = useSceneStore((state) => state.isTimelinePlaying)
  const stepTimelineIndex = useSceneStore((state) => state.stepTimelineIndex)

  const maxIndex = useMemo(() => {
    if (!selectedPersonId) return 0
    return Math.max(0, getTimelineForPerson(selectedPersonId).length - 1)
  }, [selectedPersonId])

  useEffect(() => {
    if (!isPlaying) return
    const interval = window.setInterval(() => {
      stepTimelineIndex(1, maxIndex)
    }, AUTOPLAY_INTERVAL_MS)
    return () => window.clearInterval(interval)
  }, [isPlaying, maxIndex, stepTimelineIndex])

  return null
}
