export type OnboardingMode = 'create' | 'edit'

export type OnboardingStep = 'personality' | 'planet' | 'profile' | 'matching' | 'review'

export interface OnboardingModuleProps {
  mode?: OnboardingMode
  initialStep?: OnboardingStep
  onClose?: () => void
  onSaved?: () => void
}
