import { useCallback, useEffect, useRef, useState } from 'react'
import { apiClient } from '../../product/api/apiClient'
import type { ActivityPost, NebulaDirectoryPayload, NebulaSpace } from '../../product/contracts'

const emptyDirectory: NebulaDirectoryPayload = {
  joined: [],
  recommended: [],
  searchResults: [],
  catalog: [],
  pagination: { page: 1, pageSize: 6, total: 0, totalPages: 1 },
}

const NEBULA_WINDOW_SIZE = 24

function mergeSpace(current: NebulaSpace | null, incoming: NebulaSpace): NebulaSpace {
  if (!current || current.nebula.id !== incoming.nebula.id || current.graph.version !== incoming.graph.version) return incoming
  const mergeByKey = <T>(items: T[], additions: T[], key: (item: T) => string) => {
    const values = new Map(items.map((item) => [key(item), item]))
    additions.forEach((item) => values.set(key(item), item))
    return [...values.values()]
  }
  const nodes = mergeByKey(current.snapshot.nodes, incoming.snapshot.nodes, (node) => node.planetId)
  return {
    ...incoming,
    members: mergeByKey(current.members, incoming.members, (member) => member.userId),
    activities: mergeByKey(current.activities, incoming.activities, (activity) => activity.id),
    snapshot: {
      ...incoming.snapshot,
      nodes,
      edges: mergeByKey(current.snapshot.edges, incoming.snapshot.edges, (edge) => `${edge.sourcePlanetId}:${edge.targetPlanetId}`)
        .filter((edge) => nodes.some((node) => node.planetId === edge.sourcePlanetId) && nodes.some((node) => node.planetId === edge.targetPlanetId)),
      bounds: { ...incoming.snapshot.bounds, radius: Math.max(current.snapshot.bounds.radius, incoming.snapshot.bounds.radius) },
    },
  }
}

function normalizeDirectory(result: Partial<NebulaDirectoryPayload> | null | undefined): NebulaDirectoryPayload {
  const incomingPagination = result?.pagination
  const catalog = Array.isArray(result?.catalog)
    ? result.catalog
    : Array.isArray(result?.searchResults)
      ? result.searchResults
      : []
  const pageSize = typeof incomingPagination?.pageSize === 'number' && Number.isFinite(incomingPagination.pageSize)
    ? Math.max(1, incomingPagination.pageSize)
    : 6
  const total = typeof incomingPagination?.total === 'number' && Number.isFinite(incomingPagination.total)
    ? Math.max(0, incomingPagination.total)
    : catalog.length

  return {
    joined: Array.isArray(result?.joined) ? result.joined : [],
    recommended: Array.isArray(result?.recommended) ? result.recommended : [],
    searchResults: Array.isArray(result?.searchResults) ? result.searchResults : catalog,
    catalog,
    pagination: {
      page: typeof incomingPagination?.page === 'number' && Number.isFinite(incomingPagination.page)
        ? Math.max(1, incomingPagination.page)
        : 1,
      pageSize,
      total,
      totalPages: typeof incomingPagination?.totalPages === 'number' && Number.isFinite(incomingPagination.totalPages)
        ? Math.max(1, incomingPagination.totalPages)
        : Math.max(1, Math.ceil(total / pageSize)),
    },
  }
}

