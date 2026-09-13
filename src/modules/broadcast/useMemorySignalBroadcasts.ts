import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MemorySignal, UniverseScale } from '../../product/contracts'

interface Options {
  signals: MemorySignal[]
  selfPlanetId: string
  visiblePlanetIds: string[]
  scale: UniverseScale
}

export function useMemorySignalBroadcasts({ signals, selfPlanetId, visiblePlanetIds, scale }: Options) {
  const [activeSignal, setActiveSignal] = useState<MemorySignal | null>(null)
  const queueRef = useRef<MemorySignal[]>([])
  const knownIdsRef = useRef<Set<string> | null>(null)
  const visiblePlanetIdSet = useMemo(() => new Set(visiblePlanetIds), [visiblePlanetIds])

  const enqueue = useCallback((signal: MemorySignal) => {
    setActiveSignal((current) => {
      if (!current) return signal
      queueRef.current.push(signal)
      return current
    })
  }, [])

  const completeActiveSignal = useCallback(() => {
    setActiveSignal(queueRef.current.shift() ?? null)
  }, [])

  useEffect(() => {
    if (scale !== 'galaxy') return
    const knownIds = knownIdsRef.current
    if (!knownIds) {
      knownIdsRef.current = new Set()
      for (const signal of signals) {
        if (
          signal.visible
          && signal.active
          && signal.senderUserId !== selfPlanetId
          && signal.sourcePlanetId
          && visiblePlanetIdSet.has(signal.sourcePlanetId)
        ) enqueue(signal)
        knownIdsRef.current.add(signal.id)
      }
      return
    }
    for (const signal of signals) {
      if (knownIds.has(signal.id)) continue
      knownIds.add(signal.id)
      if (
        signal.visible
        && signal.active
        && signal.senderUserId !== selfPlanetId
        && signal.sourcePlanetId
        && visiblePlanetIdSet.has(signal.sourcePlanetId)
      ) enqueue(signal)
    }
  }, [enqueue, scale, selfPlanetId, signals, visiblePlanetIdSet])

  return { activeSignal, completeActiveSignal }
}
