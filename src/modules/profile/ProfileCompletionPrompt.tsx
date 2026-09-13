import { ArrowRight, Orbit, X } from 'lucide-react'
import { PROFILE_COMPLETION_FACT_COUNT } from './profileCompletion'
import styles from './ProfileCompletionPrompt.module.css'

interface ProfileCompletionPromptProps {
  answered: number
  isZh: boolean
  onOpen: () => void
  onDismiss: () => void
}

export function ProfileCompletionPrompt({ answered, isZh, onOpen, onDismiss }: ProfileCompletionPromptProps) {
  return (
    <section className={styles.prompt} aria-label={isZh ? 'Complete your profile' : 'Complete your profile'}>
      <button type="button" className={styles.close} onClick={onDismiss} title={isZh ? 'Complete later' : 'Complete later'} aria-label={isZh ? 'Complete later' : 'Complete later'}>
        <X size={15} />
      </button>
      <div className={styles.icon}><Orbit size={19} /></div>
      <div className={styles.copy}>
        <span>{isZh ? `PROFILE COORDINATES ${answered}/${PROFILE_COMPLETION_FACT_COUNT}` : `PROFILE COORDINATES ${answered}/${PROFILE_COMPLETION_FACT_COUNT}`}</span>
        <strong>{isZh ? 'Complete the details you skipped' : 'Complete the details you skipped'}</strong>
        <p>{isZh ? 'School, city, experience, and interests contribute to real social distance.' : 'School, city, experience, and interests contribute to real social distance.'}</p>
      </div>
      <button type="button" className={styles.action} onClick={onOpen}>
        {isZh ? 'Complete now' : 'Complete now'}
        <ArrowRight size={15} />
      </button>
    </section>
  )
}
