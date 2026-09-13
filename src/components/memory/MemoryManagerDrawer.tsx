import { type FormEvent, useEffect, useState } from 'react'
import { ArrowLeft, History, Pencil, Play, RefreshCw, Search, Trash2, X } from 'lucide-react'
import { apiClient } from '../../product/api/apiClient'
import { useProductStore } from '../../product/store/useProductStore'
import { useAddMemoryStore } from '../../store/useAddMemoryStore'
import type {
  AnalysisJobRecord,
  ConfirmedMemoryDetail,
  ConfirmedMemoryListItem,
  MemoryObject,
  MemoryRevisionRecord,
} from '../../types/memoryObject'
import styles from './MemoryManagerDrawer.module.css'
import { formatShanghaiTime } from '../../utils/time'


function mergeMemories(current: ConfirmedMemoryListItem[], incoming: ConfirmedMemoryListItem[]) {
  const byId = new Map(current.map((item) => [item.id, item]))
  for (const item of incoming) byId.set(item.id, item)
  return [...byId.values()]
}

export function MemoryManagerDrawer() {
  const open = useAddMemoryStore((state) => state.libraryOpen)
  const close = useAddMemoryStore((state) => state.closeLibrary)
  const triggerToast = useAddMemoryStore((state) => state.triggerToast)
  const openDraftForConfirmation = useAddMemoryStore((state) => state.openDraftForConfirmation)
  const memoryChangeVersion = useAddMemoryStore((state) => state.memoryChangeVersion)
  const notifyMemoryChanged = useAddMemoryStore((state) => state.notifyMemoryChanged)
  const requestedMemoryId = useAddMemoryStore((state) => state.requestedMemoryId)
  const clearMemoryDetailRequest = useAddMemoryStore((state) => state.clearMemoryDetailRequest)
  const relationships = useProductStore((state) => state.relationships)
  const hydrateCosmos = useProductStore((state) => state.hydrateCosmos)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<ConfirmedMemoryDetail | null>(null)
  const [document, setDocument] = useState<MemoryObject | null>(null)
  const [relationshipId, setRelationshipId] = useState<string | null>(null)
  const [revisions, setRevisions] = useState<MemoryRevisionRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [archiveItems, setArchiveItems] = useState<ConfirmedMemoryListItem[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [archiveLoading, setArchiveLoading] = useState(false)
  const [archiveError, setArchiveError] = useState('')
  const [queryInput, setQueryInput] = useState('')
  const [query, setQuery] = useState('')
  const [filterRelationshipId, setFilterRelationshipId] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [reloadVersion, setReloadVersion] = useState(0)
  const [jobs, setJobs] = useState<AnalysisJobRecord[]>([])
  const [jobBusyId, setJobBusyId] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !requestedMemoryId) return
    setSelectedId(requestedMemoryId)
    clearMemoryDetailRequest()
  }, [clearMemoryDetailRequest, open, requestedMemoryId])

  useEffect(() => {
    if (open || !selectedId) return
    setSelectedId(null)
    setDetail(null)
    setDocument(null)
    setRevisions([])
    setError('')
  }, [open, selectedId])

  useEffect(() => {
    if (!open || selectedId) return
    let active = true
    setArchiveLoading(true)
    setArchiveError('')
    Promise.all([
      apiClient.listMemories({
        limit: 20,
        relationshipId: filterRelationshipId,
        from: fromDate,
        to: toDate,
        query,
      }),
      apiClient.listIngestionJobs({ status: 'awaiting_confirmation', limit: 50 }),
    ])
      .then(([memoryPage, jobPage]) => {
        if (!active) return
        setArchiveItems(memoryPage.items)
        setNextCursor(memoryPage.nextCursor)
        setJobs(jobPage.items)
      })
      .catch((cause) => {
        if (active) setArchiveError((cause as Error).message)
      })
      .finally(() => {
        if (active) setArchiveLoading(false)
      })
    return () => { active = false }
  }, [filterRelationshipId, fromDate, memoryChangeVersion, open, query, reloadVersion, selectedId, toDate])

  useEffect(() => {
    if (!open || !selectedId) return
    let active = true
    setLoading(true)
    setError('')
    Promise.all([
      apiClient.getMemoryDetail(selectedId),
      apiClient.getMemoryRevisions(selectedId),
    ])
      .then(([nextDetail, nextRevisions]) => {
        if (!active) return
        setDetail(nextDetail)
        setDocument(nextDetail.memory)
        setRelationshipId(nextDetail.relationshipId)
        setRevisions(nextRevisions)
      })
      .catch((cause) => {
        if (active) setError((cause as Error).message)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [open, selectedId])

  if (!open) return null

  const recoverableJobs = jobs.filter((job) => job.status === 'awaiting_confirmation' && job.draftId)

  const updateDocument = (patch: Partial<MemoryObject>) => {
    setDocument((current) => current ? { ...current, ...patch } : current)
  }

  const applySearch = (event: FormEvent) => {
    event.preventDefault()
    setQuery(queryInput.trim())
  }

  const loadMore = async () => {
    if (!nextCursor || archiveLoading) return
    setArchiveLoading(true)
    setArchiveError('')
    try {
      const page = await apiClient.listMemories({
        cursor: nextCursor,
        limit: 20,
        relationshipId: filterRelationshipId,
        from: fromDate,
        to: toDate,
        query,
      })
      setArchiveItems((current) => mergeMemories(current, page.items))
      setNextCursor(page.nextCursor)
    } catch (cause) {
      setArchiveError((cause as Error).message)
    } finally {
      setArchiveLoading(false)
    }
  }

  const resumeJob = async (job: AnalysisJobRecord) => {
    if (jobBusyId) return
    setJobBusyId(job.id)
    setArchiveError('')
    try {
      if (job.status === 'awaiting_confirmation' && job.draftId) {
        openDraftForConfirmation(await apiClient.getMemoryDraft(job.draftId))
        return
      }
      triggerToast('Your draft is being prepared. You can continue editing shortly.')
    } catch {
      setArchiveError('Could not open this draft. Please try again later.')
    } finally {
      setJobBusyId(null)
    }
  }

  const save = async () => {
    if (!selectedId || !detail || !document || busy) return
    setBusy(true)
    setError('')
    try {
      const result = await apiClient.reviseMemory(selectedId, detail.currentVersion, document, relationshipId)
      hydrateCosmos(result.cosmos)
      setDetail((current) => current ? {
        ...current,
        memory: result.memory,
        relationshipId,
        currentVersion: result.revision.version,
        latestRevision: result.revision,
        updatedAt: result.revision.createdAt,
      } : current)
      setDocument(result.memory)
      setRevisions((current) => [
        ...current.filter((revision) => revision.id !== result.revision.id),
        result.revision,
      ].sort((left, right) => left.version - right.version))
      notifyMemoryChanged()
      triggerToast('Memory changes saved.')
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!selectedId || !document || busy) return
    if (!window.confirm(`Delete “${document.summary}”? Related copies will also be removed.`)) return
    setBusy(true)
    setError('')
    try {
      const result = await apiClient.deleteMemory(selectedId)
      hydrateCosmos(result.cosmos)
      setArchiveItems((current) => current.filter((memory) => memory.id !== selectedId))
      setSelectedId(null)
      setDetail(null)
      setDocument(null)
      setRevisions([])
      notifyMemoryChanged()
      triggerToast('Memory deleted. Related copies are queued for removal.')
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button type="button" className={styles.backdrop} aria-label="Close memory manager" onClick={close} />
      <aside className={styles.panel} aria-label="Saved memory manager">
        <header className={styles.header}>
          {selectedId && (
            <button type="button" className={styles.iconButton} aria-label="Back to memories" onClick={() => setSelectedId(null)}>
              <ArrowLeft size={17} />
            </button>
          )}
          <div>
            <span>MEMORY ARCHIVE</span>
            <h2>{selectedId ? 'Edit saved memory' : 'Saved memories'}</h2>
          </div>
          <button type="button" className={styles.iconButton} aria-label="Close" onClick={close}>
            <X size={17} />
          </button>
        </header>

        {error && <p className={styles.error}>{error}</p>}
        {!selectedId && (
          <>
            <form className={styles.filters} onSubmit={applySearch}>
              <div className={styles.searchRow}>
                <input
                  aria-label="Search memories"
                  placeholder="Search saved memories"
                  value={queryInput}
                  onChange={(event) => setQueryInput(event.target.value)}
                />
                <button type="submit" aria-label="Search"><Search size={15} /></button>
                <button type="button" aria-label="Refresh memories" onClick={() => setReloadVersion((value) => value + 1)}>
                  <RefreshCw size={15} />
                </button>
              </div>
              <select
                aria-label="Filter by connection"
                value={filterRelationshipId}
                onChange={(event) => setFilterRelationshipId(event.target.value)}
              >
                <option value="">All connections</option>
                {relationships.map((relationship) => (
                  <option key={relationship.id} value={relationship.id}>{relationship.targetName}</option>
                ))}
              </select>
              <div className={styles.dateRow}>
                <label>From<input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label>
                <label>To<input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></label>
              </div>
            </form>

            {archiveError && <p className={styles.error}>{archiveError}</p>}
            {recoverableJobs.length > 0 && (
              <section className={styles.jobs} aria-label="Memory drafts to review">
                <h3>Drafts to review</h3>
                {recoverableJobs.map((job) => (
                  <article key={job.id}>
                    <div><strong>Memory draft</strong><span>{formatShanghaiTime(job.updatedAt, 'en-US', {
                      year: 'numeric', month: '2-digit', day: '2-digit',
                      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
                    })}</span></div>
                    <div className={styles.jobActions}>
                      <button type="button" disabled={jobBusyId === job.id} onClick={() => void resumeJob(job)}>
                        <Play size={13} /> Continue editing
                      </button>
                    </div>
                  </article>
                ))}
              </section>
            )}

            <div className={styles.list}>
              {!archiveLoading && archiveItems.length === 0 && <p className={styles.empty}>No saved memories match your filters.</p>}
              {archiveItems.map((memory) => (
                <button
                  type="button"
                  className={styles.memoryCard}
                  key={memory.id}
                  aria-label={`Open memory ${memory.summary}`}
                  onClick={() => setSelectedId(memory.id)}
                >
                  <span>{memory.eventTime}</span>
                  <strong>{memory.summary}</strong>
                  <small>{memory.location || memory.eventType} · v{memory.currentVersion}</small>
                </button>
              ))}
              {archiveLoading && <p className={styles.empty}>Loading memories…</p>}
              {nextCursor && !archiveLoading && (
                <button type="button" className={styles.loadMore} onClick={() => void loadMore()}>Load more</button>
              )}
            </div>
          </>
        )}

        {selectedId && loading && <p className={styles.empty}>Loading memory and versions…</p>}
        {selectedId && !loading && detail && document && (
          <div className={styles.editor}>
            <label>
              <span>What happened</span>
              <textarea rows={4} value={document.summary} onChange={(event) => updateDocument({ summary: event.target.value })} />
            </label>
            <div className={styles.twoColumns}>
              <label><span>Date</span><input type="date" value={document.eventTime} onChange={(event) => updateDocument({ eventTime: event.target.value })} /></label>
              <label><span>Place</span><input value={document.location} onChange={(event) => updateDocument({ location: event.target.value })} /></label>
            </div>
            <label>
              <span>Connection</span>
              <select value={relationshipId ?? ''} onChange={(event) => setRelationshipId(event.target.value || null)}>
                <option value="">No connection</option>
                {relationships.map((relationship) => (
                  <option key={relationship.id} value={relationship.id}>{relationship.targetName} · {relationship.identityLabel}</option>
                ))}
              </select>
            </label>
            <label><span>Memory story</span><textarea rows={3} value={document.narrative} onChange={(event) => updateDocument({ narrative: event.target.value })} /></label>

            <div className={styles.meta}>
              <span>Current version v{detail.currentVersion}</span><span>{detail.sources.length} sources</span>
            </div>
            <section className={styles.history}>
              <h3><History size={15} /> Revision history</h3>
              {revisions.length === 0 && <p>The first edit to this older memory will start its revision history.</p>}
              {revisions.map((revision) => (
                <div key={revision.id}>
                  <strong>v{revision.version} · {revision.reason}</strong>
                  <span>{formatShanghaiTime(revision.createdAt, 'en-US', {
                    year: 'numeric', month: '2-digit', day: '2-digit',
                    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
                  })}</span>
                  <p>{revision.document.summary}</p>
                </div>
              ))}
            </section>

            <div className={styles.actions}>
              <button type="button" className={styles.deleteButton} disabled={busy} onClick={() => void remove()}><Trash2 size={15} /> Delete</button>
              <button type="button" className={styles.saveButton} disabled={busy || !document.summary.trim()} onClick={() => void save()}>
                <Pencil size={15} /> {busy ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        )}
      </aside>
    </>
  )
}
