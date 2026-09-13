import type { ActivityPost } from '../../product/contracts'

export type CosmicBroadcastPerspective = 'publisher' | 'friend'

export interface CosmicBroadcastEvent {
  id: string
  activity: ActivityPost
  perspective: CosmicBroadcastPerspective
  source: 'local-publish' | 'remote-activity' | 'unread-preview'
  emittedAt: number
}

export function createCosmicBroadcastEvent(
  activity: ActivityPost,
  perspective: CosmicBroadcastPerspective,
  source: CosmicBroadcastEvent['source'],
): CosmicBroadcastEvent {
  return {
    id: `${source}:${activity.id}:${Date.now()}`,
    activity,
    perspective,
    source,
    emittedAt: Date.now(),
  }
}
