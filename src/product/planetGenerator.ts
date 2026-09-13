/**
 * Compatibility facade. Planet generation and rendering styles now live
 * together behind the dedicated planet style module.
 */
export {
  planetStyleModule as planetGenerator,
  type PlanetGenerationMode,
  type PlanetGenerationRequest,
} from '../modules/planet/style/planetStyleModule'
