import type { DiscoverableUser } from '../../product/contracts'

/**
 * Profile affinity is only meaningful when enough independent objective
 * dimensions were observed. The backend's confidence is the fraction of
 * configured evidence weight that was available, so multiplying by it keeps
 * missing dimensions from being silently renormalized into a perfect match.
 */
export const MIN_AFFINITY_CONFIDENCE = 0.3

export function getEvidenceAdjustedAffinity(person: DiscoverableUser): number | null {
  const affinity = person.profileAffinity
  const confidence = person.affinityConfidence ?? 0
  if (affinity === null || affinity === undefined || confidence < MIN_AFFINITY_CONFIDENCE) return null
  return Math.max(0, Math.min(1, affinity * confidence))
}
