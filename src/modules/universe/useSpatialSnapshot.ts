import { useEffect, useRef, useState } from 'react'
import type { SocialPlanet, SpatialSnapshot, UniverseWindowPayload } from '../../product/contracts'
import { useI18n } from '../../product/i18n'
import {
  apiSpatialLayoutProvider,
  type SpatialLayoutProvider,
} from '../../product/api/spatialLayoutProvider'

export function useSpatialSnapshot(
  centerPlanet: SocialPlanet | null,
  planets: SocialPlanet[],
  enabled: boolean,
  onWindow?: (window: UniverseWindowPayload) => void,
  provider: SpatialLayoutProvider = apiSpatialLayoutProvider,
) {
  const { t } = useI18n()
  const [snapshot, setSnapshot] = useState<SpatialSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const planetsRef = useRef(planets)
  planetsRef.current = planets

  useEffect(() => {
    if (!centerPlanet || !enabled) {
      setSnapshot(null)
      return
    }

    let active = true
    let timer = 0
    setError(null)
    setSnapshot(null)

    const mergeSnapshot = (current: SpatialSnapshot | null, incoming: SpatialSnapshot) => {
      if (!current || current.graphVersion !== incoming.graphVersion) return incoming
      const nodes = new Map(current.nodes.map((node) => [node.planetId, node]))
      incoming.nodes.forEach((node) => nodes.set(node.planetId, node))
      const edges = new Map(current.edges.map((edge) => [`${edge.sourcePlanetId}:${edge.targetPlanetId}`, edge]))
      incoming.edges.forEach((edge) => edges.set(`${edge.sourcePlanetId}:${edge.targetPlanetId}`, edge))
      return {
        ...incoming,
        nodes: [...nodes.values()],
        edges: [...edges.values()].filter((edge) => nodes.has(edge.sourcePlanetId) && nodes.has(edge.targetPlanetId)),
        bounds: { ...incoming.bounds, radius: Math.max(current.bounds.radius, incoming.bounds.radius) },
      }
    }

    if (provider.getWindow) {
      const load = async (offset: number) => {
        try {
          const payload = await provider.getWindow!(offset, 12)
          if (!active) return
          setSnapshot((current) => mergeSnapshot(current, payload.snapshot))
          onWindow?.(payload)
          if (payload.pagination.hasMore && payload.pagination.nextOffset !== null) {
            timer = window.setTimeout(() => void load(payload.pagination.nextOffset!), 650)
          }
        } catch {
          if (active) setError(t('universe.spatialUnavailable'))
        }
      }
      void load(0)
      return () => {
        active = false
        window.clearTimeout(timer)
      }
    }

    provider
      .getSnapshot({ centerPlanet, planets: planetsRef.current })
      .then((nextSnapshot) => {
        if (active) setSnapshot(nextSnapshot)
      })
      .catch(() => {
        if (active) setError(t('universe.spatialUnavailable'))
      })

    const unsubscribe = provider.subscribe?.(
      { centerPlanet, planets: planetsRef.current },
      (nextSnapshot) => {
        if (active) setSnapshot(nextSnapshot)
      },
    )

    return () => {
      active = false
      unsubscribe?.()
    }
  }, [centerPlanet, enabled, onWindow, provider, t])

  return { snapshot, error }
}
