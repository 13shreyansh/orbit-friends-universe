export type RelationType =
  | 'family'
  | 'friend'
  | 'colleague'
  | 'classmate'
  | 'past'

export type RelationshipStatus = 'active' | 'dormant' | 'faded'

/** Relationship-closeness tier, derived from `intimacy`. Used to group
 * people onto reference orbit rings. */
export type IntimacyTier = 'intimate' | 'close' | 'familiar' | 'distant'

/**
 * Orbital placement around the core planet, independent of intimacy.
 * `angle` spreads people around the Y axis, `elevation` tilts them
 * above/below the equatorial plane so the galaxy reads as 3D, not a flat ring.
 */
export interface OrbitPosition {
  angle: number // degrees, 0-360
  elevation: number // -1..1
}

export interface Person {
  id: string
  name: string
  relationType: RelationType
  /** 0-100. Higher = emotionally closer = smaller orbit radius. */
  intimacy: number
  /** 0-100. Higher = more recent/frequent contact = stronger glow. */
  interactionFrequency: number
  /** Count of shared memories. Higher = larger planet. */
  memoryCount: number
  position: OrbitPosition
  shortDescription: string
  avatar: string
  /** ISO date string of the last interaction. */
  lastInteraction: string
  status: RelationshipStatus
}
