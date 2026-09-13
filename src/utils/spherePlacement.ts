import * as THREE from 'three'
import { SPHERE_LAYOUT_CONFIG } from '../constants/sphereLayoutConfig'
import {
  CORE_ATMOSPHERE_SCALE,
  CORE_ORIGIN,
  CORE_PLANET_RADIUS,
  getPersonWorldPosition,
  getPlanetRadius,
} from './relationshipVisuals'
import type { Person } from '../types/person'

/** A sphere already occupying space in the cosmos — either an existing
 * person's planet or a special node like the core planet. Collision checks
 * always compare true world-space distance against both radii, never just
 * center points. */
export interface OccupiedSphere {
  id: string
  position: THREE.Vector3
  radius: number
  /** Extra clearance specific to this sphere (e.g. the core planet gets a
   * larger buffer than an ordinary person-to-person gap). Added on top of
   * whatever safetyGap the caller passes in. */
  extraGap?: number
}

export interface SpawnCandidate {
  position: THREE.Vector3
  orbitRadius: number
  angleDeg: number
  elevation: number
}

/** The core planet as an OccupiedSphere, with its own larger safety
 * margin — new contacts (and repositioned existing ones) must never spawn
 * inside or clip its atmosphere. */
export function getCoreOccupiedSphere(): OccupiedSphere {
  return {
    id: 'core',
    position: CORE_ORIGIN.clone(),
    radius: CORE_PLANET_RADIUS * CORE_ATMOSPHERE_SCALE,
    extraGap: SPHERE_LAYOUT_CONFIG.centerSafetyGap,
  }
}

/** Converts the live people array into the OccupiedSphere list a placement
 * search compares against, using each person's current live intimacy/
 * memoryCount — i.e. the same position/size their planet is actually
 * rendering at right now, not a stale snapshot. Pass `excludeId` when
 * repositioning a person already in the array (so they don't collide with
 * their own current spot). */
export function buildOccupiedSpheresFromPeople(
  people: readonly Person[],
  maxMemoryCount: number,
  excludeId?: string,
): OccupiedSphere[] {
  return people
    .filter((person) => person.id !== excludeId)
    .map((person) => ({
      id: person.id,
      position: getPersonWorldPosition(person),
      radius: getPlanetRadius(person.memoryCount, maxMemoryCount),
    }))
}

/** Same spherical placement formula as getPersonWorldPosition in
 * relationshipVisuals.ts (elevation scaled to ±45° so the galaxy reads as a
 * flattened disk, not a full sphere) — kept in sync deliberately so a
 * candidate that passes collision-testing here renders at the exact
 * position it was tested at. */
export function sphericalToWorld(angleDeg: number, elevation: number, orbitRadius: number): THREE.Vector3 {
  const angleRad = THREE.MathUtils.degToRad(angleDeg)
  const horizontalRadius = orbitRadius * Math.cos(elevation * (Math.PI / 4))
  const x = Math.cos(angleRad) * horizontalRadius
  const z = Math.sin(angleRad) * horizontalRadius
  const y = orbitRadius * Math.sin(elevation * (Math.PI / 4))
  return new THREE.Vector3(x, y, z)
}

/** True world-radius-aware overlap check — never compares center points
 * alone. `candidateRadius` is the new sphere's own real radius, so two
 * differently-sized planets get a distance requirement based on both of
 * their actual sizes, not a fixed spacing constant. */
export function isPositionClear(
  candidatePosition: THREE.Vector3,
  candidateRadius: number,
  existingSpheres: readonly OccupiedSphere[],
  safetyGap: number,
): boolean {
  for (const sphere of existingSpheres) {
    const minimumDistance = candidateRadius + sphere.radius + safetyGap + (sphere.extraGap ?? 0)
    if (candidatePosition.distanceTo(sphere.position) < minimumDistance) return false
  }
  return true
}

/** How far a candidate is from being disqualified — the smallest surface-
 * to-surface clearance across all existing spheres (negative = overlapping
 * by that much). Used only to rank "least-bad" fallback candidates if every
 * attempt collides, which real usage should never actually hit. */
function worstClearance(
  candidatePosition: THREE.Vector3,
  candidateRadius: number,
  existingSpheres: readonly OccupiedSphere[],
): number {
  if (existingSpheres.length === 0) return Infinity
  return Math.min(
    ...existingSpheres.map(
      (sphere) => candidatePosition.distanceTo(sphere.position) - candidateRadius - sphere.radius - (sphere.extraGap ?? 0),
    ),
  )
}

export interface FindPositionParams {
  /** The new sphere's own real radius (its planet radius, at the size it
   * will render once placed — e.g. after its first memory is attached). */
  newRadius: number
  existingSpheres: readonly OccupiedSphere[]
  /** The orbit radius a "fresh, still-getting-to-know-you" intimacy value
   * would naturally produce — the search's starting point/center, not a
   * hard requirement. */
  preferredOrbitRadius: number
  safetyGap?: number
  maxAttempts?: number
}

export interface PlacementResult extends SpawnCandidate {
  /** How many candidates were tried before landing on this one (1-indexed). */
  attempts: number
  /** True if no fully clear candidate was found within maxAttempts and this
   * is the least-overlapping one tried instead. Should be effectively
   * unreachable given the search space, but placement must never silently
   * accept a full overlap or loop forever, so a bounded fallback exists. */
  usedFallback: boolean
}

