import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Check, LoaderCircle, Search, UserPlus, X } from 'lucide-react'
import { apiClient } from '../../product/api/apiClient'
import type { DiscoverableUser, RelationType, SocialRelationship } from '../../product/contracts'
import { useProductStore } from '../../product/store/useProductStore'
import { useI18n } from '../../product/i18n'
import type { TranslationKey } from '../../product/i18n/messages'
import { getEvidenceAdjustedAffinity } from './profileAffinity'
import styles from './RelationshipEditor.module.css'

interface RelationshipEditorProps {
  relationship?: SocialRelationship | null
  onClose: () => void
  onSaved?: (targetUserId: string) => void
}

const relationOptions: Array<{ value: RelationType; label: TranslationKey }> = [
  { value: 'family', label: 'relationship.family' },
  { value: 'friend', label: 'relationship.friend' },
  { value: 'partner', label: 'relationship.partner' },
  { value: 'colleague', label: 'relationship.colleague' },
  { value: 'classmate', label: 'relationship.classmate' },
  { value: 'mentor', label: 'relationship.mentor' },
  { value: 'community', label: 'relationship.community' },
  { value: 'past', label: 'relationship.past' },
  { value: 'other', label: 'relationship.other' },
]

type AffinityRequestState = 'loading' | 'resolved'

