import { ArrowUpRight, Radio } from 'lucide-react'
import type { ActivityPost } from '../../product/contracts'
import { useI18n } from '../../product/i18n'
import { activityHeadline } from './ecosystemPresentation'
import styles from './ActivityDiscoveryCard.module.css'

interface ActivityDiscoveryCardProps {
  activity: ActivityPost
  isOwnPlanet: boolean
  onOpen: () => void
}

export function ActivityDiscoveryCard({ activity, isOwnPlanet, onOpen }: ActivityDiscoveryCardProps) {
  const { t } = useI18n()
  return (
    <button type="button" className={styles.card} onClick={onOpen}>
      <i style={{ '--signal': activity.ecosystemEffect.primaryColor } as React.CSSProperties} />
      <span>{isOwnPlanet ? t('activity.ownChanged') : t('activity.discovered')}</span>
      <strong>{activity.eventName || activityHeadline(activity, t)}</strong>
      <small>{isOwnPlanet ? t('activity.ownDescription') : t('activity.friendDescription', { name: activity.authorName })}</small>
      <em>{t('activity.explore')} <ArrowUpRight size={13} /></em>
      <Radio className={styles.radio} size={16} />
    </button>
  )
}
