import { AudioLines, ChevronLeft, ChevronRight, Image, Leaf, MessageSquarePlus, PenLine, Plus, Video } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { ActivityPost, EcosystemKind, SocialPlanet } from '../../product/contracts'
import { useI18n } from '../../product/i18n'
import { activityHeadline, ecosystemLabel } from '../activity/ecosystemPresentation'
import styles from './PlanetLifePanel.module.css'
import type { PlanetMemory } from '../memory/planetMemory'
import { PlanetStorySummary } from '../memory/PlanetStorySummary'
import { formatShanghaiTime } from '../../utils/time'

interface PlanetLifePanelProps {
  planet: SocialPlanet
  activities: ActivityPost[]
  isOwnPlanet: boolean
  onPublish: () => void
  onAddMemory: () => void
  onOpenActivity: (activity: ActivityPost) => void
  memories: PlanetMemory[]
}

function baseEcosystem(planet: SocialPlanet): EcosystemKind {
  if (planet.visual.archetype === 'volcanic') return 'volcanic-forge'
  if (planet.visual.archetype === 'oceanic') return 'tidal-ocean'
  if (planet.visual.archetype === 'verdant') return 'luminous-forest'
  if (planet.visual.oceanLevel > 0.52) return 'moonlit-lake'
  return 'luminous-forest'
}

export function PlanetLifePanel({
  planet,
  activities,
  isOwnPlanet,
  onPublish,
  onAddMemory,
  onOpenActivity,
  memories,
}: PlanetLifePanelProps) {
  const { isZh, locale, t } = useI18n()
  const memoryLabel = isZh ? 'Chat record' : 'Chat record'
  const [open, setOpen] = useState(false)
  const sortedActivities = useMemo(
    () => [...activities].sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt)),
    [activities],
  )
  const ecologyCounts = useMemo(() => {
    const counts = new Map<EcosystemKind, number>()
    for (const activity of sortedActivities) {
      const kind = activity.ecosystemEffect.kind
      counts.set(kind, (counts.get(kind) ?? 0) + 1)
    }
    if (!counts.size) counts.set(baseEcosystem(planet), 1)
    return [...counts.entries()].map(([kind, count]) => ({
      kind,
      count,
      activity: sortedActivities.find((activity) => activity.ecosystemEffect.kind === kind),
    }))
  }, [planet, sortedActivities])

  if (!open) {
    return (
      <button type="button" className={styles.openButton} onClick={() => setOpen(true)} aria-label={t('planet.openLifePanel')}>
        <ChevronLeft size={17} />
        <Leaf size={16} />
      </button>
    )
  }

  return (
    <aside className={styles.panel} aria-label={t('planet.lifePanel')}>
      <button type="button" className={styles.collapse} onClick={() => setOpen(false)} aria-label={t('planet.closeLifePanel')}>
        <ChevronRight size={16} />
      </button>

      <section className={styles.profile}>
        <span>{isOwnPlanet ? t('planet.yourProfile') : t('planet.residentProfile')}</span>
        <h2>{planet.ownerName}</h2>
        <p>{planet.identity.description || planet.identity.motto}</p>
        <div className={styles.tags}>
          {planet.identity.tags.slice(0, 6).map((tag) => <i key={tag}>{tag}</i>)}
        </div>
        <div className={styles.metrics}>
          <div><small>{t('planet.mass')}</small><strong>{Math.round(planet.identity.mass)}</strong></div>
          <div><small>{t('planet.ecologyCount')}</small><strong>{ecologyCounts.length}</strong></div>
          <div><small>{t('planet.activityCount')}</small><strong>{sortedActivities.length}</strong></div>
        </div>
      </section>

      {!isOwnPlanet && <PlanetStorySummary friendName={planet.ownerName} memories={memories} />}

      <section className={styles.ecologies}>
        <header><Leaf size={14} /><strong>{t('planet.ecologyAtlas')}</strong></header>
        <div>
          {ecologyCounts.map(({ kind, count, activity }) => (
            <span key={kind}>
              {activity ? ecosystemLabel(activity, t) : t('activity.generatedEcology')}
              {count > 1 && <b>×{count}</b>}
            </span>
          ))}
        </div>
      </section>

      <section className={styles.timeline}>
        <header>
          <div><PenLine size={14} /><strong>{t('planet.activityTimeline')}</strong></div>
          {isOwnPlanet && (
            <div className={styles.timelineActions}>
              <button type="button" onClick={onAddMemory}><MessageSquarePlus size={14} />{memoryLabel}</button>
              <button type="button" onClick={onPublish}><Plus size={14} />{t('planet.publish')}</button>
            </div>
          )}
        </header>

        {sortedActivities.length ? (
          <div className={styles.feed}>
            {sortedActivities.map((activity) => {
              const imageCount = activity.media.filter((media) => media.type === 'image').length
              const audioCount = activity.media.filter((media) => media.type === 'audio').length
              const videoCount = activity.media.filter((media) => media.type === 'video').length
              return (
                <button type="button" key={activity.id} onClick={() => onOpenActivity(activity)}>
                  <i style={{ background: activity.ecosystemEffect.primaryColor }} />
                  <div>
                    <span>{formatShanghaiTime(activity.publishedAt, locale, {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                      hourCycle: 'h23',
                    })}</span>
                    {activity.title && <strong>{activity.title}</strong>}
                    {activity.text && <p>{activity.text}</p>}
                    {!activity.title && !activity.text && <strong>{activityHeadline(activity, t)}</strong>}
                    <small>
                      {imageCount > 0 && <em><Image size={11} />{imageCount}</em>}
                      {audioCount > 0 && <em><AudioLines size={11} />{audioCount}</em>}
                      {videoCount > 0 && <em><Video size={11} />{videoCount}</em>}
                      <em><Leaf size={11} />{ecosystemLabel(activity, t)}</em>
                    </small>
                  </div>
                </button>
              )
            })}
          </div>
        ) : (
          <div className={styles.empty}>
            <Leaf size={24} />
            <strong>{t('planet.noActivities')}</strong>
            <p>{isOwnPlanet ? t('planet.noActivitiesOwn') : t('planet.noActivitiesFriend')}</p>
            {isOwnPlanet && <button type="button" onClick={onPublish}>{t('planet.publishFirst')}</button>}
          </div>
        )}
      </section>
    </aside>
  )
}
