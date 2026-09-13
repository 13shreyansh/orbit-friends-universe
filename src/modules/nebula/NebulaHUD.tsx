import { ArrowLeft, Hash, MessageCircle, Network, Users } from 'lucide-react'
import type { NebulaSpace } from '../../product/contracts'
import { useI18n } from '../../product/i18n'
import styles from './NebulaHUD.module.css'

interface NebulaHUDProps {
  space: NebulaSpace | null
  loading: boolean
  onLeaveNebula: () => void
}

export function NebulaHUD({ space, loading, onLeaveNebula }: NebulaHUDProps) {
  const { t } = useI18n()
  return (
    <div className={styles.hud}>
      <button type="button" onClick={onLeaveNebula} title={t('nebula.backToGroups')}>
        <ArrowLeft size={16} />
        <span>{t('nebula.backToGroups')}</span>
      </button>
      {space && (
        <>
          <strong className={styles.groupName}><MessageCircle size={13} /> {space.nebula.name}</strong>
          <div className={styles.meta}>
            <span><Users size={11} /> {space.nebula.memberCount}</span>
            <span><Network size={11} /> {space.graph.edgeCount}</span>
            <span><Hash size={11} /> {space.nebula.joinCode}</span>
          </div>
        </>
      )}
      {loading && <small>{t('nebula.loading')}</small>}
    </div>
  )
}
