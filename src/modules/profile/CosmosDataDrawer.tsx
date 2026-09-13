import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Gauge, Network, RefreshCw, Save, UserRound, X } from 'lucide-react'
import { apiClient } from '../../product/api/apiClient'
import type { PlanetScoreResult, ProfileGraphDocument } from '../../product/contracts'
import { useI18n } from '../../product/i18n'
import { useProductStore } from '../../product/store/useProductStore'
import styles from './CosmosDataDrawer.module.css'

type DataView = 'score' | 'graph' | 'profile'

interface CosmosDataDrawerProps {
  open: boolean
  onClose: () => void
}

function tagsFromInput(value: string): string[] {
  return value
    .split(/[,，、\n]+/)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 8)
}

export function CosmosDataDrawer({ open, onClose }: CosmosDataDrawerProps) {
  const { isZh } = useI18n()
  const profile = useProductStore((state) => state.profile)
  const updateProfile = useProductStore((state) => state.updateProfile)
  const hydrateCosmos = useProductStore((state) => state.hydrateCosmos)
  const [view, setView] = useState<DataView>('score')
  const [score, setScore] = useState<PlanetScoreResult | null>(null)
  const [graph, setGraph] = useState<ProfileGraphDocument | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [bio, setBio] = useState('')
  const [tags, setTags] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const loadData = useCallback(async () => {
    setLoading(true)
    setError('')
    const [scoreResult, graphResult] = await Promise.allSettled([
      apiClient.getPlanetScore(),
      apiClient.getProfileGraph(),
    ])
    if (scoreResult.status === 'fulfilled') setScore(scoreResult.value)
    if (graphResult.status === 'fulfilled') setGraph(graphResult.value)
    const failures = [scoreResult, graphResult]
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => result.reason instanceof Error ? result.reason.message : String(result.reason))
    setError(failures.join(' '))
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!open || !profile) return
    setDisplayName(profile.displayName)
    setBio(profile.bio)
    setTags(profile.tags.join(', '))
    void loadData()
  }, [loadData, open, profile])

  if (!open || !profile) return null

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault()
    if (saving || displayName.trim().length < 2) return
    setSaving(true)
    setError('')
    try {
      const result = await apiClient.updateProfile({
        displayName: displayName.trim(),
        bio: bio.trim(),
        tags: tagsFromInput(tags),
      })
      updateProfile(result.profile)
      hydrateCosmos(await apiClient.getCosmos())
      await loadData()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Profile update failed.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <button type="button" className={styles.backdrop} aria-label={isZh ? 'Close cosmos data' : 'Close cosmos data'} onClick={onClose} />
      <aside className={styles.panel} aria-label={isZh ? 'Cosmos data' : 'Cosmos data'}>
        <header className={styles.header}>
          <div><span>COSMOS DATA</span><h2>{profile.displayName}</h2></div>
          <button type="button" className={styles.iconButton} onClick={onClose} title={isZh ? 'Close' : 'Close'} aria-label={isZh ? 'Close' : 'Close'}><X size={17} /></button>
        </header>

        <nav className={styles.tabs} aria-label={isZh ? 'Data views' : 'Data views'}>
          <button type="button" className={view === 'score' ? styles.activeTab : ''} onClick={() => setView('score')}><Gauge size={15} />{isZh ? 'Mass' : 'Mass'}</button>
          <button type="button" className={view === 'graph' ? styles.activeTab : ''} onClick={() => setView('graph')}><Network size={15} />{isZh ? 'Graph' : 'Graph'}</button>
          <button type="button" className={view === 'profile' ? styles.activeTab : ''} onClick={() => setView('profile')}><UserRound size={15} />{isZh ? 'Profile' : 'Profile'}</button>
        </nav>

        {error && <p className={styles.error}>{error}</p>}
        {loading && <p className={styles.empty}>{isZh ? 'Loading backend results…' : 'Loading backend results…'}</p>}

        {!loading && view === 'score' && score && (
          <section className={styles.scoreView}>
            <div className={styles.scoreHero}>
              <strong>{score.massScore.toFixed(1)}</strong>
              <span>{isZh ? 'Mass score' : 'Mass score'}</span>
            </div>
            <dl className={styles.metrics}>
              <div><dt>{isZh ? 'Physical mass' : 'Physical mass'}</dt><dd>{score.physicalMass.toFixed(2)}</dd></div>
              <div><dt>{isZh ? 'Visual radius' : 'Visual radius'}</dt><dd>{score.visualRadius.toFixed(2)}</dd></div>
              <div><dt>{isZh ? 'Memories' : 'Memories'}</dt><dd>{score.memoryCount}</dd></div>
              <div><dt>{isZh ? 'Own events' : 'Own events'}</dt><dd>{score.behaviorEventCount}</dd></div>
              <div><dt>{isZh ? 'Incoming events' : 'Incoming events'}</dt><dd>{score.socialBehaviorEventCount}</dd></div>
              <div><dt>{isZh ? 'Confidence' : 'Confidence'}</dt><dd>{Math.round(score.confidence * 100)}%</dd></div>
            </dl>
            <div className={styles.features}>
              {score.features.map((feature) => (
                <div key={feature.name}>
                  <div><span>{feature.name}</span><strong>{Math.round(feature.value * 100)}%</strong></div>
                  <i><b style={{ width: `${Math.max(2, feature.value * 100)}%` }} /></i>
                </div>
              ))}
            </div>
          </section>
        )}

        {!loading && view === 'graph' && graph && (
          <section className={styles.graphView}>
            <div className={styles.graphSummary}>
              <span>{graph.nodes.length} {isZh ? 'nodes' : 'nodes'}</span>
              <span>{graph.edges.length} {isZh ? 'edges' : 'edges'}</span>
              <small>{graph.graphVersion.slice(0, 12)}</small>
            </div>
            <div className={styles.nodeList}>
              {graph.nodes.map((node) => (
                <div key={node.id}><span>{node.kind}</span><strong>{node.label}</strong></div>
              ))}
            </div>
            {graph.edges.length > 0 && (
              <div className={styles.edgeList}>
                {graph.edges.map((edge) => <div key={edge.id}><span>{edge.type}</span><code>{edge.source} → {edge.target}</code></div>)}
              </div>
            )}
          </section>
        )}

        {view === 'profile' && (
          <form className={styles.profileForm} onSubmit={saveProfile}>
            <label><span>{isZh ? 'Display name' : 'Display name'}</span><input value={displayName} minLength={2} maxLength={80} onChange={(event) => setDisplayName(event.target.value)} /></label>
            <label><span>{isZh ? 'Bio' : 'Bio'}</span><textarea rows={6} maxLength={2000} value={bio} onChange={(event) => setBio(event.target.value)} /></label>
            <label><span>{isZh ? 'Tags' : 'Tags'}</span><input value={tags} onChange={(event) => setTags(event.target.value)} /></label>
            <button type="submit" disabled={saving || displayName.trim().length < 2}><Save size={15} />{saving ? (isZh ? 'Saving…' : 'Saving…') : (isZh ? 'Save profile' : 'Save profile')}</button>
          </form>
        )}

        {!loading && ((view === 'score' && !score) || (view === 'graph' && !graph)) && <p className={styles.empty}>{isZh ? 'No data is available.' : 'No data is available.'}</p>}
        <button type="button" className={styles.refresh} disabled={loading} onClick={() => void loadData()}><RefreshCw size={14} />{isZh ? 'Refresh' : 'Refresh'}</button>
      </aside>
    </>
  )
}
