import { AnimatePresence, motion } from 'framer-motion'
import { useSceneStore } from '../../store/useSceneStore'
import { usePeopleStore } from '../../store/usePeopleStore'
import styles from './UIOverlay.module.css'

export function UIOverlay() {
  const isReady = useSceneStore((state) => state.isReady)
  const mode = useSceneStore((state) => state.mode)
  const selectedPersonId = useSceneStore((state) => state.selectedPersonId)
  const returnToPersonMode = useSceneStore((state) => state.returnToPersonMode)
  const people = usePeopleStore((state) => state.people)

  const selectedPerson = people.find((person) => person.id === selectedPersonId) ?? null

  return (
    <div className={styles.overlay}>
      <motion.div
        className={styles.topLeft}
        initial={{ opacity: 0, y: 8 }}
        animate={isReady ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 1.2, ease: 'easeOut' }}
      >
        <div className={styles.title}>SOCIAL COSMOS</div>
        <div className={styles.subtitle}>
          A private universe of people and memories.
        </div>
      </motion.div>

      <AnimatePresence>
        {mode === 'memories' && (
          <motion.button
            type="button"
            className={styles.backButton}
            onClick={() => returnToPersonMode()}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
          >
            ← Back to {selectedPerson ? selectedPerson.name.split(' ')[0] : 'person'}
          </motion.button>
        )}
      </AnimatePresence>

      <motion.div
        className={styles.bottomCenter}
        initial={{ opacity: 0, y: 8 }}
        animate={isReady && mode !== 'cometRide' ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }}
        transition={{ duration: 1.2, delay: 0.2, ease: 'easeOut' }}
      >
        <div className={styles.bottomText}>
          Explore the people, memories and relationships that shape your
          life.
        </div>
      </motion.div>
    </div>
  )
}
