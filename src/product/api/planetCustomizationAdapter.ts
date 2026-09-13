import type {
  PlanetCustomizationRequest,
  PlanetCustomizationResult,
  PlanetRendererExtension,
} from '../contracts'
import { apiClient } from './apiClient'

export interface PlanetCustomizationAdapter {
  customize(request: PlanetCustomizationRequest): Promise<PlanetCustomizationResult>
  getRendererExtension?(shaderId: string): Promise<PlanetRendererExtension | null>
}

export const planetCustomizationAdapter: PlanetCustomizationAdapter = {
  customize(request) {
    return apiClient.customizePlanet(request)
  },
  async getRendererExtension() {
    return null
  },
}
