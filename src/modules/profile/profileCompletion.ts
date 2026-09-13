import type { ProfileIntakePayload } from '../../product/contracts'

export const PROFILE_COMPLETION_FACT_COUNT = 9

export function countProfileFacts(intake: ProfileIntakePayload | null | undefined): number {
  if (!intake) return 0
  return [
    intake.education?.some((item) => item.level === 'secondary'),
    intake.education?.some((item) => item.level !== 'secondary'),
    intake.education?.some((item) => Boolean(item.fieldOfStudy?.trim())),
    Boolean(intake.residences?.[0]?.place.name.trim()),
    Boolean(intake.birthPlace?.name.trim()),
    Boolean(intake.interests?.length),
    Boolean(intake.skills?.length),
    Boolean(intake.projects?.some((item) => Boolean(item.description?.trim()))),
    Boolean(intake.bio?.trim()),
  ].filter(Boolean).length
}

export function needsProfileSupplement(intake: ProfileIntakePayload | null | undefined): boolean {
  return countProfileFacts(intake) < PROFILE_COMPLETION_FACT_COUNT
}
