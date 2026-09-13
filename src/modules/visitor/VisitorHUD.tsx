import { useEffect } from 'react'
import { X } from 'lucide-react'
import { useI18n } from '../../product/i18n'
import styles from './VisitorHUD.module.css'

interface VisitorHUDProps {
  originName: string
  destinationName: string
  onCancel: () => void
}

export function VisitorHUD({ originName, destinationName, onCancel }: VisitorHUDProps) {
  const { t } = useI18n()
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onCancel])

  return (
    <div className={styles.hud}>
      <div className={styles.route}>
        <span>{t('visitor.transit')}</span>
        <strong>{originName} <i aria-hidden="true">-&gt;</i> {destinationName}</strong>
        <small>{t('visitor.locked')} · {t('visitor.rotateHint')}</small>
      </div>
      <button type="button" onClick={onCancel} title={t('visitor.cancel')} aria-label={t('visitor.cancel')}>
        <X size={17} />
      </button>
    </div>
  )
}