/**
 * Finds a collision-free spawn position for a new contact planet by
 * sampling random points on an (initially flattened) orbit shell around the
 * core and rejecting any that violate real radius-aware clearance against
 * every existing planet (and the core itself, passed in as just another
 * OccupiedSphere with a larger extraGap). Every `attemptsPerExpansion`
 * failed tries, both the vertical spread and the orbit-radius jitter widen
 * a bit (see SPHERE_LAYOUT_CONFIG.expansionStep) so a crowded cosmos keeps
 * searching a bigger volume instead of grinding forever in a spot that's
 * already full. Bounded by maxAttempts — never loops indefinitely, and
 * degrades to the least-overlapping candidate tried rather than either
 * hanging or silently returning a colliding position.
 */
export function findNonOverlappingPosition({
  newRadius,
  existingSpheres,
  preferredOrbitRadius,
  safetyGap = SPHERE_LAYOUT_CONFIG.defaultSafetyGap,
  maxAttempts = SPHERE_LAYOUT_CONFIG.maxPlacementAttempts,
}: FindPositionParams): PlacementResult {
  const { attemptsPerExpansion, expansionStep, minElevation, maxElevation, minOrbitRadius, maxOrbitRadius } =
    SPHERE_LAYOUT_CONFIG

  const elevationCenter = (minElevation + maxElevation) / 2
  const baseElevationRange = (maxElevation - minElevation) / 2

  let bestCandidate: (SpawnCandidate & { clearance: number }) | null = null

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const expansionTier = Math.floor(attempt / attemptsPerExpansion)
    const expansionFactor = 1 + expansionTier * expansionStep

    // Tier 0 keeps the "narratively intended" orbit radius untouched and
    // only searches angle/elevation — radius (i.e. intimacy) only starts
    // drifting once plain repositioning around the shell isn't finding room.
    const elevationRange = Math.min(1, baseElevationRange * expansionFactor)
    const elevation = elevationCenter + (Math.random() * 2 - 1) * elevationRange

    const radiusJitter = expansionTier > 0 ? preferredOrbitRadius * 0.1 * expansionFactor : 0
    const orbitRadius = Math.min(
      maxOrbitRadius,
      Math.max(minOrbitRadius, preferredOrbitRadius + (Math.random() * 2 - 1) * radiusJitter),
    )

    const angleDeg = Math.random() * 360
    const position = sphericalToWorld(angleDeg, elevation, orbitRadius)

    if (isPositionClear(position, newRadius, existingSpheres, safetyGap)) {
      return { position, orbitRadius, angleDeg, elevation, attempts: attempt + 1, usedFallback: false }
    }

    const clearance = worstClearance(position, newRadius, existingSpheres)
    if (!bestCandidate || clearance > bestCandidate.clearance) {
      bestCandidate = { position, orbitRadius, angleDeg, elevation, clearance }
    }
  }

  // Every attempt collided (should not happen in practice — a 360° x
  // wide-elevation x expanding-radius shell around ~10 small planets has
  // enormous room). Return the least-overlapping candidate found rather
  // than looping further or accepting an arbitrary bad position blindly.
  const fallback = bestCandidate as SpawnCandidate & { clearance: number }
  return {
    position: fallback.position,
    orbitRadius: fallback.orbitRadius,
    angleDeg: fallback.angleDeg,
    elevation: fallback.elevation,
    attempts: maxAttempts,
    usedFallback: true,
  }
}

export interface FindRadiusParams {
  /** Fixed direction (angle/elevation don't move for an existing planet —
   * only how far out along that same ray it sits changes). */
  angleDeg: number
  elevation: number
  /** The orbit radius the relationship-change nudge would naturally produce. */
  targetOrbitRadius: number
  newRadius: number
  existingSpheres: readonly OccupiedSphere[]
  safetyGap?: number
}

/**
 * For an *existing* person whose intimacy just changed (closer/distant/
 * reconnected), finds the orbit radius nearest to the naive target that's
 * still collision-free, searching outward in both directions along their
 * existing angle/elevation so the relationship-distance change is honored
 * as closely as possible instead of being discarded outright. Existing
 * direction is never altered — only how far out along it the planet sits.
 */
export function findNearestSafeRadius({
  angleDeg,
  elevation,
  targetOrbitRadius,
  newRadius,
  existingSpheres,
  safetyGap = SPHERE_LAYOUT_CONFIG.defaultSafetyGap,
}: FindRadiusParams): { orbitRadius: number; position: THREE.Vector3; moved: boolean } {
  const { minOrbitRadius, maxOrbitRadius } = SPHERE_LAYOUT_CONFIG
  const clampedTarget = Math.min(maxOrbitRadius, Math.max(minOrbitRadius, targetOrbitRadius))

  const naivePosition = sphericalToWorld(angleDeg, elevation, clampedTarget)
  if (isPositionClear(naivePosition, newRadius, existingSpheres, safetyGap)) {
    return { orbitRadius: clampedTarget, position: naivePosition, moved: false }
  }

  const step = 0.1
  const maxOffset = maxOrbitRadius - minOrbitRadius
  for (let offset = step; offset <= maxOffset; offset += step) {
    for (const direction of [1, -1]) {
      const candidateRadius = clampedTarget + direction * offset
      if (candidateRadius < minOrbitRadius || candidateRadius > maxOrbitRadius) continue
      const candidatePosition = sphericalToWorld(angleDeg, elevation, candidateRadius)
      if (isPositionClear(candidatePosition, newRadius, existingSpheres, safetyGap)) {
        return { orbitRadius: candidateRadius, position: candidatePosition, moved: true }
      }
    }
  }

  // No safe radius anywhere along this ray (essentially unreachable in
  // practice) — hold the planet at its last known-good radius rather than
  // placing it inside another sphere.
  return { orbitRadius: clampedTarget, position: naivePosition, moved: false }
}
