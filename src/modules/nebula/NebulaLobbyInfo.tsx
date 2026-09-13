import { ArrowRight, Hash, Search, UserPlus, Users, X } from 'lucide-react'
import { useState } from 'react'
import type { NebulaSummary } from '../../product/contracts'
import { useI18n } from '../../product/i18n'
import styles from './NebulaLobbyInfo.module.css'

interface NebulaLobbyInfoProps {
  nebula: NebulaSummary
  onClose: () => void
  onEnter: (nebulaId: string) => void
  onJoin: (nebulaId: string) => Promise<unknown>
}

export function NebulaLobbyInfo({ nebula, onClose, onEnter, onJoin }: NebulaLobbyInfoProps) {
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const proceed = async () => {
    setBusy(true)
    setError('')
    try {
      if (nebula.joined) onEnter(nebula.id)
      else await onJoin(nebula.id)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t('nebula.directoryError'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <aside className={styles.panel} aria-label={t('nebula.groupInfo')}>
      <button type="button" className={styles.close} onClick={onClose} title={t('nebula.closeGroupInfo')}><X size={17} /></button>
      <span>{nebula.joined ? t('nebula.joinedGroup') : t('nebula.recommendedGroup')}</span>
      <h2>{nebula.name}</h2>
      <p>{nebula.description}</p>
      <dl>
        <div><dt><Users size={13} /> {t('nebula.membersLabel')}</dt><dd>{nebula.memberCount}</dd></div>
        <div><dt><Hash size={13} /> {t('nebula.joinCode')}</dt><dd>{nebula.joinCode}</dd></div>
      </dl>
      <button type="button" className={styles.proceed} onClick={() => void proceed()} disabled={busy}>
        {nebula.joined ? <ArrowRight size={16} /> : <UserPlus size={16} />}
        {busy ? t('nebula.loading') : nebula.joined ? t('nebula.enterGroup') : t('nebula.joinAndEnter')}
      </button>
      {error && <small>{error}</small>}
    </aside>
  )
}

export function NebulaLobbyHUD({ count, onBrowse }: { count: number; onBrowse: () => void }) {
  const { t } = useI18n()
  return (
    <div className={styles.hud}>
      <span>{t('nebula.groups')}</span>
      <strong>{t('nebula.recommendedCount', { count })}</strong>
      <button type="button" onClick={onBrowse}><Search size={14} /> {t('nebula.browseGroups')}</button>
    </div>
  )
}