export function useNebulaSpace(enabled: boolean) {
  const [directory, setDirectory] = useState<NebulaDirectoryPayload>(emptyDirectory)
  const [activeNebulaId, setActiveNebulaId] = useState<string | null>(null)
  const [space, setSpace] = useState<NebulaSpace | null>(null)
  const [directoryOpen, setDirectoryOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [directoryLoading, setDirectoryLoading] = useState(false)
  const [error, setError] = useState('')
  const spaceRequestRef = useRef<string | null>(null)
  const spaceTimerRef = useRef(0)
  const wasEnabledRef = useRef(false)

  const loadDirectory = useCallback(async (query = '', page = 1) => {
    setDirectoryLoading(true)
    setError('')
    try {
      const result = await apiClient.getNebulae(query, page, 6)
      const normalized = normalizeDirectory(result)
      setDirectory(normalized)
      if (normalized.joined.length === 0) setDirectoryOpen(true)
      return normalized
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Nebula directory unavailable.')
      throw requestError
    } finally {
      setDirectoryLoading(false)
    }
  }, [])

  const refreshSpace = useCallback(async (nebulaId = activeNebulaId) => {
    if (!nebulaId) return null
    spaceRequestRef.current = nebulaId
    setLoading(true)
    setError('')
    try {
      window.clearTimeout(spaceTimerRef.current)
      const loadWindow = async (offset: number): Promise<NebulaSpace | null> => {
        const result = await apiClient.getNebulaSpace(nebulaId, offset, NEBULA_WINDOW_SIZE)
        if (spaceRequestRef.current !== nebulaId) return null
        setSpace((current) => mergeSpace(current, result))
        if (result.pagination.hasMore && result.pagination.nextOffset !== null) {
          spaceTimerRef.current = window.setTimeout(() => {
            void loadWindow(result.pagination.nextOffset!).catch((requestError) => {
              if (spaceRequestRef.current === nebulaId) {
                setError(requestError instanceof Error ? requestError.message : 'Nebula space unavailable.')
              }
            })
          }, 650)
        }
        return result
      }
      const result = await loadWindow(0)
      return result
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Nebula space unavailable.')
      throw requestError
    } finally {
      if (spaceRequestRef.current === nebulaId) setLoading(false)
    }
  }, [activeNebulaId])

  useEffect(() => {
    if (!enabled) return
    void loadDirectory().catch(() => undefined)
  }, [activeNebulaId, enabled, loadDirectory])

  useEffect(() => {
    if (enabled && !wasEnabledRef.current) setDirectoryOpen(true)
    if (!enabled) setDirectoryOpen(false)
    wasEnabledRef.current = enabled
  }, [enabled])

  useEffect(() => {
    if (!enabled || !activeNebulaId) return
    void refreshSpace(activeNebulaId).catch(() => undefined)
    return () => window.clearTimeout(spaceTimerRef.current)
  }, [activeNebulaId, enabled, refreshSpace])

  const enterNebula = useCallback((nebulaId: string) => {
    window.clearTimeout(spaceTimerRef.current)
    spaceRequestRef.current = nebulaId
    setSpace(null)
    setActiveNebulaId(nebulaId)
    setDirectoryOpen(false)
  }, [])

  const leaveNebula = useCallback(() => {
    window.clearTimeout(spaceTimerRef.current)
    spaceRequestRef.current = null
    setActiveNebulaId(null)
    setSpace(null)
    setLoading(false)
    setDirectoryOpen(false)
  }, [])

  const joinNebula = useCallback(async (nebulaId: string) => {
    const joined = await apiClient.joinNebula(nebulaId)
    await loadDirectory()
    enterNebula(joined.id)
    return joined
  }, [enterNebula, loadDirectory])

  const joinByCode = useCallback(async (joinCode: string) => {
    const joined = await apiClient.joinNebulaByCode(joinCode)
    await loadDirectory()
    enterNebula(joined.id)
    return joined
  }, [enterNebula, loadDirectory])

  const createNebula = useCallback(async (body: { name: string; description?: string }) => {
    const created = await apiClient.createNebula(body)
    await loadDirectory()
    enterNebula(created.id)
    return created
  }, [enterNebula, loadDirectory])

  const replaceActivity = useCallback((activity: ActivityPost) => {
    setSpace((current) => current ? {
      ...current,
      activities: current.activities.map((item) => item.id === activity.id ? activity : item),
      members: current.members.map((member) => member.latestActivityId === activity.id
        ? { ...member, status: activity.broadcast.visible ? 'broadcasting' : 'active' }
        : member),
    } : current)
    return activity
  }, [])

  const markActivityRead = useCallback(async (activityId: string) => {
    const result = await apiClient.markActivityBroadcastRead(activityId)
    return replaceActivity(result.activity)
  }, [replaceActivity])

  const closeActivity = useCallback(async (activityId: string) => {
    let previous: ActivityPost | null = null
    setSpace((current) => {
      if (!current) return current
      previous = current.activities.find((activity) => activity.id === activityId) ?? null
      return {
        ...current,
        activities: current.activities.map((activity) => activity.id === activityId
          ? { ...activity, broadcast: { ...activity.broadcast, active: false, visible: false } }
          : activity),
        members: current.members.map((member) => member.latestActivityId === activityId
          ? { ...member, status: 'active' }
          : member),
      }
    })
    try {
      const result = await apiClient.closeActivityBroadcast(activityId)
      return replaceActivity(result.activity)
    } catch (error) {
      if (previous) replaceActivity(previous)
      throw error
    }
  }, [replaceActivity])

  return {
    directory,
    activeNebulaId,
    space,
    loading,
    directoryLoading,
    error,
    directoryOpen,
    setDirectoryOpen,
    loadDirectory,
    enterNebula,
    leaveNebula,
    joinNebula,
    joinByCode,
    createNebula,
    refreshSpace,
    markActivityRead,
    closeActivity,
  }
}
