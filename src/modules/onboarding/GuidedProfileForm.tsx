import { ArrowLeft, ArrowRight, SkipForward } from 'lucide-react'
import type { GuidedProfileDraft, GuidedProfileField } from './profileDistanceModel'
import { GUIDED_PROFILE_FIELDS } from './guidedProfileFields'
import styles from './OnboardingFlow.module.css'

interface GuidedProfileFormProps {
  draft: GuidedProfileDraft
  fieldIndex: number
  isZh: boolean
  onChange: (field: GuidedProfileField, value: string) => void
  onBack: () => void
  onAdvance: () => void
  onSkip: () => void
}

export function GuidedProfileForm({ draft, fieldIndex, isZh, onChange, onBack, onAdvance, onSkip }: GuidedProfileFormProps) {
  const field = GUIDED_PROFILE_FIELDS[fieldIndex]
  const value = draft[field.id]
  const multiline = field.id === 'projectDirection' || field.id === 'bio'
  const isLast = fieldIndex === GUIDED_PROFILE_FIELDS.length - 1

  return (
    <div className={styles.guidedField}>
      <div className={styles.guidedFieldIndex}>{field.step} / {String(GUIDED_PROFILE_FIELDS.length).padStart(2, '0')} · {isZh ? field.title.zh : field.title.en}</div>
      <h2>{isZh ? field.question.zh : field.question.en}</h2>
      <p>{isZh ? field.why.zh : field.why.en}</p>
      <label className={styles.guidedInput}>
        {multiline ? (
          <textarea autoFocus rows={4} value={value} onChange={(event) => onChange(field.id, event.target.value)} placeholder={isZh ? field.placeholder.zh : field.placeholder.en} />
        ) : (
          <input autoFocus value={value} onChange={(event) => onChange(field.id, event.target.value)} placeholder={isZh ? field.placeholder.zh : field.placeholder.en} />
        )}
      </label>
      <div className={styles.liveSignal}><i />{isZh ? 'Saving updates world mass, coordinates, and real-user discovery' : 'Saving updates world mass, coordinates, and real-user discovery'}</div>
      <div className={styles.fieldActions}>
        <button type="button" className={styles.skipField} onClick={onBack}><ArrowLeft size={15} />{isZh ? 'Previous' : 'Previous'}</button>
        <button type="button" className={styles.skipField} onClick={onSkip}><SkipForward size={15} />{isZh ? 'Skip this question' : 'Skip this question'}</button>
        <button type="button" className={styles.advanceField} onClick={onAdvance}>{isLast ? (isZh ? 'Finish profile guide' : 'Finish profile guide') : (isZh ? 'Confirm and observe' : 'Confirm and observe')}<ArrowRight size={15} /></button>
      </div>
    </div>
  )
}
