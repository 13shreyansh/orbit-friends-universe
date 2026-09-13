import type { ActivityPost } from '../../product/contracts'

function publishedAt(activity: ActivityPost) {
  const timestamp = Date.parse(activity.publishedAt)
  return Number.isFinite(timestamp) ? timestamp : 0
}

export function latestActivitiesByPlanet(activities: ActivityPost[]) {
  const latest = new Map<string, ActivityPost>()

  for (const activity of activities) {
    const current = latest.get(activity.planetId)
    if (!current || publishedAt(activity) > publishedAt(current)) {
      latest.set(activity.planetId, activity)
    }
  }

  return latest
}

export function isBroadcastVisible(activity: ActivityPost) {
  return activity.broadcast?.visible ?? true
}
