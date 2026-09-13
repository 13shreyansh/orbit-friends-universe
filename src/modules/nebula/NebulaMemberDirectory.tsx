import { Orbit, Radio, X } from 'lucide-react'
import type { NebulaSpace } from '../../product/contracts'
import { useI18n } from '../../product/i18n'
import type { TranslationKey } from '../../product/i18n/messages'
import styles from './NebulaMemberDirectory.module.css'

interface NebulaMemberDirectoryProps {
  open: boolean
  space: NebulaSpace
  selfPlanetId: string
  onClose: () => void
  onSelectPlanet: (planetId: string) => void
}

export function NebulaMemberDirectory({
  open,
  space,
  selfPlanetId,
  onClose,
  onSelectPlanet,
}: NebulaMemberDirectoryProps) {
  const { t } = useI18n()
  if (!open) return null

  const members = [...space.members].sort((left, right) => {
    if (left.planet.id === selfPlanetId) return -1
    if (right.planet.id === selfPlanetId) return 1
    return left.distance - right.distance
  })

  return (
    <aside className={styles.drawer} aria-label={t('nebula.memberDirectory')}>
      <header>
        <div>
          <span>{t('nebula.groupSpace')}</span>
          <h2>{space.nebula.name}</h2>
          <p>{t('nebula.loadedMembers', { loaded: members.length, total: space.pagination.total })}</p>
        </div>
        <button type="button" onClick={onClose} title={t('nebula.closeMemberDirectory')} aria-label={t('nebula.closeMemberDirectory')}>
          <X size={17} />
        </button>
      </header>

      <div className={styles.list}>
        {members.map((member) => {
          const planet = member.planet
          const isSelf = planet.id === selfPlanetId
          return (
            <article key={member.userId} className={isSelf ? styles.selfRow : styles.memberRow}>
              <div className={styles.memberHeading}>
                <span className={member.status === 'broadcasting' ? styles.broadcastSignal : styles.orbitSignal} />
                <div>
                  <strong>{planet.ownerName}</strong>
                  <small>{isSelf ? t('nebula.you') : planet.identity.name}</small>
                </div>
                <span className={styles.distance}>{member.distance.toFixed(1)}</span>
              </div>

              <p className={styles.description}>{planet.identity.description || planet.identity.motto}</p>

              <dl>
                <div><dt>{t('nebula.memberRole')}</dt><dd>{t(`nebula.role.${member.role}` as TranslationKey)}</dd></div>
                <div><dt>{t('nebula.memberState')}</dt><dd>{t(`nebula.memberStatus.${member.status}` as TranslationKey)}</dd></div>
                <div><dt>{t('planet.mass')}</dt><dd>{Math.round(planet.identity.mass)}</dd></div>
              </dl>

              {planet.identity.tags.length > 0 && (
                <div className={styles.tags}>{planet.identity.tags.slice(0, 4).map((tag) => <span key={tag}>{tag}</span>)}</div>
              )}

              {!isSelf && (
                <button className={styles.focusAction} type="button" onClick={() => onSelectPlanet(planet.id)}>
                  {member.status === 'broadcasting' ? <Radio size={14} /> : <Orbit size={14} />}
                  <span>{member.status === 'broadcasting' ? t('nebula.locateSignal') : t('nebula.locatePlanet')}</span>
                </button>
              )}
            </article>
          )
        })}
      </div>
    </aside>
  )
}