export function RelationshipEditor({ relationship, onClose, onSaved }: RelationshipEditorProps) {
  const { t } = useI18n()
  const createRelationship = useProductStore((state) => state.createRelationship)
  const [people, setPeople] = useState<DiscoverableUser[]>([])
  const [targetUserId, setTargetUserId] = useState(relationship?.targetUserId ?? '')
  const [relationType, setRelationType] = useState<RelationType>(relationship?.relationType ?? 'friend')
  const [identityLabel, setIdentityLabel] = useState(relationship?.identityLabel ?? t('relationship.defaultIdentity'))
  const [description, setDescription] = useState(relationship?.description ?? t('relationship.defaultDescription'))
  const [startedAt, setStartedAt] = useState(relationship?.startedAt ?? '')
  const [loading, setLoading] = useState(false)
  const [discovering, setDiscovering] = useState(!relationship)
  const discoveryRequestId = useRef(0)
  const requestedAffinityIds = useRef(new Set<string>())
  const [affinityRequestStates, setAffinityRequestStates] = useState<Record<string, AffinityRequestState>>({})
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (relationship) return
    const requestId = ++discoveryRequestId.current
    const normalizedQuery = query.trim()
    const timer = window.setTimeout(() => {
      setDiscovering(true)
      setError('')
      apiClient.discoverUsers(false, normalizedQuery)
        .then(({ users }) => {
          if (requestId !== discoveryRequestId.current) return
          setPeople(users)
          setTargetUserId((current) => {
            const currentPerson = users.find((person) => person.id === current)
            if (currentPerson && currentPerson.canConnect !== false) return current
            return users.find((person) => person.canConnect !== false)?.id ?? ''
          })
        })
        .catch((cause) => {
          if (requestId !== discoveryRequestId.current) return
          setError(cause instanceof Error ? cause.message : t('relationship.nearbyFailed'))
          setPeople([])
          setTargetUserId('')
        })
        .finally(() => {
          if (requestId === discoveryRequestId.current) setDiscovering(false)
        })
    }, normalizedQuery ? 300 : 0)
    return () => window.clearTimeout(timer)
  }, [query, relationship, t])

  useEffect(() => {
    if (relationship || !targetUserId) return
    const selected = people.find((person) => person.id === targetUserId)
    if (!selected || selected.canConnect === false || requestedAffinityIds.current.has(targetUserId)) return
    requestedAffinityIds.current.add(targetUserId)
    setAffinityRequestStates((current) => ({ ...current, [targetUserId]: 'loading' }))
    apiClient.getUserAffinity(targetUserId)
      .then((result) => {
        setPeople((current) => current.map((person) => person.id === targetUserId
          ? { ...person, ...result }
          : person))
        setAffinityRequestStates((current) => ({ ...current, [targetUserId]: 'resolved' }))
      })
      .catch(() => {
        setPeople((current) => current.map((person) => person.id === targetUserId
          ? { ...person, profileAffinity: null, affinityConfidence: 0, profileFeatures: [] }
          : person))
        setAffinityRequestStates((current) => ({ ...current, [targetUserId]: 'resolved' }))
      })
  }, [people, relationship, targetUserId])

  const selectedPerson = people.find((person) => person.id === targetUserId) ?? null
  const selectedAffinityState = selectedPerson ? affinityRequestStates[selectedPerson.id] : undefined
  const selectedAffinity = selectedPerson ? getEvidenceAdjustedAffinity(selectedPerson) : null

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!targetUserId || !selectedPerson || selectedPerson.canConnect === false) {
      setError(t('relationship.validation'))
      return
    }
    setLoading(true)
    setError('')
    try {
      await createRelationship({
        targetUserId,
        relationType,
        identityLabel: identityLabel.trim(),
        description: description.trim(),
        status: relationship?.status ?? 'active',
        startedAt: startedAt || null,
      })
      onSaved?.(targetUserId)
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('relationship.saveFailed'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={styles.backdrop} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className={styles.panel} role="dialog" aria-modal="true" aria-label={t('relationship.editor')}>
        <header>
          <div className={styles.icon}><UserPlus size={18} /></div>
          <div><span>{relationship ? t('relationship.signal') : t('relationship.addEyebrow')}</span><h2>{relationship ? t('relationship.refine') : t('relationship.addTitle')}</h2><p>{!relationship && t('relationship.addDescription')}</p></div>
          <button type="button" className={styles.close} onClick={onClose} title={t('common.close')}><X size={17} /></button>
        </header>
        <form onSubmit={handleSubmit}>
          <label>
            {t('relationship.personPlanet')}
            {relationship ? (
              <div className={styles.readonly}>{relationship.targetName}</div>
            ) : (
              <div className={styles.peoplePicker}>
                <div className={styles.search}><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('relationship.searchPlaceholder')} aria-label={t('relationship.searchPlaceholder')} /></div>
                <div className={styles.peopleList}>
                  {discovering && <div className={styles.loadingPeople}><LoaderCircle size={15} className={styles.spinner} />{query.trim() ? t('relationship.searching') : t('relationship.loadingPeople')}</div>}
                  {!discovering && people.map((person) => {
                    const unavailable = person.canConnect === false
                    const status = person.connected
                      ? t('relationship.alreadyConnected')
                      : person.planetReady === false
                        ? t('relationship.planetPending')
                        : person.planetName
                    return <button
                      type="button"
                      key={person.id}
                      className={unavailable ? styles.personUnavailable : person.id === targetUserId ? styles.personActive : styles.person}
                      onClick={() => !unavailable && setTargetUserId(person.id)}
                      disabled={unavailable}
                    >
                      <span className={styles.personAvatar}>{person.displayName.slice(0, 1).toUpperCase()}</span>
                      <span className={styles.personCopy}><strong>{person.displayName}</strong><small>{status}</small></span>
                      {person.id === targetUserId && <Check size={15} />}
                    </button>
                  })}
                  {!discovering && people.length === 0 && <p className={styles.none}>{query.trim() ? t('relationship.noResults') : t('relationship.noneFound')}</p>}
                </div>
              </div>
            )}
          </label>
          {!relationship && selectedPerson && <div className={styles.distanceHint}>
            <span>{t('relationship.distanceHintLabel')}</span>
            <strong>{selectedAffinityState === 'loading'
              ? t('relationship.calculatingAffinity')
              : selectedAffinityState === 'resolved' && selectedAffinity === null
              ? t('relationship.affinityInsufficient')
              : selectedAffinity === null
              ? t('relationship.distancePending')
              : `${t('relationship.distanceHint')} · ${Math.round(selectedAffinity * 100)}%`}</strong>
            <small>{selectedPerson.planetName} · {selectedPerson.displayName}</small>
          </div>}
          {relationship && <div className={styles.columns}>
            <label>
              {t('relationship.type')}
              <select value={relationType} onChange={(event) => setRelationType(event.target.value as RelationType)}>
                {relationOptions.map((option) => <option key={option.value} value={option.value}>{t(option.label)}</option>)}
              </select>
            </label>
            <label>
              {t('relationship.identity')}
              <input value={identityLabel} onChange={(event) => setIdentityLabel(event.target.value)} placeholder={t('relationship.identityPlaceholder')} />
            </label>
          </div>}
          {relationship && <label>
            {t('relationship.description')}
            <textarea rows={4} value={description} onChange={(event) => setDescription(event.target.value)} placeholder={t('relationship.descriptionPlaceholder')} />
          </label>}
          {relationship && <label>
            {t('relationship.knownSince')}
              <input type="date" value={startedAt} onInput={(event) => setStartedAt(event.currentTarget.value)} />
          </label>}
          {error && <p className={styles.error}>{error}</p>}
          <footer>
            <button type="button" className={styles.cancel} onClick={onClose}>{t('common.cancel')}</button>
            <button type="submit" className={styles.save} disabled={loading || !targetUserId || !selectedPerson || selectedPerson.canConnect === false}>
              {loading && <LoaderCircle size={15} className={styles.spinner} />}
              {relationship ? t('relationship.save') : t('relationship.addConfirm')}
            </button>
          </footer>
        </form>
      </section>
    </div>
  )
}
