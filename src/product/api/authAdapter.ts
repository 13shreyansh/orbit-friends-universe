import type { AuthSession, CosmosPayload, UserProfile } from '../contracts'
import { apiClient } from './apiClient'

export interface AuthCredentials {
  email: string
  password: string
  displayName?: string
  verificationCode?: string
}

export interface AuthResult {
  session: AuthSession
  profile: UserProfile
  cosmos: CosmosPayload
}

export interface AuthAdapter {
  getConfig(): Promise<{ emailVerificationRequired: boolean; emailDeliveryConfigured: boolean }>
  signIn(credentials: AuthCredentials): Promise<AuthResult>
  signUp(credentials: AuthCredentials): Promise<AuthResult>
  requestSignupVerification(email: string): Promise<{ expiresIn: number; resendAfter: number }>
  signOut(): Promise<void>
}

function toResult(payload: Awaited<ReturnType<typeof apiClient.signIn>>): AuthResult {
  return { session: payload.session, profile: payload.profile, cosmos: payload }
}

export const authAdapter: AuthAdapter = {
  getConfig() {
    return apiClient.getAuthConfig()
  },
  async signIn(credentials) {
    return toResult(await apiClient.signIn(credentials))
  },
  async signUp(credentials) {
    return toResult(await apiClient.signUp(credentials))
  },
  async requestSignupVerification(email) {
    return apiClient.requestSignupVerification(email)
  },
  async signOut() {
    await apiClient.signOut()
  },
}
