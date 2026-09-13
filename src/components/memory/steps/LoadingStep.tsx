import { AnimatePresence, motion } from 'framer-motion'
import { useAddMemoryStore } from '../../../store/useAddMemoryStore'
import styles from './LoadingStep.module.css'

const STAGE_LABELS = [
  'Reading your memory',
  'Finding the people involved',
  'Understanding the moment and feelings',
  'Exploring what this memory means to your connection',
]

export function LoadingStep() {
  const loadingStage = useAddMemoryStore((state) => state.loadingStage)

  return (
    <div className={styles.wrapper}>
      <div className={styles.glow} />
      <AnimatePresence mode="wait">
        <motion.p
          key={loadingStage}
          className={styles.label}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.35, ease: 'easeOut' }}
        >
          {STAGE_LABELS[loadingStage] ?? STAGE_LABELS[0]}
        </motion.p>
      </AnimatePresence>
      <div className={styles.dots}>
        {STAGE_LABELS.map((label, index) => (
          <span
            key={label}
            className={`${styles.dot} ${index <= loadingStage ? styles.dotActive : ''}`}
          />
        ))}
      </div>
    </div>
  )
}
