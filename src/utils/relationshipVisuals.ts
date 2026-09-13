import * as THREE from 'three'
import type {
  IntimacyTier,
  Person,
  RelationType,
  RelationshipStatus,
} from '../types/person'

// Core planet's own size — the single source of truth CorePlanet.tsx
// renders from and spherePlacement.ts treats as an occupied sphere when
// placing new contacts, so the two can never silently drift apart.
export const CORE_PLANET_RADIUS = 1.4
export const CORE_ATMOSPHERE_SCALE = 1.18

// Orbit radius bounds. MIN sits just outside the core planet's atmosphere
// (core radius 1.4 * atmosphere scale 1.18 ≈ 1.65) so nothing clips.
export const ORBIT_RADIUS_MIN = 3.0
export const ORBIT_RADIUS_MAX = 9.2

// Planet size bounds for people (kept well below the core planet's 1.4).
const PLANET_RADIUS_MIN = 0.16
const PLANET_RADIUS_MAX = 0.5

// Emissive glow bounds driven by interaction frequency.
const EMISSIVE_MIN = 0.12
const EMISSIVE_MAX = 1.3

const RELATION_COLORS: Record<RelationType, string> = {
  family: '#c98f9c', // warm muted rose
  friend: '#6fb8c9', // soft cyan
  colleague: '#7d8fc7', // slate blue-violet
  classmate: '#6fae9a', // muted teal
  past: '#71708c', // desaturated grey-violet
}

const STATUS_OPACITY: Record<RelationshipStatus, number> = {
  active: 1,
  dormant: 0.75,
  faded: 0.5,
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function lerp(min: number, max: number, t: number): number {
  return min + (max - min) * clamp01(t)
}

/** Intimacy 0-100 → orbit radius. Higher intimacy = smaller radius (closer). */
export function getOrbitRadius(intimacy: number): number {
  return lerp(ORBIT_RADIUS_MAX, ORBIT_RADIUS_MIN, intimacy / 100)
}

/** Inverse of getOrbitRadius — given a target orbit radius (e.g. one a
 * collision search landed on), returns the intimacy value that reproduces
 * it exactly through the normal rendering path. Used by the spawn-position
 * placement logic, which searches in world-radius space but must still
 * store a plain `intimacy` field since that's what the rest of the app
 * (planet position, camera focus, timeline) reads. */
export function getIntimacyForOrbitRadius(radius: number): number {
  const clampedRadius = Math.min(ORBIT_RADIUS_MAX, Math.max(ORBIT_RADIUS_MIN, radius))
  const t = (ORBIT_RADIUS_MAX - clampedRadius) / (ORBIT_RADIUS_MAX - ORBIT_RADIUS_MIN)
  return Math.min(100, Math.max(0, t * 100))
}

/** MemoryCount → planet radius. Scaled with sqrt so size differences read
 * as area rather than raw linear count (avoids tiny planets vs one giant one). */
export function getPlanetRadius(memoryCount: number, maxMemoryCount: number): number {
  const t = maxMemoryCount > 0 ? Math.sqrt(memoryCount / maxMemoryCount) : 0
  return lerp(PLANET_RADIUS_MIN, PLANET_RADIUS_MAX, t)
}

/** InteractionFrequency 0-100 → emissive glow intensity. */
export function getEmissiveIntensity(interactionFrequency: number): number {
  return lerp(EMISSIVE_MIN, EMISSIVE_MAX, interactionFrequency / 100)
}

export function getRelationColor(relationType: RelationType): string {
  return RELATION_COLORS[relationType]
}

export function getStatusOpacity(status: RelationshipStatus): number {
  return STATUS_OPACITY[status]
}

/** Converts a person's orbit angle/elevation + intimacy-derived radius into
 * a 3D world position around the core planet. Pass `intimacyOverride` to
 * place the planet at a different point in its relationship history (used
 * by the relationship-timeline playback) instead of its current intimacy. */
export function getPersonWorldPosition(person: Person, intimacyOverride?: number): THREE.Vector3 {
  const radius = getOrbitRadius(intimacyOverride ?? person.intimacy)
  const angleRad = THREE.MathUtils.degToRad(person.position.angle)
  const elevation = person.position.elevation // -1..1

  const horizontalRadius = radius * Math.cos(elevation * (Math.PI / 4))
  const x = Math.cos(angleRad) * horizontalRadius
  const z = Math.sin(angleRad) * horizontalRadius
  const y = radius * Math.sin(elevation * (Math.PI / 4))

  return new THREE.Vector3(x, y, z)
}

/** Small deterministic pseudo-random number derived from a string id, so
 * each planet's floating/rotation phase differs without needing shared
 * random state (same id always yields the same offset across renders). */
export function hashSeed(id: string): number {
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = (hash << 5) - hash + id.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash % 1000) / 1000
}

// --- Intimacy tiers (drive the faint reference orbit rings) -------------

export const INTIMACY_TIERS: IntimacyTier[] = [
  'intimate',
  'close',
  'familiar',
  'distant',
]

// Representative intimacy value used to place each tier's reference ring
// (midpoint of the tier's range), fed through the same radius formula
// planets use, so rings actually line up with where people cluster.
const TIER_MIDPOINT_INTIMACY: Record<IntimacyTier, number> = {
  intimate: 90,
  close: 67,
  familiar: 42,
  distant: 15,
}

export function getTierRingRadius(tier: IntimacyTier): number {
  return getOrbitRadius(TIER_MIDPOINT_INTIMACY[tier])
}

// --- Relationship connection lines ---------------------------------------

/** Only people at/above this intimacy show a connection line by default;
 * less-intimate ones reveal their line on hover/select instead. */
export const LINE_INTIMACY_THRESHOLD = 55

export const CORE_ORIGIN = new THREE.Vector3(0, 0, 0)

/** Builds a gently arced curve from the core to a person's position, used
 * by both RelationshipLine (the visible arc) and FlowParticles (the dots
 * traveling along it) so the two always agree on the same path. */
export function buildRelationshipCurve(
  endPosition: THREE.Vector3,
): THREE.QuadraticBezierCurve3 {
  const control = CORE_ORIGIN.clone().lerp(endPosition, 0.5)
  const arcHeight = CORE_ORIGIN.distanceTo(endPosition) * 0.16
  control.y += arcHeight
  return new THREE.QuadraticBezierCurve3(CORE_ORIGIN, control, endPosition)
}
