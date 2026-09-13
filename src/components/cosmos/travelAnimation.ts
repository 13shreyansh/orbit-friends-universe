export type TravelAnimationPhase =
  | 'IDLE'
  | 'INTRO_CHARACTER_SHOW'
  | 'MOUNT_METEOR'
  | 'FLYING_TO_PLANET'
  | 'FLYING_BACK'
  | 'ARRIVE_PLANET'

export const CHARACTER_INTRO_DURATION = 2.4
export const CHARACTER_ROTATION_END_PROGRESS = 0.72
export const VISIT_MOUNT_DURATION = 1.15
export const IGNITION_DURATION = 0.65
export const RETURN_MOUNT_DURATION = 0.75
export const VISIT_PREFLIGHT_DURATION =
  CHARACTER_INTRO_DURATION + VISIT_MOUNT_DURATION + IGNITION_DURATION

export function preflightDuration(showCharacterIntro: boolean): number {
  return showCharacterIntro ? VISIT_PREFLIGHT_DURATION : RETURN_MOUNT_DURATION
}

export function characterShowcaseRotation(introProgress: number): number {
  const rotationProgress = Math.min(
    1,
    Math.max(0, introProgress / CHARACTER_ROTATION_END_PROGRESS),
  )
  const easedRotation = rotationProgress * rotationProgress * (3 - 2 * rotationProgress)
  return easedRotation * Math.PI * 2
}
