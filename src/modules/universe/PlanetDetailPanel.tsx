import { ArrowRight, Pencil, Radio, X } from 'lucide-react'
import type { ActivityPost, SocialPlanet, SocialRelationship } from '../../product/contracts'
import { useI18n } from '../../product/i18n'
import type { TranslationKey } from '../../product/i18n/messages'
import { activityHeadline } from '../activity/ecosystemPresentation'
import { PlanetMemoryInput } from '../memory/PlanetMemoryInput'
import styles from './PlanetDetailPanel.module.css'
import { getFriendsStory } from '../../demo/friendsStories'
import { useProductStore } from '../../product/store/useProductStore'

interface PlanetDetailPanelProps {
  planet: SocialPlanet
  relationship: SocialRelationship | null
  activity: ActivityPost | null
  distanceFromHome: number | null
  onClose: () => void
  onVisit: () => void
  onEditRelationship: () => void
  onInspectActivity: () => void
  onAddMemory?: () => void
}

export function PlanetDetailPanel({ planet, relationship, activity, distanceFromHome, onClose, onVisit, onEditRelationship, onInspectActivity, onAddMemory }: PlanetDetailPanelProps) {
  const { t, isZh } = useI18n()
  const memories = useProductStore(state => state.memories)
  const viewerId = useProductStore(state => state.profile?.id ?? '')
  const story = getFriendsStory(viewerId, planet.ownerId)
  const isChapter = planet.ownerId.startsWith('chapter-')
  const photos = [...new Map(memories.filter(memory => memory.people.some(person => person.id === planet.ownerId) || memory.sharedByUserId === planet.ownerId).flatMap(memory => (memory.media ?? []).filter(media => media.type === 'image')).map(media => [media.url,media])).values()].slice(0,5)
  const featureLabels: Record<string, { zh: string; en: string }> = {
    profile_affinity: { zh: 'Profile affinity', en: 'Profile affinity' },
    interaction_frequency: { zh: 'Observed interaction', en: 'Observed interaction' },
    recency: { zh: 'Interaction recency', en: 'Interaction recency' },
    shared_experience: { zh: 'Shared experiences', en: 'Shared experiences' },
    duration: { zh: 'Relationship duration', en: 'Relationship duration' },
    reciprocity: { zh: 'Reciprocal activity', en: 'Reciprocal activity' },
  }
  const evidence = relationship?.score.features
    .filter((feature) => feature.weight > 0)
    .sort((left, right) => right.contribution - left.contribution)
    .slice(0, 4) ?? []
  if (story) return <aside className={`${styles.panel} ${styles.demoPanel}`} aria-label={`${story.title} shared story`}>
    <button className={styles.close} aria-label="Close relationship" onClick={onClose}><X size={18}/></button>
    <span className={styles.eyebrow}>YOUR SHARED STORY</span>
    <h2>{story.title}</h2><p className={styles.demoRelationship}>{story.relationship}</p>
    <p className={styles.demoDescription}>{story.description}</p>
    <div className={styles.demoPhotos}>{story.photos.slice(0,3).map(photo=><img key={photo.url} src={photo.url} alt={photo.caption}/>)}</div>
    <span className={styles.demoCount}>{story.photos.length} photographs from your story together</span>
    <button className={styles.visit} onClick={onVisit}>Relive our story <ArrowRight size={17}/></button>
  </aside>
  return (
    <aside className={styles.panel} aria-label={t('planet.aria', { name: planet.ownerName })}>
      <button type="button" className={styles.close} onClick={onClose} title={t('common.close')} aria-label={t('common.close')}>
        <X size={16} />
      </button>
      <span className={styles.eyebrow}>{isChapter ? 'MEMORY CHAPTER' : t('planet.friendWorld')}</span>
      <h2>{planet.identity.name}</h2>
      <p className={styles.owner}>{planet.ownerName}</p>
      {!!photos.length && <div className={styles.photos}>{photos.map(photo => <img key={photo.url} src={photo.url} alt={photo.name}/>)}</div>}
      <button type="button" className={styles.visit} onClick={onVisit}>Visit this planet <ArrowRight size={16}/></button>
      {relationship && !isChapter && (
        <div className={styles.relationship}>
          <span>{t(`relationship.${relationship.relationType}` as TranslationKey)}</span>
          <strong>{relationship.identityLabel}</strong>
          <p>{relationship.description}</p>
          <div className={styles.evidence}>
            <small>{isZh ? 'OBJECTIVE EVIDENCE' : 'OBJECTIVE EVIDENCE'}</small>
            <div><span>{isZh ? 'Profile affinity' : 'Profile affinity'}</span><b>{relationship.score.profileAffinity === null ? '—' : `${Math.round(relationship.score.profileAffinity * 100)}%`}</b></div>
            <div><span>{isZh ? 'Dynamic evidence' : 'Dynamic evidence'}</span><b>{Math.round(relationship.score.dynamicEvidence * 100)}%</b></div>
            {evidence.map((feature) => (
              <div key={feature.name}>
                <span>{featureLabels[feature.name]?.[isZh ? 'zh' : 'en'] ?? feature.name}</span>
                <b>{Math.round(feature.value * 100)}%</b>
              </div>
            ))}
          </div>
          <button type="button" onClick={onEditRelationship}><Pencil size={13} /> {t('planet.editRelationship')}</button>
        </div>
      )}
      <p className={styles.description}>{planet.identity.description}</p>
      {activity && (
        <button type="button" className={styles.activity} onClick={onInspectActivity}>
          <Radio size={14} />
          <span><small>{t('planet.activeSignal')}</small><strong>{activity.eventName || activityHeadline(activity, t)}</strong></span>
          <ArrowRight size={14} />
        </button>
      )}
      <div className={styles.tags}>
        {planet.identity.tags.map((tag) => <span key={tag}>{tag}</span>)}
      </div>
      <dl className={styles.metrics}>
        {distanceFromHome !== null && <div className={styles.distanceMetric}><dt>{t('planet.distanceFromYou')}</dt><dd>{distanceFromHome.toFixed(1)} <small>{t('planet.distanceUnit')}</small></dd></div>}
        <div><dt>{t('planet.mass')}</dt><dd>{planet.identity.mass}</dd></div>
        <div><dt>{t('planet.relationForce')}</dt><dd>{Math.round(planet.relationshipStrength * 100)}</dd></div>
      </dl>
      {!isChapter && <PlanetMemoryInput targetName={planet.ownerName} onAddMemory={onAddMemory} />}
    </aside>
  )
}
