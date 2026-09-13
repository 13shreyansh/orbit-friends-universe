export interface GuidedProfileDraft {
  highSchool: string
  university: string
  major: string
  city: string
  hometown: string
  interests: string
  skills: string
  projectDirection: string
  bio: string
}

export type GuidedProfileField = keyof GuidedProfileDraft

export const EMPTY_GUIDED_PROFILE: GuidedProfileDraft = {
  highSchool: '',
  university: '',
  major: '',
  city: '',
  hometown: '',
  interests: '',
  skills: '',
  projectDirection: '',
  bio: '',
}
