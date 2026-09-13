import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ActivityPost, UniverseScale } from '../../product/contracts'
import { createCosmicBroadcastEvent, type CosmicBroadcastEvent } from './contracts'

interface UseCosmicBroadcastsOptions {
  activities: ActivityPost[]
  selfPlanetId: string
  visiblePlanetIds: string[]
  scale: UniverseScale
}

/**
 * Translates persisted activity changes into transient visual broadcasts.
 * A future SSE/WebSocket adapter can call receiveRemotePublication directly;
 * rendering is intentionally independent of the delivery transport.
 */
export function useCosmicBroadcasts({ activities, selfPlanetId, visiblePlanetIds, scale }: UseCosmicBroadcastsOptions) {
  const [activeEvent, setActiveEvent] = useState<CosmicBroadcastEvent | null>(null)
  const queueRef = useRef<CosmicBroadcastEvent[]>([])
  const knownActivityIdsRef = useRef<Set<string> | null>(null)
  const previewShownRef = useRef(false)
  const visiblePlanetIdSet = useMemo(() => new Set(visiblePlanetIds), [visiblePlanetIds])

  const enqueue = useCallback((event: CosmicBroadcastEvent) => {
    setActiveEvent((current) => {
      if (!current) return event
      queueRef.current.push(event)
      return current
    })
  }, [])

  const completeActiveBroadcast = useCallback(() => {
    setActiveEvent(queueRef.current.shift() ?? null)
  }, [])

  const emitLocalPublication = useCallback((activity: ActivityPost) => {
    enqueue(createCosmicBroadcastEvent(activity, 'publisher', 'local-publish'))
  }, [enqueue])

  const receiveRemotePublication = useCallback((activity: ActivityPost) => {
    if (activity.planetId === selfPlanetId) return
    enqueue(createCosmicBroadcastEvent(activity, 'friend', 'remote-activity'))
  }, [enqueue, selfPlanetId])

  useEffect(() => {
    const knownIds = knownActivityIdsRef.current
    if (!knownIds) {
      knownActivityIdsRef.current = new Set(activities.map((activity) => activity.id))
      return
    }

    for (const activity of activities) {
      if (!knownIds.has(activity.id)) {
        knownIds.add(activity.id)
        if (
          activity.planetId !== selfPlanetId
          && visiblePlanetIdSet.has(activity.planetId)
          && (activity.broadcast?.visible ?? true)
        ) {
          receiveRemotePublication(activity)
        }
      }
    }
  }, [activities, receiveRemotePublication, selfPlanetId, visiblePlanetIdSet])

  // Existing unseen friend activity demonstrates the same event path that the
  // future real-time transport will use, once per local galaxy session.
  useEffect(() => {
    if (scale !== 'galaxy' || previewShownRef.current || activeEvent) return
    const latestFriendActivity = activities
      .filter((activity) => (
        activity.planetId !== selfPlanetId
        && visiblePlanetIdSet.has(activity.planetId)
        && (activity.broadcast?.visible ?? true)
      ))
      .sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt))[0]
    if (!latestFriendActivity) return
    previewShownRef.current = true
    enqueue(createCosmicBroadcastEvent(latestFriendActivity, 'friend', 'unread-preview'))
  }, [activeEvent, activities, enqueue, scale, selfPlanetId, visiblePlanetIdSet])

  return {
    activeEvent,
    completeActiveBroadcast,
    emitLocalPublication,
    receiveRemotePublication,
  }
}
