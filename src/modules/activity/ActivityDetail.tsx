import { useEffect, useState } from 'react'
import { CalendarDays, MapPin, Radio, X } from 'lucide-react'
import type { ActivityPost } from '../../product/contracts'
import { useI18n } from '../../product/i18n'
import { activityHeadline, ecosystemLabel } from './ecosystemPresentation'
import { formatShanghaiTime } from '../../utils/time'
import styles from './ActivityDetail.module.css'

interface ActivityDetailProps {
  activity: ActivityPost
  onClose: () => void
}

function MediaAttachment({ media, title }: { media: ActivityPost['media'][number]; title: string }) {
  const { t } = useI18n()
  const [failed, setFailed] = useState(false)

  if (failed) {
    return <p className={styles.mediaError}>{t('activity.mediaFailed')}</p>
  }

  if (media.type === 'image') {
    return <img src={media.url} alt={title} onError={() => setFailed(true)} />
  }
  if (media.type === 'video') {
    return (
      <video
        src={media.url}
        controls
        playsInline
        preload="metadata"
        disablePictureInPicture
        onError={() => setFailed(true)}
      />
    )
  }
  return <audio src={media.url} controls preload="metadata" onError={() => setFailed(true)} />
}

export function ActivityDetail({ activity, onClose }: ActivityDetailProps) {
  const { locale, t } = useI18n()
  const effect = activity.ecosystemEffect
  const published = formatShanghaiTime(activity.publishedAt, locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previousOverflow }
  }, [])

  return (
    <div className={styles.backdrop} role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <article className={styles.detail} role="dialog" aria-modal="true" aria-label={activityHeadline(activity, t)}>
        <button type="button" className={styles.close} onClick={onClose} aria-label={t('activity.close')}><X size={17} /></button>
        <div className={styles.signal} style={{ '--signal': effect.primaryColor } as React.CSSProperties}>
          <Radio size={14} /> {t('activity.record')}
        </div>
        <span className={styles.author}>{t('activity.transmitted', { name: activity.authorName })}</span>
        {activity.title && <h2>{activity.title}</h2>}
        <p className={styles.text}>{activity.text}</p>
        {activity.tags?.length > 0 && (
          <div className={styles.tags}>{activity.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div>
        )}
        <div className={styles.meta}>
          <span><CalendarDays size={13} /> {[activity.eventName, published, 'Asia/Shanghai'].filter(Boolean).join(' · ')}</span>
          {activity.location && <span><MapPin size={13} /> {activity.location}</span>}
        </div>
        {activity.media.map((media) => (
          <div className={styles.media} key={media.url}>
            <MediaAttachment media={media} title={activityHeadline(activity, t)} />
          </div>
        ))}
        <div className={styles.ecology}>
          <i style={{ background: effect.primaryColor, boxShadow: `0 0 25px ${effect.primaryColor}` }} />
          <div><span>{t('activity.visibleConsequence')}</span><strong>{ecosystemLabel(activity, t)}</strong></div>
          <p>{t('activity.landmarks', { count: effect.landmarkCount, strength: Math.round(effect.signalStrength * 100) })}</p>
        </div>
      </article>
    </div>
  )
}
