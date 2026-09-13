import { useI18n } from './useI18n'
import styles from './LanguageSwitcher.module.css'

export function LanguageSwitcher() {
  const { isZh, t, toggleLocale } = useI18n()

  return (
    <button type="button" className={styles.switcher} onClick={toggleLocale} aria-label={t('language.switch')}>
      {isZh ? 'English' : 'English'}
      <span className={styles.divider}>/</span>
      {isZh ? 'EN' : <strong>EN</strong>}
    </button>
  )
}
