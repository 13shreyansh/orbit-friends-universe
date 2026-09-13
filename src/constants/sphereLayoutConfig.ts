/**
 * Centralized tuning for the new-contact collision-avoidance placement
 * algorithm (src/utils/spherePlacement.ts). Values are in the same
 * world-unit scale as the rest of the cosmos: planet radii run
 * ~0.16-0.5, orbit radii run 3.0-9.2, core radius (incl. atmosphere) is
 * ~1.65 — see src/utils/relationshipVisuals.ts.
 */
export const SPHERE_LAYOUT_CONFIG = {
  /** Extra clearance kept between any two planet *surfaces*, on top of
   * their two radii. ~35-100% of the smallest planet's radius — a visibly
   * distinct gap without wasting orbit space. */
  defaultSafetyGap: 0.18,
  /** Additional clearance specifically around the core planet, added on
   * top of defaultSafetyGap. The core is large and always front-and-center,
   * so it earns a more generous buffer than person-to-person spacing. */
  centerSafetyGap: 0.3,

  maxPlacementAttempts: 100,
  /** Attempts per radius/elevation-range "expansion tier" — every this-many
   * failed tries, the search space widens a bit before trying again. */
  attemptsPerExpansion: 20,
  /** Fractional growth applied to the elevation search band and orbit-radius
   * jitter per expansion tier (tier = floor(attempt / attemptsPerExpansion)). */
  expansionStep: 0.15,

  // Mirrors ORBIT_RADIUS_MIN/MAX from relationshipVisuals.ts — kept as a
  // plain copy here (not an import) so this config stays a single
  // self-contained source of truth for placement tuning specifically.
  minOrbitRadius: 3.0,
  maxOrbitRadius: 9.2,

  /** Initial vertical spread band (same units as Person.position.elevation,
   * -1..1) new contacts are sampled within before any expansion — matches
   * the flattened-disk feel of the curated cast rather than scattering
   * straight up/down. Expansion tiers widen toward the full -1..1 range. */
  minElevation: -0.6,
  maxElevation: 0.6,
} as const
