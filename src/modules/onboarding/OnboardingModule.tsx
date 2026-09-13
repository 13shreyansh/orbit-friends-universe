import { OnboardingFlow } from './OnboardingFlow'
import type { OnboardingModuleProps } from './types'

/**
 * Public entry point for the complete user-guidance experience.
 * Product screens should depend on this component rather than internal steps.
 */
export function OnboardingModule(props: OnboardingModuleProps = {}) {
  return <OnboardingFlow {...props} />
}
