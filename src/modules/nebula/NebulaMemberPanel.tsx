import { ArrowUpRight, Radio, Route, X } from 'lucide-react'
import type { ActivityPost, NebulaMember } from '../../product/contracts'
import { useI18n } from '../../product/i18n'
import styles from './NebulaMemberPanel.module.css'

interface NebulaMemberPanelProps {
  member: NebulaMember
  activity: ActivityPost | null
  onClose: () => void
  onVisit: () => void
  onInspectActivity: () => void
}

export function NebulaMemberPanel({ member, activity, onClose, onVisit, onInspectActivity }: NebulaMemberPanelProps) {
  const { t } = useI18n()
  const planet = member.planet
  const statusKey = `nebula.memberStatus.${member.status}` as const
  return (
    <aside className={styles.panel} aria-label={t('planet.friendWorld')}>
      <button className={styles.close} type="button" onClick={onClose} title={t('common.close')} aria-label={t('common.close')}><X size={16} /></button>
      <div className={styles.eyebrow}><span className={member.status === 'broadcasting' ? styles.signal : styles.quietSignal} />{t(statusKey)}</div>
      <h2>{planet.ownerName}</h2>
      <p className={styles.planetName}>{planet.identity.name}</p>
      <p className={styles.description}>{planet.identity.description || planet.identity.motto}</p>
      <dl className={styles.stats}>
        <div><dt>{t('planet.mass')}</dt><dd>{Math.round(planet.identity.mass)}</dd></div>
        <div><dt>{t('nebula.distance')}</dt><dd>{member.distance.toFixed(1)}</dd></div>
        <div><dt>{t('planet.relationForce')}</dt><dd>{Math.round(planet.relationshipStrength * 100)}%</dd></div>
      </dl>
      <div className={styles.source}><span>{t('nebula.graphSource')}</span><strong>social-spherical-v1</strong></div>
      <div className={styles.actions}>
        <button type="button" onClick={onVisit}><Route size={15} /> {t('planet.rideComet')}</button>
        {activity && <button type="button" className={styles.signalAction} onClick={onInspectActivity}><Radio size={15} /> {t('nebula.inspectSignal')}</button>}
      </div>
      {activity && <button type="button" className={styles.activityLink} onClick={onInspectActivity}>{activity.title || activity.text || t('galaxy.newEcology')} <ArrowUpRight size={13} /></button>}
    </aside>
  )
}
